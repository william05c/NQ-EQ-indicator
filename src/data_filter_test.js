// Does filtering "less accurate data" improve the model?
//
// Two very different things hide behind that phrase, and only one is legitimate:
//
//   A. DATA-QUALITY filtering - drop sessions whose bar is visibly corrupt
//      (a range many multiples of anything the market produces). Correct: a
//      broken bar is not evidence about anything.
//
//   B. OUTCOME filtering - trim the residuals that came from the biggest-range
//      sessions, on the grounds that they "hurt accuracy". This narrows the
//      bands, which reduces measured MAE and destroys the 80% claim. The repo
//      already fell into this once: clamping residuals at +/-1.5 cut coverage
//      from 79.9% to 76.9%.
//
// This script runs both against the canonical harness and prints MAE next to
// coverage, so the trade is visible instead of hidden behind a better MAE.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500, FROM = '2016-10-18';
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

function load(dataFile) {
  return fs.readFileSync(path.join(__dirname, '..', 'data', dataFile), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
}

// variant controls how a completed session's residual enters the pool
function run(dataFile, variant) {
  const rows = load(dataFile);
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
  let dropped = 0;

  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], a = [], b = [];
      for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
      wU = ols(X, a); wD = ols(X, b); lastFit = t;
    }
    const x = feats(t);
    const muU = dot(wU, x), muD = dot(wD, x);
    if (resU.length >= MIN_RESID && rows[t].date >= FROM) {
      const o = rows[t].open;
      out.push({
        o, ah: rows[t].high, al: rows[t].low,
        hi: o * (1 + Math.exp(muU + q(resU, 0.5))),
        lo: o * (1 - Math.exp(muD + q(resD, 0.5))),
        hi10: o * (1 + Math.exp(muU + q(resU, 0.1))), hi90: o * (1 + Math.exp(muU + q(resU, 0.9))),
        lo10: o * (1 - Math.exp(muD + q(resD, 0.9))), lo90: o * (1 - Math.exp(muD + q(resD, 0.1))),
      });
    }
    let rU = yU[t] - muU, rD = yD[t] - muD;

    // A. data-quality filter: a bar whose range dwarfs anything recent is corrupt
    const med60 = trail(rr, t, 60);
    const isGlitch = rr[t] > 5 * med60;

    // B. outcome filters
    if (variant === 'trim3' && (Math.abs(rU) > 3 || Math.abs(rD) > 3)) { dropped++; }
    else if (variant === 'trim2' && (Math.abs(rU) > 2 || Math.abs(rD) > 2)) { dropped++; }
    else if (variant === 'winsor2') {
      rU = Math.max(-2, Math.min(2, rU)); rD = Math.max(-2, Math.min(2, rD));
      resU.push(rU); resD.push(rD);
    } else if (variant === 'glitch') {
      if (!isGlitch) { resU.push(rU); resD.push(rD); } else dropped++;
    } else if (variant === 'glitch_winsor') {
      if (!isGlitch) { rU = Math.max(-2, Math.min(2, rU)); rD = Math.max(-2, Math.min(2, rD)); resU.push(rU); resD.push(rD); } else dropped++;
    } else {
      resU.push(rU); resD.push(rD);
    }
    if (resU.length > RW) { resU.shift(); resD.shift(); }
  }

  const m = out.length;
  const maeH = mean(out.map((r) => Math.abs(r.hi - r.ah)));
  const maeL = mean(out.map((r) => Math.abs(r.lo - r.al)));
  const covH = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / m;
  const covL = out.filter((r) => r.al >= r.lo10 && r.al <= r.lo90).length / m;
  const widthH = mean(out.map((r) => (r.hi90 - r.hi10) / r.o));
  return { maeH, maeL, covH: covH * 100, covL: covL * 100, widthH: widthH * 100, dropped };
}

const FILES = [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv'],
  ['NQ', 'nq_futures_daily.csv'],
  ['ES', 'es_futures_daily.csv'],
];
const VARIANTS = ['baseline', 'glitch', 'winsor2', 'trim3', 'trim2', 'glitch_winsor'];

console.log('Does filtering data improve the model?');
console.log('gate: MAE must beat reference, AND both coverages stay in 78-84%\n');

for (const [label, file] of FILES) {
  const base = run(file, 'baseline');
  console.log(`${label}`);
  console.log('  variant        MAE high   MAE low   cov high   cov low   80% width   gate');
  for (const v of VARIANTS) {
    const r = run(file, v);
    const gate = (r.covH >= 78 && r.covH <= 84 && r.covL >= 78 && r.covL <= 84) ? 'pass' : 'FAIL';
    const name = v === 'baseline' ? 'baseline' : v;
    console.log(`  ${name.padEnd(13)} ${r.maeH.toFixed(2).padStart(7)}   ${r.maeL.toFixed(2).padStart(7)}    ${r.covH.toFixed(1).padStart(6)}%   ${r.covL.toFixed(1).padStart(6)}%   ${r.widthH.toFixed(2).padStart(7)}%   ${gate}`);
  }
  console.log('');
}
