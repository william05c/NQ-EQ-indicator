// Does ANY simple directional signal survive out-of-sample on the data we already have?
//
// Before buying new data, test the six candidates that are derivable from daily
// OHLCV. Each is univariate and interpretable: one signal, one regression, walk
// forward, refit every 21 bars, predict the next session, never revisit it.
//
// Reported per candidate:
//   R2        - negative means worse than predicting zero change
//   hit rate  - share of sessions where the sign was right (50% = coin flip)
//   Sharpe    - annualised Sharpe of a long/short rule that trades the sign every
//               session, BEFORE costs. A daily-traded signal needs a high number
//               because one round turn per day on NQ is ~$5 against ~$20/point.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, REFIT = 21;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function ols2(x, y) {                       // univariate with intercept
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  return [my - b * mx, b];
}
const dot2 = (w, x) => w[0] + w[1] * x;

function load(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
}

function evaluate(rows, signalOf, label) {
  const n = rows.length;
  // Target is the SESSION's own move, open -> close. That is the only tradeable
  // version: the decision is made at the open, the outcome is the rest of the day.
  // Predicting close-to-close from the gap leaks, because the gap is PART of that
  // return - it scored R2 0.32 and a fake Sharpe of 6.4 before this was fixed.
  const ret = rows.map((r) => r.open > 0 ? Math.log(r.close / r.open) : 0);
  let w = null, lastFit = -1;
  const pred = new Array(n).fill(0);
  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], Y = [];
      for (let i = 60; i < t; i++) { const s = signalOf(rows, i); if (Number.isFinite(s)) { X.push(s); Y.push(ret[i]); } }
      w = X.length > 50 ? ols2(X, Y) : [0, 0];
      lastFit = t;
    }
    const s = signalOf(rows, t);
    pred[t] = Number.isFinite(s) ? dot2(w, s) : 0;
  }
  const idx = [];
  for (let t = WARMUP; t < n; t++) if (Number.isFinite(signalOf(rows, t))) idx.push(t);
  const P = idx.map((t) => pred[t]), A = idx.map((t) => ret[t]);
  const m = P.length;
  const mu = mean(A);
  const r2 = 1 - mean(P.map((p, i) => (p - A[i]) ** 2)) / mean(A.map((a) => (a - mu) ** 2));
  const hit = P.filter((p, i) => Math.sign(p) === Math.sign(A[i]) && p !== 0).length / P.length;
  // long/short the sign every session; subtract nothing, so the gross figure
  // flatters the signal
  const strat = P.map((p, i) => Math.sign(p) * A[i]);
  const sharpe = sd(strat) > 0 ? (mean(strat) / sd(strat)) * Math.sqrt(252) : 0;
  console.log(`  ${label.padEnd(28)} R2 ${r2.toFixed(4).padStart(7)}   hit ${(hit * 100).toFixed(1)}%   gross Sharpe ${sharpe.toFixed(2).padStart(6)}`);
  return sharpe;
}

const SIGNALS = [
  ['gap (open/prev close)', (r, t) => t > 0 && r[t - 1].close > 0 ? Math.log(r[t].open / r[t - 1].close) : NaN],
  ['yesterday close position', (r, t) => { const h = r[t - 1].high - r[t - 1].low; return h > 0 ? (r[t - 1].high - r[t - 1].open) / h - 0.5 : NaN; }],
  ['5-day return', (r, t) => t >= 6 ? Math.log(r[t - 1].close / r[t - 6].close) : NaN],
  ['20-day return', (r, t) => t >= 21 ? Math.log(r[t - 1].close / r[t - 21].close) : NaN],
  ['60-day return', (r, t) => t >= 61 ? Math.log(r[t - 1].close / r[t - 61].close) : NaN],
  ['distance from 20d mean', (r, t) => { if (t < 20) return NaN; const m = mean(r.slice(t - 20, t).map((x) => x.close)); return Math.log(r[t - 1].close / m); }],
  ['yesterday range vs 20d', (r, t) => { if (t < 21) return NaN; const rr = (x) => (x.high - x.low) / x.close; return rr(r[t - 1]) / mean(r.slice(t - 21, t - 1).map(rr)) - 1; }],
];

for (const [file, label] of [
  ['nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['nq_futures_daily.csv', 'NQ'],
]) {
  const rows = load(file);
  console.log(`${label} - predicting the session move (open -> close) from information known at the open`);
  for (const [name, fn] of SIGNALS) evaluate(rows, fn, name);
  console.log('');
}
console.log('A daily-traded signal needs a gross Sharpe well above ~1 just to survive');
console.log('costs and noise. Anything under 0.3 is indistinguishable from zero.');
