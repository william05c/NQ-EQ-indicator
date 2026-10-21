// Does the volatility regime rescue any directional signal?
//
// The seven signals in direction_candidates.js were flat overall. A common claim
// is that they only work in a particular regime, so this tests that directly:
// does VIX - known BEFORE the session, so no look-ahead - change whether a
// signal predicts the session's own move (open -> close)?
//
// Two regime definitions, both lagged to the prior session:
//   level : VIX close above/below its own trailing 252-session median
//   trend : VIX 5-day change positive/negative
//
// The interaction t-stat is the number that matters. With 3 signals x 2 regime
// definitions x 2 datasets = 12 interaction tests, a |t| of 2 is not evidence;
// at that many comparisons you expect ~0.6 cells to clear 2.0 by chance alone.
const fs = require('fs');
const path = require('path');

const WARMUP = 300, REFIT = 63;                 // quarterly refit, fewer params
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function ols(X, y) {                            // multi-variate, with intercept
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j < k; j++) { b[j] += X[i][j] * y[i]; for (let l = 0; l < k; l++) A[j][l] += X[i][j] * X[i][l]; }
  for (let i = 0; i < k; i++) A[i][i] += 1e-8;
  const M = A.map((r) => r.slice());
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = M[i][i] || 1e-12;
    for (let j = i; j < k; j++) M[i][j] /= d; b[i] /= d;
    for (let r = 0; r < k; r++) { if (r === i) continue; const f = M[r][i]; for (let j = i; j < k; j++) M[r][j] -= f * M[i][j]; b[r] -= f * b[i]; }
  }
  return b;
}
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

function loadCsv(file, dmy) {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  return rows.map((l) => {
    const c = l.split(',');
    let date = c[0].trim();
    if (dmy) { const [m, d, y] = date.split('/'); date = `${y}-${m}-${d}`; }
    return { date, open: +c[1], high: +c[2], low: +c[3], close: +c[4] };
  });
}

const vixRows = loadCsv('vix_history.csv', true);
const vixByDate = new Map(vixRows.map((r) => [r.date, r.close]));

function withVix(rows) {
  const out = [];
  let last = NaN;
  for (const r of rows) {
    const v = vixByDate.get(r.date);
    if (v !== undefined) last = v;
    out.push({ ...r, vix: last });
  }
  return out;
}

const SIGNALS = {
  'gap': (r, t) => t > 0 && r[t - 1].close > 0 ? Math.log(r[t].open / r[t - 1].close) : NaN,
  '5-day return': (r, t) => t >= 6 ? Math.log(r[t - 1].close / r[t - 6].close) : NaN,
  '20-day return': (r, t) => t >= 21 ? Math.log(r[t - 1].close / r[t - 21].close) : NaN,
};

function regimeSeries(rows, kind) {
  const out = new Array(rows.length).fill(0);
  for (let t = 0; t < rows.length; t++) {
    if (kind === 'level') {
      if (t < 252) { out[t] = 0; continue; }
      const hist = rows.slice(t - 252, t).map((r) => r.vix).filter(Number.isFinite);
      if (hist.length < 100 || !Number.isFinite(rows[t - 1].vix)) { out[t] = 0; continue; }
      out[t] = rows[t - 1].vix > median(hist) ? 1 : 0;
    } else {
      if (t < 6 || !Number.isFinite(rows[t - 1].vix) || !Number.isFinite(rows[t - 6].vix)) { out[t] = 0; continue; }
      out[t] = rows[t - 1].vix - rows[t - 6].vix > 0 ? 1 : 0;
    }
  }
  return out;
}

function test(rows, signalFn, reg, label) {
  const n = rows.length;
  const ret = rows.map((r) => (r.open > 0 ? Math.log(r.close / r.open) : 0));
  const xs = rows.map((_, t) => signalFn(rows, t));
  let w = null, lastFit = -1;
  const pred = new Array(n).fill(0);
  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], Y = [];
      for (let i = 60; i < t; i++) {
        const s = xs[i]; if (!Number.isFinite(s)) continue;
        X.push([1, s, reg[i], s * reg[i]]); Y.push(ret[i]);
      }
      w = X.length > 80 ? ols(X, Y) : [0, 0, 0, 0];
      lastFit = t;
    }
    pred[t] = Number.isFinite(xs[t]) ? dot(w, [1, xs[t], reg[t], xs[t] * reg[t]]) : 0;
  }

  // in-sample interaction t-stat on the final fit, for the "does it differ by regime" question
  const idx = [];
  for (let t = WARMUP; t < n; t++) if (Number.isFinite(xs[t])) idx.push(t);
  const P = idx.map((t) => pred[t]), A = idx.map((t) => ret[t]);
  const strat = P.map((p, i) => Math.sign(p) * A[i]);
  const sharpe = sd(strat) > 0 ? (mean(strat) / sd(strat)) * Math.sqrt(252) : 0;

  // split the SAME out-of-sample predictions by regime
  const hi = idx.filter((t) => reg[t] === 1), lo = idx.filter((t) => reg[t] === 0);
  const sh = (set) => {
    const s = set.map((t) => Math.sign(pred[t]) * ret[t]);
    return sd(s) > 0 ? (mean(s) / sd(s)) * Math.sqrt(252) : 0;
  };
  console.log(`  ${label.padEnd(16)} overall ${sharpe.toFixed(2).padStart(6)}   regime A ${sh(hi).toFixed(2).padStart(6)} (n=${hi.length})   regime B ${sh(lo).toFixed(2).padStart(6)} (n=${lo.length})`);
}

for (const [file, label] of [['nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'], ['nq_futures_daily.csv', 'NQ']]) {
  const rows = withVix(loadCsv(file, false));
  const covered = rows.filter((r) => Number.isFinite(r.vix)).length;
  console.log(`${label}  (${covered} of ${rows.length} sessions have VIX)`);
  for (const kind of ['level', 'trend']) {
    const reg = regimeSeries(rows, kind);
    console.log(`  regime = VIX ${kind === 'level' ? 'ABOVE/BELOW trailing 1y median' : '5-day change up/down'}`);
    for (const [name, fn] of Object.entries(SIGNALS)) test(rows, fn, reg, name);
  }
  console.log('');
}
console.log('Judge with the multiple-testing threshold: 12 cells were tested.');
console.log('At that count, a Sharpe of 1.0 in one cell is expected by chance.');
