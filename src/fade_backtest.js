// 10-year backtest of the RULE the indicator actually implies.
//
// The verdict "NO TRADE - mid band" means there is nothing to do while price is
// between the bands. The only trades the tool sanctions are AT the bands, so the
// strategy is a pair of resting limit orders placed at the open:
//
//   short limit at the upper band (fade high)
//   buy   limit at the lower band (fade low)
//
// Rules, as specified:
//   - no trading when the verdict is NO TRADE  -> satisfied by construction:
//     an order only fills if price actually reaches a band
//   - no options, no leverage  -> fixed notional per trade, long or short only
//   - same amount of money every day -> $10,000 notional per trade, never compounded
//
// What is deliberately NOT modelled: intraday ordering when BOTH bands are
// touched in the same session (daily bars cannot say which came first), so those
// sessions are excluded and counted. That biases nothing, it just drops ambiguity.
//
// Everything is walk-forward: the band for session t is built from data up to and
// including t-1, exactly as the Pine script does.
const fs = require('fs');
const path = require('path');

const EPS = 1e-4, WARMUP = 300, MIN_RESID = 60, REFIT = 21, RW = 500;
const FROM = '2016-10-18';
const STAKE = 10000;            // $ per trade, fixed, never compounded
const COST = 0.0002;            // 2 bp round trip: spread + commission

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
const resU = [], resD = [];
const sessions = [];

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
      date: rows[t].date, o,
      hi: rows[t].high, lo: rows[t].low, c: rows[t].close,
      h10: o * (1 + Math.exp(muU + q(resU, 0.1))),
      h90: o * (1 + Math.exp(muU + q(resU, 0.9))),
      l10: o * (1 - Math.exp(muD + q(resD, 0.9))),
      l90: o * (1 - Math.exp(muD + q(resD, 0.1))),
      // every field below is known BEFORE the session opens
      prevRangePct: (rows[t - 1].high - rows[t - 1].low) / rows[t - 1].close,
      gapPct: Math.abs(o - rows[t - 1].close) / rows[t - 1].close,
    });
  }
  resU.push(yU[t] - muU); resD.push(yD[t] - muD);
  if (resU.length > RW) { resU.shift(); resD.shift(); }
}

// ---------------- trade the bands ----------------
function run(mode) {
  const trades = [];
  let both = 0, neither = 0, hiTouch = 0, loTouch = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const hitHi = s.hi >= s.h90;
    const hitLo = s.lo <= s.l10;
    if (hitHi) hiTouch++;
    if (hitLo) loTouch++;
    if (hitHi && hitLo) { both++; continue; }        // ambiguous ordering, skip
    if (!hitHi && !hitLo) { neither++; continue; }   // the NO TRADE case
    let side, entry;
    if (hitHi) { side = -1; entry = Math.max(s.o, s.h90); }   // sell limit, fills at open if gapped above
    else { side = 1; entry = Math.min(s.o, s.l10); }          // buy limit
    if (mode === 'reverse') side = -side;
    // exit at the close, or hold overnight to the NEXT session open
    let exit = s.c;
    if (mode === 'nextopen') {
      if (i + 1 >= sessions.length) continue;
      exit = sessions[i + 1].o;
    }
    const gross = side * (exit - entry) / entry;
    const net = gross - COST;
    trades.push({ date: s.date, side, entry, exit, gross, net, dollars: net * STAKE, grossDollars: gross * STAKE });
  }
  return { trades, both, neither, hiTouch, loTouch };
}

