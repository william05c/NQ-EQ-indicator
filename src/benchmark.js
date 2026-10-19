#!/usr/bin/env node
// Canonical evaluation harness. Every proposed change must be scored with this script
// so numbers are comparable across contributors.
//
//   node src/benchmark.js                          # default: Nasdaq Composite 24y
//   node src/benchmark.js --data nq_futures_daily.csv
//   node src/benchmark.js --data es_futures_daily.csv --from 2018-01-01
//   node src/benchmark.js --json                   # machine-readable, for CI or diffing
//
// The model here is the reference implementation. If you change the model, change it
// here first — range_forecast.js and the Pine constants are downstream of this.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const asJson = argv.includes('--json');
const dataFile = arg('data', 'nasdaq_composite_IXIC_daily_2002-2026.csv');
const fromDate = arg('from', '2016-10-18');

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

const rows = fs
  .readFileSync(path.join(__dirname, '..', 'data', dataFile), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

const n = rows.length;
const rr = rows.map((r) => (r.high - r.low) / r.close);
const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };

// ---- reference model -------------------------------------------------------
const feats = (t) => [
  1,
  Math.log(trail(rr, t, 5) + EPS),
  Math.log(trail(rr, t, 20) + EPS),
  Math.log(trail(rr, t, 60) + EPS),
  Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS),
];

const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
const yU = u.map(Math.log), yD = d.map(Math.log);

// EWMA benchmark
const lam = 0.94;
const varEwma = new Array(n).fill(0);
let v = sd(lr.slice(1, 61)) ** 2;
for (let t = 61; t < n; t++) { varEwma[t] = v; v = lam * v + (1 - lam) * lr[t] ** 2; }
const sig = (t) => Math.sqrt(Math.max(varEwma[t], 1e-12));

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
  if (resU.length >= MIN_RESID && rows[t].date >= fromDate) {
    const o = rows[t].open;
    const k = { c: 0 };
    let ku = 0, kd = 0, c = 0;
    for (let i = WARMUP; i < t; i++) { const si = sig(i); if (si > 0) { ku += u[i] / si; kd += d[i] / si; c++; } }
    ku = c ? ku / c : 1; kd = c ? kd / c : 1;
    out.push({
      date: rows[t].date, o,
      ah: rows[t].high, al: rows[t].low,
      hi: o * (1 + Math.exp(muU + q(resU, 0.5))),
      lo: o * (1 - Math.exp(muD + q(resD, 0.5))),
      hi10: o * (1 + Math.exp(muU + q(resU, 0.1))), hi90: o * (1 + Math.exp(muU + q(resU, 0.9))),
      lo10: o * (1 - Math.exp(muD + q(resD, 0.9))), lo90: o * (1 - Math.exp(muD + q(resD, 0.1))),
      ar: (rows[t].high - rows[t].low) / o,
      naiveH: o * (1 + (rows[t - 1].high - rows[t - 1].open) / rows[t - 1].open),
      naiveL: o * (1 - (rows[t - 1].open - rows[t - 1].low) / rows[t - 1].open),
      ewmaH: o * (1 + ku * sig(t)), ewmaL: o * (1 - kd * sig(t)),
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---- metrics ---------------------------------------------------------------
const m = out.length;
const maeH = mean(out.map((r) => Math.abs(r.hi - r.ah)));
const maeL = mean(out.map((r) => Math.abs(r.lo - r.al)));
const maeHn = mean(out.map((r) => Math.abs(r.naiveH - r.ah)));
const maeLn = mean(out.map((r) => Math.abs(r.naiveL - r.al)));
const maeHe = mean(out.map((r) => Math.abs(r.ewmaH - r.ah)));
const maeLe = mean(out.map((r) => Math.abs(r.ewmaL - r.al)));
const medH = q(out.map((r) => Math.abs(r.hi - r.ah) / r.o), 0.5);
const medL = q(out.map((r) => Math.abs(r.lo - r.al) / r.o), 0.5);
const covH = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / m;
const covL = out.filter((r) => r.al >= r.lo10 && r.al <= r.lo90).length / m;
const covB = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90 && r.al >= r.lo10 && r.al <= r.lo90).length / m;
const corr = (() => { const a = out.map((r) => (r.hi - r.lo) / r.o), b = out.map((r) => r.ar); const ma = mean(a), mb = mean(b); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < m; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxy / Math.sqrt(sxx * syy); })();

const sorted = [...out].sort((a, b) => a.ar - b.ar);
const third = Math.floor(m / 3);
const calm = sorted.slice(0, third), wild = sorted.slice(-third);
const covOf = (set) => set.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / set.length;

const result = {
  data: dataFile,
  window: `${out[0].date}..${out[m - 1].date}`,
  sessions: m,
  mae_high: +maeH.toFixed(2),
  mae_low: +maeL.toFixed(2),
  median_pct_high: +(medH * 100).toFixed(3),
  median_pct_low: +(medL * 100).toFixed(3),
  coverage_high_80: +(covH * 100).toFixed(1),
  coverage_low_80: +(covL * 100).toFixed(1),
  coverage_both_80: +(covB * 100).toFixed(1),
  corr_range: +corr.toFixed(3),
  vs_naive_high_pct: +((1 - maeH / maeHn) * 100).toFixed(1),
  vs_naive_low_pct: +((1 - maeL / maeLn) * 100).toFixed(1),
  vs_ewma_high_pct: +((1 - maeH / maeHe) * 100).toFixed(1),
  vs_ewma_low_pct: +((1 - maeL / maeLe) * 100).toFixed(1),
  coverage_calm_third: +(covOf(calm) * 100).toFixed(1),
  coverage_wild_third: +(covOf(wild) * 100).toFixed(1),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`data            : ${result.data}`);
  console.log(`window          : ${result.window}  (${result.sessions} out-of-sample sessions)`);
  console.log('');
  console.log(`MAE high / low  : ${result.mae_high} / ${result.mae_low}`);
  console.log(`median error    : ${result.median_pct_high}% / ${result.median_pct_low}%`);
  console.log(`80% coverage    : high ${result.coverage_high_80}%  low ${result.coverage_low_80}%  both ${result.coverage_both_80}%`);
  console.log(`range corr      : ${result.corr_range}`);
  console.log('');
  console.log(`vs naive        : ${result.vs_naive_high_pct}% / ${result.vs_naive_low_pct}% better`);
  console.log(`vs EWMA         : ${result.vs_ewma_high_pct}% / ${result.vs_ewma_low_pct}% better`);
  console.log('');
  console.log(`coverage, calm third : ${result.coverage_calm_third}%   (over-wide bands here)`);
  console.log(`coverage, wild third : ${result.coverage_wild_third}%   (under-wide bands here)`);
  console.log('');
  console.log('Acceptance bar (CONTRIBUTING.md): beat MAE by >=2%, keep both coverages within');
  console.log('78-84%, and do not make the calm/wild split worse than 91/68.');
}
