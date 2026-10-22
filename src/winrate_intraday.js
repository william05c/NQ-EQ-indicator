// TEST 3 - the win-rate question, measured with real bar-by-bar sequencing.
//
// The daily-bar attempt at this produced a fake 99.8% win rate because it credited
// a target with moves that happened BEFORE entry. With 1-minute bars the forward
// path is explicit, so target and stop can be ordered correctly.
//
// Protocol (pre-registered in docs/09-intraday-experiment.md):
//   entry   first touch of the band in the session, resting limit
//   target  f * H in favour          H = (upper band - lower band) / 2
//   stop    g * H against
//   walk the 1-minute path forward; the first level touched decides the trade
//   neither touched -> exit at the session close
//
// Within-bar ambiguity: if a single bar contains both levels, the STOP is assumed
// to have been hit first. That biases every cell toward losses, which is the safe
// direction for a claim of profitability. The count is reported.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const STAKE = 10000, COST = 0.0002;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

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

// ---- daily band, walk-forward ----
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
const dRowsByDate = new Map(drows.map((r) => [r.date, r.open]));
for (let t = WARMUP; t < n; t++) {
  if (lastFit < 0 || t - lastFit >= REFIT) {
    const X = [], a = [], b = [];
    for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
    wU = ols(X, a); wD = ols(X, b); lastFit = t;
  }
  const x = feats(t);
  const muU = dot(wU, x), muD = dot(wD, x);
  if (resU.length >= MIN_RESID) {
    const o = drows[t].open;
    bands.set(drows[t].date, {
      h90: o * (1 + Math.exp(Math.min(muU + q(resU, 0.9), 0.69))),
      l10: o * (1 - Math.exp(Math.min(muD + q(resD, 0.9), 0.69))),
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---- session tapes ----
const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_1min_2022_2025.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const sessions = new Map();
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  const m = c[0].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) continue;
  const [, mo, dd, yy, hh, mi] = m.map(Number);
  const mins = hh * 60 + mi;
  let sy = yy, smo = mo, sdd = dd;
  if (mins < 18 * 60) {
    const dt = new Date(Date.UTC(yy, mo - 1, dd)); dt.setUTCDate(dt.getUTCDate() - 1);
    sy = dt.getUTCFullYear(); smo = dt.getUTCMonth() + 1; sdd = dt.getUTCDate();
  }
  const key = `${sy}-${String(smo).padStart(2, '0')}-${String(sdd).padStart(2, '0')}`;
  const closeDt = new Date(Date.UTC(sy, smo - 1, sdd)); closeDt.setUTCDate(closeDt.getUTCDate() + 1);
  if (!sessions.has(key)) sessions.set(key, { tradeDate: closeDt.toISOString().slice(0, 10), bars: [] });
  sessions.get(key).bars.push({ mins, o: +c[1], h: +c[2], l: +c[3], c: +c[4] });
}

// ---- collect one forward path per band touch ----
const touches = [];   // { side: 'hi'|'lo', entry, H, path: [...], ambiguousEntry }
let noBand = 0, shortSess = 0, noTouch = 0;
for (const [, s] of sessions) {
  const raw = bands.get(s.tradeDate);
  if (!raw || !(raw.h90 > raw.l10)) { noBand++; continue; }
  const bars = s.bars.sort((x, y) => x.mins - y.mins);
  if (bars.length < 600) { shortSess++; continue; }
  // ALIGNMENT FIX: nq_futures_daily.csv is a back-adjusted continuous series, so its
  // levels sit up to 20% below the raw intraday prices in 2022. Bands taken from it
  // unchanged were compared against a different price series, which produced a fake
  // 96% touch rate and a fake 90% win rate. Rescale onto the intraday open.
  const dOpen = dRowsByDate.get(s.tradeDate);
  if (!(dOpen > 0)) { noBand++; continue; }
  const ratio = bars[0].o / dOpen;
  const b = { h90: raw.h90 * ratio, l10: raw.l10 * ratio };
  const H = (b.h90 - b.l10) / 2;
  let iHi = -1, iLo = -1;
  for (let i = 0; i < bars.length; i++) {
    if (iHi < 0 && bars[i].h >= b.h90) iHi = i;
    if (iLo < 0 && bars[i].l <= b.l10) iLo = i;
    if (iHi >= 0 && iLo >= 0) break;
  }
  if (iHi < 0 && iLo < 0) { noTouch++; continue; }
  // first touch wins; if both happen in the same bar, skip as ambiguous
  let side, idx;
  if (iHi >= 0 && iLo >= 0 && iHi === iLo) continue;
  if (iHi >= 0 && (iLo < 0 || iHi < iLo)) { side = 'hi'; idx = iHi; } else { side = 'lo'; idx = iLo; }
  const bar = bars[idx];
  const entry = side === 'hi' ? Math.max(bar.o, b.h90) : Math.min(bar.o, b.l10);
  // the walk starts on the NEXT bar. The entry bar contains the touch at an unknown
  // instant, so its high/low cannot be attributed to the period after entry - using
  // them credited targets with pre-entry moves and produced a t-stat of 59.7.
  touches.push({ side, entry, H, path: bars.slice(idx + 1) });
}
console.log(`sessions with a band ${bands.size ? touches.length : 0} touches collected`);
console.log(`  no daily band ${noBand}   too short ${shortSess}   band never touched ${noTouch}   usable touches ${touches.length}`);


// how big is H, in percent of price?
{
  const pct = touches.map((t) => t.H / t.entry * 100).sort((a, b) => a - b);
  const md = pct[Math.floor(pct.length / 2)];
  console.log(`H (half the band width): median ${md.toFixed(2)}% of price, p10 ${pct[Math.floor(0.1 * pct.length)].toFixed(2)}%, p90 ${pct[Math.floor(0.9 * pct.length)].toFixed(2)}%`);
  console.log(`so a 0.1H target is about ${(md * 0.1).toFixed(3)}% = $${(md * 0.1 * 100).toFixed(0)} on $10,000, and a 2H stop is about $${(md * 2 * 100).toFixed(0)}\n`);
}
// ---- evaluate the grid ----
function evaluate(dir, f, g) {
  let wins = 0, losses = 0, flat = 0, sameBarAmb = 0;
  const rets = [];
  for (const t of touches) {
    const long = (t.side === 'lo') === (dir === 'fade');   // fade buys the lower band
    const tgt = long ? t.entry + f * t.H : t.entry - f * t.H;
    const stp = long ? t.entry - g * t.H : t.entry + g * t.H;
    let exit = null;
    for (let k = 0; k < t.path.length; k++) {
      const b = t.path[k];
      const hitT = long ? b.h >= tgt : b.l <= tgt;
      const hitS = long ? b.l <= stp : b.h >= stp;
      if (hitT && hitS) { exit = stp; if (k === 0) sameBarAmb++; break; }   // conservative
      if (hitS) { exit = stp; break; }
      if (hitT) { exit = tgt; break; }
    }
    if (exit === null) { exit = t.path[t.path.length - 1].c; if (Math.abs(exit - t.entry) < 1e-9) { flat++; continue; } }
    const gross = (long ? 1 : -1) * (exit - t.entry) / t.entry;
    const net = gross - COST;
    rets.push(net);
    if (net > 0) wins++; else losses++;
  }
  const N = rets.length;
  if (!N) return null;
  const w = rets.filter((r) => r > 0), l = rets.filter((r) => r <= 0);
  return {
    N, win: wins / N * 100, exp: mean(rets) * STAKE, total: rets.reduce((a, r) => a + r * STAKE, 0),
    tstat: sd(rets) > 0 ? mean(rets) / (sd(rets) / Math.sqrt(N)) : 0, sameBarAmb, flat,
    avgW: w.length ? mean(w) * STAKE : 0, avgL: l.length ? mean(l) * STAKE : 0,
  };
}

const FS = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];
const GS = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0];
console.log('\nTEST 3 - win rate vs expectancy, target = f*H, stop = g*H, $10,000 per trade, 2bp cost\n');
for (const dir of ['fade', 'momentum']) {
  console.log(`  ${dir.toUpperCase()}`);
  console.log('  target  stop    n    win%    expectancy     total      t      avg win / avg loss');
  const rows = [];
  for (const f of FS) for (const g of GS) {
    const r = evaluate(dir, f, g);
    if (r) rows.push({ f, g, ...r });
  }
  rows.sort((a, b) => b.win - a.win);
  for (const r of rows.slice(0, 8)) {
    console.log(`   ${r.f.toFixed(1)}    ${r.g.toFixed(1)}   ${String(r.N).padStart(3)}  ${r.win.toFixed(1).padStart(5)}  ${('$' + r.exp.toFixed(1)).padStart(10)}  ${('$' + r.total.toFixed(0)).padStart(8)}  ${r.tstat.toFixed(2).padStart(6)}   ${('$' + r.avgW.toFixed(0)).padStart(6)} / ${('$' + r.avgL.toFixed(0)).padStart(6)}`);
  }
  const passing = rows.filter((r) => r.win > 75 && r.exp > 0 && r.tstat > 2.9);
  console.log(`  cells meeting win>75% AND exp>0 AND t>2.9 : ${passing.length}`);
  console.log('');
}

