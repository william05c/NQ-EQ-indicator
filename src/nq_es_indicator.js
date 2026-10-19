// NQ / ES daily range indicator.
// Same walk-forward model, but fitted on each instrument's own history instead of
// proxying with the Nasdaq Composite.
//
//   node nq_es_indicator.js
//
// Writes nq_es_forecast.csv with the next-session bands for each contract.
//
// NOTE ON SESSIONS: these Sina bars are 24-hour (Globex) sessions, not RTH 09:30-16:00.
// That is why NQ's mean range (1.98%) is far above the cash index (1.44%) and why the
// open-to-prior-close gap is tiny (0.14%). For a day-trading indicator you want RTH bars;
// this is the closest free approximation available here.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

function load(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
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

function build(rows) {
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
  const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
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
    if (resU.length >= MIN_RESID) {
      const o = rows[t].open;
      out.push({
        date: rows[t].date, o, ah: rows[t].high, al: rows[t].low,
        hi: o * (1 + Math.exp(muU + q(resU, 0.5))),
        lo: o * (1 - Math.exp(muD + q(resD, 0.5))),
        hi10: o * (1 + Math.exp(muU + q(resU, 0.1))), hi90: o * (1 + Math.exp(muU + q(resU, 0.9))),
        lo10: o * (1 - Math.exp(muD + q(resD, 0.9))), lo90: o * (1 - Math.exp(muD + q(resD, 0.1))),
        ar: (rows[t].high - rows[t].low) / o,
      });
    }
    resU.push(yU[t] - muU); resD.push(yD[t] - muD);
    if (resU.length > RW) { resU.shift(); resD.shift(); }
  }

  // final fit on all data for the next session
  const X = [], a = [], b = [];
  for (let i = 60; i < n; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
  const fU = ols(X, a), fD = ols(X, b);
  const xf = feats(n);
  const muU = dot(fU, xf), muD = dot(fD, xf);
  const c = rows[n - 1].close;
  const band = (p) => [c * (1 + Math.exp(muU + q(resU, p))), c * (1 - Math.exp(muD + q(resD, 1 - p)))];
  return { out, last: rows[n - 1], band, n, years: (new Date(rows[n - 1].date) - new Date(rows[0].date)) / (365.25 * 864e5) };
}

const rows = [];
for (const [name, file] of [['NQ', 'nq_futures_daily.csv'], ['ES', 'es_futures_daily.csv']]) {
  const r = build(load(file));
  const n = r.out.length;
  const maeH = mean(r.out.map((x) => Math.abs(x.hi - x.ah)));
  const medH = q(r.out.map((x) => Math.abs(x.hi - x.ah) / x.o), 0.5);
  const medL = q(r.out.map((x) => Math.abs(x.lo - x.al) / x.o), 0.5);
  const covH = r.out.filter((x) => x.ah >= x.hi10 && x.ah <= x.hi90).length / n;
  const covL = r.out.filter((x) => x.al >= x.lo10 && x.al <= x.lo90).length / n;

  console.log(`\n${name}  (${r.n} sessions, ${r.years.toFixed(1)}y, OOS ${n})`);
  console.log(`  median error  high ${(medH * 100).toFixed(2)}%   low ${(medL * 100).toFixed(2)}%   MAE_high ${maeH.toFixed(0)} pts`);
  console.log(`  80% band coverage  high ${(covH * 100).toFixed(1)}%   low ${(covL * 100).toFixed(1)}%`);
  const [h10, l10] = r.band(0.1), [h50, l50] = r.band(0.5), [h90, l90] = r.band(0.9);
  console.log(`  next session (anchor ${r.last.date} close ${r.last.close}):`);
  console.log(`    high 80% band ${h10.toFixed(0)} .. ${h90.toFixed(0)}   median ${h50.toFixed(0)}`);
  console.log(`    low  80% band ${l10.toFixed(0)} .. ${l90.toFixed(0)}   median ${l50.toFixed(0)}`);
  console.log(`    median range ${(h50 - l50).toFixed(0)} pts (${((h50 - l50) / r.last.close * 100).toFixed(2)}%)`);
  rows.push([name, r.last.date, r.last.close.toFixed(2), h10.toFixed(2), h50.toFixed(2), h90.toFixed(2), l10.toFixed(2), l50.toFixed(2), l90.toFixed(2), (covH * 100).toFixed(1), (covL * 100).toFixed(1)].join(','));
}

fs.writeFileSync(path.join(__dirname, '..', 'data', 'nq_es_forecast.csv'), 'asset,as_of,last_close,high_p10,high_p50,high_p90,low_p10,low_p50,low_p90,oos_cov_high,oos_cov_low\n' + rows.join('\n') + '\n', 'utf8');
console.log('\nwrote nq_es_forecast.csv');