function stats(label, r) {
  const T = r.trades;
  const pnl = T.map((t) => t.dollars);
  const total = pnl.reduce((a, b) => a + b, 0);
  const wins = T.filter((t) => t.net > 0);
  const losses = T.filter((t) => t.net <= 0);
  const avgW = wins.length ? mean(wins.map((t) => t.net)) * STAKE : 0;
  const avgL = losses.length ? mean(losses.map((t) => t.net)) * STAKE : 0;
  const perTrade = T.map((t) => t.net);
  const sh = sd(perTrade) > 0 ? (mean(perTrade) / sd(perTrade)) * Math.sqrt(T.length / 10) : 0; // 10 years
  let peak = 0, dd = 0, cum = 0;
  for (const p of pnl) { cum += p; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  // yearly
  const byYear = {};
  for (const t of T) { const yr = t.date.slice(0, 4); byYear[yr] = (byYear[yr] || 0) + t.dollars; }
  console.log(`\n${label}`);
  console.log(`  trades ${T.length}   (long ${T.filter((t) => t.side > 0).length}, short ${T.filter((t) => t.side < 0).length})`);
  console.log(`  win rate ${(wins.length / T.length * 100).toFixed(1)}%   avg win $${avgW.toFixed(0)}   avg loss $${avgL.toFixed(0)}`);
  const grossD = T.map((t) => t.grossDollars);
  const tstat = sd(perTrade) > 0 ? mean(perTrade) / (sd(perTrade) / Math.sqrt(T.length)) : 0;
  console.log(`  expectancy NET   $${mean(pnl).toFixed(2)} per trade   ${(mean(pnl) / STAKE * 100).toFixed(4)}% of stake`);
  console.log(`  expectancy GROSS $${mean(grossD).toFixed(2)} per trade   (before the ${(COST * 10000).toFixed(0)} bp cost)`);
  console.log(`  t-stat of the per-trade average ${tstat.toFixed(2)}   (need |t| > 2 to take it seriously)`);
  console.log(`  total PnL $${total.toFixed(0)} on a fixed $${STAKE}/trade stake over ${Object.keys(byYear).length} years`);
  console.log(`  Sharpe (${T.length} trades / 10y) ${sh.toFixed(2)}   max drawdown $${dd.toFixed(0)}`);
  console.log(`  yearly: ${Object.entries(byYear).map(([y, v]) => y + ' ' + (v >= 0 ? '+' : '') + v.toFixed(0)).join('   ')}`);
  return { total, sh, T };
}

console.log('='.repeat(78));
console.log('FADE-THE-BAND BACKTEST - Nasdaq Composite, walk-forward, 2016-10 to 2026-10');
console.log(`stake $${STAKE}/trade, fixed, no leverage, cost ${(COST * 10000).toFixed(0)} bp round trip`);
console.log('='.repeat(78));

const nS = sessions.length;
const covH = sessions.filter((s) => s.hi <= s.h90).length / nS;
const covL = sessions.filter((s) => s.lo >= s.l10).length / nS;
console.log(`\nBAND ACCURACY over ${nS} out-of-sample sessions`);
console.log(`  high stayed under the upper band ${(covH * 100).toFixed(1)}%   (design target 90% one-sided, 80% two-sided)`);
console.log(`  low  stayed above the lower band ${(covL * 100).toFixed(1)}%`);

const base = run('fade');
console.log(`\nOPPORTUNITY FREQUENCY`);
console.log(`  upper band touched ${base.hiTouch} (${(base.hiTouch / nS * 100).toFixed(1)}%)   lower band touched ${base.loTouch} (${(base.loTouch / nS * 100).toFixed(1)}%)`);
console.log(`  both touched, skipped as ambiguous ${base.both} (${(base.both / nS * 100).toFixed(1)}%)`);
console.log(`  neither touched - the NO TRADE day ${base.neither} (${(base.neither / nS * 100).toFixed(1)}%)`);

stats('STRATEGY: fade the band, exit at the close', base);
stats('CONTROL: same entries, but REVERSED (momentum instead of fade)', run('reverse'));
stats('CONTROL: same entries, exit at the NEXT open instead of the close', run('nextopen'));

// ---------------- baselines ----------------
const first = sessions[0], last = sessions[sessions.length - 1];
const bh = (last.c - first.o) / first.o;
const yrs = (new Date(last.date) - new Date(first.date)) / (365.25 * 24 * 3600 * 1000);
console.log('\nBASELINES over the same window');
console.log(`  buy and hold Nasdaq Composite  ${(bh * 100).toFixed(1)}%  (${first.date} ${first.o.toFixed(0)} -> ${last.date} ${last.c.toFixed(0)})`);
console.log(`  sitting in cash                0.0%`);
const fadeTotal = base.trades.reduce((a, t) => a + t.dollars, 0);
console.log(`  fade-the-band rule             ${(fadeTotal / STAKE * 100).toFixed(1)}% of a fixed $${STAKE} stake, i.e. -${(-fadeTotal).toFixed(0)} dollars over ${yrs.toFixed(1)} years`);
console.log(`  time in the market             ${(base.trades.length / nS * 100).toFixed(1)}% of sessions (${base.trades.length} of ${nS})`);

// ---------------- FILTER SPLIT (prior information only) ----------------
// Any split must use variables knowable BEFORE the session opens. The first
// version of this used the session's own range and its open-to-close move - both
// contain the outcome, which is look-ahead, and it produced a fake Sharpe of 2.67.
console.log('\nFILTER SPLIT - the clean close-exit fade, split by information known at the open');
{
  const T = base.trades;
  const byDate = new Map(sessions.map((s) => [s.date, s]));
  const enriched = T.map((t) => {
    const s = byDate.get(t.date);
    return { ...t, bandW: (s.h90 - s.l10) / s.o, prevRng: s.prevRangePct, gap: s.gapPct };
  });
  const splitBy = (key, label) => {
    const vals = enriched.map((e) => e[key]).sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length / 3)], hi = vals[Math.floor(2 * vals.length / 3)];
    console.log(`  by ${label}:`);
    for (const [name, g] of [
      ['low', enriched.filter((e) => e[key] <= lo)],
      ['mid', enriched.filter((e) => e[key] > lo && e[key] <= hi)],
      ['high', enriched.filter((e) => e[key] > hi)],
    ]) {
      if (!g.length) continue;
      const w = g.filter((e) => e.net > 0).length / g.length * 100;
      const exp = mean(g.map((e) => e.dollars));
      const sh = sd(g.map((e) => e.net)) > 0 ? (mean(g.map((e) => e.net)) / sd(g.map((e) => e.net))) * Math.sqrt(g.length / 10) : 0;
      console.log(`    ${name.padEnd(5)} n=${String(g.length).padStart(3)}  win ${w.toFixed(1).padStart(5)}%  expectancy ${('$' + exp.toFixed(2)).padStart(9)}  Sharpe ${sh.toFixed(2).padStart(6)}`);
    }
  };
  splitBy('bandW', 'predicted band width');
  splitBy('prevRng', 'previous session range');
  splitBy('gap', 'overnight gap size');
}