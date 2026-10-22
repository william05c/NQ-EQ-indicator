// FIRST-TWO-HOUR CASH WINDOW - full quant study.
//
// Executes prompts/mega_prompt_first2h.txt. Entries only 09:30-11:30 ET, with a
// TIME STOP at 11:30 so a rule cannot hold a morning entry for eleven hours (the
// omission that made every earlier first-2h number meaningless).
//
// Exact specification of every variant is written to reports/first2h_results.json
// and docs/backtesting/first2h.md so the trade list can be rebuilt from scratch.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const STAKE = 10000, COST = 0.0002;
const OPEN_ET = 18 * 60;              // session open, minutes of day
const W_LO = 930, W_HI = 1050;        // 09:30 -> 11:30 ET, minutes after the open

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const skew = (a) => { const m = mean(a), s = sd(a); return a.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / a.length; };
const kurt = (a) => { const m = mean(a), s = sd(a); return a.reduce((t, x) => t + ((x - m) / s) ** 4, 0) / a.length - 3; };

function ols(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j < k; j++) { b[j] += X[i][j] * y[i]; for (let l = 0; l < k; l++) A[j][l] += X[i][j] * X[i][l]; }
  for (let i = 0; i < k; i++) A[i][i] += 1e-8;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let j = i; j < k; j++) A[i][j] /= d; b[i] /= d;
    for (let r = 0; r < k; r++) { if (r === i) continue; const f = A[r][i]; for (let j = i; j < k; j++) A[r][j] -= f * A[i][j]; b[r] -= f * b[i]; }
  }
  return b;
}
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

// ---------- daily band, walk-forward ----------
const drows = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_futures_daily.csv'), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
const n = drows.length;
const rr = drows.map((r) => (r.high - r.low) / r.close);
const lr = drows.map((r, i) => (i ? Math.log(r.close / drows[i - 1].close) : 0));
const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
const u = drows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
const d = drows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
const yU = u.map(Math.log), yD = d.map(Math.log);
let wU = null, wD = null, lastFit = -1;
const resU = [], resD = [];
const bands = new Map();
for (let t = WARMUP; t < n; t++) {
  if (lastFit < 0 || t - lastFit >= REFIT) {
    const X = [], a = [], b = [];
    for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
    wU = ols(X, a); wD = ols(X, b); lastFit = t;
  }
  const x = feats(t);
  const muU = dot(wU, x), muD = dot(wD, x);
  if (resU.length >= MIN_RESID) {
    const cap = (v) => Math.min(v, 0.69);
    const o = drows[t].open;
    bands.set(drows[t].date, {
      o,
      h90: o * (1 + Math.exp(cap(muU + q(resU, 0.9)))),
      l10: o * (1 - Math.exp(cap(muD + q(resD, 0.9)))),
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---------- intraday sessions ----------
const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_1min_2022_2025.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const sess = new Map();
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  const m = c[0].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) continue;
  const [, mo, dd, yy, hh, mi] = m.map(Number);
  const mins = hh * 60 + mi;
  let sy = yy, smo = mo, sdd = dd;
  if (mins < OPEN_ET) { const dt = new Date(Date.UTC(yy, mo - 1, dd)); dt.setUTCDate(dt.getUTCDate() - 1); sy = dt.getUTCFullYear(); smo = dt.getUTCMonth() + 1; sdd = dt.getUTCDate(); }
  const cd = new Date(Date.UTC(sy, smo - 1, sdd)); cd.setUTCDate(cd.getUTCDate() + 1);
  const td = cd.toISOString().slice(0, 10);
  const el = mins < OPEN_ET ? mins + 360 : mins - 1080;
  if (!sess.has(td)) sess.set(td, []);
  sess.get(td).push({ el, o: +c[1], h: +c[2], l: +c[3], c: +c[4] });
}

// ---------- build the trade candidates ----------
const candidates = [];
let skippedNoBand = 0, skippedShort = 0, noTouchInWindow = 0;
for (const [td, raw] of sess) {
  const b = bands.get(td);
  const bars = raw.slice().sort((a, b2) => a.el - b2.el);
  if (bars.length < 600) { skippedShort++; continue; }
  if (!b || !(b.h90 > b.l10)) { skippedNoBand++; continue; }
  const ratio = bars[0].o / b.o;          // alignment: daily series is back-adjusted
  const h90 = b.h90 * ratio, l10 = b.l10 * ratio;
  const H = (h90 - l10) / 2;
  let iHi = -1, iLo = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].el < W_LO || bars[i].el >= W_HI) continue;   // entry only inside the window
    if (iHi < 0 && bars[i].h >= h90) iHi = i;
    if (iLo < 0 && bars[i].l <= l10) iLo = i;
    if (iHi >= 0 && iLo >= 0) break;
  }
  if (iHi < 0 && iLo < 0) { noTouchInWindow++; continue; }
  if (iHi >= 0 && iLo >= 0 && iHi === iLo) continue;
  const side = (iHi >= 0 && (iLo < 0 || iHi < iLo)) ? 'hi' : 'lo';
  const idx = side === 'hi' ? iHi : iLo;
  const bar = bars[idx];
  const entry = side === 'hi' ? Math.max(bar.o, h90) : Math.min(bar.o, l10);
  // path runs to the 11:30 time stop
  const path = bars.slice(idx + 1).filter((x) => x.el < W_HI);
  candidates.push({ td, side, entry, H, at: bar.el, path });
}
console.log(`sessions ${sess.size}  candidates ${candidates.length}  no touch in window ${noTouchInWindow}  too short ${skippedShort}`);

