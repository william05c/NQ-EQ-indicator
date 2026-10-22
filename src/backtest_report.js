// One report, one place, explicitly separated objects.
//
// THE TAXONOMY THIS SCRIPT ENFORCES
//
//   1. THE DAILY MODEL      predicts tomorrow's high and low band from daily bars.
//                           Measured by MAE and band coverage. Not a strategy.
//   2. THE INTRADAY NOWCAST  given the running high/low, gives P(new high) and
//                           P(new low). Measured by calibration. Not a strategy.
//   3. A TRADING RULE        entry at a band touch, exit by target/stop/close.
//                           A WIN RATE BELONGS TO THIS, AND ONLY THIS. It is a
//                           property of a rule someone wrote, not of the indicator.
//
// Every number in the output carries which of the three it describes, the exact
// session hours it traded, and the rule's target/stop in H units.
//
// H = half the band width. All targets and stops are expressed as multiples of H
// so they can be compared across sessions of different volatility.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const STAKE = 10000, COST = 0.0002;
const CASH_SHARE = 0.662, OVERFRAC = 15.5 / 23;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

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

// ============ daily model, walk-forward ============
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
const dailyBand = new Map();
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
    const h10 = o * (1 + Math.exp(cap(muU + q(resU, 0.1))));
    const h50 = o * (1 + Math.exp(cap(muU + q(resU, 0.5))));
    const h90 = o * (1 + Math.exp(cap(muU + q(resU, 0.9))));
    const l10 = o * (1 - Math.exp(cap(muD + q(resD, 0.9))));
    const l50 = o * (1 - Math.exp(cap(muD + q(resD, 0.5))));
    const l90 = o * (1 - Math.exp(cap(muD + q(resD, 0.1))));
    dailyBand.set(drows[t].date, { o, h10, h50, h90, l10, l50, l90, sigma: (h50 - l50) / 1.596 });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ============ intraday sessions ============
const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_1min_2022_2025.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const sess = new Map();
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  const m = c[0].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) continue;
  const [, mo, dd, yy, hh, mi] = m.map(Number);
  const mins = hh * 60 + mi;
  let sy = yy, smo = mo, sdd = dd;
  if (mins < 18 * 60) { const dt = new Date(Date.UTC(yy, mo - 1, dd)); dt.setUTCDate(dt.getUTCDate() - 1); sy = dt.getUTCFullYear(); smo = dt.getUTCMonth() + 1; sdd = dt.getUTCDate(); }
  const cd = new Date(Date.UTC(sy, smo - 1, sdd)); cd.setUTCDate(cd.getUTCDate() + 1);
  const td = cd.toISOString().slice(0, 10);
  if (!sess.has(td)) sess.set(td, []);
  // elapsed minutes from the 18:00 session open
  const el = mins < 18 * 60 ? mins + 360 : mins - 1080;
  sess.get(td).push({ el, o: +c[1], h: +c[2], l: +c[3], c: +c[4] });
}

// session windows, in minutes from the 18:00 open. 09:30 ET = 930, 16:00 ET = 1320.
const WINDOWS = [
  { id: 'full', label: 'full 23h session (18:00-17:00 ET)', lo: 0, hi: 1380 },
  { id: 'rth', label: 'cash hours only (09:30-16:00 ET)', lo: 930, hi: 1320 },
  { id: 'first2h', label: 'first 2 cash hours (09:30-11:30 ET)', lo: 930, hi: 1050 },
  { id: 'last2h', label: 'last 2 cash hours (14:00-16:00 ET)', lo: 1200, hi: 1320 },
];

