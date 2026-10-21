// Same harness, three datasets, two directions, prior-only filters.
//
// (1) does the fade result hold on NQ and ES, or was IXIC a one-off?
// (2) does MOMENTUM - entering on the band break and holding - survive filters
//     built only from information available at the open?
//
// Clean measurement only: entry at the band, exit at the session close. No
// target/stop grid, because daily bars cannot order an intraday target against an
// intraday stop (that mistake produced a fake 99.8% win rate earlier).
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const STAKE = 10000, COST = 0.0002;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

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

function build(file) {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => { const [date, open, high, low, close] = l.split(','); return { date, open: +open, high: +high, low: +low, close: +close }; });
  const n = rows.length;
  const rr = rows.map((r) => (r.high - r.low) / r.close);
  const lr = rows.map((r, i) => (i ? Math.log(r.close / rows[i - 1].close) : 0));
  const trail = (arr, t, w) => { const a = arr.slice(Math.max(0, t - w), t); return a.length ? mean(a) : 0; };
  const feats = (t) => [1, Math.log(trail(rr, t, 5) + EPS), Math.log(trail(rr, t, 20) + EPS), Math.log(trail(rr, t, 60) + EPS), Math.log(sd(lr.slice(Math.max(0, t - 20), t)) + EPS)];
  const u = rows.map((r) => Math.max(EPS, (r.high - r.open) / r.open));
  const d = rows.map((r) => Math.max(EPS, (r.open - r.low) / r.open));
  const yU = u.map(Math.log), yD = d.map(Math.log);
  let wU = null, wD = null, lastFit = -1;
  const resU = [], resD = [], sessions = [];
  for (let t = WARMUP; t < n; t++) {
    if (lastFit < 0 || t - lastFit >= REFIT) {
      const X = [], a = [], b = [];
      for (let i = 60; i < t; i++) { X.push(feats(i)); a.push(yU[i]); b.push(yD[i]); }
      wU = ols(X, a); wD = ols(X, b); lastFit = t;
    }
    const x = feats(t);
    const muU = dot(wU, x), muD = dot(wD, x);
    if (resU.length >= MIN_RESID) {
      const o = rows[t].open;
      sessions.push({
        date: rows[t].date, o, hi: rows[t].high, lo: rows[t].low, c: rows[t].close,
        h90: o * (1 + Math.exp(muU + q(resU, 0.9))),
        l10: o * (1 - Math.exp(muD + q(resD, 0.9))),
        bandW: 0, prevRng: (rows[t - 1].high - rows[t - 1].low) / rows[t - 1].close,
        gap: Math.abs(o - rows[t - 1].close) / rows[t - 1].close,
      });
      sessions[sessions.length - 1].bandW = (sessions[sessions.length - 1].h90 - sessions[sessions.length - 1].l10) / o;
    }
    resU.push(yU[t] - muU); resD.push(yD[t] - muD);
    if (resU.length > RW) { resU.shift(); resD.shift(); }
  }
  return { sessions, rows };
}

function trades(sessions, dir) {
  const out = [];
  for (const s of sessions) {
    const hitHi = s.hi >= s.h90, hitLo = s.lo <= s.l10;
    if (hitHi && hitLo) continue;
    if (!hitHi && !hitLo) continue;
    let long, entry;
    if (hitHi) { entry = Math.max(s.o, s.h90); long = dir === 'momentum'; }
    else { entry = Math.min(s.o, s.l10); long = dir === 'fade'; }
    const gross = (long ? 1 : -1) * (s.c - entry) / entry;
    out.push({ ...s, side: long ? 1 : -1, gross, net: gross - COST, dollars: (gross - COST) * STAKE });
  }
  return out;
}