// ---------------- RISK PROFILE of the headline cell ----------------
// A 93% win rate with a $15 average win and a $330 stop is not an edge until you
// know how often the stop is hit. That is a question about the tail, and the tail
// is what the sample under-samples.
console.log('\nRISK PROFILE - fade, target 0.1H, stop 2.0H');
{
  const f = 0.1, g = 2.0, dir = 'fade';
  const rows = [];
  for (const t of touches) {
    const long = (t.side === 'lo') === (dir === 'fade');
    const tgt = long ? t.entry + f * t.H : t.entry - f * t.H;
    const stp = long ? t.entry - g * t.H : t.entry + g * t.H;
    let exit = null, why = 'close';
    for (const b of t.path) {
      const hitT = long ? b.h >= tgt : b.l <= tgt;
      const hitS = long ? b.l <= stp : b.h >= stp;
      if (hitT && hitS) { exit = stp; why = 'stop(sameBar)'; break; }
      if (hitS) { exit = stp; why = 'stop'; break; }
      if (hitT) { exit = tgt; why = 'target'; break; }
    }
    if (exit === null) exit = t.path[t.path.length - 1].c;
    const gross = (long ? 1 : -1) * (exit - t.entry) / t.entry;
    rows.push({ d: (gross - COST) * STAKE, why });
  }
  const n = rows.length;
  const stops = rows.filter((r) => r.why.startsWith('stop')).length;
  const closes = rows.filter((r) => r.why === 'close').length;
  const wins = rows.filter((r) => r.d > 0).length;
  const worst = Math.min(...rows.map((r) => r.d));
  let cum = 0, peak = 0, dd = 0;
  for (const r of rows) { cum += r.d; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  console.log(`  trades ${n}   target hit ${n - stops - closes}   stop hit ${stops} (${(stops / n * 100).toFixed(2)}%)   exited at close ${closes} (${(closes / n * 100).toFixed(1)}%)`);
  console.log(`  win rate ${(wins / n * 100).toFixed(1)}%   worst single trade $${worst.toFixed(0)}   max drawdown $${dd.toFixed(0)}`);
  console.log(`  total $${rows.reduce((a, r) => a + r.d, 0).toFixed(0)}`);
  const W = 0.1 * 1.65 * 100;   // target in dollars at the median H
  const L = 2.0 * 1.65 * 100;   // stop in dollars at the median H
  const be = W / (W + L);
  console.log(`\n  break-even stop frequency: a $${W.toFixed(0)} win against a $${L.toFixed(0)} stop needs the stop`);
  console.log(`  to fire on fewer than ${(be * 100).toFixed(1)}% of trades. This sample shows ${(stops / n * 100).toFixed(2)}%.`);
  console.log(`  one stop erases ${(L / W).toFixed(0)} wins. At 720 trades the difference between`);
  console.log(`  0.5% and 5% stop frequency is $${((5 - 0.5) / 100 * n * L).toFixed(0)}.`);
  console.log(`\n  the sample is 2022-12 to 2025-12. It contains no crash. The tail is not sampled.`);
}