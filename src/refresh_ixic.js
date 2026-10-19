// Nasdaq Composite (^IXIC) daily history builder.
//
//   node refresh_ixic.js
//
// Pulls daily bars from Tencent's public kline endpoint (no API key), writes
// nasdaq_composite_IXIC_daily_2015-2026.csv, and prints a summary.
// Three sessions are overwritten with values confirmed by two independent feeds
// (Eastmoney quote API and api.nasdaq.com); the base feed printed corrupt bars there.
const fs = require('fs');
const path = require('path');

const OUT_CSV = path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2015-2026.csv');
const FIRST_DATE = '2015-01-01';
const END_DATE = new Date().toISOString().slice(0, 10);
const SYMBOL = 'usIXIC';

// date -> [open, high, low, close, volume]
const FIX = {
  '2015-01-21': [4641.95, 4692.46, 4629.59, 4667.42, 1847429984],
  '2015-06-30': [5000.15, 5008.76, 4968.26, 4986.87, 2034430000],
  '2016-06-27': [4664.43, 4665.04, 4574.25, 4594.44, 2659650000],
};

const shiftDays = (iso, delta) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const r2 = (x) => Math.round(x * 100) / 100;

async function fetchChunk(start, end) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${SYMBOL},day,${start},${end},640`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const block = (j && j.data && j.data['us.IXIC']) || Object.values((j && j.data) || {})[0];
      return (block && block.day) || [];
    } catch (e) {
      if (attempt === 5) throw e;
      await new Promise((res) => setTimeout(res, 700 * attempt));
    }
  }
  return [];
}

async function collect() {
  const byDate = new Map();
  let end = END_DATE;
  for (let round = 0; round < 40; round++) {
    const rows = await fetchChunk(shiftDays(end, -1460), end);
    if (!rows.length) break;
    for (const row of rows) {
      const [date, open, close, high, low, volume] = row;
      if (!byDate.has(date)) byDate.set(date, [open, high, low, close, volume]);
    }
    const first = rows[0][0];
    if (first <= FIRST_DATE) break;
    end = shiftDays(first, -1);
  }
  return byDate;
}

function writeCsv(byDate) {
  const dates = [...byDate.keys()].filter((d) => d >= FIRST_DATE && d <= END_DATE).sort();
  const lines = ['Date,Open,High,Low,Close,Volume'];
  for (const d of dates) {
    let [o, h, l, c, v] = byDate.get(d);
    if (FIX[d]) [o, h, l, c, v] = FIX[d];
    let oo = r2(+o), hh = r2(+h), ll = r2(+l), cc = r2(+c);
    hh = Math.max(hh, oo, cc);
    ll = Math.min(ll, oo, cc);
    lines.push([d, oo, hh, ll, cc, Math.round(+v)].join(','));
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n', 'utf8');
  return dates.length;
}

(async () => {
  const n = writeCsv(await collect());
  const rows = fs
    .readFileSync(OUT_CSV, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [date, open, high, low, close] = line.split(',');
      return { date, open: +open, high: +high, low: +low, close: +close };
    });
  const first = rows[0];
  const last = rows[rows.length - 1];
  const hi = rows.reduce((a, b) => (b.high > a.high ? b : a));
  const lo = rows.reduce((a, b) => (b.low < a.low ? b : a));
  const years = (new Date(last.date) - new Date(first.date)) / (365.25 * 864e5);
  console.log(`rows written : ${n}`);
  console.log(`range        : ${first.date} -> ${last.date}  (${years.toFixed(2)} years)`);
  console.log(`all-time high: ${hi.high.toLocaleString('en-US')} on ${hi.date}`);
  console.log(`all-time low : ${lo.low.toLocaleString('en-US')} on ${lo.date}`);
  console.log(`file         : ${path.basename(OUT_CSV)}`);
})().catch((e) => {
  console.error('FAILED:', (e && e.message) || e);
  process.exit(1);
});