// ---------- evaluate one variant ----------
// SPEC (identical for every cell):
//   entry  : first touch of the band inside 09:30-11:30 ET, at the band level
//            (or at the bar open if the session gapped through it)
//   direction: 'fade' buys the lower band and sells the upper; 'momentum' the reverse
//   target : f*H in favour      stop: g*H against
//   TIME STOP: any open position is closed at the 11:30 bar close
//   if target and stop occur in the same 1-minute bar, the STOP is assumed first
function run(direction, f, g) {
  const trades = [];
  for (const c of candidates) {
    const long = (c.side === 'lo') === (direction === 'fade');
    const tgt = long ? c.entry + f * c.H : c.entry - f * c.H;
    const stp = long ? c.entry - g * c.H : c.entry + g * c.H;
    let exit = null, why = 'time';
    for (const b of c.path) {
      const hitT = long ? b.h >= tgt : b.l <= tgt;
      const hitS = long ? b.l <= stp : b.h >= stp;
      if (hitT && hitS) { exit = stp; why = 'stop'; break; }
      if (hitS) { exit = stp; why = 'stop'; break; }
      if (hitT) { exit = tgt; why = 'target'; break; }
    }
    if (exit === null) exit = c.path.length ? c.path[c.path.length - 1].c : c.entry;
    const gross = (long ? 1 : -1) * (exit - c.entry) / c.entry;
    const net = gross - COST;
    trades.push({ date: c.td, side: long ? 'long' : 'short', entry: +c.entry.toFixed(2), exit: +exit.toFixed(2), why, net: +net.toFixed(6), dollars: +(net * STAKE).toFixed(2), at: c.at });
  }
  return trades;
}

