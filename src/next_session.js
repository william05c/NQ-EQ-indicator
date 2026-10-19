// Compute the next-session projection exactly as the Pine script should produce it,
// so the chart can be checked against a known number.
//
// Two variants are printed:
//   "stale" - reuses the last bar's model input (features through t-1). This is what
//             the current Pine code does, and it throws away the last session's data.
//   "fresh" - rebuilds the features including the last completed bar (correct for
//             forecasting t+1).
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, RESID_WIN = 500;
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

function nextForecast(file) {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };

  const feats = (t) => [1,
    Math.log(trail(rr, t, 5) + EPS),
    Math.log(trail(rr, t, 20) + EPS),
    Math.log(trail(rr, t, 60) + EPS),
    Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];

  // features for the NEXT session: everything through the last completed bar
  const featsNext = [1,
    Math.log(mean(rr.slice(n - 5)) + EPS),
    Math.log(mean(rr.slice(n - 20)) + EPS),
    Math.log(mean(rr.slice(n - 60)) + EPS),
    Math.log(sd(lr.slice(n - 20)) + EPS)];

  const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
  const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
  const yU = u.map(Math.log), yD = d.map(Math.log);

  // fit on everything (this is what the final refit does)
  const X = [], a = [], b = [];
  for (let i = 60; i < n; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
  const wU = ols(X, a), wD = ols(X, b);

  // residual buffer of the most recent out-of-sample errors
  const resU = [], resD = [];
  for (let i = Math.max(60, n - RESID_WIN); i < n; i++) {
    resU.push(yU[i] - dot(wU, feats(i)));
    resD.push(yD[i] - dot(wD, feats(i)));
  }

  const close = rows[n - 1].close;
  const lastFeat = feats(n - 1);
  const out = { file, date: rows[n - 1].date, close };

  for (const [label, f] of [['stale', lastFeat], ['fresh', featsNext]]) {
    const muU = dot(wU, f), muD = dot(wD, f);
    const at = (p) => close * (1 + Math.exp(muU + q(resU, p)));
    const bt = (p) => close * (1 - Math.exp(muD + q(resD, 1 - p)));
    out[label] = {
      hi10: at(0.1), hi50: at(0.5), hi90: at(0.9),
      lo10: bt(0.1), lo50: bt(0.5), lo90: bt(0.9),
    };
  }
  return out;
}

for (const [label, file] of [
  ['NQ', 'nq_futures_daily.csv'],
  ['ES', 'es_futures_daily.csv'],
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv'],
]) {
  const r = nextForecast(file);
  const f = (v) => v.toFixed(0).padStart(7);
  console.log(`\n${label}  last bar ${r.date}  close ${r.close}`);
  for (const which of ['stale', 'fresh']) {
    const s = r[which];
    const hiBand = `${f(s.hi10)} .. ${f(s.hi90)}  (med ${f(s.hi50)})`;
    const loBand = `${f(s.lo10)} .. ${f(s.lo90)}  (med ${f(s.lo50)})`;
    console.log(`  ${which}: high ${hiBand}`);
    console.log(`         low  ${loBand}`);
    console.log(`         median range ${f(s.hi50 - s.lo50)} (${((s.hi50 - s.lo50) / r.close * 100).toFixed(2)}%)`);
  }
  const dH = Math.abs(r.fresh.hi50 - r.stale.hi50);
  const dL = Math.abs(r.fresh.lo50 - r.stale.lo50);
  console.log(`  difference stale vs fresh: high ${dH.toFixed(0)} pts, low ${dL.toFixed(0)} pts`);
}
