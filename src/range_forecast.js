// Range / high-low band forecaster for the Nasdaq Composite.
//
// Two models, refit monthly on an expanding window:
//   u = (high - open) / open     "upside excursion from the open"
//   d = (open - low)  / open     "downside excursion from the open"
// Modelled in logs, banded with empirical residual quantiles from the last 500
// out-of-sample errors, validated walk-forward (no lookahead anywhere).
//
//   node range_forecast.js
//
// Writes range_bands_oos.csv (one row per out-of-sample session) and prints
// calibration stats plus a forecast for the next session.
const fs = require('fs');
const path = require('path');

const CSV = path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2015-2026.csv');
const OUT = path.join(__dirname, '..', 'data', 'range_bands_oos.csv');

const rows = fs
  .readFileSync(CSV, 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [date, open, high, low, close] = line.split(',');
    return { date, open: +open, high: +high, low: +low, close: +close };
  });

const n = rows.length;
const EPS = 1e-4;
const WARMUP = 300; // sessions of history before the first model fit
const MIN_RESID = 60; // residuals needed before bands are trustworthy
const REFIT = 21; // refit cadence in trading days
const RESID_WINDOW = 500;

const rangeRatio = rows.map((r) => (r.high - r.low) / r.close);
const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const trail = (arr, t, w) => {
  const a = arr.slice(Math.max(0, t - w), t);
  return a.length ? mean(a) : 0;
};

// everything below uses only data strictly before day t (plus day t's open)
function features(t) {
  // Deliberately excludes yesterday's single-day range: it adds no accuracy
  // (tested) but doubles day-to-day noise in the forecast.
  const rr5 = trail(rangeRatio, t, 5);
  const rr20 = trail(rangeRatio, t, 20);
  const rr60 = trail(rangeRatio, t, 60);
  const rv20 = sd(lr.slice(Math.max(0, t - 20), t));
  return [
    1,
    Math.log(rr5 + EPS),
    Math.log(rr20 + EPS),
    Math.log(rr60 + EPS),
    Math.log(rv20 + EPS),
  ];
}

function ols(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < k; j++) {
      b[j] += X[i][j] * y[i];
      for (let l = 0; l < k; l++) A[j][l] += X[i][j] * X[i][l];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-8;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    const piv = A[i][i] || 1e-12;
    for (let j = i; j < k; j++) A[i][j] /= piv;
    b[i] /= piv;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let j = i; j < k; j++) A[r][j] -= f * A[i][j];
      b[r] -= f * b[i];
    }
  }
  return b;
}
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
const yU = u.map(Math.log);
const yD = d.map(Math.log);

// ---------- walk-forward ----------
let wU = null, wD = null, lastFit = -1;
const resU = [], resD = [];
const out = [];

for (let t = WARMUP; t < n; t++) {
  if (lastFit < 0 || t - lastFit >= REFIT) {
    const Xtr = [], ytrU = [], ytrD = [];
    for (let i = 60; i < t; i++) { Xtr.push(features(i)); ytrU.push(yU[i]); ytrD.push(yD[i]); }
    wU = ols(Xtr, ytrU);
    wD = ols(Xtr, ytrD);
    lastFit = t;
  }

  const x = features(t);
  const muU = dot(wU, x);
  const muD = dot(wD, x);

  if (resU.length >= MIN_RESID) {
    const o = rows[t].open;
    const hi = (p) => o * (1 + Math.exp(muU + q(resU, p)));
    const lo = (p) => o * (1 - Math.exp(muD + q(resD, p)));
    const rec = {
      date: rows[t].date,
      open: o,
      actualHigh: rows[t].high,
      actualLow: rows[t].low,
      hi10: hi(0.1), hi50: hi(0.5), hi90: hi(0.9),
      // low is decreasing in the downside excursion, so percentiles flip
      lo10: lo(0.9), lo50: lo(0.5), lo90: lo(0.1),
      naiveHi: o * (1 + (rows[t - 1].high - rows[t - 1].open) / rows[t - 1].open),
      naiveLo: o * (1 - (rows[t - 1].open - rows[t - 1].low) / rows[t - 1].open),
    };
    out.push(rec);
  }

  resU.push(yU[t] - muU);
  resD.push(yD[t] - muD);
  if (resU.length > RESID_WINDOW) { resU.shift(); resD.shift(); }
}

