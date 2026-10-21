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
  path.join(__dirname, '..', 'pine', 'nasdaq_range_all.pine'),
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
if (failed) process.exit(1);

// ---------------- CROSS-FILE identifier check ----------------
// Catches the bug class where a script references a variable that only exists in
// a DIFFERENT script (e.g. hiNow10 copied into the unified file as iHi10).
// Builtins are never declared in any file, so they cannot trigger this.
function declaredNames(src) {
  const out = new Set();
  const lines = src.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.replace(/\/\/.*$/, '');
    let m = line.match(/^\s*\[([^\]]+)\]\s*=/);
    if (m) { m[1].split(',').forEach((n) => out.add(n.trim())); continue; }
    m = line.match(/^\s*(?:var|varip)\s+(?:float|int|bool|string|color|line|label|box|table|polyline)\s+(\w+)\s*=/);
    if (m) { out.add(m[1]); continue; }
    m = line.match(/^\s*(\w+)\s*=/);
    if (m) { out.add(m[1]); continue; }
    m = line.match(/^\s*(\w+)\s*\(([^)]*)\)\s*=>/);
    if (m) {
      out.add(m[1]);
      m[2].split(',').forEach((a) => { const n = a.trim().split(/\s+/).pop(); if (n) out.add(n); });
      continue;
    }
    m = line.match(/^\s*(\w+)\s*:=\s*/);
    if (m) { out.add(m[1]); }
  }
  return out;
}

function usedNames(src) {
  const cleaned = src
    .replace(/\/\/.*$/gm, '')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
  const out = new Set();
  const re = /([.\w]*)/g;
  const idRe = /[A-Za-z_]\w*/g;
  let m;
  while ((m = idRe.exec(cleaned)) !== null) {
    const start = m.index;
    if (start > 0 && cleaned[start - 1] === '.') continue;
    out.add(m[0]);
  }
  return out;
}

const filesSrc = FILES.map((f) => ({ file: f, src: fs.readFileSync(f, 'utf8') }));
const declByFile = new Map(filesSrc.map((f) => [f.file, declaredNames(f.src)]));
const allDecl = new Set();
declByFile.forEach((s) => s.forEach((n) => allDecl.add(n)));

let leaks = 0;
for (const { file, src } of filesSrc) {
  const mine = declByFile.get(file);
  const leaksHere = [];
  for (const u of usedNames(src)) {
    if (mine.has(u)) continue;
    if (!allDecl.has(u)) continue;
    leaksHere.push(u);
  }
  if (leaksHere.length) {
    leaks += leaksHere.length;
    console.log(`${path.basename(file)}: UNDEFINED (declared only in another script): ${leaksHere.join(', ')}`);
  }
}
if (leaks) {
  console.log(`\n${leaks} undefined identifier(s) - this will not compile`);
  process.exitCode = 1;
} else {
  console.log('cross-file identifier check: ok');
}
// ---------------- NORMAL CDF SCALING ----------------
// The A&S 7.1.26 polynomial computes erf(x); Phi needs erf(x/sqrt(2)). Missing the
// /sqrt(2) silently understates every tail probability by a wide margin.
{
  let bad = 0;
  for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/normCdf\s*\(/.test(src)) continue;
    if (!/0\.70710678/.test(src)) {
      console.log(`${path.basename(file)}: normCdf present but no 1/sqrt(2) scaling -> Phi(x*sqrt(2))`);
      bad++;
    }
  }
  if (bad) { console.log(`\n${bad} file(s) with a wrong normal CDF`); process.exit(1); }
  console.log('normal CDF scaling: ok');
}