// Can anything in this feature set predict DIRECTION?
//
// The nowcast is driftless: it forecasts where the extremes land, never where
// price closes. That is a design choice, but it is only honest if direction is
// genuinely unpredictable from the same inputs. This script tests that directly.
//
// Two targets, both about "ending high or low":
//
//   ret  = log(close[t] / close[t-1])   which way the session closed
//   w    = (high[t] - open[t]) / (high[t] - low[t])
//        where inside its own range the session finished: 1.0 = closed on the
//        high, 0.0 = closed on the low, 0.5 = the middle.
//
// Features are the ones the model already uses, all lagged so there is no
// look-ahead. Out-of-sample only: refit every 21 bars on an expanding window,
// predict the next bar, never look at it again.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, REFIT = 21;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

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

function load(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
}

function run(file, label) {
  const rows = load(file);
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
  const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];

  const yRet = lr;                                                   // signed return
  const yW = rows.map((r) => { const h = r.high - r.low; return h > 0 ? (r.high - r.open) / h : 0.5; });

  let wR = null, wW = null, lastFit = -1;
  const out = [];
  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], a = [], b = [];
      for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yRet[i]); b.push(yW[i]); }
      wR = ols(X, a); wW = ols(X, b); lastFit = t;
    }
    const x = feats(t);
    out.push({ predR: dot(wR, x), actR: yRet[t], predW: dot(wW, x), actW: yW[t] });
  }

  const m = out.length;
  const varY = (arr) => { const mu = mean(arr); return mean(arr.map((v) => (v - mu) ** 2)); };
  const r2 = (pred, act) => 1 - mean(pred.map((p, i) => (p - act[i]) ** 2)) / varY(act);
  const hit = (pred, act) => pred.filter((p, i) => Math.sign(p) === Math.sign(act[i])).length / pred.length;

  const pr = out.map((r) => r.predR), ar = out.map((r) => r.actR);
  const pw = out.map((r) => r.predW), aw = out.map((r) => r.actW);

  console.log(`${label}  (${m} out-of-sample sessions)`);
  console.log(`  direction of the CLOSE      R2 ${r2(pr, ar).toFixed(4).padStart(7)}   sign hit rate ${(hit(pr, ar) * 100).toFixed(1)}%`);
  console.log(`  where it closes in its range R2 ${r2(pw, aw).toFixed(4).padStart(7)}   sign hit rate ${(hit(pw.map(p => p - 0.5), aw.map(a => a - 0.5)) * 100).toFixed(1)}%   (base rate 50%)`);
  console.log(`  actual w: mean ${mean(aw).toFixed(3)}  sd ${sd(aw).toFixed(3)}  (0.5 = middle of the range)`);
  console.log('');
}

run('nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC');
run('nq_futures_daily.csv', 'NQ');
run('es_futures_daily.csv', 'ES');

console.log('R2 near 0 and a hit rate near 50% means direction is not predictable from');
console.log('these inputs - which is why the indicator reports extremes and refuses a call.');