function stats(T) {
  if (T.length < 15) return null;
  const r = T.map((t) => t.dollars);
  const wins = r.filter((x) => x > 0), losses = r.filter((x) => x <= 0);
  let cum = 0, peak = 0, dd = 0, underwater = 0, maxUnder = 0;
  for (const x of r) { cum += x; if (cum >= peak) { peak = cum; underwater = 0; } else { underwater++; maxUnder = Math.max(maxUnder, underwater); } dd = Math.min(dd, cum - peak); }
  const sortedR = [...r].sort((a, b) => a - b);
  const var95 = -q(sortedR, 0.05);
  const cvar95 = -mean(sortedR.slice(0, Math.max(1, Math.floor(0.05 * sortedR.length))));
  return {
    n: T.length, winRate: wins.length / T.length * 100,
    expectancy: mean(r), total: cum, maxDD: dd, maxUnderwaterTrades: maxUnder,
    tstat: sd(r) > 0 ? mean(r) / (sd(r) / Math.sqrt(T.length)) : 0,
    avgWin: wins.length ? mean(wins) : 0, avgLoss: losses.length ? mean(losses) : 0,
    worst: sortedR[0], best: sortedR[sortedR.length - 1],
    p5: q(sortedR, 0.05), p50: q(sortedR, 0.5), p95: q(sortedR, 0.95),
    sd: sd(r), skew: skew(r), kurt: kurt(r), var95, cvar95,
    stops: T.filter((t) => t.why === 'stop').length,
    targets: T.filter((t) => t.why === 'target').length,
    timeouts: T.filter((t) => t.why === 'time').length,
  };
}

// ---------- the grid ----------
const FS = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];
const GS = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0];
const grid = [];
for (const dir of ['fade', 'momentum']) for (const f of FS) for (const g of GS) {
  const T = run(dir, f, g);
  const s = stats(T);
  if (s) grid.push({ direction: dir, target: f, stop: g, ...s, trades: T });
}

// ---------- bootstrap CI on the best cell ----------
function bootstrap(xs, iters = 10000) {
  const out = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let k = 0; k < xs.length; k++) s += xs[Math.floor(Math.random() * xs.length)];
    out.push(s / xs.length);
  }
  out.sort((a, b) => a - b);
  return { lo: q(out, 0.025), hi: q(out, 0.975) };
}
const ranked = [...grid].sort((a, b) => b.expectancy - a.expectancy);
const best = ranked[0];
const bestTrades = best.trades.map((t) => t.dollars);
const ciExp = bootstrap(bestTrades);
const ciWin = bootstrap(best.trades.map((t) => (t.dollars > 0 ? 100 : 0)));

// ---------- robustness ----------
const byYear = {};
for (const t of best.trades) { const y = t.date.slice(0, 4); (byYear[y] = byYear[y] || []).push(t.dollars); }
const yearSplit = Object.entries(byYear).map(([y, a]) => ({ year: y, n: a.length, expectancy: mean(a), total: a.reduce((s, x) => s + x, 0) }));

// sign stability around the best cell
const stability = [];
for (const f of FS) for (const g of GS) {
  const cell = grid.find((x) => x.direction === best.direction && x.target === f && x.stop === g);
  if (cell) stability.push({ f, g, exp: cell.expectancy });
}
const positiveNeighbours = stability.filter((s) => s.exp > 0).length;

