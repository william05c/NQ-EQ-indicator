// Does the model still calibrate on MONTHLY bars? The residual quantiles adapt,
// so coverage may hold even though mu is biased. Measure it instead of assuming.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, MIN_RESID = 60, REFIT = 21, RESID_WIN = 500;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

const COEF = {
  NQ: { cU: [-1.694495, 0.755239, -0.125094, 0.262881, -0.034915], cD: [-1.692194, 0.571979, 0.075713, 0.067209, 0.153190], sU: [-1.393331, 0.244323, 1.137000], sD: [-1.743627, 0.274472, 1.427955] },
  ES: { cU: [-1.460724, 0.681027, 0.497639, 0.180519, -0.399594], cD: [-1.449274, 0.532104, 0.621457, 0.162186, -0.335095], sU: [-1.478340, 0.200374, 1.202514], sD: [-1.798963, 0.234755, 1.412328] },
  IXIC: { cU: [-1.560655, 0.757907, 0.147927, 0.073320, -0.053215], cD: [-1.561902, 0.495297, 0.145741, 0.180904, 0.101781], sU: [-1.737729, 0.297207, 1.274199], sD: [-2.018891, 0.299511, 1.451093] },
};

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function monthly(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    if (!cur || cur.key !== key) { cur = { key, open: r.open, high: r.high, low: r.low, close: r.close }; out.push(cur); }
    else { cur.high = Math.max(cur.high, r.high); cur.low = Math.min(cur.low, r.low); cur.close = r.close; }
  }
  return out;
}

function run(rows, k, cap) {
  const n = rows.length;
  const rr = rows.map((r) => Math.min(Math.max((r.high - r.low) / r.close, 0), 0.5));
  const lr = rows.map((r, i) => (i && rows[i - 1].close > 0 ? Math.log(r.close / rows[i - 1].close) : 0));
  const smaPrev = (a, t, w) => { let s = 0, c = 0; for (let i = Math.max(0, t - w); i < t; i++) { s += a[i]; c++; } return c ? s / c : a[Math.max(0, t - 1)]; };
  const sdPrev = (a, t, w) => { const x = []; for (let i = Math.max(0, t - w); i < t; i++) x.push(a[i]); return x.length > 1 ? sd(x) : 0.01; };
  const capE = (x) => Math.min(Math.max(Math.exp(Math.min(x, 0.69)), 0), cap);

  const resU = [], resD = [], out = [];
  let qU = k.sU.slice(), qD = k.sD.slice(), lastQ = -1e5;

  for (let t = 61; t < n; t++) {
    const f = [1, Math.log(smaPrev(rr, t, 5) + EPS), Math.log(smaPrev(rr, t, 20) + EPS), Math.log(smaPrev(rr, t, 60) + EPS), Math.log(Math.min(Math.max(sdPrev(lr, t, 20), EPS), 0.5) + EPS)];
    const muU = f.reduce((s, v, i) => s + v * k.cU[i], 0);
    const muD = f.reduce((s, v, i) => s + v * k.cD[i], 0);
    const valid = resU.length >= MIN_RESID;
    if (valid && t - lastQ >= REFIT) { qU = [q(resU, 0.1), q(resU, 0.5), q(resU, 0.9)]; qD = [q(resD, 0.1), q(resD, 0.5), q(resD, 0.9)]; lastQ = t; }
    const o = rows[t].open;
    if (valid) {
      out.push({
        ah: rows[t].high, al: rows[t].low, o,
        hi10: o * (1 + capE(muU + qU[0])), hi90: o * (1 + capE(muU + qU[2])),
        lo10: o * (1 - capE(muD + qD[2])), lo90: o * (1 - capE(muD + qD[0])),
      });
    }
    const uRaw = Math.min(Math.max((rows[t].high - o) / o, 1e-4), 0.5);
    const dRaw = Math.min(Math.max((o - rows[t].low) / o, 1e-4), 0.5);
    resU.push(Math.log(uRaw) - muU); resD.push(Math.log(dRaw) - muD);
    if (resU.length > RESID_WIN) { resU.shift(); resD.shift(); }
  }
  const covH = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / out.length;
  const covL = out.filter((r) => r.al >= r.lo10 && r.al <= r.lo90).length / out.length;
  const medH = q(out.map((r) => Math.abs((r.hi10 + r.hi90) / 2 - r.ah) / r.o), 0.5);
  return { n, scored: out.length, covH, covL };
}

console.log('Coverage on MONTHLY bars (shipped daily coefficients, cap 0.25):');
for (const [label, file, key] of [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
]) {
  const m = monthly(load(file));
  const r = run(m, COEF[key], 0.25);
  console.log(`  ${label.padEnd(5)} ${String(r.n).padStart(4)} months, ${String(r.scored).padStart(3)} scored -> coverage high ${(r.covH * 100).toFixed(1)}%  low ${(r.covL * 100).toFixed(1)}%`);
}

console.log('\nSame test on DAILY bars, for reference:');
for (const [label, file, key] of [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
]) {
  const r = run(load(file), COEF[key], 0.25);
  console.log(`  ${label.padEnd(5)} ${String(r.n).padStart(5)} bars, ${String(r.scored).padStart(4)} scored -> coverage high ${(r.covH * 100).toFixed(1)}%  low ${(r.covL * 100).toFixed(1)}%`);
}
