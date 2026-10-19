// Static checks on the Pine files. Catches the failure modes that compile fine and
// then misbehave on the chart.
//
//   node src/pine_lint.js
//
// Exit code 1 on failure, so it can gate a commit or CI step.
const fs = require('fs');
const path = require('path');

const FILES = [
  path.join(__dirname, '..', 'pine', 'nasdaq_range_forecaster.pine'),
  path.join(__dirname, '..', 'pine', 'nasdaq_range_intraday.pine'),
  path.join(__dirname, '..', 'pine', 'nasdaq_range_nowcast.pine'),
];

let failed = 0;

for (const file of FILES) {
  const name = path.basename(file);
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const problems = [];
  const warnings = [];

  // --- structure ---
  if (!/^\/\/@version=5/.test(src)) problems.push('missing //@version=5');
  if (!/^indicator\(/m.test(src)) problems.push('missing indicator() declaration');

  // --- every declared array that gates a plot must be fed ---
  const declaredArrays = [...src.matchAll(/var\s+(\w+)\s*=\s*array\.new_float\(\)/g)].map((m) => m[1]);
  for (const a of declaredArrays) {
    if (!new RegExp('array\\.push\\(\\s*' + a + '\\s*,').test(src)) {
      problems.push(`array "${a}" is declared but never pushed — bands would stay empty`);
    }
  }

  // --- inputs must be used ---
  const inputs = [...src.matchAll(/^(\w+)\s*=\s*input\.\w+\(/gm)].map((m) => m[1]);
  for (const id of inputs) {
    const uses = lines.filter((l) => new RegExp('\\b' + id + '\\b').test(l) && !new RegExp('^' + id + '\\s*=\\s*input').test(l.trim())).length;
    if (uses === 0) problems.push(`input "${id}" is declared but never used`);
  }

  // --- plots ---
  const plots = (src.match(/plot\(/g) || []).length;
  if (plots === 0) problems.push('no plot() calls');

  // --- ta.* inside a conditional block breaks stateful functions ---
  let inConditional = false;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (/^(if|else)\b/.test(t) && /$/.test(t)) inConditional = true;
    if (t === '' || (/^\S/.test(l) && !/^(if|else)/.test(t))) inConditional = false;
    if (inConditional && /ta\.(sma|ema|stdev|rsi|atr|highest|lowest)/.test(l)) {
      problems.push(`line ${i + 1}: ta.* called inside a conditional block — move it to global scope`);
    }
  });

  // --- lookahead discipline on request.security ---
  if (/request\.security/.test(src) && !/lookahead\s*=\s*barmerge\.lookahead_off/.test(src)) {
    problems.push('request.security without lookahead = barmerge.lookahead_off (repainting risk)');
  }

  // --- tabs / smart quotes / stray BOM ---
  if (src.charCodeAt(0) === 0xfeff) problems.push('file starts with a UTF-8 BOM');
  const weird = lines.filter((l) => /[\u201C\u201D\u2018\u2019\t]/.test(l));
  if (weird.length) warnings.push(`${weird.length} line(s) contain tabs or smart quotes`);

  // --- balanced parentheses per code line ---
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    const open = (code.match(/\(/g) || []).length;
    const close = (code.match(/\)/g) || []).length;
    if (open !== close) problems.push(`line ${i + 1}: unbalanced parentheses`);
  });

  console.log(`\n${name} — ${lines.length} lines, ${declaredArrays.length} state arrays, ${plots} plots`);
  warnings.forEach((w) => console.log('  warning: ' + w));
  if (problems.length) {
    problems.forEach((p) => console.log('  FAIL: ' + p));
    failed++;
  } else {
    console.log('  ok');
  }
}

console.log(failed ? `\n${failed} file(s) FAILED` : '\nall files passed');
process.exit(failed ? 1 : 0);
