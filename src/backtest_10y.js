// 10-year backtest: our range model vs the standard benchmarks a desk would use.
// Window: 2016-10-18 .. 2026-10-16 (the last 10 years of the dataset).
// Models compared, all walk-forward with monthly refits and no lookahead:
//   ours   - log-linear excursion model (see range_forecast.js)
//   naive  - yesterday's excursion carried forward
//   roll20 - mean excursion over the prior 20 sessions
//   ewma   - RiskMetrics EWMA volatility (lambda 0.94) scaled by a calibrated multiplier
const fs = require('fs');
const path = require('path');

const rows = fs
  .readFileSync(path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2015-2026.csv'), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

const n = rows.length;
const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const START = '2016-10-18'; // 10-year window

const rr = rows.map((r) => (r.high - r.low) / r.close);
const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };

function feats(t) {
  return [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
}
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

const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
const yU = u.map(Math.log), yD = d.map(Math.log);

// EWMA vol (RiskMetrics) computed causally: sigma_t uses returns up to t-1
const lam = 0.94;
const varEwma = new Array(n).fill(0);
let v = sd(lr.slice(1, 61)) ** 2;
for (let t = 61; t < n; t++) { varEwma[t] = v; v = lam * v + (1 - lam) * lr[t] ** 2; }
const sig = (t) => Math.sqrt(Math.max(varEwma[t], 1e-12));

let wU = null, wD = null, lastFit = -1;
const resU = [], resD = [];
const recs = [];

for (let t = WARMUP; t < n; t++) {
  if (lastFit < 0 || t - lastFit >= REFIT) {
    const X = [], a = [], b = [];
    for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
    wU = ols(X, a); wD = ols(X, b); lastFit = t;
  }
  const x = feats(t);
  const muU = dot(wU, x), muD = dot(wD, x);
  const o = rows[t].open;
  const s = sig(t);

  // calibrated EWMA multipliers from the training window only
  let ku = 0, kd = 0, c = 0;
  for (let i = WARMUP; i < t; i++) {
    const si = sig(i);
    if (si > 0) { ku += u[i] / si; kd += d[i] / si; c++; }
  }
  ku = c ? ku / c : 1; kd = c ? kd / c : 1;

  if (resU.length >= MIN_RESID && rows[t].date >= START) {
    const hi = o * (1 + Math.exp(muU + q(resU, 0.5)));
    const lo = o * (1 - Math.exp(muD + q(resD, 0.5)));
    recs.push({
      date: rows[t].date,
      o,
      ah: rows[t].high,
      al: rows[t].low,
      ar: (rows[t].high - rows[t].low) / o,
      oursH: hi, oursL: lo,
      oursR: (hi - lo) / o,
      naiveH: o * (1 + (rows[t - 1].high - rows[t - 1].open) / rows[t - 1].open),
      naiveL: o * (1 - (rows[t - 1].open - rows[t - 1].low) / rows[t - 1].open),
      rollH: o * (1 + trail(u, t, 20)),
      rollL: o * (1 - trail(d, t, 20)),
      ewmaH: o * (1 + ku * s),
      ewmaL: o * (1 - kd * s),
      hiIn80: rows[t].high >= o * (1 + Math.exp(muU + q(resU, 0.1))) && rows[t].high <= o * (1 + Math.exp(muU + q(resU, 0.9))),
      loIn80: rows[t].low >= o * (1 - Math.exp(muD + q(resD, 0.9))) && rows[t].low <= o * (1 - Math.exp(muD + q(resD, 0.1))),
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---------- metrics ----------
const mae = (f) => mean(recs.map((r) => Math.abs(f(r))));
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < a.length; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxy / Math.sqrt(sxx * syy); };
const medAbsPct = (f, act) => { const a = recs.map((r) => Math.abs(f(r)) / act(r)).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

const models = [
  ['ours', (r) => r.oursH, (r) => r.oursL],
  ['naive', (r) => r.naiveH, (r) => r.naiveL],
  ['roll20', (r) => r.rollH, (r) => r.rollL],
  ['ewma', (r) => r.ewmaH, (r) => r.ewmaL],
];

console.log(`window ${recs[0].date} -> ${recs[recs.length - 1].date}  (${recs.length} sessions)\n`);
console.log('model    MAE_high  MAE_low   med%_high  med%_low   corr_range');
for (const [name, fh, fl] of models) {
  const mh = mae((r) => fh(r) - r.ah), ml = mae((r) => fl(r) - r.al);
  const cr = corr(recs.map((r) => (fh(r) - fl(r)) / r.o), recs.map((r) => r.ar));
  console.log(`${name.padEnd(8)} ${mh.toFixed(0).padStart(8)} ${ml.toFixed(0).padStart(9)} ${(medAbsPct((r) => fh(r) - r.ah, (r) => r.ah) * 100).toFixed(2).padStart(10)}% ${(medAbsPct((r) => fl(r) - r.al, (r) => r.al) * 100).toFixed(2).padStart(9)}% ${cr.toFixed(3).padStart(11)}`);
}

// ---------- yearly ----------
console.log('\n=== ours, by year ===');
console.log('year  n     MAE_high  med%_high  80%_high  80%_both   naive_MAE   beat');
const years = [...new Set(recs.map((r) => r.date.slice(0, 4)))];
const yearly = [];
for (const y of years) {
  const rs = recs.filter((r) => r.date.startsWith(y));
  const mh = mean(rs.map((r) => Math.abs(r.oursH - r.ah)));
  const mhn = mean(rs.map((r) => Math.abs(r.naiveH - r.ah)));
  const med = rs.map((r) => Math.abs(r.oursH - r.ah) / r.ah).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  const c80 = rs.filter((r) => r.hiIn80).length / rs.length;
  const cb = rs.filter((r) => r.hiIn80 && r.loIn80).length / rs.length;
  console.log(`${y} ${String(rs.length).padStart(5)} ${mh.toFixed(0).padStart(9)} ${(med * 100).toFixed(2).padStart(9)}% ${(c80 * 100).toFixed(1).padStart(9)}% ${(cb * 100).toFixed(1).padStart(9)}% ${mhn.toFixed(0).padStart(10)} ${((1 - mh / mhn) * 100).toFixed(0).padStart(5)}%`);
  yearly.push([y, rs.length, mh.toFixed(1), mhn.toFixed(1), (c80 * 100).toFixed(1), (cb * 100).toFixed(1)].join(','));
}
fs.writeFileSync(path.join(__dirname, '..', 'data', 'backtest_yearly.csv'), 'year,n,mae_ours,mae_naive,coverage_high,coverage_both\n' + yearly.join('\n') + '\n', 'utf8');

// ---------- regime split ----------
const volRank = [...recs].sort((a, b) => a.ar - b.ar);
const third = Math.floor(recs.length / 3);
const lowVol = volRank.slice(0, third), highVol = volRank.slice(-third);
for (const [label, set] of [['calm third (smallest realized ranges)', lowVol], ['wild third (largest realized ranges)', highVol]]) {
  const mh = mean(set.map((r) => Math.abs(r.oursH - r.ah)));
  const c80 = set.filter((r) => r.hiIn80).length / set.length;
  const med = set.map((r) => Math.abs(r.oursH - r.ah) / r.ah).sort((a, b) => a - b)[Math.floor(set.length / 2)];
  console.log(`${label}: MAE_high ${mh.toFixed(0)}  med ${(med * 100).toFixed(2)}%  80%-coverage ${(c80 * 100).toFixed(1)}%`);
}

