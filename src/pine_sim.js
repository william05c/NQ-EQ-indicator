// Bit-exact simulator of the Pine script's logic, so the .pine can be audited
// without a TradingView compiler.
//
//   node src/pine_sim.js
//
// Mirrors: feature clamps, capExc, residual clamp, quantile refresh cadence,
// band formulas, and the next-session projection. Reports anything a user
// could see as broken: inverted bands, negative prices, oversized multipliers.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, MIN_RESID = 60, REFIT = 21, RESID_WIN = 500;
const CAP = 0.25;          // capExc ceiling
const RESID_CLAMP = Infinity;   // u/d are already bounded; no extra clamp

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const quantile = (arr, p) => {
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
// capExc(): cap the log-excursion, exponentiate, then bound the multiplier
const capExc = (x) => clamp(Math.exp(Math.min(x, 0.69)), 0, CAP);
const residClamp = (x) => (Number.isFinite(RESID_CLAMP) ? clamp(x, -RESID_CLAMP, RESID_CLAMP) : x);

// coefficients exactly as hardcoded in the .pine
const C = {
  NQ: { cU: [-1.694495, 0.755239, -0.125094, 0.262881, -0.034915], cD: [-1.692194, 0.571979, 0.075713, 0.067209, 0.153190], sU: [-1.393331, 0.244323, 1.137000], sD: [-1.743627, 0.274472, 1.427955] },
  ES: { cU: [-1.460724, 0.681027, 0.497639, 0.180519, -0.399594], cD: [-1.449274, 0.532104, 0.621457, 0.162186, -0.335095], sU: [-1.478340, 0.200374, 1.202514], sD: [-1.798963, 0.234755, 1.412328] },
  IXIC: { cU: [-1.560655, 0.757907, 0.147927, 0.073320, -0.053215], cD: [-1.561902, 0.495297, 0.145741, 0.180904, 0.101781], sU: [-1.737729, 0.297207, 1.274199], sD: [-2.018891, 0.299511, 1.451093] },
};

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function simulate(rows, prof) {
  const k = C[prof];
  const n = rows.length;

  // --- per-bar series, exactly as Pine computes them ---
  const rr = new Array(n), lr = new Array(n), rrS = new Array(n);
  for (let i = 0; i < n; i++) {
    rr[i] = (rows[i].high - rows[i].low) / rows[i].close;
    lr[i] = (i > 0 && rows[i - 1].close > 0 && rows[i].close > 0) ? Math.log(rows[i].close / rows[i - 1].close) : 0;
    rrS[i] = clamp(rr[i], 0, 0.5);
  }
  // ta.sma(x, w)[1] -> mean over [t-w, t-1]
  const smaPrev = (arr, t, w) => {
    let s = 0, c = 0;
    for (let i = Math.max(0, t - w); i < t; i++) { s += arr[i]; c++; }
    return c ? s / c : arr[Math.max(0, t - 1)];
  };
  const sdPrev = (arr, t, w) => {
    const a = [];
    for (let i = Math.max(0, t - w); i < t; i++) a.push(arr[i]);
    if (a.length < 2) return 0.01;
    return sd(a);
  };
  // ta.sma(x, w) including the current bar (for the projection)
  const smaNow = (arr, t, w) => {
    let s = 0, c = 0;
    for (let i = Math.max(0, t - w + 1); i <= t; i++) { s += arr[i]; c++; }
    return c ? s / c : arr[t];
  };
  const sdNow = (arr, t, w) => {
    const a = [];
    for (let i = Math.max(0, t - w + 1); i <= t; i++) a.push(arr[i]);
    return a.length > 1 ? sd(a) : 0.01;
  };

  const featsAt = (t) => {
    const rr5 = smaPrev(rrS, t, 5), rr20 = smaPrev(rrS, t, 20), rr60 = smaPrev(rrS, t, 60);
    const rv = clamp(sdPrev(lr, t, 20), EPS, 0.5);
    return [1, Math.log(rr5 + EPS), Math.log(rr20 + EPS), Math.log(rr60 + EPS), Math.log(rv + EPS)];
  };
  const featsNext = (t) => {
    const rr5 = smaNow(rrS, t, 5), rr20 = smaNow(rrS, t, 20), rr60 = smaNow(rrS, t, 60);
    const rv = clamp(sdNow(lr, t, 20), EPS, 0.5);
    return [1, Math.log(rr5 + EPS), Math.log(rr20 + EPS), Math.log(rr60 + EPS), Math.log(rv + EPS)];
  };

  const resU = [], resD = [];
  let qU = k.sU.slice(), qD = k.sD.slice(), lastQ = -100000;
  let validFrom = -1;

  const issues = { inverted: 0, negative: 0, capped: 0, naBands: 0 };
  let maxMult = 0;
  const out = [];

  for (let t = 61; t < n; t++) {
    const f = featsAt(t);
    const muU = f.reduce((s, v, i) => s + v * k.cU[i], 0);
    const muD = f.reduce((s, v, i) => s + v * k.cD[i], 0);

    const valid = resU.length >= MIN_RESID;
    if (valid && (t - lastQ >= REFIT)) {
      qU = [quantile(resU, 0.10), quantile(resU, 0.50), quantile(resU, 0.90)];
      qD = [quantile(resD, 0.10), quantile(resD, 0.50), quantile(resD, 0.90)];
      lastQ = t;
    }

    const o = rows[t].open;
    const eU = (q) => capExc(muU + q);
    const eD = (q) => capExc(muD + q);
    const hiP10 = o * (1 + eU(qU[0]));
    const hiP50 = o * (1 + eU(qU[1]));
    const hiP90 = o * (1 + eU(qU[2]));
    const loP10 = o * (1 - eD(qD[2]));
    const loP50 = o * (1 - eD(qD[1]));
    const loP90 = o * (1 - eD(qD[0]));

    if (valid) {
      if (validFrom < 0) validFrom = t;
      if (!(hiP10 <= hiP50 && hiP50 <= hiP90)) issues.inverted++;
      if (!(loP10 <= loP50 && loP50 <= loP90)) issues.inverted++;
      if (loP10 <= 0) issues.negative++;
      if ([hiP10, hiP50, hiP90, loP10, loP50, loP90].some((v) => !Number.isFinite(v))) issues.naBands++;
      const m = Math.max(eU(qU[0]), eU(qU[2]), eD(qD[0]), eD(qD[2]));
      if (m >= CAP - 1e-9) issues.capped++;
      maxMult = Math.max(maxMult, m);
      out.push({ date: rows[t].date, o, ah: rows[t].high, al: rows[t].low, hiP10, hiP50, hiP90, loP10, loP50, loP90 });
    }

    const uRaw = clamp((rows[t].high - o) / o, 0.0001, 0.5);
    const dRaw = clamp((o - rows[t].low) / o, 0.0001, 0.5);
    resU.push(residClamp(Math.log(uRaw) - muU));
    resD.push(residClamp(Math.log(dRaw) - muD));
    if (resU.length > RESID_WIN) { resU.shift(); resD.shift(); }
  }

  // next-session projection (global-scope features at the last bar)
  const nf = featsNext(n - 1);
  const muUn = nf.reduce((s, v, i) => s + v * k.cU[i], 0);
  const muDn = nf.reduce((s, v, i) => s + v * k.cD[i], 0);
  const anchor = rows[n - 1].close;
  const proj = {
    hi10: anchor * (1 + capExc(muUn + qU[0])),
    hi50: anchor * (1 + capExc(muUn + qU[1])),
    hi90: anchor * (1 + capExc(muUn + qU[2])),
    lo10: anchor * (1 - capExc(muDn + qD[2])),
    lo50: anchor * (1 - capExc(muDn + qD[1])),
    lo90: anchor * (1 - capExc(muDn + qD[0])),
  };

  const nOut = out.length;
  const cov = (set) => ({
    h: set.filter((r) => r.ah >= r.hiP10 && r.ah <= r.hiP90).length / set.length,
    l: set.filter((r) => r.al >= r.loP10 && r.al <= r.loP90).length / set.length,
  });
  const recent = out.filter((r) => r.date >= '2016-10-18');
  const covH = cov(out).h, covL = cov(out).l;
  const covRecent = cov(recent.length ? recent : out);
  const medH = quantile(out.map((r) => Math.abs(r.hiP50 - r.ah) / r.o), 0.5);
  const medL = quantile(out.map((r) => Math.abs(r.loP50 - r.al) / r.o), 0.5);

  return { prof, n, validFrom, nOut, covH, covL, covRecent, recentN: recent.length, medH, medL, issues, maxMult, proj, last: rows[n - 1] };
}

let failures = 0;
for (const [label, file, prof] of [
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
]) {
  const r = simulate(load(file), prof);
  const f = (v) => v.toFixed(0);
  console.log(`\n=== ${label} (${prof} coefficients) ===`);
  console.log(`  bars ${r.n}, bands from bar ${r.validFrom}, scored ${r.nOut}`);
  console.log(`  80% coverage (full history)  high ${(r.covH * 100).toFixed(1)}%  low ${(r.covL * 100).toFixed(1)}%`);
  console.log(`  80% coverage (2016+ only, n=${r.recentN})  high ${(r.covRecent.h * 100).toFixed(1)}%  low ${(r.covRecent.l * 100).toFixed(1)}%`);
  console.log(`  median error  high ${(r.medH * 100).toFixed(2)}%  low ${(r.medL * 100).toFixed(2)}%`);
  console.log(`  largest excursion multiplier used: ${r.maxMult.toFixed(3)} (cap ${CAP})`);
  console.log(`  inverted bands: ${r.issues.inverted}  negative prices: ${r.issues.negative}  na bands: ${r.issues.naBands}  bars at cap: ${r.issues.capped}`);
  console.log(`  next session from close ${r.last.close}:`);
  console.log(`    high ${f(r.proj.hi10)} .. ${f(r.proj.hi90)} (med ${f(r.proj.hi50)})`);
  console.log(`    low  ${f(r.proj.lo10)} .. ${f(r.proj.lo90)} (med ${f(r.proj.lo50)})`);
  if (r.issues.inverted || r.issues.negative || r.issues.naBands) { failures++; console.log('  *** FAILED sanity checks ***'); }
}

// cross-check the projection against the independent implementation
console.log('\n=== projection cross-check vs src/next_session.js (NQ) ===');
const nqSim = simulate(load('nq_futures_daily.csv'), 'NQ');
console.log(`  pine_sim: high ${nqSim.proj.hi10.toFixed(0)}..${nqSim.proj.hi90.toFixed(0)} med ${nqSim.proj.hi50.toFixed(0)}`);
console.log(`  reference earlier run: high 29824..30389 med 30042 (no caps, so small differences expected)`);

console.log(failures ? `\n${failures} asset(s) FAILED` : '\nall assets passed sanity checks');
process.exit(failures ? 1 : 0);
