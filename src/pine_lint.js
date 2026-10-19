// Static checks on the Pine file. Catches the failure mode where the script compiles,
// loads onto the chart, and draws nothing — because a state array is never fed.
//
//   node src/pine_lint.js
//
// Exit code 1 on failure, so it can gate a commit or CI step.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'pine', 'nasdaq_range_forecaster.pine');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const problems = [];
const warnings = [];

// 1. every array that gates a plot must be pushed somewhere
const declaredArrays = [...src.matchAll(/var\s+(\w+)\s*=\s*array\.new_float\(\)/g)].map((m) => m[1]);
if (!declaredArrays.length) problems.push('no `var x = array.new_float()` declarations found');
for (const a of declaredArrays) {
  const pushed = new RegExp('array\\.push\\(\\s*' + a + '\\s*,').test(src);
  if (!pushed) problems.push(`array "${a}" is declared but never pushed — bands would stay empty (all plots na)`);
}

// 2. any input that is declared should actually be used somewhere else
const inputs = [...src.matchAll(/^(\w+)\s*=\s*input\.\w+\(/gm)].map((m) => m[1]);
for (const id of inputs) {
  const uses = lines.filter((l) => new RegExp('\\b' + id + '\\b').test(l) && !l.trim().startsWith(id + ' =') && !l.includes('input.')).length;
  if (uses === 0) problems.push(`input "${id}" is declared but never used`);
}

// 3. the plots we expect must exist
const plots = (src.match(/^\s*\w*\s*plot\(/gm) || []).length + (src.match(/=\s*plot\(/g) || []).length;
if (plots < 6) problems.push(`expected 6 plot() calls, found ${plots}`);

// 4. version + entry point
if (!/^\/\/@version=5/.test(src)) problems.push('missing //@version=5');
if (!/indicator\(/.test(src)) problems.push('missing indicator() declaration');

// 5. no obvious lookahead on the outcome we predict
if (/\bhigh\s*\[\s*-/.test(src)) problems.push('negative history reference (lookahead)');

// 6. tabs / smart quotes that break Pine
const weird = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /[\u201C\u201D\u2018\u2019\t]/.test(l));
if (weird.length) warnings.push(`${weird.length} line(s) contain tabs or smart quotes (Pine dislikes both)`);

// 7. unbalanced parentheses per line (comments excluded)
lines.forEach((l, i) => {
  const code = l.replace(/\/\/.*$/, '');
  const open = (code.match(/\(/g) || []).length;
  const close = (code.match(/\)/g) || []).length;
  if (open !== close) problems.push(`line ${i + 1}: unbalanced parentheses`);
});

console.log(`checked ${path.basename(file)} — ${lines.length} lines, ${declaredArrays.length} state arrays, ${plots} plots`);
if (warnings.length) warnings.forEach((w) => console.log('  warning: ' + w));
if (problems.length) {
  problems.forEach((p) => console.log('  FAIL: ' + p));
  process.exit(1);
}
console.log('  ok: no structural problems found');
