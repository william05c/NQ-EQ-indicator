// How far can this dataset actually go toward "predicting tomorrow's high/low"?
// Builds simple, honestly-validated baselines on the 2,965 daily bars.
const fs = require('fs');
const path = require('path');

const rows = fs
  .readFileSync(path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2015-2026.csv'), 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [date, open, high, low, close] = line.split(',');
    return { date, open: +open, high: +high, low: +low, close: +close };
  });

const n = rows.length;
const rng = rows.map((r) => (r.high - r.low) / r.close); // daily range as % of close
const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(p * (s.length - 1))];
};

// ---------- 1. what the target looks like ----------
console.log('=== daily range as % of close (what we are trying to predict) ===');
console.log(`mean ${(mean(rng) * 100).toFixed(2)}%  median ${(q(rng, 0.5) * 100).toFixed(2)}%`);
console.log(`p10 ${(q(rng, 0.1) * 100).toFixed(2)}%  p90 ${(q(rng, 0.9) * 100).toFixed(2)}%  max ${(Math.max(...rng) * 100).toFixed(2)}%`);
console.log(`std of range itself: ${(sd(rng) * 100).toFixed(2)} pts of %  -> range varies by +/- ${(sd(rng) / mean(rng) * 100).toFixed(0)}% around its own mean`);

// ---------- helpers ----------
const trail = (arr, i, w) => mean(arr.slice(Math.max(0, i - w + 1), i + 1));

function ols(X, y) {
  // normal equations via Gaussian elimination, X includes intercept column
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < k; j++) {
      b[j] += X[i][j] * y[i];
      for (let l = 0; l < k; l++) A[j][l] += X[i][j] * X[i][l];
    }
  }
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let j = i; j < k; j++) A[i][j] /= d;
    b[i] /= d;
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
const r2 = (pred, y) => {
  const m = mean(y);
  const ss = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const st = y.reduce((s, v) => s + (v - m) ** 2, 0);
  return 1 - ss / st;
};
const mae = (pred, y) => mean(y.map((v, i) => Math.abs(v - pred[i])));

// ---------- 2. can trailing data forecast the range? ----------
// features at day i (known at close of i), target = range on day i+1
const idx = [];
for (let i = 60; i < n - 1; i++) idx.push(i);
const split = Math.floor(idx.length * 0.7);
const trainIdx = idx.slice(0, split);
const testIdx = idx.slice(split);

const feats = (i) => [1, trail(rng, i, 5), trail(rng, i, 20), trail(rng, i, 60), Math.abs(lr[i])];
const Xtr = trainIdx.map(feats);
const ytr = trainIdx.map((i) => rng[i + 1]);
const w = ols(Xtr, ytr);

const predTr = Xtr.map((x) => dot(w, x));
const predTe = testIdx.map((i) => dot(w, feats(i)));
const yTe = testIdx.map((i) => rng[i + 1]);

console.log('\n=== predicting the SIZE of tomorrow\'s range (volatility model) ===');
console.log(`R2 in-sample : ${r2(predTr, ytr).toFixed(3)}`);
console.log(`R2 out-of-sample (last 30%, never seen): ${r2(predTe, yTe).toFixed(3)}`);
console.log(`out-of-sample MAE: ${(mae(predTe, yTe) * 100).toFixed(3)} pp of range`);
console.log(`baseline (always guess the long-run mean range) R2: ${r2(yTe.map(() => mean(ytr)), yTe).toFixed(3)}`);

// ---------- 3. now the thing you actually asked: predict the high and low LEVELS ----------
// model: high_{t+1} = close_t + a * predRange, low_{t+1} = close_t - b * predRange
const trainH = trainIdx.map((i) => (rows[i + 1].high - rows[i].close) / (predTr[trainIdx.indexOf(i)] * rows[i].close));
const trainL = trainIdx.map((i) => (rows[i].close - rows[i + 1].low) / (predTr[trainIdx.indexOf(i)] * rows[i].close));
const a = mean(trainH);
const b = mean(trainL);

const maeH = [];
const maeL = [];
const maeHbase = [];
const maeLbase = [];
const errPct = [];
for (const i of testIdx) {
  const pr = dot(w, feats(i)) * rows[i].close;
  const pH = rows[i].close + a * pr;
  const pL = rows[i].close - b * pr;
  maeH.push(Math.abs(pH - rows[i + 1].high));
  maeL.push(Math.abs(pL - rows[i + 1].low));
  maeHbase.push(Math.abs(rows[i].high - rows[i + 1].high)); // naive: tomorrow's high = today's high
  maeLbase.push(Math.abs(rows[i].low - rows[i + 1].low));
  errPct.push(Math.abs(pH - rows[i + 1].high) / rows[i + 1].high);
}
console.log('\n=== predicting tomorrow\'s HIGH and LOW levels (points) ===');
console.log(`model MAE high: ${mean(maeH).toFixed(0)} pts (${(mean(maeH) / mean(testIdx.map((i) => rows[i + 1].high)) * 100).toFixed(2)}%)`);
console.log(`model MAE low : ${mean(maeL).toFixed(0)} pts (${(mean(maeL) / mean(testIdx.map((i) => rows[i + 1].low)) * 100).toFixed(2)}%)`);
console.log(`naive MAE high: ${mean(maeHbase).toFixed(0)} pts  |  naive MAE low: ${mean(maeLbase).toFixed(0)} pts`);
console.log(`median error on the high: ${(q(errPct, 0.5) * 100).toFixed(2)}%  |  90th pct: ${(q(errPct, 0.9) * 100).toFixed(2)}%`);

// ---------- 4. how often is the "predicted high" actually breached? ----------
let breaches = 0;
for (const i of testIdx) {
  const pr = dot(w, feats(i)) * rows[i].close;
  const pH = rows[i].close + a * pr;
  if (rows[i + 1].high > pH) breaches++;
}
console.log(`\nfraction of days the real high came in ABOVE the predicted high: ${(breaches / testIdx.length * 100).toFixed(0)}%`);
console.log('(a useful high/low "prediction" is a band you can quote odds on, not a single number)');