// ============ build touch records (bands rescaled onto the intraday price level) ============
const sessionsUsed = [];
const touches = [];
let noBand = 0, shortSess = 0, noTouch = 0;
for (const [td, barsRaw] of sess) {
  const raw = dailyBand.get(td);
  const bars = barsRaw.sort((a, b) => a.el - b.el);
  if (bars.length < 600) { shortSess++; continue; }
  if (!raw || !(raw.h90 > raw.l10)) { noBand++; continue; }
  const ratio = bars[0].o / raw.o;          // alignment: daily series is back-adjusted
  const H = (raw.h90 - raw.l10) * ratio / 2;
  const h90 = raw.h90 * ratio, l10 = raw.l10 * ratio;
  sessionsUsed.push({ td, ratio, bars, H, sigma: raw.sigma * ratio, l10, l90: raw.l90 * ratio, h10: raw.h10 * ratio, h90 });
  let iHi = -1, iLo = -1;
  for (let i = 0; i < bars.length; i++) {
    if (iHi < 0 && bars[i].h >= h90) iHi = i;
    if (iLo < 0 && bars[i].l <= l10) iLo = i;
    if (iHi >= 0 && iLo >= 0) break;
  }
  if (iHi < 0 && iLo < 0) { noTouch++; continue; }
  if (iHi >= 0 && iLo >= 0 && iHi === iLo) continue;
  const side = (iHi >= 0 && (iLo < 0 || iHi < iLo)) ? 'hi' : 'lo';
  const idx = side === 'hi' ? iHi : iLo;
  const bar = bars[idx];
  const entry = side === 'hi' ? Math.max(bar.o, h90) : Math.min(bar.o, l10);
  touches.push({ td, side, entry, H, at: bar.el, path: bars.slice(idx + 1) });
}
console.log(`sessions ${sess.size}   usable ${sessionsUsed.length}   touches ${touches.length}   no touch ${noTouch}   too short ${shortSess}`);

// ============ NOWCAST CALIBRATION (object 2), alignment corrected ============
function cumVar(t) {
  if (t <= 0) return 0;
  if (t <= OVERFRAC) return (1 - CASH_SHARE) / OVERFRAC * t;
  return Math.min(1, (1 - CASH_SHARE) + CASH_SHARE / (1 - OVERFRAC) * (t - OVERFRAC));
}
const calib = { total: 0, pred: 0, real: 0, deciles: [] };
const byDec = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 }));
for (const s of sessionsUsed) {
  const finalHigh = Math.max(...s.bars.map((b) => b.h));
  let runHigh = -Infinity;
  for (let i = 0; i < s.bars.length; i++) {
    const b = s.bars[i];
    if (b.h > runHigh) runHigh = b.h;
    if (i % 5 !== 0 || i < 30) continue;
    const t = Math.min(Math.max(b.el / 1380, 0), 1);
    const sigRem = s.sigma * Math.sqrt(Math.max(1 - cumVar(t), 0));
    if (!(sigRem > 0)) continue;
    const p = Math.min(1, Math.max(0, 2 * (1 - phi((runHigh - b.c) / sigRem))));
    const hit = finalHigh > runHigh ? 1 : 0;
    calib.total++; calib.pred += p; calib.real += hit;
    const k = Math.min(9, Math.floor(p * 10));
    byDec[k].n++; byDec[k].p += p; byDec[k].hit += hit;
  }
}
calib.pred /= calib.total; calib.real /= calib.total;
calib.deciles = byDec.map((b, i) => ({ decile: i + 1, n: b.n, pred: b.n ? b.p / b.n : 0, real: b.n ? b.hit / b.n : 0 }));

