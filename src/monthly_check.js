// What happens when the daily-calibrated model is applied to MONTHLY bars?
// Resamples the daily data, applies the shipped coefficients, and compares the
// implied excursion with what actually happened.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

const C = {
  NQ: { cU: [-1.694495, 0.755239, -0.125094, 0.262881, -0.034915], cD: [-1.692194, 0.571979, 0.075713, 0.067209, 0.153190] },
  ES: { cU: [-1.460724, 0.681027, 0.497639, 0.180519, -0.399594], cD: [-1.449274, 0.532104, 0.621457, 0.162186, -0.335095] },
  IXIC: { cU: [-1.560655, 0.757907, 0.147927, 0.073320, -0.053215], cD: [-1.561902, 0.495297, 0.145741, 0.180904, 0.101781] },
};

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

// daily -> monthly bars (calendar month)
function monthly(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    if (!cur || cur.key !== key) {
      cur = { key, date: r.date, open: r.open, high: r.high, low: r.low, close: r.close };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.date = r.date;
    }
  }
  return out;
}

function evaluate(rows, coef) {
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const smaPrev = (a, t, w) => { let s = 0, c = 0; for (let i = Math.max(0, t - w); i < t; i++) { s += a[i]; c++; } return c ? s / c : a[Math.max(0, t - 1)]; };
  const sdPrev = (a, t, w) => { const x = []; for (let i = Math.max(0, t - w); i < t; i++) x.push(a[i]); return x.length > 1 ? sd(x) : 0.01; };

  let predU = 0, realU = 0, predD = 0, realD = 0, cnt = 0;
  for (let t = 61; t < n; t++) {
    const f = [1, Math.log(smaPrev(rr, t, 5) + EPS), Math.log(smaPrev(rr, t, 20) + EPS), Math.log(smaPrev(rr, t, 60) + EPS), Math.log(sdPrev(lr, t, 20) + EPS)];
    const muU = f.reduce((s, v, i) => s + v * coef.cU[i], 0);
    const muD = f.reduce((s, v, i) => s + v * coef.cD[i], 0);
    predU += Math.exp(muU); predD += Math.exp(muD);
    realU += (rows[t].high - rows[t].open) / rows[t].open;
    realD += (rows[t].open - rows[t].low) / rows[t].open;
    cnt++;
  }
  return { cnt, predU: predU / cnt, realU: realU / cnt, predD: predD / cnt, realD: realD / cnt };
}

console.log('Applying the DAILY coefficients to MONTHLY bars:\n');
console.log('asset  months  predicted upside | realized upside | ratio | predicted down | realized down | ratio');
for (const [label, file, key] of [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
]) {
  const m = monthly(load(file));
  const r = evaluate(m, C[key]);
  console.log(
    `${label.padEnd(5)} ${String(m.length).padStart(6)}   ${(r.predU * 100).toFixed(2)}%`.padEnd(42) +
    ` ${(r.realU * 100).toFixed(2)}%`.padEnd(18) +
    ` ${(r.predU / r.realU).toFixed(2)}x`.padEnd(8) +
    ` ${(r.predD * 100).toFixed(2)}%`.padEnd(16) +
    ` ${(r.realD * 100).toFixed(2)}%`.padEnd(16) +
    ` ${(r.predD / r.realD).toFixed(2)}x`
  );
}

// Same comparison on daily bars, as a control
console.log('\nControl - same code on DAILY bars:');
console.log('asset  bars  predicted upside | realized upside | ratio');
for (const [label, file, key] of [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['NQ', 'nq_futures_daily.csv', 'NQ'],
  ['ES', 'es_futures_daily.csv', 'ES'],
]) {
  const r = evaluate(load(file), C[key]);
  console.log(`${label.padEnd(5)} ${String(r.cnt).padStart(5)}   ${(r.predU * 100).toFixed(2)}%`.padEnd(42) + ` ${(r.realU * 100).toFixed(2)}%`.padEnd(18) + ` ${(r.predU / r.realU).toFixed(2)}x`);
}