function summarise(T, years) {
  if (!T.length) return null;
  const r = T.map((t) => t.net);
  const wins = T.filter((t) => t.net > 0).length;
  return {
    n: T.length, win: wins / T.length * 100, exp: mean(T.map((t) => t.dollars)),
    total: T.reduce((a, t) => a + t.dollars, 0),
    tstat: sd(r) > 0 ? mean(r) / (sd(r) / Math.sqrt(T.length)) : 0,
    sharpe: sd(r) > 0 ? (mean(r) / sd(r)) * Math.sqrt(T.length / years) : 0,
  };
}

const FILES = [
  ['nasdaq_composite_IXIC_daily_2002-2026.csv', 'IXIC'],
  ['nq_futures_daily.csv', 'NQ'],
  ['es_futures_daily.csv', 'ES'],
];

console.log('='.repeat(96));
console.log('FADE vs MOMENTUM at the band, three datasets, entry at the band / exit at the close');
console.log(`$${STAKE} per trade, ${(COST * 10000).toFixed(0)} bp cost, no leverage, walk-forward bands`);
console.log('='.repeat(96));

for (const [file, name] of FILES) {
  const { sessions, rows } = build(file);
  const first = sessions[0], last = sessions[sessions.length - 1];
  const years = (new Date(last.date) - new Date(first.date)) / (365.25 * 24 * 3600 * 1000);
  const bh = (last.c - first.o) / first.o;
  const covH = sessions.filter((s) => s.hi <= s.h90).length / sessions.length;
  const noTrade = sessions.filter((s) => s.hi < s.h90 && s.lo > s.l10).length / sessions.length;

  console.log(`\n${name}  ${first.date} -> ${last.date}   ${sessions.length} sessions`);
  console.log(`  band coverage (high) ${(covH * 100).toFixed(1)}%   NO-TRADE days ${(noTrade * 100).toFixed(1)}%   buy&hold ${(bh * 100).toFixed(0)}%`);

  for (const dir of ['fade', 'momentum']) {
    const T = trades(sessions, dir);
    const s = summarise(T, years);
    if (!s) continue;
    console.log(`  ${dir.padEnd(9)} n=${String(s.n).padStart(4)}  win ${s.win.toFixed(1).padStart(5)}%  exp ${('$' + s.exp.toFixed(2)).padStart(9)}  total ${('$' + s.total.toFixed(0)).padStart(8)}  t ${s.tstat.toFixed(2).padStart(6)}  Sharpe ${s.sharpe.toFixed(2).padStart(5)}`);
  }
}

// ---------------- momentum, filtered on prior information only ----------------
console.log('\n' + '='.repeat(96));
console.log('MOMENTUM under prior-only filters (the only direction with a positive point estimate)');
console.log('='.repeat(96));
for (const [file, name] of FILES) {
  const { sessions } = build(file);
  const years = (new Date(sessions[sessions.length - 1].date) - new Date(sessions[0].date)) / (365.25 * 24 * 3600 * 1000);
  const T = trades(sessions, 'momentum');
  console.log(`\n${name}  (n=${T.length})`);
  for (const key of ['bandW', 'prevRng', 'gap']) {
    const vals = T.map((t) => t[key]).sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length / 3)], hi = vals[Math.floor(2 * vals.length / 3)];
    const groups = [
      ['low', T.filter((t) => t[key] <= lo)],
      ['mid', T.filter((t) => t[key] > lo && t[key] <= hi)],
      ['high', T.filter((t) => t[key] > hi)],
    ];
    const label = key === 'bandW' ? 'predicted band width' : key === 'prevRng' ? 'previous session range' : 'overnight gap';
    console.log(`  by ${label}:`);
    for (const [nm, g] of groups) {
      const s = summarise(g, years);
      if (!s) continue;
      console.log(`    ${nm.padEnd(5)} n=${String(s.n).padStart(3)}  win ${s.win.toFixed(1).padStart(5)}%  exp ${('$' + s.exp.toFixed(2)).padStart(9)}  t ${s.tstat.toFixed(2).padStart(6)}`);
    }
  }
}
