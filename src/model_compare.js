// Does 24 years of history actually improve accuracy? And do NQ/ES need their own data?
// Runs the identical walk-forward range model under different training histories and assets.
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

function run(rows, opts) {
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
  const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];

  const trainStart = opts.trainFromDate ? rows.findIndex((r) => r.date >= opts.trainFromDate) : 60;
  const evalFrom = opts.evalFromDate ? rows.findIndex((r) => r.date >= opts.evalFromDate) : 0;

  const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
  const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
  const yU = u.map(Math.log), yD = d.map(Math.log);

  let wU = null, wD = null, lastFit = -1;
  const resU = [], resD = [], out = [];
  const base = Math.max(trainStart, 60);

  for (let t = Math.max(WARMUP, base + 60); t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], a = [], b = [];
      for (let i = base; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
      wU = ols(X, a); wD = ols(X, b); lastFit = t;
    }
    const x = feats(t);
    const muU = dot(wU, x), muD = dot(wD, x);
    if (resU.length >= MIN_RESID && t >= Math.max(evalFrom, 60)) {
      const o = rows[t].open;
      out.push({
        date: rows[t].date, o, ah: rows[t].high, al: rows[t].low,
        hi: o * (1 + Math.exp(muU + q(resU, 0.5))),
        lo: o * (1 - Math.exp(muD + q(resD, 0.5))),
        hi10: o * (1 + Math.exp(muU + q(resU, 0.1))),
        hi90: o * (1 + Math.exp(muU + q(resU, 0.9))),
        lo10: o * (1 - Math.exp(muD + q(resD, 0.9))),
        lo90: o * (1 - Math.exp(muD + q(resD, 0.1))),
        ar: (rows[t].high - rows[t].low) / o,
      });
    }
    resU.push(yU[t] - muU); resD.push(yD[t] - muD);
    if (resU.length > RW) { resU.shift(); resD.shift(); }
  }
  return out;
}

function score(label, out) {
  const n = out.length;
  const maeH = mean(out.map((r) => Math.abs(r.hi - r.ah)));
  const maeL = mean(out.map((r) => Math.abs(r.lo - r.al)));
  const medH = q(out.map((r) => Math.abs(r.hi - r.ah) / r.o), 0.5);
  const medL = q(out.map((r) => Math.abs(r.lo - r.al) / r.o), 0.5);
  const covH = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / n;
  const covL = out.filter((r) => r.al >= r.lo10 && r.al <= r.lo90).length / n;
  const corr = (() => { const a = out.map((r) => (r.hi - r.lo) / r.o), b = out.map((r) => r.ar); const ma = mean(a), mb = mean(b); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxy / Math.sqrt(sxx * syy); })();
  console.log(`${label.padEnd(38)} n=${String(n).padStart(5)}  MAE_H ${maeH.toFixed(0).padStart(4)}  MAE_L ${maeL.toFixed(0).padStart(4)}  med% ${(medH * 100).toFixed(2)} / ${(medL * 100).toFixed(2)}  cov80 ${(covH * 100).toFixed(1)} / ${(covL * 100).toFixed(1)}  corr ${corr.toFixed(3)}`);
  return { n, maeH, maeL, medH, covH, corr };
}

const ixic = load('nasdaq_composite_IXIC_daily_2002-2026.csv');
const nq = load('nq_futures_daily.csv');
const es = load('es_futures_daily.csv');

console.log('=== A. Does the extra history help? (same test window 2016-10-18..2026-10-16) ===');
const evalFrom = '2016-10-18';
const withAll = run(ixic, { evalFromDate: evalFrom });                    // trained from 2002
const with10y = run(ixic, { evalFromDate: evalFrom, trainFromDate: '2015-01-01' }); // trained from 2015
score('IXIC, trained on 24y (from 2002)', withAll);
score('IXIC, trained on 10y (from 2015)', with10y);

console.log('\n=== B. The early era, unseen by the 10y model (2003-2016) ===');
const early = run(ixic, {}).filter((r) => r.date < evalFrom);
score('IXIC, full history incl. 2003-2016', early);

const gfc = run(ixic, {}).filter((r) => r.date >= '2007-10-01' && r.date <= '2009-06-30');
score('IXIC during the GFC', gfc);

console.log('\n=== C. On the actual instruments (own data, own sessions) ===');
score('NQ futures (Nasdaq-100, from 2018-04)', run(nq, {}));
score('ES futures (S&P 500, from 2016-10)', run(es, {}));

console.log('\n=== D. How close are the instruments? (daily close-close returns) ===');
const ret = (rows) => { const m = new Map(); for (let i = 1; i < rows.length; i++) m.set(rows[i].date, Math.log(rows[i].close / rows[i - 1].close)); return m; };
const rn = ret(nq), re = ret(es), ri = ret(ixic);
const pair = (a, b) => { const ks = [...a.keys()].filter((k) => b.has(k)); const x = ks.map((k) => a.get(k)), y = ks.map((k) => b.get(k)); const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return [ks.length, sxy / Math.sqrt(sxx * syy)]; };
let [c1, k1] = pair(rn, ri); console.log(`NQ vs IXIC  corr ${k1.toFixed(3)}  (${c1} common days)`);
let [c2, k2] = pair(re, rn); console.log(`ES vs NQ    corr ${k2.toFixed(3)}  (${c2} common days)`);
let [c3, k3] = pair(re, ri); console.log(`ES vs IXIC  corr ${k3.toFixed(3)}  (${c3} common days)`);

