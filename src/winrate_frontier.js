// Win rate vs expectancy: the frontier.
//
// A 90% win rate is trivially achievable and almost always loss-making: take a
// small profit target and a wide stop, and you win most trades while one loss
// eats many wins. This script maps the whole frontier so the trade-off is a
// number, not an opinion.
//
// Rule under test, both directions:
//   entry   at the band, resting limit, filled if the session touches it
//   target  f * H in the favourable direction      H = (upper - lower band) / 2
//   stop    g * H against
//   neither hit by the close -> exit at the close
//
// Where BOTH target and stop are touched the daily bar cannot say which came
// first. Those are counted and scored as LOSSES, the conservative choice, and the
// count is printed so the distortion is visible.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const FROM = '2016-10-18', STAKE = 10000, COST = 0.0002;
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

const rows = fs.readFileSync(path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2002-2026.csv'), 'utf8')
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
  if (resU.length >= MIN_RESID && rows[t].date >= FROM) {
    const o = rows[t].open;
    sessions.push({
      o, hi: rows[t].high, lo: rows[t].low, c: rows[t].close,
      h90: o * (1 + Math.exp(muU + q(resU, 0.9))),
      l10: o * (1 - Math.exp(muD + q(resD, 0.9))),
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

function trial(dir, f, g) {
  let wins = 0, losses = 0, ambiguous = 0, sum = 0;
  const rets = [];
  for (const s of sessions) {
    const H = (s.h90 - s.l10) / 2;
    if (!(H > 0)) continue;
    const hitHi = s.hi >= s.h90, hitLo = s.lo <= s.l10;
    if (hitHi && hitLo) continue;               // ambiguous entry side
    if (!hitHi && !hitLo) continue;             // the NO TRADE day
    // fade: short the upper band, long the lower. momentum: the opposite
    let long;
    let entry;
    if (hitHi) { entry = Math.max(s.o, s.h90); long = dir === 'momentum'; }
    else { entry = Math.min(s.o, s.l10); long = dir === 'fade'; }
    const tgt = long ? entry + f * H : entry - f * H;
    const stp = long ? entry - g * H : entry + g * H;
    const hitT = long ? s.hi >= tgt : s.lo <= tgt;
    const hitS = long ? s.lo <= stp : s.hi >= stp;
    let exit;
    if (hitT && hitS) { ambiguous++; exit = stp; }        // scored as a loss
    else if (hitT) exit = tgt;
    else if (hitS) exit = stp;
    else exit = s.c;
    const gross = (long ? 1 : -1) * (exit - entry) / entry;
    const net = gross - COST;
    rets.push(net);
    sum += net * STAKE;
    if (net > 0) wins++; else losses++;
  }
  const t = rets.length;
  if (!t) return null;
  return {
    winRate: wins / t * 100, trades: t, ambiguous,
    expectancy: mean(rets) * STAKE, total: sum,
    sharpe: sd(rets) > 0 ? (mean(rets) / sd(rets)) * Math.sqrt(t / 10) : 0,
  };
}

console.log('WIN RATE vs EXPECTANCY - 505 band touches, 2016-10 to 2026-10');
console.log('H = half the band width. target = f*H, stop = g*H, $10,000 per trade, 2bp cost\n');
const out = [];
for (const dir of ['fade', 'momentum'])
  for (const f of [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0])
    for (const g of [0.3, 0.5, 1.0, 1.5, 2.0, 3.0]) {
      const r = trial(dir, f, g);
      if (r) out.push({ dir, f, g, ...r });
    }
out.sort((a, b) => b.winRate - a.winRate);
console.log('dir       target  stop   trades  win rate   expectancy   total PnL   Sharpe   ambiguous');
for (const r of out) {
  console.log(`${r.dir.padEnd(9)} ${(r.f).toFixed(2).padStart(5)}  ${(r.g).toFixed(2).padStart(5)}  ${String(r.trades).padStart(6)}  ${r.winRate.toFixed(1).padStart(7)}%  ${('$' + r.expectancy.toFixed(2)).padStart(10)}  ${('$' + r.total.toFixed(0)).padStart(10)}  ${r.sharpe.toFixed(2).padStart(6)}   ${r.ambiguous}`);
}

const pos = out.filter((r) => r.total > 0);
console.log(`\n${out.length} configurations tested. ${pos.length} made money.`);
if (pos.length) {
  pos.sort((a, b) => b.winRate - a.winRate);
  console.log(`best win rate among the profitable ones: ${pos[0].winRate.toFixed(1)}% (${pos[0].dir}, target ${pos[0].f}H, stop ${pos[0].g}H, total $${pos[0].total.toFixed(0)})`);
} else {
  console.log('none of them made money after costs.');
}
