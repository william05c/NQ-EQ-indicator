// Renders reports/first2h_results.json into a self-contained HTML report.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'reports');
const R = JSON.parse(fs.readFileSync(path.join(dir, 'first2h_results.json'), 'utf8'));

const W = 740, Hc = 260, pad = 46;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (v) => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(0);

// equity curve of the best cell
function equity() {
  const T = R.bestTradeLog;
  let cum = 0;
  const curve = T.map((t) => (cum += t.dollars));
  const lo = Math.min(0, ...curve), hi = Math.max(0, ...curve);
  const w = W - pad - 20, h = Hc - pad - 26;
  const x = (i) => pad + (i / Math.max(1, curve.length - 1)) * w;
  const y = (v) => pad + h - ((v - lo) / (hi - lo || 1)) * h;
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  s += `<line x1="${pad}" y1="${y(0)}" x2="${pad + w}" y2="${y(0)}" class="zero"/>`;
  s += `<text x="${pad - 8}" y="${y(0) + 4}" class="ax" text-anchor="end">$0</text>`;
  s += `<text x="${pad - 8}" y="${y(hi) + 4}" class="ax" text-anchor="end">${money(hi)}</text>`;
  s += `<text x="${pad - 8}" y="${y(lo) + 4}" class="ax" text-anchor="end">${money(lo)}</text>`;
  s += `<polyline points="${curve.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="#69db7c" stroke-width="2"/>`;
  T.forEach((t, i) => {
    s += `<circle cx="${x(i)}" cy="${y(curve[i])}" r="2.5" fill="${t.dollars > 0 ? '#69db7c' : '#ff8787'}"><title>${t.date} ${t.side} @ ${t.entry} -> ${t.exit} (${t.why})  ${money(t.dollars)}</title></circle>`;
  });
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">trade number (44 in total)</text></svg>`;
  return s;
}

// per-trade P&L histogram
function hist() {
  const d = R.bestTradeLog.map((t) => t.dollars);
  const lo = Math.min(...d), hi = Math.max(...d);
  const bins = 14, bw = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of d) counts[Math.min(bins - 1, Math.floor((v - lo) / bw))]++;
  const maxC = Math.max(...counts);
  const w = W - pad - 20, h = Hc - pad - 26;
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  counts.forEach((c, i) => {
    const x = pad + (i / bins) * w, bh = (c / maxC) * h;
    const centre = lo + (i + 0.5) * bw;
    s += `<rect x="${x + 2}" y="${pad + h - bh}" width="${w / bins - 4}" height="${bh}" fill="${centre >= 0 ? '#2f9e44' : '#c92a2a'}" opacity="0.8"><title>${money(centre)}: ${c} trades</title></rect>`;
    if (i % 2 === 0) s += `<text x="${x + w / bins / 2}" y="${pad + h + 14}" class="ax" text-anchor="middle">${Math.round(centre)}</text>`;
  });
  s += `<line x1="${pad}" y1="${pad + h}" x2="${pad + w}" y2="${pad + h}" class="axis"/>`;
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">P&amp;L per trade, dollars</text></svg>`;
  return s;
}

const gridRows = [...R.grid].sort((a, b) => b.expectancy - a.expectancy).map((r) => `
  <tr class="${r.expectancy > 0 ? 'pos' : 'neg'}">
    <td>${r.direction}</td><td>${r.target}H</td><td>${r.stop}H</td><td>${r.n}</td>
    <td>${r.winRate.toFixed(1)}</td><td>${money(r.expectancy)}</td><td>${money(r.total)}</td>
    <td>${money(r.maxDD)}</td><td>${r.tstat.toFixed(2)}</td><td>${money(r.cvar95)}</td>
    <td>${r.targets}</td><td>${r.stops}</td><td>${r.timeouts}</td>`).join('');

