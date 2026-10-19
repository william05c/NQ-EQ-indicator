// Fit the final coefficients for the Pine port, per asset profile.
// Prints Pine-ready constants plus seed residual quantiles (fallback before enough history).
const fs = require('fs');
const path = require('path');

const EPS = 1e-4;
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

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function fit(file, label) {
  const rows = load(file);
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => mean(arr.slice(Math.max(0, t - w), t));
  const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
  const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
  const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));

  const X = [], a = [], b = [];
  for (let i = 60; i < n; i++) { X.push(feats(i)); a.push(Math.log(u[i])); b.push(Math.log(d[i])); }
  const wU = ols(X, a), wD = ols(X, b);

  const resU = [], resD = [];
  for (let i = 0; i < X.length; i++) {
    resU.push(a[i] - (wU[0] + wU[1] * X[i][1] + wU[2] * X[i][2] + wU[3] * X[i][3] + wU[4] * X[i][4]));
    resD.push(b[i] - (wD[0] + wD[1] * X[i][1] + wD[2] * X[i][2] + wD[3] * X[i][3] + wD[4] * X[i][4]));
  }

  const f = (v) => v.toFixed(6);
  console.log(`\n// ${label}  (${n} bars, ${rows[0].date}..${rows[n - 1].date})`);
  console.log(`// U model: ${wU.map(f).join(', ')}`);
  console.log(`// D model: ${wD.map(f).join(', ')}`);
  console.log(`coefU := array.from(${wU.map(f).join(', ')})`);
  console.log(`coefD := array.from(${wD.map(f).join(', ')})`);
  console.log(`seedU := array.from(${[0.1, 0.5, 0.9].map((p) => f(q(resU, p))).join(', ')})  // p10,p50,p90`);
  console.log(`seedD := array.from(${[0.1, 0.5, 0.9].map((p) => f(q(resD, p))).join(', ')})  // p10,p50,p90`);
  console.log(`// residual sd: U ${sd(resU).toFixed(4)}  D ${sd(resD).toFixed(4)}`);
}

fit('nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC 24y - cash index profile');
fit('nq_futures_daily.csv', 'NQ - futures 24h profile');
fit('es_futures_daily.csv', 'ES - futures 24h profile');