// ---------- calibration ----------
const inside = (lo, hi, act) => act >= lo && act <= hi;
const m = out.length;
const covHi80 = out.filter((r) => inside(r.hi10, r.hi90, r.actualHigh)).length / m;
const covLo80 = out.filter((r) => inside(r.lo10, r.lo90, r.actualLow)).length / m;
const covBoth80 = out.filter((r) => inside(r.hi10, r.hi90, r.actualHigh) && inside(r.lo10, r.lo90, r.actualLow)).length / m;
const covHi50 = out.filter((r) => inside(r.hi50 * 0.999, r.hi50 * 1.001, r.actualHigh)).length / m;

const maeHi = mean(out.map((r) => Math.abs(r.hi50 - r.actualHigh)));
const maeLo = mean(out.map((r) => Math.abs(r.lo50 - r.actualLow)));
const maeHiN = mean(out.map((r) => Math.abs(r.naiveHi - r.actualHigh)));
const maeLoN = mean(out.map((r) => Math.abs(r.naiveLo - r.actualLow)));

console.log(`sessions ${n} | out-of-sample forecasts ${m} (${out[0].date} -> ${out[m - 1].date})`);
console.log(`anchor = that session's open; open==high ${rows.filter((r) => r.high <= r.open).length}x, open==low ${rows.filter((r) => r.low >= r.open).length}x\n`);

console.log('=== band calibration (80% band should contain the truth ~80% of the time) ===');
console.log(`high inside [p10,p90] : ${(covHi80 * 100).toFixed(1)}%`);
console.log(`low  inside [p10,p90] : ${(covLo80 * 100).toFixed(1)}%`);
console.log(`both inside           : ${(covBoth80 * 100).toFixed(1)}%`);

console.log('\n=== point error ===');
console.log(`high  MAE ${maeHi.toFixed(0)} pts  (naive ${maeHiN.toFixed(0)})  -> ${((1 - maeHi / maeHiN) * 100).toFixed(0)}% better`);
console.log(`low   MAE ${maeLo.toFixed(0)} pts  (naive ${maeLoN.toFixed(0)})  -> ${((1 - maeLo / maeLoN) * 100).toFixed(0)}% better`);

// ---------- next session ----------
const tNext = n;
const Xall = [], yUall = [], yDall = [];
for (let i = 60; i < n; i++) { Xall.push(features(i)); yUall.push(yU[i]); yDall.push(yD[i]); }
const wUf = ols(Xall, yUall), wDf = ols(Xall, yDall);
const xf = features(tNext); // needs only data through n-1
const muUf = dot(wUf, xf), muDf = dot(wDf, xf);
const lastClose = rows[n - 1].close;
const anchor = lastClose;

console.log('\n=== next session forecast (levels shown as if it opens at the last close) ===');
const hiAt = (p) => anchor * (1 + Math.exp(muUf + q(resU, p)));
const loAt = (p) => anchor * (1 - Math.exp(muDf + q(resD, 1 - p)));
console.log(`  high 80% band : ${hiAt(0.1).toFixed(0)} .. ${hiAt(0.9).toFixed(0)}   (median ${hiAt(0.5).toFixed(0)})`);
console.log(`  low  80% band : ${loAt(0.1).toFixed(0)} .. ${loAt(0.9).toFixed(0)}   (median ${loAt(0.5).toFixed(0)})`);
const medHi = anchor * (1 + Math.exp(muUf + q(resU, 0.5)));
const medLo = anchor * (1 - Math.exp(muDf + q(resD, 0.5)));
console.log(`\n  median high ${medHi.toFixed(0)} / low ${medLo.toFixed(0)} -> median range ${((medHi - medLo) / anchor * 100).toFixed(2)}% of price`);

// ---------- csv ----------
const lines = ['date,open,actual_high,actual_low,high_p10,high_p50,high_p90,low_p10,low_p50,low_p90,high_in80,low_in80'];
const f2 = (v) => v.toFixed(2);
for (const r of out) {
  lines.push([r.date, f2(r.open), f2(r.actualHigh), f2(r.actualLow), f2(r.hi10), f2(r.hi50), f2(r.hi90), f2(r.lo10), f2(r.lo50), f2(r.lo90), inside(r.hi10, r.hi90, r.actualHigh) ? 1 : 0, inside(r.lo10, r.lo90, r.actualLow) ? 1 : 0].join(','));
}
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log(`\nwrote ${path.basename(OUT)} (${m} rows)`);


