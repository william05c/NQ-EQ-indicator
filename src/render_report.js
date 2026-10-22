// Renders reports/backtest_results.json into a self-contained HTML dashboard.
// No CDN, no dependencies: inline SVG, works offline, opens by double-click.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'reports');
const R = JSON.parse(fs.readFileSync(path.join(dir, 'backtest_results.json'), 'utf8'));

const W = 760, Hc = 320, pad = 46;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (v) => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(0);

// ---------- chart 1: calibration ----------
function calibChart() {
  const D = R.calibration.deciles;
  const w = W - pad - 20, h = Hc - pad - 30;
  const x = (i) => pad + (i + 0.5) * (w / 10);
  const y = (v) => pad + h - v * h;
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  for (let g = 0; g <= 1.001; g += 0.25) {
    s += `<line x1="${pad}" y1="${y(g)}" x2="${pad + w}" y2="${y(g)}" class="grid"/>`;
    s += `<text x="${pad - 8}" y="${y(g) + 4}" class="ax" text-anchor="end">${(g * 100).toFixed(0)}%</text>`;
  }
  const bw = w / 10 * 0.30;
  D.forEach((d, i) => {
    s += `<rect x="${x(i) - bw - 1}" y="${y(d.pred)}" width="${bw}" height="${Math.max(0, y(0) - y(d.pred))}" class="barPred"/>`;
    s += `<rect x="${x(i) + 1}" y="${y(d.real)}" width="${bw}" height="${Math.max(0, y(0) - y(d.real))}" class="barReal"/>`;
    s += `<text x="${x(i)}" y="${pad + h + 16}" class="ax" text-anchor="middle">${d.decile}</text>`;
  });
  s += `<line x1="${pad}" y1="${y(0)}" x2="${pad + w}" y2="${y(0)}" class="axis"/>`;
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">predicted decile (1 = model says ~0-10% chance the high extends)</text>`;
  s += `</svg>`;
  return s;
}

// ---------- chart 2: scatter ----------
function scatter() {
  const R_ = R.rules.filter((r) => r.n >= 20);
  const w = W - pad - 20, h = Hc - pad - 30;
  const exps = R_.map((r) => r.expectancy);
  const lo = Math.min(-20, Math.min(...exps)), hi = Math.max(20, Math.max(...exps));
  const x = (v) => pad + (v / 100) * w;
  const y = (v) => pad + h - ((v - lo) / (hi - lo)) * h;
  const colors = { full: '#4c8bf5', rth: '#f5b64c', first2h: '#7ad67a', last2h: '#d47ae0' };
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  for (let g = 0; g <= 100; g += 25) {
    s += `<line x1="${x(g)}" y1="${pad}" x2="${x(g)}" y2="${pad + h}" class="grid"/>`;
    s += `<text x="${x(g)}" y="${pad + h + 16}" class="ax" text-anchor="middle">${g}%</text>`;
  }
  s += `<line x1="${pad}" y1="${y(0)}" x2="${pad + w}" y2="${y(0)}" class="zero"/>`;
  s += `<text x="${pad - 8}" y="${y(0) + 4}" class="ax" text-anchor="end">$0</text>`;
  s += `<text x="${pad - 8}" y="${y(hi) + 4}" class="ax" text-anchor="end">${money(hi)}</text>`;
  s += `<text x="${pad - 8}" y="${y(lo) + 4}" class="ax" text-anchor="end">${money(lo)}</text>`;
  for (const r of R_) {
    const rad = Math.max(3, Math.min(11, Math.sqrt(r.n) / 2));
    s += `<circle cx="${x(r.winRate)}" cy="${y(r.expectancy)}" r="${rad}" fill="${colors[r.window]}" opacity="0.55" stroke="${colors[r.window]}" stroke-width="1"><title>${esc(r.windowLabel)}\n${r.direction} target ${r.target}H / stop ${r.stop}H\nn=${r.n}  win ${r.winRate.toFixed(1)}%  exp $${r.expectancy.toFixed(1)}\nt=${r.tstat.toFixed(2)}  stops=${r.stopHits}</title></circle>`;
  }
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">win rate (%)   -   dot size = number of trades</text>`;
  s += `</svg>`;
  return s;
}

