// TEST 2 - does the nowcast's P(new high) match reality on real tape?
//
// For every session, at each 5-minute mark, the nowcast claims a probability that
// the final high will exceed the running high. Until now that claim was only ever
// checked against simulated paths. This checks it against the market.
//
// Method
//   1. Build the daily band walk-forward from NQ daily bars (no look-ahead).
//   2. sigma_day = (median high - median low) / 1.596, exactly as the indicator does.
//   3. Walk the 1-minute tape of the matching session; at each 5-minute mark compute
//        P = 2 * (1 - Phi((H_t - P_t) / sigma_rem)),  sigma_rem = sigma_day*sqrt(1 - F(t))
//      with F the business-time clock at the FITTED cash share.
//   4. After the close, record whether the final high did exceed H_t.
//   5. Bucket predictions into deciles; compare predicted with realised.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const OVERFRAC = 15.5 / 23;
const CASH_SHARE = Number(process.argv[3] || 0.662);   // fitted in Test 1

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

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

// ---- 1. daily band, walk-forward ----
const drows = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_futures_daily.csv'), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
const n = drows.length;
const rr = drows.map((r) => (r.high - r.low) / r.close);
const lr = drows.map((r, i) => (i ? Math.log(r.close / drows[i - 1].close) : 0));
const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
const u = drows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
const d = drows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
const yU = u.map(Math.log), yD = d.map(Math.log);
let wU = null, wD = null, lastFit = -1;
const resU = [], resD = [];
const daily = new Map();
for (let t = WARMUP; t < n; t++) {
  if (lastFit < 0 || t - lastFit >= REFIT) {
    const X = [], a = [], b = [];
    for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
    wU = ols(X, a); wD = ols(X, b); lastFit = t;
  }
  const x = feats(t);
  const muU = dot(wU, x), muD = dot(wD, x);
  if (resU.length >= MIN_RESID) {
    const o = drows[t].open;
    const h50 = o * (1 + Math.exp(Math.min(muU + q(resU, 0.5), 0.69)));
    const l50 = o * (1 - Math.exp(Math.min(muD + q(resD, 0.5), 0.69)));
    daily.set(drows[t].date, { h50, l50, sigma: (h50 - l50) / 1.596 });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---- 2. intraday tape ----
const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'nq_1min_2022_2025.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const sessions = new Map();
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  const m = c[0].trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) continue;
  const [, mo, dd, yy, hh, mi] = m.map(Number);
  const mins = hh * 60 + mi;
  // session that opens 18:00: bars before 18:00 belong to the previous evening
  let sy = yy, smo = mo, sdd = dd;
  if (mins < 18 * 60) {
    const dt = new Date(Date.UTC(yy, mo - 1, dd)); dt.setUTCDate(dt.getUTCDate() - 1);
    sy = dt.getUTCFullYear(); smo = dt.getUTCMonth() + 1; sdd = dt.getUTCDate();
  }
  const key = `${sy}-${String(smo).padStart(2, '0')}-${String(sdd).padStart(2, '0')}`;
  // the trading date is the calendar day the session CLOSES
  const closeDt = new Date(Date.UTC(sy, smo - 1, sdd)); closeDt.setUTCDate(closeDt.getUTCDate() + 1);
  const tradeDate = closeDt.toISOString().slice(0, 10);
  if (!sessions.has(key)) sessions.set(key, { key, tradeDate, bars: [], elapsedMin: mins < 18 * 60 ? mins + 6 * 60 : mins - 18 * 60 });
  sessions.get(key).bars.push({ mins, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] });
}

function cumVar(t) {
  if (t <= 0) return 0;
  if (t <= OVERFRAC) return (1 - CASH_SHARE) / OVERFRAC * t;
  return Math.min(1, (1 - CASH_SHARE) + CASH_SHARE / (1 - OVERFRAC) * (t - OVERFRAC));
}

// ---- 3. predictions ----
const preds = [];   // {p, hit}
let joined = 0, skipped = 0;
for (const [, s] of sessions) {
  const day = daily.get(s.tradeDate);
  if (!day || !(day.sigma > 0)) { skipped++; continue; }
  const bars = s.bars.slice().sort((a, b) => a.mins - b.mins);
  if (bars.length < 600) { skipped++; continue; }      // half days / truncated
  joined++;
  const finalHigh = Math.max(...bars.map((b) => b.h));
  let runHigh = -Infinity, price = bars[0].o;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.h > runHigh) runHigh = b.h;
    price = b.c;
    // elapsed fraction of the 23h session, from 18:00
    const elapsedMin = (b.mins < 18 * 60) ? b.mins + 6 * 60 : b.mins - 18 * 60;
    const t = Math.min(Math.max(elapsedMin / (23 * 60), 0), 1);
    if (i % 5 !== 0 || i < 30) continue;              // every 5 minutes
    const sigRem = day.sigma * Math.sqrt(Math.max(1 - cumVar(t), 0));
    if (!(sigRem > 0)) continue;
    const p = Math.min(1, Math.max(0, 2 * (1 - phi((runHigh - price) / sigRem))));
    preds.push({ p, hit: finalHigh > runHigh ? 1 : 0, t });
  }
}
console.log(`sessions joined to the daily model: ${joined}   skipped: ${skipped}   observations: ${preds.length}`);
if (!preds.length) process.exit(1);

// ---- 4. calibration by decile ----
console.log('\nTEST 2 - predicted vs realised chance that the high extends');
console.log('decile   predicted   realised   error     n');
let worst = 0;
for (let k = 0; k < 10; k++) {
  const lo = k / 10, hi = (k + 1) / 10;
  const g = preds.filter((x) => x.p >= lo && (k === 9 ? x.p <= 1 : x.p < hi));
  if (!g.length) continue;
  const pred = mean(g.map((x) => x.p)) * 100;
  const real = mean(g.map((x) => x.hit)) * 100;
  const err = real - pred;
  worst = Math.max(worst, Math.abs(err));
  console.log(`  ${(k + 1).toString().padStart(2)}     ${pred.toFixed(1).padStart(6)}%    ${real.toFixed(1).padStart(6)}%   ${(err >= 0 ? '+' : '') + err.toFixed(1).padStart(5)}   ${g.length}`);
}
const overallPred = mean(preds.map((x) => x.p)) * 100;
const overallReal = mean(preds.map((x) => x.hit)) * 100;
console.log(`\n  overall predicted ${overallPred.toFixed(1)}%   realised ${overallReal.toFixed(1)}%   worst decile error ${worst.toFixed(1)} points`);
console.log(`  pre-registered verdict: <5 usable, 5-10 note the correction, >10 model misspecified`);

// ---- 5. the tail question: low-prediction deciles ----
const lowDec = preds.filter((x) => x.p <= 0.10);
if (lowDec.length) {
  console.log(`\n  the tail check: when the model says <=10% chance, it actually happened ${(mean(lowDec.map((x) => x.hit)) * 100).toFixed(1)}% of the time (n=${lowDec.length})`);
  console.log(`  pre-registered falsification: >20% here means fat tails break the diffusion assumption`);
}