const b = R.bestCell;
// concentration chart: total P&L after removing the k largest trades
function concentrationChart() {
  const C = R.profitConcentration;
  const w = W - pad - 20, h = Hc - pad - 26;
  const maxAbs = Math.max(...C.map((c) => Math.abs(c.total))) || 1;
  const y = (v) => pad + h / 2 - (v / maxAbs) * (h / 2);
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  s += `<line x1="${pad}" y1="${y(0)}" x2="${pad + w}" y2="${y(0)}" class="axis"/>`;
  const bw = w / C.length * 0.6;
  C.forEach((c, i) => {
    const x = pad + (i + 0.5) * (w / C.length);
    const top = Math.min(y(c.total), y(0)), ht = Math.abs(y(c.total) - y(0));
    s += `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${ht}" fill="${c.total > 0 ? '#2f9e44' : '#c92a2a'}" opacity="0.85"><title>drop ${c.k} largest: total ${money(c.total)}, expectancy ${money(c.expectancy)}, n=${c.n}</title></rect>`;
    s += `<text x="${x}" y="${pad + h + 14}" class="ax" text-anchor="middle">${c.k}</text>`;
  });
  s += `<text x="${pad - 8}" y="${y(maxAbs) + 4}" class="ax" text-anchor="end">${money(maxAbs)}</text>`;
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">number of largest trades removed</text></svg>`;
  return s;
}

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>First 2 cash hours — study</title><style>
:root{color-scheme:dark}
body{margin:0;padding:26px 18px 60px;background:#0e1117;color:#d7dde8;font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto}
h1{font-size:21px;margin:0 0 4px}h2{font-size:14px;margin:32px 0 10px;color:#8fb4ff;letter-spacing:.03em}
.sub{color:#7d8799;font-size:13px;margin:0 0 20px}
.card{background:#151a23;border:1px solid #222a37;border-radius:10px;padding:15px 17px;margin:12px 0}
.chart{width:100%;height:auto;display:block}
.grid{stroke:#232b38}.axis{stroke:#3a4454}.zero{stroke:#5a6577;stroke-dasharray:4 3}
.ax{fill:#7d8799;font-size:10px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:4px 6px;text-align:right;border-bottom:1px solid #1e2430}
th{color:#7d8799}th:first-child,td:first-child{text-align:left}
tr.pos td:nth-child(6){color:#69db7c}tr.neg td:nth-child(6){color:#ff8787}
.fail{border-left:3px solid #ff6b6b;padding-left:12px;color:#f0b8b8}
.ok{border-left:3px solid #51cf66;padding-left:12px}
code{background:#1b2230;padding:1px 5px;border-radius:4px}
</style></head><body><div class="wrap">
<h1>First two cash hours — 09:30 to 11:30 ET</h1>
<p class="sub">${esc(R.generated)} · NQ 1-minute · ${R.data.candidates} entries in ${R.data.sessions} sessions · ${R.multipleTesting.cells} cells · $${R.spec.stake} per trade · ${R.spec.cost}</p>

<h2>Verdict</h2>
<div class="card fail">
  <p><strong>No variant is tradeable.</strong> The best of ${R.grid.length} cells is ${b.direction} ${b.target}H/${b.stop}H at <strong>+$${b.expectancy.toFixed(2)} per trade, t = ${b.tstat.toFixed(2)}</strong>, with a 95% bootstrap CI of <strong>[$${b.expectancyCI95.lo.toFixed(2)}, $${b.expectancyCI95.hi.toFixed(2)}]</strong> — it includes zero.</p>
  <p>The window produces <strong>${R.data.candidates} entries in three years</strong>. That is the binding constraint, not the parameter choice.</p>
</div>

<h2>Exact specification (replicate from this)</h2>
<div class="card">
  <p><strong>Window</strong> — ${esc(R.spec.window)}</p>
  <p><strong>Entry</strong> — ${esc(R.spec.entry)}</p>
  <p><strong>Target</strong> — ${esc(R.spec.target)}</p>
  <p><strong>Stop</strong> — ${esc(R.spec.stop)}</p>
  <p><strong>Time stop</strong> — ${esc(R.spec.timeStop)}</p>
  <p><strong>Costs</strong> — ${esc(R.spec.cost)}; fixed $${R.spec.stake} per trade, no leverage, no compounding.</p>
  <p><strong>Alignment</strong> — ${esc(R.spec.alignment)}</p>
</div>

<h2>Equity curve — best cell, all ${R.data.candidates} trades</h2>
<div class="card">${equity()}</div>

<h2>P&amp;L distribution — note the positive skew</h2>
<div class="card">${hist()}
<p>Skew <strong>${b.skew.toFixed(2)}</strong>, excess kurtosis <strong>${b.kurt.toFixed(2)}</strong>, worst trade <strong>$${b.worst.toFixed(0)}</strong>, VaR95 <strong>$${b.var95.toFixed(0)}</strong>, CVaR95 <strong>$${b.cvar95.toFixed(0)}</strong>.</p>
<p>${b.targets} of ${b.n} trades hit target, ${b.stops} hit stop, and <strong>${b.timeouts} were closed by the 11:30 time stop</strong>. The target and stop almost never bind — this is effectively a two-hour hold from the band, so the grid is not ${R.grid.length} independent tests.</p>
</div>

<h2>Multiple testing</h2>
<div class="card">
  <p>${R.multipleTesting.cells} cells tested. At that count roughly <strong>${R.multipleTesting.expectedFalsePositivesAtT2}</strong> cells clear |t| &gt; 2 by chance; the Bonferroni threshold is |t| &gt; ${R.multipleTesting.bonferroniThreshold}. Nothing reaches it.</p>
</div>

<h2>Year by year — the result lives in one year</h2>
<div class="card">
<table><thead><tr><th>year</th><th>trades</th><th>expectancy</th><th>total</th></tr></thead><tbody>
${R.yearSplit.map((y) => `<tr><td>${y.year}</td><td>${y.n}</td><td>${money(y.expectancy)}</td><td>${money(y.total)}</td></tr>`).join('')}
</tbody></table>
<p>${R.yearSplit[R.yearSplit.length - 1].n} trades in the final year carry the whole result. That is not a track record, it is a subset.</p>
</div>

<h2>Profit concentration — the number that decides it</h2>
<div class="card">
  ${concentrationChart()}
  <table><thead><tr><th>drop the k largest</th><th>trades left</th><th>expectancy</th><th>total</th></tr></thead><tbody>
  ${R.profitConcentration.map((c) => `<tr><td>${c.k}</td><td>${c.n}</td><td>${money(c.expectancy)}</td><td>${money(c.total)}</td></tr>`).join('')}
  </tbody></table>
  <p class="fail" style="margin-top:12px"><strong>Two trades produce 94% of the profit.</strong> Remove them and expectancy falls from +$12.96 to <strong>+$0.85</strong> over the remaining 42. Remove three and it is negative. The strategy is two observations wearing a statistics costume.</p>
</div>

<h2>Ruin analysis and Kelly</h2>
<div class="card">
  <p><strong>Bootstrapped drawdowns</strong> (10,000 resamples of the 44 trades): median $${R.ruin.ddBootstrap.p50.toFixed(0)}, 95th percentile $${R.ruin.ddBootstrap.p95.toFixed(0)}, 99th $${R.ruin.ddBootstrap.p99.toFixed(0)}. Observed max drawdown $${R.ruin.observedDD.toFixed(0)}.</p>
  <p>A 20% drawdown needs an account of about <strong>$${R.ruin.accountFor20pctAtP50.toFixed(0)}</strong> at the median, <strong>$${R.ruin.accountFor20pctAtP95.toFixed(0)}</strong> at the 95th percentile. But no-leverage forces the account to be at least the $10,000 stake, so a 20% drawdown needs $2,000 of losses — <strong>${((0.2 * 10000) / R.ruin.ddBootstrap.p95).toFixed(1)}×</strong> the 95th-percentile drawdown. Ruin is not the binding risk here; the edge is.</p>
  <p><strong>Kelly:</strong> full Kelly of <strong>${(R.kelly.full * 100).toFixed(0)}%</strong> of capital per trade. That is not a sizing recommendation, it is proof the estimator is broken on this sample: with a mean whose confidence interval spans zero and a variance flattered by 41 time-stopped micro-outcomes, the ratio explodes. Rejected — ${esc(R.kelly.rejectedBecause)}.</p>
</div>

<h2>Entry-rule sensitivity — first touch vs break persistence</h2>
<div class="card">
  <table><thead><tr><th>persistence required</th><th>n</th><th>win %</th><th>expectancy</th><th>t</th></tr></thead><tbody>
  ${R.persistence.map((x) => `<tr><td>${x.persistMin} min</td><td>${x.n}</td><td>${x.expectancy === null ? '—' : x.winRate.toFixed(1)}</td><td>${x.expectancy === null ? '—' : money(x.expectancy)}</td><td>${x.expectancy === null ? '—' : x.tstat.toFixed(2)}</td></tr>`).join('')}
  </tbody></table>
  <p>Expectancy peaks at 1–5 minutes of persistence (+$25 to +$27) then decays to +$3 by 15 minutes — the shape of a short-lived effect. But the filter halves the sample to ~20 trades, so the peak is one fewer observation away from zero, not evidence. <strong>No variant reaches t = 1.5.</strong></p>
</div>

<h2>Every cell</h2>
<div class="card" style="overflow-x:auto"><table><thead><tr>
<th>dir</th><th>target</th><th>stop</th><th>n</th><th>win%</th><th>expectancy</th><th>total</th><th>maxDD</th><th>t</th><th>CVaR95</th><th>targets</th><th>stops</th><th>timeouts</th>
</tr></thead><tbody>${gridRows}</tbody></table></div>

<h2>Reproduce</h2>
<div class="card"><p><code>node src/first2h_study.js &amp;&amp; node src/render_first2h.js</code></p>
<p>Trade log with every entry, exit and reason is in <code>reports/first2h_results.json</code> under <code>bestTradeLog</code>.</p></div>
</div></body></html>`;
fs.writeFileSync(path.join(dir, 'first2h_report.html'), html);
console.log('wrote reports/first2h_report.html');