const out = {
  generated: new Date().toISOString(),
  spec: {
    instrument: 'CME NQ front-month, 1-minute bars',
    window: 'entries only 09:30-11:30 ET (930-1050 min after the 18:00 open)',
    entry: 'first band touch inside the window, filled at the band level (or session open if gapped through)',
    target: 'f * H in favour, H = (upper band - lower band)/2',
    stop: 'g * H against; if target and stop occur inside the same minute, the stop is assumed first',
    timeStop: 'any open position closed at the 11:30 bar close',
    cost: `${COST * 10000} bp round trip`,
    stake: STAKE,
    alignment: 'daily band rescaled per session by intradayOpen/dailyOpen (daily series is back-adjusted)',
  },
  data: { sessions: sess.size, candidates: candidates.length, noTouchInWindow },
  multipleTesting: {
    cells: grid.length,
    expectedFalsePositivesAtT2: +(grid.length * 0.0455).toFixed(1),
    bonferroniThreshold: 3.48,
    note: `with ${grid.length} cells, about ${(grid.length * 0.0455).toFixed(1)} are expected to show |t|>2 by chance`,
  },
  grid: grid.map(({ trades, ...rest }) => rest),
  bestCell: {
    direction: best.direction, target: best.target, stop: best.stop,
    ...Object.fromEntries(Object.entries(best).filter(([k]) => !['trades', 'direction', 'target', 'stop'].includes(k))),
    expectancyCI95: ciExp, winRateCI95: ciWin,
  },
  bestTradeLog: best.trades,
  yearSplit,
  parameterStability: { cellsTested: stability.length, positive: positiveNeighbours, grid: stability },
};
const dir = path.join(__dirname, '..', 'reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'first2h_results.json'), JSON.stringify(out, null, 2));

// ---------- console report ----------
console.log('\n=== FIRST 2 CASH HOURS - spec, then results ===');
console.log(`entry    : first band touch 09:30-11:30 ET, filled at the band`);
console.log(`exit     : target f*H / stop g*H / TIME STOP at 11:30 ET`);
console.log(`cost     : ${COST * 10000} bp    stake: $${STAKE}\n`);
console.log('dir       f     g     n   win%   expectancy    total    maxDD     t   VaR95  CVaR95  stops  timeouts');
for (const r of ranked.slice(0, 12)) {
  console.log(`${r.direction.padEnd(9)}${r.target.toFixed(1).padStart(4)} ${r.stop.toFixed(1).padStart(4)} ${String(r.n).padStart(5)} ${r.winRate.toFixed(1).padStart(6)} ${('$' + r.expectancy.toFixed(2)).padStart(11)} ${('$' + r.total.toFixed(0)).padStart(8)} ${('$' + r.maxDD.toFixed(0)).padStart(7)} ${r.tstat.toFixed(2).padStart(6)} ${('$' + r.var95.toFixed(0)).padStart(7)} ${('$' + r.cvar95.toFixed(0)).padStart(7)} ${String(r.stops).padStart(6)} ${String(r.timeouts).padStart(9)}`);
}
console.log(`\nBEST CELL: ${best.direction} ${best.target}H/${best.stop}H`);
console.log(`  expectancy $${best.expectancy.toFixed(2)}  95% CI [$${ciExp.lo.toFixed(2)}, $${ciExp.hi.toFixed(2)}]  ${ciExp.lo > 0 ? 'CI EXCLUDES ZERO' : 'CI INCLUDES ZERO'}`);
console.log(`  win rate ${best.winRate.toFixed(1)}%  95% CI [${ciWin.lo.toFixed(1)}%, ${ciWin.hi.toFixed(1)}%]`);
console.log(`  skew ${best.skew.toFixed(2)}  excess kurtosis ${best.kurt.toFixed(2)}  worst trade $${best.worst.toFixed(0)}`);
console.log(`  max drawdown $${best.maxDD.toFixed(0)} over ${best.maxUnderwaterTrades} trades underwater`);
console.log(`  targets ${best.targets}  stops ${best.stops}  time stops ${best.timeouts}`);
console.log(`\nMULTIPLE TESTING: ${grid.length} cells, ~${(grid.length * 0.0455).toFixed(1)} expected |t|>2 by chance; observed ${grid.filter((x) => Math.abs(x.tstat) > 2).length}`);
console.log(`\nROBUSTNESS by year:`);
for (const y of yearSplit) console.log(`  ${y.year}  n=${String(y.n).padStart(3)}  expectancy $${y.expectancy.toFixed(2)}  total $${y.total.toFixed(0)}`);
console.log(`\nPARAMETER STABILITY: ${positiveNeighbours} of ${stability.length} cells positive for the same direction`);
console.log(`  -> ${positiveNeighbours > stability.length * 0.7 ? 'sign is stable across parameters' : 'sign flips across parameters: the result is noise'}`);