// ---------- chart 3: equity curves for the top rules ----------
function equity() {
  const top = [...R.rules].filter((r) => r.n >= 20).sort((a, b) => b.expectancy - a.expectancy).slice(0, 4);
  const w = W - pad - 20, h = Hc - pad - 30;
  const maxLen = Math.max(...top.map((r) => r.curve.length));
  const lo = Math.min(0, ...top.map((r) => Math.min(...r.curve)));
  const hi = Math.max(0, ...top.map((r) => Math.max(...r.curve)));
  const x = (i) => pad + (i / (maxLen - 1)) * w;
  const y = (v) => pad + h - ((v - lo) / (hi - lo || 1)) * h;
  const colors = ['#7ad67a', '#4c8bf5', '#f5b64c', '#d47ae0'];
  let s = `<svg viewBox="0 0 ${W} ${Hc}" class="chart">`;
  s += `<line x1="${pad}" y1="${y(0)}" x2="${pad + w}" y2="${y(0)}" class="zero"/>`;
  s += `<text x="${pad - 8}" y="${y(0) + 4}" class="ax" text-anchor="end">$0</text>`;
  s += `<text x="${pad - 8}" y="${y(hi) + 4}" class="ax" text-anchor="end">${money(hi)}</text>`;
  top.forEach((r, k) => {
    const pts = r.curve.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${colors[k]}" stroke-width="2"/>`;
    s += `<text x="${pad + 6}" y="${pad + 16 + k * 16}" class="ax" fill="${colors[k]}">${r.direction} ${r.target}H/${r.stop}H  ${r.window}  ${money(r.total)}</text>`;
  });
  s += `<text x="${pad + w / 2}" y="${Hc - 6}" class="ax" text-anchor="middle">trade number</text>`;
  s += `</svg>`;
  return s;
}

