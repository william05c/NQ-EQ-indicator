// Build three datasets:
//   nasdaq_composite_IXIC_daily_2002-2026.csv   ~24 years of the index (api.nasdaq.com)
//   nq_futures_daily.csv                        Nasdaq-100 E-mini continuous daily bars
//   es_futures_daily.csv                        S&P 500 E-mini continuous daily bars
const fs = require('fs');
const path = require('path');

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

const num = (s) => (s == null || s === '' || s === '--' ? NaN : Number(String(s).replace(/,/g, '').trim()));
const iso = (us) => { const [m, d, y] = us.split('/'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };

async function fetchJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((res) => setTimeout(res, 600 * i));
    }
  }
}

async function buildIndex() {
  const chunks = [
    ['2002-01-01', '2005-12-31'], ['2006-01-01', '2009-12-31'], ['2010-01-01', '2013-12-31'],
    ['2014-01-01', '2017-12-31'], ['2018-01-01', '2021-12-31'], ['2022-01-01', '2026-12-31'],
  ];
  const byDate = new Map();
  for (const [from, to] of chunks) {
    const url = `https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=${from}&todate=${to}&limit=9999`;
    const j = await fetchJson(url);
    const rows = j?.data?.tradesTable?.rows || [];
    for (const r of rows) {
      const d = iso(r.date);
      const o = num(r.open), h = num(r.high), l = num(r.low), c = num(r.close);
      if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue; // drop placeholder holiday rows
      byDate.set(d, { d, o, h, l, c });
    }
    console.log(`  ${from}..${to}: ${rows.length} rows (running total ${byDate.size})`);
    await new Promise((res) => setTimeout(res, 400));
  }
  const all = [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  const lines = ['Date,Open,High,Low,Close'];
  for (const r of all) {
    const f = (v) => (Math.round(v * 100) / 100).toFixed(2);
    lines.push([r.d, f(r.o), f(r.h), f(r.l), f(r.c)].join(','));
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'nasdaq_composite_IXIC_daily_2002-2026.csv'), lines.join('\n') + '\n', 'utf8');
  console.log(`IXIC 24y: ${all.length} sessions ${all[0].d} -> ${all[all.length - 1].d}`);
}

async function buildFuture(symbol, outName) {
  const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${symbol}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${symbol}&_=2026`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn/' } });
  const txt = await r.text();
  const start = txt.indexOf('([') + 1;
  const end = txt.lastIndexOf('])') + 1;
  const arr = JSON.parse(txt.slice(start, end));
  const clean = arr
    .map((x) => ({ d: x.date, o: +x.open, h: +x.high, l: +x.low, c: +x.close }))
    .filter((x) => x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0 && x.h > x.l) // drop flat placeholders
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  const seen = new Set();
  const uniq = clean.filter((x) => (seen.has(x.d) ? false : (seen.add(x.d), true)));
  const lines = ['Date,Open,High,Low,Close'];
  for (const x of uniq) {
    const f = (v) => (Math.round(v * 100) / 100).toFixed(2);
    lines.push([x.d, f(x.o), f(x.h), f(x.l), f(x.c)].join(','));
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', outName), lines.join('\n') + '\n', 'utf8');
  const dropped = arr.length - uniq.length;
  console.log(`${symbol}: ${uniq.length} sessions ${uniq[0].d} -> ${uniq[uniq.length - 1].d}  (dropped ${dropped} flat/dup rows)`);
}

(async () => {
  console.log('index (Nasdaq Composite):');
  await buildIndex();
  console.log('futures:');
  await buildFuture('NQ', 'nq_futures_daily.csv');
  await buildFuture('ES', 'es_futures_daily.csv');
})().catch((e) => { console.error('FAILED:', e && e.message || e); process.exit(1); });
