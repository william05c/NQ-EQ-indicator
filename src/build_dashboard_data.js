// Generate web/data.js from the committed CSVs so the dashboard works offline
// by double-clicking index.html (no server, no fetch, no CORS problems).
const fs = require('fs');
const path = require('path');

const sets = [
  ['IXIC', 'nasdaq_composite_IXIC_daily_2002-2026.csv', 'Nasdaq Composite (index, RTH)'],
  ['NQ', 'nq_futures_daily.csv', 'NQ — Nasdaq-100 E-mini (24h)'],
  ['ES', 'es_futures_daily.csv', 'ES — S&P 500 E-mini (24h)'],
];

const out = {};
for (const [key, file, label] of sets) {
  const p = path.join(__dirname, '..', 'data', file);
  const rows = fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => {
      const [date, open, high, low, close] = l.split(',');
      return [date, +open, +high, +low, +close];
    });
  out[key] = { label, rows };
  console.log(`${key}: ${rows.length} sessions (${rows[0][0]} .. ${rows[rows.length - 1][0]})`);
}

const body = 'window.RANGE_DATA = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'web', 'data.js'), body, 'utf8');
console.log('wrote web/data.js (' + Math.round(body.length / 1024) + ' KB)');
