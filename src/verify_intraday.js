// Verify a vendor intraday file before any result depends on it, then measure the
// overnight/cash variance split that the intraday model currently guesses at.
//
//   node src/verify_intraday.js <csv> [--split]
//
// Session convention for CME equity index futures: a trading session opens 18:00 ET
// and closes 17:00 ET the next day. So a bar stamped before 18:00 belongs to the
// session that began the previous evening.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('usage: node src/verify_intraday.js <csv>'); process.exit(1); }
const lines = fs.readFileSync(path.resolve(file), 'utf8').split(/\r?\n/).filter(Boolean);
const header = lines[0].split(',').map((h) => h.trim());
console.log(`file    : ${path.basename(file)}`);
console.log(`header  : ${header.join(', ')}`);
console.log(`lines   : ${lines.length - 1} data rows`);

const idx = (name) => header.findIndex((h) => h.toLowerCase().replace(/[^a-z]/g, '') === name);
const ci = {
  ts: 0, o: idx('open'), h: idx('high'), l: idx('low'), c: idx('close'), v: idx('volume'),
};

function parseTs(s) {
  // "12/26/2022 18:01"  ->  minutes since epoch, plus the wall-clock fields
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, mo, d, y, hh, mm] = m;
  return {
    y: +y, mo: +mo, d: +d, hh: +hh, mi: +mm,
    key: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    mins: +hh * 60 + +mm,
  };
}

const bars = [];
let bad = 0, nonMono = 0, ohlcBad = 0, dupes = 0;
let prevAbs = -1;
const seen = new Set();
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  const t = parseTs(c[ci.ts]);
  if (!t) { bad++; continue; }
  const abs = Date.UTC(t.y, t.mo - 1, t.d, t.hh, t.mi) / 60000;
  if (abs <= prevAbs) { if (abs === prevAbs) dupes++; else nonMono++; }
  prevAbs = Math.max(prevAbs, abs);
  const o = +c[ci.o], h = +c[ci.h], l = +c[ci.l], cl = +c[ci.c], v = +c[ci.v];
  if (!(h >= l) || !(h >= o) || !(h >= cl) || !(l <= o) || !(l <= cl)) ohlcBad++;
  bars.push({ t, abs, o, h, l, c: cl, v });
}

console.log(`\nINTEGRITY`);
console.log(`  unparseable timestamps : ${bad}`);
console.log(`  out-of-order rows      : ${nonMono}`);
console.log(`  duplicate timestamps   : ${dupes}`);
console.log(`  OHLC inconsistent      : ${ohlcBad}`);

// session grouping
const sessionOf = (t) => {
  if (t.mins >= 18 * 60) return t.key;
  const dt = new Date(Date.UTC(t.y, t.mo - 1, t.d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
};
const bySession = new Map();
for (const b of bars) {
  const s = sessionOf(b.t);
  if (!bySession.has(s)) bySession.set(s, []);
  bySession.get(s).push(b);
}
const sessionKeys = [...bySession.keys()].sort();
console.log(`\nCOVERAGE`);
console.log(`  first bar    : ${bars[0].t.key} ${String(Math.floor(bars[0].t.mins / 60)).padStart(2, '0')}:${String(bars[0].t.mins % 60).padStart(2, '0')}`);
console.log(`  last bar     : ${bars[bars.length - 1].t.key} ${String(Math.floor(bars[bars.length - 1].t.mins / 60)).padStart(2, '0')}:${String(bars[bars.length - 1].t.mins % 60).padStart(2, '0')}`);
console.log(`  sessions     : ${sessionKeys.length}   (${sessionKeys[0]} -> ${sessionKeys[sessionKeys.length - 1]})`);

const counts = sessionKeys.map((k) => bySession.get(k).length).sort((a, b) => a - b);
const median = counts[Math.floor(counts.length / 2)];
console.log(`  bars/session : min ${counts[0]}  median ${median}  max ${counts[counts.length - 1]}`);
const rthBars = bars.filter((b) => b.t.mins >= 9 * 60 + 30 && b.t.mins < 16 * 60).length;
const onBars = bars.filter((b) => b.t.mins >= 18 * 60 || b.t.mins < 9 * 60 + 30).length;
const lateBars = bars.filter((b) => b.t.mins >= 16 * 60 && b.t.mins < 18 * 60).length;
console.log(`  block counts : overnight ${onBars}   RTH ${rthBars}   after-16:00 ${lateBars}`);

// a full session should hold ~1380 one-minute bars
const truncated = sessionKeys.filter((k) => bySession.get(k).length < 0.9 * median);
console.log(`  sessions < 90% of median (holidays/half-days/truncation): ${truncated.length}`);
if (truncated.length && truncated.length < 20) console.log(`    ${truncated.join(', ')}`);

if (!process.argv.includes('--split')) process.exit(0);

// ---------------- overnight vs cash variance ----------------
// Realised variance on 1-minute log returns, computed WITHIN each block so no
// return spans a block boundary.
const acc = { on: 0, rth: 0, late: 0 };
const per = [];
for (const k of sessionKeys) {
  const s = bySession.get(k).sort((a, b) => a.abs - b.abs);
  const v = { on: 0, rth: 0, late: 0 };
  let prev = null;
  for (const b of s) {
    const block = (b.t.mins >= 18 * 60 || b.t.mins < 9 * 60 + 30) ? 'on'
      : (b.t.mins >= 9 * 60 + 30 && b.t.mins < 16 * 60) ? 'rth' : 'late';
    if (prev && prev.block === block && prev.c > 0 && b.c > 0) {
      const r = Math.log(b.c / prev.c);
      if (Number.isFinite(r)) v[block] += r * r;
    }
    prev = { block, c: b.c };
  }
  acc.on += v.on; acc.rth += v.rth; acc.late += v.late;
  const tot = v.on + v.rth + v.late;
  if (tot > 0) per.push(v.rth / tot);
}
const total = acc.on + acc.rth + acc.late;
console.log(`\nVARIANCE SPLIT (Test 1)`);
console.log(`  overnight (18:00-09:30) ${(acc.on / total * 100).toFixed(1)}% of variance in ${((23 - 6.5 - 1) / 23 * 100).toFixed(0)}% of clock`);
console.log(`  cash      (09:30-16:00) ${(acc.rth / total * 100).toFixed(1)}% of variance in ${(6.5 / 23 * 100).toFixed(0)}% of clock`);
console.log(`  after 16:00             ${(acc.late / total * 100).toFixed(1)}%`);
const sorted = [...per].sort((a, b) => a - b);
console.log(`\n  per-session cash share: p10 ${(sorted[Math.floor(0.1 * sorted.length)] * 100).toFixed(1)}%  median ${(sorted[Math.floor(0.5 * sorted.length)] * 100).toFixed(1)}%  p90 ${(sorted[Math.floor(0.9 * sorted.length)] * 100).toFixed(1)}%`);
console.log(`  ASSUMED in the indicator: 0.70`);
const med = sorted[Math.floor(0.5 * sorted.length)];
const fits = med >= 0.55 && med <= 0.85;
console.log(`  fitted median ${med.toFixed(3)} -> ${fits ? 'inside the 0.55-0.85 acceptance window' : 'OUTSIDE the window: a constant is the wrong model'}`);
