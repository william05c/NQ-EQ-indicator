// Validation for the intraday NOWCAST.
//
// Model: the session is a diffusion with daily volatility sigma_d. Given the running
// high H_t, price P_t and remaining fraction (1-t), the reflection principle gives
//
//     P(final high <= h) = 2*Phi((h - P_t)/sigma_rem) - 1     for h >= max(H_t, P_t)
//     =>  h_q = max(H_t, P_t + sigma_rem * Phi^-1((1+q)/2))
//
// with sigma_rem = sigma_d * sqrt(1 - t). Same construction for the low.
//
// This simulates whole sessions and checks that the 80% band contains the REAL final
// high/low the promised 80% of the time, at each point in the day.
//
//   gauss  - Brownian (the formula's own assumption; near-perfect is expected)
//   fat    - Student-t(4) increments + U-shaped intraday vol (stress test)
const fs = require('fs');
const path = require('path');

function normInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function randt4scaled() {
  const z = randn();
  let chi = 0;
  for (let i = 0; i < 4; i++) { const n = randn(); chi += n * n; }
  return (z / Math.sqrt(chi / 4)) / Math.SQRT2; // unit variance
}
function uProfile(x) {
  const w = 1.30 - 1.9 * x + 2.4 * x * x + 0.35 * Math.exp(-40 * x) + 0.45 * Math.exp(-12 * (1 - x));
  return Math.max(w, 0.15);
}

function loadRanges() {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'data', 'range_bands_oos.csv'), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const c = l.split(','); return (+c[5] - +c[8]) / +c[1]; }); // high_p50 - low_p50
  return rows.filter((v) => v > 0 && Number.isFinite(v));
}

const Z = { lo: normInv(0.55), hi: normInv(0.95) };

function simulateDay(sigma, steps, kind, checkpoints) {
  const w = [];
  let varSum = 0;
  for (let k = 0; k < steps; k++) {
    const v = kind === 'fat' ? uProfile((k + 0.5) / steps) : 1;
    w.push(v);
    varSum += v * v;
  }
  const norm = Math.sqrt(1 / varSum);

  let price = 0, hi = 0, lo = 0;
  const marks = {};
  for (let k = 0; k < steps; k++) {
    const shock = kind === 'fat' ? randt4scaled() : randn();
    price += sigma * norm * w[k] * shock;
    if (price > hi) hi = price;
    if (price < lo) lo = price;
    const t = (k + 1) / steps;
    const cp = checkpoints.find((c) => Math.round(c * steps) === k + 1);
    if (cp !== undefined) {
      const sRem = sigma * Math.sqrt(1 - t);
      const pHiSet = Math.min(1, Math.max(0, 1 - 2 * (1 - phi((hi - price) / sRem))));
      const pLoSet = Math.min(1, Math.max(0, 1 - 2 * (1 - phi((price - lo) / sRem))));
      marks[cp] = {
        hiLo: Math.max(hi, price + sRem * Z.lo),
        hiHi: Math.max(hi, price + sRem * Z.hi),
        loLo: Math.min(lo, price - sRem * Z.hi),
        loHi: Math.min(lo, price - sRem * Z.lo),
        hiAtMark: hi, loAtMark: lo, pHiSet, pLoSet,
      };
    }
  }
  return { hi, lo, marks };
}

const ranges = loadRanges();
const meanR = ranges.reduce((s, x) => s + x, 0) / ranges.length;
console.log(`model's implied daily range: mean ${(meanR * 100).toFixed(2)}%  (n=${ranges.length})`);
console.log(`sigma_d = range / 1.596 = ${(meanR / 1.596 * 100).toFixed(2)}%\n`);

const CPS = [0.25, 0.5, 0.75, 0.95];
const STEPS = Number(process.env.STEPS || 78);
const TRIALS = 3000;

for (const kind of ['gauss', 'fat']) {
  const hitH = Object.fromEntries(CPS.map((c) => [c, 0]));
  const hitL = Object.fromEntries(CPS.map((c) => [c, 0]));
  const probH = Object.fromEntries(CPS.map((c) => [c, 0]));
  const probL = Object.fromEntries(CPS.map((c) => [c, 0]));
  const freqHits = Object.fromEntries(CPS.map((c) => [c, 0]));
  const freqLits = Object.fromEntries(CPS.map((c) => [c, 0]));
  const nH = Object.fromEntries(CPS.map((c) => [c, 0]));
  const nL = Object.fromEntries(CPS.map((c) => [c, 0]));
  for (let i = 0; i < TRIALS; i++) {
    const sigma = ranges[Math.floor(Math.random() * ranges.length)] / 1.596;
    const d = simulateDay(sigma, STEPS, kind, CPS);
    for (const c of CPS) {
      const m = d.marks[c];
      if (d.hi >= m.hiLo && d.hi <= m.hiHi) hitH[c]++;
      if (d.lo >= m.loLo && d.lo <= m.loHi) hitL[c]++;
      probH[c] += m.pHiSet; nH[c]++;
      probL[c] += m.pLoSet; nL[c]++;
      if (d.hi <= m.hiAtMark + 1e-12) freqHits[c]++;
      if (d.lo >= m.loAtMark - 1e-12) freqLits[c]++;
    }
  }
  console.log(`${kind} paths - 80% band coverage, and calibration of "extreme already set"`);
  for (const c of CPS) {
    const hp = probH[c] / nH[c], lp = probL[c] / nL[c];
    const freqH = freqHits[c] / nH[c], freqL = freqLits[c] / nL[c];
    console.log(`  at ${(c * 100).toFixed(0).padStart(2)}%:  band high ${(hitH[c] / TRIALS * 100).toFixed(1)}%  low ${(hitL[c] / TRIALS * 100).toFixed(1)}%` +
      `   |  P(high set) predicted ${(hp * 100).toFixed(0)}% vs actual ${(freqH * 100).toFixed(0)}%` +
      `   |  P(low set) predicted ${(lp * 100).toFixed(0)}% vs actual ${(freqL * 100).toFixed(0)}%`);
  }
  console.log('');
}