// ============ RULES (object 3), per window ============
function evaluate(direction, f, g, win) {
  const rows = [];
  for (const t of touches) {
    if (t.at < win.lo || t.at >= win.hi) continue;          // entry must occur inside the window
    const long = (t.side === 'lo') === (direction === 'fade');
    const tgt = long ? t.entry + f * t.H : t.entry - f * t.H;
    const stp = long ? t.entry - g * t.H : t.entry + g * t.H;
    let exit = null, why = 'close';
    for (const b of t.path) {
      const hitT = long ? b.h >= tgt : b.l <= tgt;
      const hitS = long ? b.l <= stp : b.h >= stp;
      if (hitT && hitS) { exit = stp; why = 'stop'; break; }
      if (hitS) { exit = stp; why = 'stop'; break; }
      if (hitT) { exit = tgt; why = 'target'; break; }
    }
    if (exit === null) exit = t.path[t.path.length - 1].c;
    const gross = (long ? 1 : -1) * (exit - t.entry) / t.entry;
    rows.push({ d: (gross - COST) * STAKE, why });
  }
  const N = rows.length;
  if (N < 20) return null;
  const rets = rows.map((r) => r.d);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  let cum = 0, peak = 0, dd = 0;
  const curve = [];
  for (const r of rets) { cum += r; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); curve.push(+cum.toFixed(0)); }
  return {
    direction, target: f, stop: g, window: win.id, windowLabel: win.label,
    n: N, winRate: wins.length / N * 100,
    expectancy: mean(rets), total: cum, maxDD: dd,
    tstat: sd(rets) > 0 ? mean(rets) / (sd(rets) / Math.sqrt(N)) : 0,
    avgWin: wins.length ? mean(wins) : 0, avgLoss: losses.length ? mean(losses) : 0,
    stopHits: rows.filter((r) => r.why === 'stop').length,
    closeExits: rows.filter((r) => r.why === 'close').length,
    curve,
  };
}
const FS = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];
const GS = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0];
const rules = [];
for (const win of WINDOWS) for (const dir of ['fade', 'momentum']) for (const f of FS) for (const g of GS) {
  const r = evaluate(dir, f, g, win);
  if (r) rules.push(r);
}
console.log(`rules evaluated: ${rules.length}`);

const out = {
  generated: new Date().toISOString(),
  meta: {
    instrument: 'CME NQ front-month, 1-minute bars',
    intradayFile: 'data/nq_1min_2022_2025.csv',
    dailyFile: 'data/nq_futures_daily.csv',
    sessions: sessionsUsed.length,
    touches: touches.length,
    stake: STAKE, costBp: COST * 10000,
    alignmentNote: 'daily series is back-adjusted; bands rescaled per session by intradayOpen/dailyOpen',
    hDefinition: 'H = half the band width = (upper - lower band)/2',
    winDefinition: 'net P&L per trade > 0 after the round-trip cost',
  },
  objects: {
    dailyModel: { what: 'predicts the session high/low band from prior daily bars', measuredBy: 'MAE and band coverage (see docs/02-method)', isNot: 'a trading strategy' },
    nowcast: { what: 'given the running high/low, P(new high) and P(new low)', measuredBy: 'calibration below', isNot: 'a trading strategy' },
    rules: { what: 'entry at a band touch, exit by target/stop/close', measuredBy: 'win rate, expectancy, t-stat', isNot: 'the indicator' },
  },
  calibration: calib,
  rules,
};
const dir = path.join(__dirname, '..', 'reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'backtest_results.json'), JSON.stringify(out, null, 2));
console.log(`wrote reports/backtest_results.json`);

// quick console summary
console.log('\nCALIBRATION (object 2: the nowcast, not a rule)');
console.log('decile  predicted  realised   n');
for (const dd of calib.deciles) console.log(`  ${String(dd.decile).padStart(2)}     ${(dd.pred * 100).toFixed(1).padStart(6)}%  ${(dd.real * 100).toFixed(1).padStart(6)}%  ${dd.n}`);
console.log(`  overall ${(calib.pred * 100).toFixed(1)}% vs ${(calib.real * 100).toFixed(1)}%  n=${calib.total}`);

console.log('\nBEST RULES BY EXPECTANCY, PER WINDOW (object 3: a rule, not the indicator)');
for (const win of WINDOWS) {
  const set = rules.filter((r) => r.window === win.id).sort((a, b) => b.expectancy - a.expectancy);
  if (!set.length) { console.log(`  ${win.id}: not enough trades`); continue; }
  const b = set[0];
  console.log(`  ${win.id.padEnd(8)} best: ${b.direction} ${b.target}H/${b.stop}H  n=${b.n}  win ${b.winRate.toFixed(1)}%  exp $${b.expectancy.toFixed(1)}  t ${b.tstat.toFixed(2)}  stops ${b.stopHits}`);
}
