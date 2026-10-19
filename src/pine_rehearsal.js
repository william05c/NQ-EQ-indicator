// Rehearsal of the Pine script's exact logic (static coefficients + runtime residual
// quantiles recomputed every 21 bars). If this reproduces the Node backtest numbers,
// the Pine port is faithful.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, MIN_RESID = 60, REFIT = 21, RESID_WIN = 500;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

// coefficients exactly as hardcoded in the .pine file
const C = {
  NQ: { cU: [-1.694495, 0.755239, -0.125094, 0.262881, -0.034915], cD: [-1.692194, 0.571979, 0.075713, 0.067209, 0.153190], sU: [-1.393331, 0.244323, 1.137000], sD: [-1.743627, 0.274472, 1.427955] },
  ES: { cU: [-1.460724, 0.681027, 0.497639, 0.180519, -0.399594], cD: [-1.449274, 0.532104, 0.621457, 0.162186, -0.335095], sU: [-1.478340, 0.200374, 1.202514], sD: [-1.798963, 0.234755, 1.412328] },
  IXIC: { cU: [-1.560655, 0.757907, 0.147927, 0.073320, -0.053215], cD: [-1.561902, 0.495297, 0.145741, 0.180904, 0.101781], sU: [-1.737729, 0.297207, 1.274199], sD: [-2.018891, 0.299511, 1.451093] },
};

const load = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });

function rehearsal(file, prof, evalFrom) {
  const rows = load(file);
  const n = rows.length;
  const k = C[prof];
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => mean(arr.slice(Math.max(0, t - w), t));
  const sdev = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

  const resU = [], resD = [];
  let qU = [...k.sU], qD = [...k.sD], lastQ = -100000;
  const out = [];

  for (let t = 60; t < n; t++) {
    const rr5 = trail(rr, t, 5), rr20 = trail(rr, t, 20), rr60 = trail(rr, t, 60), rv20 = sdev(lr, t, 20);
    const x = [1, Math.log(rr5 + EPS), Math.log(rr20 + EPS), Math.log(rr60 + EPS), Math.log(rv20 + EPS)];
    const muU = x.reduce((s, v, i) => s + v * k.cU[i], 0);
    const muD = x.reduce((s, v, i) => s + v * k.cD[i], 0);

    const valid = resU.length >= MIN_RESID;
    if (valid && t - lastQ >= REFIT) {
      qU = [q(resU, 0.10), q(resU, 0.50), q(resU, 0.90)];
      qD = [q(resD, 0.10), q(resD, 0.50), q(resD, 0.90)];
      lastQ = t;
    }

    const o = rows[t].open;
    const hiP10 = o * (1 + Math.exp(muU + qU[0]));
    const hiP50 = o * (1 + Math.exp(muU + qU[1]));
    const hiP90 = o * (1 + Math.exp(muU + qU[2]));
    const loP10 = o * (1 - Math.exp(muD + qD[2]));
    const loP50 = o * (1 - Math.exp(muD + qD[1]));
    const loP90 = o * (1 - Math.exp(muD + qD[0]));

    if (valid && rows[t].date >= evalFrom) {
      out.push({ o, ah: rows[t].high, al: rows[t].low, hiP10, hiP50, hiP90, loP10, loP50, loP90 });
    }

    resU.push(Math.log(Math.max(EPS, (rows[t].high - rows[t].open) / rows[t].open)) - muU);
    resD.push(Math.log(Math.max(EPS, (rows[t].open - rows[t].low) / rows[t].open)) - muD);
    if (resU.length > RESID_WIN) { resU.shift(); resD.shift(); }
  }

  const m = out.length;
  const maeH = mean(out.map((r) => Math.abs(r.hiP50 - r.ah)));
  const maeL = mean(out.map((r) => Math.abs(r.loP50 - r.al)));
  const covH = out.filter((r) => r.ah >= r.hiP10 && r.ah <= r.hiP90).length / m;
  const covL = out.filter((r) => r.al >= r.loP10 && r.al <= r.loP90).length / m;
  const covBoth = out.filter((r) => r.ah >= r.hiP10 && r.ah <= r.hiP90 && r.al >= r.loP10 && r.al <= r.loP90).length / m;
  console.log(`${prof.padEnd(5)} n=${String(m).padStart(5)}  MAE_H ${maeH.toFixed(1).padStart(6)}  MAE_L ${maeL.toFixed(1).padStart(6)}  covH ${(covH * 100).toFixed(1)}%  covL ${(covL * 100).toFixed(1)}%  both ${(covBoth * 100).toFixed(1)}%`);
  return { maeH, covH };
}

console.log('=== Pine logic rehearsal (static coefficients, runtime quantiles) ===');
rehearsal('nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC', '2016-10-18');
rehearsal('nq_futures_daily.csv', 'NQ', '2019-06-01');
rehearsal('es_futures_daily.csv', 'ES', '2018-01-01');
console.log('\nreference (rolling-refit Node backtest): IXIC MAE_H 55 / cov 79.9 | NQ 98 / 78.7 | ES 21 / 80.3');
