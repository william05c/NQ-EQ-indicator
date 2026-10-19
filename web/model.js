// Shared model for the browser dashboard. Same maths as src/benchmark.js so the
// dashboard cannot drift from the research implementation.
// Loaded as <script> in the browser (window.RangeModel) and require()'d in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RangeModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EPS = 1e-4;
  const MIN_RESID = 60;   // residuals before bands are trustworthy
  const REFIT = 21;       // refit OLS every N bars
  const RESID_WIN = 500;  // rolling residual buffer

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const q = (a, p) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  };

  function ols(X, y) {
    const k = X[0].length;
    const A = [], b = new Array(k).fill(0);
    for (let i = 0; i < k; i++) A.push(new Array(k).fill(0));
    for (let r = 0; r < X.length; r++) {
      const xr = X[r];
      for (let i = 0; i < k; i++) {
        b[i] += xr[i] * y[r];
        for (let j = 0; j < k; j++) A[i][j] += xr[i] * xr[j];
      }
    }
    for (let i = 0; i < k; i++) A[i][i] += 1e-8;
    for (let i = 0; i < k; i++) {
      let p = i;
      for (let j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      const tA = A[i]; A[i] = A[p]; A[p] = tA;
      const tb = b[i]; b[i] = b[p]; b[p] = tb;
      const d = A[i][i] || 1e-12;
      for (let j = i; j < k; j++) A[i][j] /= d;
      b[i] /= d;
      for (let r = 0; r < k; r++) {
        if (r === i) continue;
        const f = A[r][i];
        for (let j = i; j < k; j++) A[r][j] -= f * A[i][j];
        b[r] -= f * b[i];
      }
    }
    return b;
  }

  // rows: [{date, open, high, low, close}] ascending
  function run(rows) {
    const n = rows.length;
    const rr = new Array(n), lr = new Array(n);
    for (let i = 0; i < n; i++) {
      rr[i] = (rows[i].high - rows[i].low) / rows[i].close;
      lr[i] = i ? Math.log(rows[i].close / rows[i - 1].close) : 0;
    }
    const trail = (arr, t, w) => {
      let s = 0, c = 0;
      for (let i = Math.max(0, t - w); i < t; i++) { s += arr[i]; c++; }
      return c ? s / c : 0;
    };
    const sdev = (arr, t, w) => {
      const a = arr.slice(Math.max(0, t - w), t);
      const m = mean(a);
      return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
    };

    // precompute features once (a per-bar OLS refit would otherwise be O(n^2))
    const F = new Array(n);
    for (let t = 0; t < n; t++) {
      const v = t > 60 ? sdev(lr, t, 20) : 0.01;
      F[t] = [1,
        Math.log(trail(rr, t, 5) + EPS),
        Math.log(trail(rr, t, 20) + EPS),
        Math.log(trail(rr, t, 60) + EPS),
        Math.log(v + EPS)];
    }

    const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
    const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
    const yU = u.map(Math.log), yD = d.map(Math.log);

    let wU = null, wD = null, lastFit = -1;
    const resU = [], resD = [];
    const out = [];

    for (let t = 61; t < n; t++) {
      if (lastFit < 0 || t - lastFit >= REFIT) {
        const X = [], a = [], b = [];
        for (let i = 60; i < t; i++) { X.push(F[i]); a.push(yU[i]); b.push(yD[i]); }
        wU = ols(X, a); wD = ols(X, b);
        lastFit = t;
      }
      const x = F[t];
      let muU = 0, muD = 0;
      for (let i = 0; i < 5; i++) { muU += wU[i] * x[i]; muD += wD[i] * x[i]; }

      const valid = resU.length >= MIN_RESID;
      const o = rows[t].open;
      const r = rows[t];
      const rec = {
        i: t, date: r.date, open: o, high: r.high, low: r.low, close: r.close, valid,
      };
      if (valid) {
        const qU10 = q(resU, 0.1), qU50 = q(resU, 0.5), qU90 = q(resU, 0.9);
        const qD10 = q(resD, 0.1), qD50 = q(resD, 0.5), qD90 = q(resD, 0.9);
        rec.hi10 = o * (1 + Math.exp(muU + qU10));
        rec.hi50 = o * (1 + Math.exp(muU + qU50));
        rec.hi90 = o * (1 + Math.exp(muU + qU90));
        rec.lo10 = o * (1 - Math.exp(muD + qD90));
        rec.lo50 = o * (1 - Math.exp(muD + qD50));
        rec.lo90 = o * (1 - Math.exp(muD + qD10));
        rec.hitH = r.high >= rec.hi10 && r.high <= rec.hi90;
        rec.hitL = r.low >= rec.lo10 && r.low <= rec.lo90;
      }
      out.push(rec);

      resU.push(yU[t] - muU);
      resD.push(yD[t] - muD);
      if (resU.length > RESID_WIN) { resU.shift(); resD.shift(); }
    }
    return out;
  }

  function stats(out) {
    const v = out.filter((r) => r.valid);
    const n = v.length;
    const maeH = mean(v.map((r) => Math.abs(r.hi50 - r.high)));
    const maeL = mean(v.map((r) => Math.abs(r.lo50 - r.low)));
    const medH = q(v.map((r) => Math.abs(r.hi50 - r.high) / r.open), 0.5);
    const medL = q(v.map((r) => Math.abs(r.lo50 - r.low) / r.open), 0.5);
    const covH = v.filter((r) => r.hitH).length / n;
    const covL = v.filter((r) => r.hitL).length / n;
    return { n, maeH, maeL, medH, medL, covH, covL };
  }

  return { run, stats, MIN_RESID };
});
