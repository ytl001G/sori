// Size limits: every file in src/, test/ and main.js. Runs first in npm test.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const MAX_FILE = 300, MAX_FN = 40, MAX_LINE = 120;
const root = path.join(__dirname, '..');
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(js|css|html)$/.test(e.name) ? [p] : [];
  });
}
// every function node, nested ones too (a callback inside a long function is measured on its own as well)
function functions(node, out = []) {
  if (!node || typeof node.type !== 'string') return out;
  if (FN.has(node.type)) out.push(node);
  for (const v of Object.values(node)) {
    for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x === 'object') functions(x, out);
  }
  return out;
}

function check(file) {
  const text = fs.readFileSync(file, 'utf8'), lines = text.split('\n'), rel = path.relative(root, file);
  const bad = [];
  if (text.endsWith('\n')) lines.pop();
  if (lines.length > MAX_FILE) bad.push(`${rel}: ${lines.length} lines (max ${MAX_FILE}): split it by job`);
  lines.forEach((l, i) => {
    if (l.length > MAX_LINE) bad.push(`${rel}:${i + 1}: ${l.length} chars (max ${MAX_LINE})`);
  });
  if (!file.endsWith('.js')) return bad;
  const ast = acorn.parse(text, { ecmaVersion: 'latest', locations: true, allowHashBang: true });
  for (const f of functions(ast)) {
    const n = f.loc.end.line - f.loc.start.line + 1;
    const name = (f.id && f.id.name) || '';
    if (n > MAX_FN) bad.push(`${rel}:${f.loc.start.line}: function ${name} ${n} lines (max ${MAX_FN})`);
  }
  return bad;
}

const all = [...files(path.join(root, 'src')), ...files(path.join(root, 'test')), path.join(root, 'main.js')]
  .flatMap(check);
if (all.length) {
  console.log(all.join('\n') + `\n\n${all.length} size-limit breaches`);
  process.exit(1);
}
console.log('size limits ok');
