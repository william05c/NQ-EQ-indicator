// For an intraday overlay we cannot carry the rolling residual quantiles across
// timeframes, so the bands must use the FIXED seed quantiles. Question: is that
// still calibrated? Measure coverage with seasONICS frozen.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const COEF = {
  NQ: { cU: [-1.694495, 0.755239, -0.125094, 0.262881, -0.034915], cD: [-1.692194, 0.571979, 0.075713, 0.067209, 0.153190], sU: [-1.393331, 0.244323, 1.137000], sD: [-1.743627, 0.274472, 1.427955] },
  ES: { cU: [-1.460724, 0.681027, 0.497639, 0.180519, -0.399594], cD: [-1.449274, 0.532104, 0.621457, 0.162186, -0.335095], sU: [-1.478340, 0.200374, 1.202514], sD: [-1.798963, 0.234755, 1.412328] },
  IXIC: { cU: [-1.560655, 0.757907, 0.147927, 0.073320, -0.053215], cD: [-1.561902, 0.495297, 0.145741, 0.180904, 0.101781], sU: [-1.737729, 0.297207, 1.274199], sD: [-2.018891, 0.299511, 1.451093] },
};

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function score(rows, k, cap) {
  const n = rows.length;
  const rr = rows.map((r) => Math.min(Math.max((r.high - r.low) / r.close, 0), 0.5));
  const lr = rows.map((r, i) => (i && rows[i - 1].close > 0 ? Math.log(r.close / rows[i - 1].close) : 0));
  const smaPrev = (a, t, w) => { let s = 0, c = 0; for (let i = Math.max(0, t - w); i < t; i++) { s += a[i]; c++; } return c ? s / c : a[Math.max(0, t - 1)]; };
  const sdPrev = (a, t, w) => { const x = []; for (let i = Math.max(0, t - w); i < t; i++) x.push(a[i]); return x.length > 1 ? sd(x) : 0.01; };
  const capE = (x) => Math.min(Math.max(Math.exp(Math.min(x, 0.69)), 0), cap);

  const out = [];
  for (let t = 61; t < n; t++) {
    const f = [1, Math.log(smaPrev(rr, t, 5) + EPS), Math.log(smaPrev(rr, t, 20) + EPS), Math.log(smaPrev(rr, t, 60) + EPS), Math.log(Math.min(Math.max(sdPrev(lr, t, 20), EPS), 0.5) + EPS)];
    const muU = f.reduce((s, v, i) => s + v * k.cU[i], 0);
    const muD = f.reduce((s, v, i) => s + v * k.cD[i], 0);
    const o = rows[t].open;
    out.push({
      ah: rows[t].high, al: rows[t].low,
      hi10: o * (1 + capE(muU + k.sU[0])), hi90: o * (1 + capE(muU + k.sU[2])),
      lo10: o * (1 - capE(muD + k.sD[2])), lo90: o * (1 - capE(muD + k.sD[0])),
      hi50: o * (1 + capE(muU + k.sU[1])), lo50: o * (1 - capE(muD + k.sD[1])),
    });
  }
  const covH = out.filter((r) => r.ah >= r.hi10 && r.ah <= r.hi90).length / out.length;
  const covL = out.filter((r) => r.al >= r.lo10 && r.al <= r.lo90).length / out.length;
  const medH = q(out.map((r) => Math.abs(r.hi50 - r.ah) / r.ah), 0.5);
  return { n: out.length, covH, covL, medH };
}

console.log('STATIC seed quantiles (no rolling adaptation) on daily bars:\n');
console.log('asset  scored  coverage high  coverage low  median err high');
for (const [label, file, key] of [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
]) {
  const r = score(load(file), COEF[key], 0.25);
  console.log(`  ${label.padEnd(5)} ${String(r.n).padStart(5)}   ${(r.covH * 100).toFixed(1)}%`.padEnd(34) + ` ${(r.covL * 100).toFixed(1)}%`.padEnd(14) + ` ${(r.medH * 100).toFixed(2)}%`);
}
