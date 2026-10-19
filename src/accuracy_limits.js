// Where does the hard limit on high/low accuracy come from?
// 1. Even knowing the day's exact RANGE, how well can you place the high? (oracle ceiling)
// 2. How wide is the band you need for 90% coverage today?
// 3. Does error concentrate on big-move days (i.e. would event/vol data help)?
const fs = require('fs');
const path = require('path');

const recs = fs
  .readFileSync(path.join(__dirname, '..', 'data', 'range_bands_oos.csv'), 'utf8')
  .split(/\r?\n/).slice(1).filter(Boolean)
  .map((l) => {
    const [date, open, ah, al, h10, h50, h90, l10, l50, l90] = l.split(',');
    return { date, o: +open, ah: +ah, al: +al, h10: +h10, h50: +h50, h90: +h90, l10: +l10, l50: +l50, l90: +l90 };
  });

const n = recs.length;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };

// ---- 1. position of the high inside the day's range ----
// w = (high - open) / (high - low). If you knew the range exactly, w is the only unknown.
const wHigh = recs.map((r) => (r.ah - r.o) / (r.ah - r.al));
const wLow = recs.map((r) => (r.o - r.al) / (r.ah - r.al));
console.log('=== where does the high sit inside the range? ===');
console.log(`w = (high-open)/(high-low)   mean ${mean(wHigh).toFixed(3)}  sd ${(() => { const m = mean(wHigh); return Math.sqrt(mean(wHigh.map((x) => (x - m) ** 2))); })().toFixed(3)}`);
console.log(`  p10 ${q(wHigh, 0.1).toFixed(3)}  p25 ${q(wHigh, 0.25).toFixed(3)}  median ${q(wHigh, 0.5).toFixed(3)}  p75 ${q(wHigh, 0.75).toFixed(3)}  p90 ${q(wHigh, 0.9).toFixed(3)}`);
console.log(`  fraction of days the high is within 20% of either edge: ${(wHigh.filter((w) => w < 0.2 || w > 0.8).length / n * 100).toFixed(0)}%`);

// Oracle: you are handed the exact daily range R, and must guess the high.
// Best guess is the median w; error = |w - w50| * R.
const wMed = q(wHigh, 0.5);
const oracleErrPct = recs.map((r, i) => (Math.abs(wHigh[i] - wMed) * (r.ah - r.al)) / r.o);
console.log(`\nORACLE 1 - knows the exact range, best possible placement of the high:`);
console.log(`  median error ${(q(oracleErrPct, 0.5) * 100).toFixed(3)}% of price | 90th pct ${(q(oracleErrPct, 0.9) * 100).toFixed(3)}%`);
console.log(`  our model's median error: 0.280%`);
console.log(`  -> our model is at ${((q(oracleErrPct, 0.5) * 100) / 0.28).toFixed(2)}x of this oracle's error`);

// ---- 2. band width needed for 90% coverage ----
const widths90 = recs.map((r) => (r.h90 - r.h10) / r.o);
const widthsPct = recs.map((r) => (r.h90 - r.h10) / 2 / r.o); // half-width as % of price
console.log('\n=== what a 90% band actually costs you ===');
console.log(`  90% band half-width: median +-${(q(widthsPct, 0.5) * 100).toFixed(2)}% of price (${Math.round(q(widthsPct, 0.5) * 26140)} pts at today's level)`);
console.log(`  i.e. we ALREADY hit ~90% "accuracy" for any tolerance of +-${(q(widthsPct, 0.5) * 100).toFixed(2)}% or wider.`);

// how accurate is a fixed +-0.25% tolerance?
const tol = 0.0025;
const hit = recs.filter((r) => Math.abs(r.h50 - r.ah) / r.o <= tol).length / n;
const hit1 = recs.filter((r) => Math.abs(r.h50 - r.ah) / r.o <= 0.005).length / n;
console.log(`  share of days the median forecast lands within 0.25%: ${(hit * 100).toFixed(0)}%`);
console.log(`  share of days the median forecast lands within 0.50%: ${(hit1 * 100).toFixed(0)}%`);
console.log(`  share within 0.10%: ${(recs.filter((r) => Math.abs(r.h50 - r.ah) / r.o <= 0.001).length / n * 100).toFixed(0)}%`);

// ---- 3. error by size of the day's net move ----
const withMove = recs.map((r) => ({ ...r, move: Math.abs(r.ah - r.al) / r.o }));
withMove.sort((a, b) => a.move - b.move);
const cut = Math.floor(n / 5);
console.log('\n=== error by day type (quintiles of realized range) ===');
for (let b = 0; b < 5; b++) {
  const set = withMove.slice(b * cut, Math.min(n, (b + 1) * cut));
  const e = mean(set.map((r) => Math.abs(r.h50 - r.ah) / r.o));
  const med = q(set.map((r) => Math.abs(r.h50 - r.ah) / r.o), 0.5);
  console.log(`  Q${b + 1} (range ${(set[0].move * 100).toFixed(2)}%-${(set[set.length - 1].move * 100).toFixed(2)}%): median err ${(med * 100).toFixed(2)}%  mean err ${(e * 100).toFixed(2)}%`);
}

