// Is calendar time the right clock for the intraday band?
//
// The nowcast scales remaining volatility as sigma_rem = sigma_d * sqrt(1 - t),
// where t is the fraction of the 23h futures day that has ELAPSED. That assumes
// variance accrues uniformly, i.e. 1 hour overnight carries the same variance as
// 1 hour in the cash session. It does not: for NQ roughly 75% of the daily
// variance is earned in the 6.5h cash session, which is 33% of the clock.
//
// The alternative is BUSINESS TIME: scale by the fraction of expected VARIANCE
// consumed, not the fraction of minutes. If A(u) is the activity density,
//
//     sigma_rem = sigma_d * sqrt(1 - F(t)),   F(t) = integral_0^t A du
//
// Consequence: at 07:00 ET (57% of the clock, before the cash open) calendar
// time claims 43% of the variance is left, while business time correctly knows
// that almost the entire cash session - and thus most of the variance - is
// still ahead.
//
// This script measures both against simulated sessions under three volatility
// regimes and reports 80%-band coverage.
const fs = require('fs');
const path = require('path');

function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- clocks -------------------------------------------------------------
const OVERNIGHT = 15.5 / 23;          // 18:00 -> 09:30 ET is 15.5h of a 23h day
const RTH_SHARE = 0.76;               // share of daily variance earned in RTH

// activity densities on the two blocks, normalised to integrate to 1
const aOver = (1 - RTH_SHARE) / OVERNIGHT;
const aRth = RTH_SHARE / (1 - OVERNIGHT);

function activity(u) { return u < OVERNIGHT ? aOver : aRth; }

// cumulative variance fraction F(t)
function cumVar(t) {
  if (t <= 0) return 0;
  if (t <= OVERNIGHT) return aOver * t;
  const over = aOver * OVERNIGHT;
  return Math.min(1, over + aRth * (t - OVERNIGHT));
}

// ---- volatility regimes -------------------------------------------------
function regime(name, steps, u) {
  // U-shape inside the cash session, flat overnight
  if (name === 'flat') return 1;
  const x = u < OVERNIGHT ? 0 : (u - OVERNIGHT) / (1 - OVERNIGHT);
  if (name === 'ushape') {
    const base = u < OVERNIGHT ? 1 : 1.30 - 1.9 * x + 2.4 * x * x + 0.35 * Math.exp(-40 * x) + 0.45 * Math.exp(-12 * (1 - x));
    return Math.max(base, 0.15);
  }
  // 'blocks': exactly the two-block structure the business clock assumes
  return Math.sqrt(activity(u) * 23 / 276 * 1); // placeholder, normalised below
}

function loadRanges() {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'data', 'range_bands_oos.csv'), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const c = l.split(','); return (+c[5] - +c[8]) / +c[1]; });
  return rows.filter((v) => v > 0 && Number.isFinite(v));
}

const Z90 = 1.644854;
const CPS = [0.25, 0.5, 0.75, 0.95];
const STEPS = 276;                    // 5-minute bars across 23h
const TRIALS = 4000;
const ranges = loadRanges();
const meanR = ranges.reduce((s, x) => s + x, 0) / ranges.length;

// build a weight profile and normalise so total variance = 1
function weights(name) {
  const w = [];
  let ss = 0;
  for (let k = 0; k < STEPS; k++) {
    const u = (k + 0.5) / STEPS;
    let v;
    if (name === 'flat') v = 1;
    else if (name === 'ushape') {
      const x = u < OVERNIGHT ? 0 : (u - OVERNIGHT) / (1 - OVERNIGHT);
      v = u < OVERNIGHT ? 1
        : Math.max(1.30 - 1.9 * x + 2.4 * x * x + 0.35 * Math.exp(-40 * x) + 0.45 * Math.exp(-12 * (1 - x)), 0.15);
    } else {
      v = Math.sqrt(activity(u));
    }
    w.push(v); ss += v * v;
  }
  const norm = Math.sqrt(1 / ss);
  return w.map((v) => v * norm);
}

console.log('clock comparison for the intraday band\n');
console.log(`mean implied daily range ${(meanR * 100).toFixed(2)}%, sigma_d = ${(meanR / 1.596 * 100).toFixed(2)}%`);
console.log(`business clock: overnight ${(OVERNIGHT * 100).toFixed(0)}% of the clock carries ${((1 - RTH_SHARE) * 100).toFixed(0)}% of variance`);
console.log(`                cash session ${((1 - OVERNIGHT) * 100).toFixed(0)}% of the clock carries ${(RTH_SHARE * 100).toFixed(0)}% of variance\n`);

for (const name of ['flat', 'ushape', 'blocks']) {
  const w = weights(name);
  const hitCal = Object.fromEntries(CPS.map((c) => [c, 0]));
  const hitBiz = Object.fromEntries(CPS.map((c) => [c, 0]));

  for (let i = 0; i < TRIALS; i++) {
    const sigma = ranges[Math.floor(Math.random() * ranges.length)] / 1.596;
    let price = 0, hi = 0, lo = 0;
    const marks = {};
    for (let k = 0; k < STEPS; k++) {
      price += sigma * w[k] * randn();
      if (price > hi) hi = price;
      if (price < lo) lo = price;
      const t = (k + 1) / STEPS;
      const cp = CPS.find((c) => Math.round(c * STEPS) === k + 1);
      if (cp !== undefined) {
        const sCal = sigma * Math.sqrt(Math.max(1 - t, 0));
        const sBiz = sigma * Math.sqrt(Math.max(1 - cumVar(t), 0));
        marks[cp] = {
          calHi: Math.max(hi, price + sCal * Z90),
          bizHi: Math.max(hi, price + sBiz * Z90),
        };
      }
    }
    for (const c of CPS) {
      if (hi <= marks[c].calHi) hitCal[c]++;
      if (hi <= marks[c].bizHi) hitBiz[c]++;
    }
  }

  console.log(`${name.padEnd(7)} - share of sessions whose FINAL high stayed under the 90th-percentile band`);
  for (const c of CPS) {
    const a = hitCal[c] / TRIALS * 100, b = hitBiz[c] / TRIALS * 100;
    const better = Math.abs(b - 90) < Math.abs(a - 90) ? 'biz' : 'cal';
    console.log(`  at ${(c * 100).toFixed(0).padStart(3)}% of clock:  calendar ${a.toFixed(1)}%   business ${b.toFixed(1)}%   closer: ${better}`);
  }
  console.log('');
}
