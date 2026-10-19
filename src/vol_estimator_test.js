// Do better volatility estimators (Parkinson / Garman-Klass / Yang-Zhang) beat the
// close-to-close realized vol currently in the model? Same walk-forward, same data.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
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
const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function run(rows, variant, evalFrom) {
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };

  // per-day volatility estimators
  const lnHL = rows.map((r) => Math.log(r.high / r.low));
  const lnCO = rows.map((r) => Math.log(r.close / r.open));
  const lnHO = rows.map((r) => Math.log(r.high / r.open));
  const lnLO = rows.map((r) => Math.log(r.low / r.open));
  const lnOC = rows.map((r) => Math.log(r.open / (i0(rows) || r.open))); // placeholder, replaced below
  const overnight = rows.map((r, i) => (i ? Math.log(r.open / rows[i - 1].close) : 0));

  const park = rows.map((r, i) => (lnHL[i] ** 2) / (4 * Math.LN2));
  const gk = rows.map((r, i) => 0.5 * lnHL[i] ** 2 - (2 * Math.LN2 - 1) * lnCO[i] ** 2);
  const rs = rows.map((r, i) => lnHO[i] * (lnHO[i] - lnCO[i]) + lnLO[i] * (lnLO[i] - lnCO[i]));
  const yz = rows.map((r, i) => overnight[i] ** 2 + 0.5 * lnCO[i] ** 2 + (1 - 0.5) * rs[i]);

  const vol = (arr, t, w) => Math.sqrt(Math.max(0, trail(arr, t, w)));
  const rvCC = (t, w) => sd(lr.slice(Math.max(0, t - w), t));

  const feats = (t) => {
    const base = [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS)];
    if (variant === 'base') return base.concat([Math.log(rvCC(t, 20) + EPS)]);
    if (variant === 'parkinson') return base.concat([Math.log(vol(park, t, 20) + EPS)]);
    if (variant === 'garman') return base.concat([Math.log(vol(gk, t, 20) + EPS)]);
    if (variant === 'yangzhang') return base.concat([Math.log(vol(yz, t, 20) + EPS)]);
    if (variant === 'both') return base.concat([Math.log(rvCC(t, 20) + EPS), Math.log(vol(gk, t, 20) + EPS)]);
    if (variant === 'har') {
      // HAR: daily / weekly / monthly realized vol layers
      return [1, Math.log(trail(rr, t, 1) + EPS), Math.log(rvCC(t, 1) + EPS), Math.log(trail(rr, t, 5) + EPS),
        Math.log(rvCC(t, 5) + EPS), Math.log(trail(rr, t, 22) + EPS), Math.log(rvCC(t, 22) + EPS)].slice(0, 7);
    }
    return base.concat([Math.log(rvCC(t, 20) + EPS)]);
  };

  const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
  const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
  const yU = u.map(Math.log), yD = d.map(Math.log);

  let wU = null, wD = null, lastFit = -1;
  const resU = [], resD = [], out = [];
  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], a = [], b = [];
      for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
      wU = ols(X, a); wD = ols(X, b); lastFit = t;
    }
    const x = feats(t);
    const muU = dot(wU, x), muD = dot(wD, x);
    if (resU.length >= MIN_RESID && rows[t].date >= evalFrom) {
      const o = rows[t].open;
      out.push({ o, ah: rows[t].high, al: rows[t].low, hi: o * (1 + Math.exp(muU + q(resU, 0.5))), lo: o * (1 - Math.exp(muD + q(resD, 0.5))) });
    }
    resU.push(yU[t] - muU); resD.push(yD[t] - muD);
    if (resU.length > RW) { resU.shift(); resD.shift(); }
  }
  return out;
}
function i0() { return 0; }

const score = (o) => ({
  mh: mean(o.map((r) => Math.abs(r.hi - r.ah))),
  ml: mean(o.map((r) => Math.abs(r.lo - r.al))),
  med: q(o.map((r) => Math.abs(r.hi - r.ah) / r.o), 0.5) * 100,
});

const variants = ['base', 'parkinson', 'garman', 'yangzhang', 'both', 'har'];
const sets = [
  ['IXIC 24y (2016-2026)', load('nasdaq_composite_IXIC_daily_2002-2026.csv'), '2016-10-18'],
  ['NQ (own data)', load('nq_futures_daily.csv'), '2019-06-01'],
  ['ES (own data)', load('es_futures_daily.csv'), '2018-01-01'],
];

for (const [label, rows, from] of sets) {
  console.log(`\n${label}`);
  let best = null;
  for (const v of variants) {
    const o = run(rows, v, from);
    const s = score(o);
    if (!best || s.mh < best.s.mh) best = { v, s };
    console.log(`  ${v.padEnd(12)} MAE_H ${s.mh.toFixed(1).padStart(6)}  MAE_L ${s.ml.toFixed(1).padStart(6)}  med% ${s.med.toFixed(3)}`);
  }
  console.log(`  -> best: ${best.v}`);
}