// ---------- table ----------
function table() {
  const rows = [...R.rules].sort((a, b) => b.expectancy - a.expectancy);
  let s = `<table><thead><tr>
    <th>hours traded</th><th>rule</th><th>target</th><th>stop</th><th>n</th>
    <th>win %</th><th>expectancy</th><th>total</th><th>t</th><th>stops</th><th>avg win</th><th>avg loss</th></tr></thead><tbody>`;
  for (const r of rows) {
    const cls = r.expectancy > 0 ? 'pos' : 'neg';
    s += `<tr class="${cls}"><td>${esc(r.windowLabel)}</td><td>${r.direction}</td><td>${r.target}H</td><td>${r.stop}H</td>
      <td>${r.n}</td><td>${r.winRate.toFixed(1)}</td><td>${money(r.expectancy)}</td><td>${money(r.total)}</td>
      <td>${r.tstat.toFixed(2)}</td><td>${r.stopHits}</td><td>$${r.avgWin.toFixed(0)}</td><td>$${r.avgLoss.toFixed(0)}</td></tr>`;
  }
  return s + `</tbody></table>`;
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Range indicator - backtest report</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:28px 20px 60px; background:#0e1117; color:#d7dde8;
         font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:15px; margin:34px 0 10px; color:#8fb4ff; letter-spacing:.02em; }
  .sub { color:#7d8799; margin:0 0 22px; font-size:13px; }
  .card { background:#151a23; border:1px solid #222a37; border-radius:10px; padding:16px 18px; margin:12px 0; }
  .chart { width:100%; height:auto; display:block; }
  .grid { stroke:#232b38; stroke-width:1; }
  .axis { stroke:#3a4454; stroke-width:1; }
  .zero { stroke:#5a6577; stroke-width:1; stroke-dasharray:4 3; }
  .ax { fill:#7d8799; font-size:10px; }
  .barPred { fill:#3b5bdb; opacity:.85; }
  .barReal { fill:#37b24d; opacity:.85; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { padding:5px 7px; text-align:right; border-bottom:1px solid #1e2430; }
  th { color:#7d8799; font-weight:600; text-align:right; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align:left; }
  tr.pos td:nth-child(7) { color:#69db7c; }
  tr.neg td:nth-child(7) { color:#ff8787; }
  .legend span { display:inline-block; margin-right:14px; font-size:12px; color:#9aa4b5; }
  .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  code { background:#1b2230; padding:1px 5px; border-radius:4px; font-size:12px; }
  .warn { border-left:3px solid #f5b64c; padding-left:12px; color:#c8c2b4; font-size:13px; }
</style></head><body><div class="wrap">

<h1>Range indicator &mdash; what was measured, on what, and why</h1>
<p class="sub">generated ${esc(R.generated)} &middot; ${R.meta.sessions} sessions &middot; ${R.meta.touches} band touches &middot; $${R.meta.stake} per trade &middot; ${R.meta.costBp} bp round-trip cost</p>

<h2>Three separate things - do not mix them up</h2>
<div class="card">
  <p><strong>1. The daily model.</strong> ${esc(R.objects.dailyModel.what)}. Measured by ${esc(R.objects.dailyModel.measuredBy)}. It is ${esc(R.objects.dailyModel.isNot)}.</p>
  <p><strong>2. The intraday nowcast.</strong> ${esc(R.objects.nowcast.what)}. Measured by ${esc(R.objects.nowcast.measuredBy)}. It is ${esc(R.objects.nowcast.isNot)}.</p>
  <p><strong>3. A trading rule.</strong> ${esc(R.objects.rules.what)}. Measured by ${esc(R.objects.rules.measuredBy)}. It is ${esc(R.objects.rules.isNot)}.</p>
  <p class="warn" style="margin-top:14px"><strong>Every win rate on this page belongs to object 3.</strong> It is a property of a rule someone wrote, using the indicator's levels as entry prices. The indicator itself has no win rate.</p>
</div>

<h2>Definitions used</h2>
<div class="card">
  <p><strong>H</strong> = ${esc(R.meta.hDefinition)}. Target and stop are quoted as multiples of H so sessions of different volatility are comparable.</p>
  <p><strong>Win</strong> = ${esc(R.meta.winDefinition)}. A 90% win rate with a large average loss can still lose money; that is why expectancy and the stop count are shown beside every win rate.</p>
  <p><strong>Hours traded</strong> = the window in which the entry may occur. The full session runs 18:00&ndash;17:00 ET; the cash window 09:30&ndash;16:00 ET.</p>
  <p><strong>Alignment</strong> = ${esc(R.meta.alignmentNote)}.</p>
</div>

<h2>Object 2 &mdash; nowcast calibration: predicted vs realised</h2>
<div class="card">
  ${calibChart()}
  <p class="legend"><span><span class="sw" style="background:#3b5bdb"></span>predicted</span><span><span class="sw" style="background:#37b24d"></span>realised</span>
  <span>overall ${(R.calibration.pred * 100).toFixed(1)}% predicted vs ${(R.calibration.real * 100).toFixed(1)}% realised, n=${R.calibration.total}</span></p>
  <p>Each bar pair asks: when the model said there was a <em>p</em> chance the session high would extend, how often did it actually extend? Bars of equal height mean the model is honest. The largest disagreement is ${(Math.max(...R.calibration.deciles.map((d) => Math.abs(d.real - d.pred))) * 100).toFixed(1)} points.</p>
</div>

<h2>Object 3 &mdash; every rule: win rate against actual expectancy</h2>
<div class="card">
  ${scatter()}
  <p class="legend"><span><span class="sw" style="background:#4c8bf5"></span>full session</span><span><span class="sw" style="background:#f5b64c"></span>cash hours</span><span><span class="sw" style="background:#7ad67a"></span>first 2 cash hours</span><span><span class="sw" style="background:#d47ae0"></span>last 2 cash hours</span></p>
  <p>This is the chart that answers your question directly: a rule can sit at 90% win rate and still be at or below the $0 line. Hover any dot for its full context. Nothing above the line clears t = 2.</p>
</div>

<h2>Object 3 &mdash; equity curves of the four best rules</h2>
<div class="card">${equity()}</div>

<h2>Object 3 &mdash; full table, sorted by expectancy</h2>
<div class="card" style="overflow-x:auto">${table()}</div>

<h2>What this does and does not establish</h2>
<div class="card">
  <p><strong>Established:</strong> on ${R.meta.sessions} sessions of real 1-minute NQ tape, the nowcast's extension probabilities match reality to within a few points across all ten deciles. The model is calibrated.</p>
  <p><strong>Not established:</strong> that any rule above makes money. ${R.rules.filter((r) => r.tstat > 2).length} of ${R.rules.length} rule variants reach t &gt; 2, and ${R.meta.touches} band touches over three years is a small sample. Treat every number here as a hypothesis with a confidence interval, not a result.</p>
  <p><strong>Reproduce:</strong> <code>node src/backtest_report.js &amp;&amp; node src/render_report.js</code></p>
</div>

</div></body></html>`;

fs.writeFileSync(path.join(dir, 'backtest_dashboard.html'), html);
console.log('wrote reports/backtest_dashboard.html');
