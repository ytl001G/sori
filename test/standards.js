// Size limits (and no stray control characters): every file in src/, test/ and main.js; the design rules of every
// stylesheet; spec.md's shortcut table against the code. Runs first in npm test.
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
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(l)) bad.push(`${rel}:${i + 1}: a control character (a lost escape?)`);
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

// The design rules of docs/ui-guide.md (Tokens, Type) in every stylesheet: colors only through tokens (raw ones only
// in the :root token blocks of base.css), text 12px or more, spacing and corner radius from their scales
// a negative margin pulls by a step of the scale; -1px pulls a 1px border over its neighbour
const SPACE = new Set([2, 4, 6, 8, 10, 12, 14, 16, 20, 24]), space = (v) => SPACE.has(Math.abs(v)) || v === -1;
const RADIUS = new Set([2, 4, 5, 6, 8, 999]); // 999: a pill (round ends at any height); circles use 50%
const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w-])(?:white|black)(?![\w-])/g;
function tokenBlocks(text) { // [start, end) of each ':root… { … }' block
  return [...text.matchAll(/(^|\})\s*:root[^{]*\{/g)].map((m) => [m.index, text.indexOf('}', m.index + m[0].length)]);
}
function cssRules(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const rel = path.relative(root, file), line = (i) => text.slice(0, i).split('\n').length, bad = [];
  const roots = path.basename(file) === 'base.css' ? tokenBlocks(text) : [];
  for (const m of text.matchAll(RAW)) {
    if (!roots.some(([a, b]) => m.index > a && m.index < b)) bad.push(`${rel}:${line(m.index)}: raw color ${m[0]}`);
  }
  const each = (re, ok, what) => {
    for (const m of text.matchAll(re)) {
      if (/calc\(|var\(/.test(m[2])) continue; // layout math with named widths
      for (const px of m[2].matchAll(/-?\d+(?:\.\d+)?px/g)) {
        if (!ok(parseFloat(px[0]))) bad.push(`${rel}:${line(m.index)}: ${what} ${px[0]}`);
      }
    }
  };
  each(/(font-size|(?<![\w-])font)\s*:\s*([^;}]+)/g, (v) => v >= 12, 'text under 12px:'); // the shorthand too
  each(/((?:padding|margin|gap|column-gap|row-gap)(?:-[a-z]+)?)\s*:\s*([^;}]+)/g, space,
    'spacing off the scale (2/4/6/8/10/12/14/16/20/24):');
  each(/(border(?:-[a-z]+)*-radius)\s*:\s*([^;}]+)/g, (v) => RADIUS.has(v),
    'radius off the scale (2/4/5/6/8, 999 pill):');
  // a named color in a color value (a class like .red is no color)
  for (const m of text.matchAll(/((?:color|background|border|outline|fill|stroke)[a-z-]*)\s*:\s*([^;}]+)/g)) {
    const named = m[2].match(/(?<![\w-])(?:red|green|blue|gray|grey|orange|yellow|purple|pink|silver|navy)(?![\w-])/);
    if (named) bad.push(`${rel}:${line(m.index)}: raw color ${named[0]}`);
  }
  return bad;
}
// The same rules where the screen is drawn from code (canvas text, colors set in JS): 12px text, colors from tokens
function jsRules(file) {
  const text = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file), bad = [];
  const line = (i) => text.slice(0, i).split('\n').length;
  for (const m of text.matchAll(/\.font\s*=\s*([^;]+)/g)) {
    for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
      if (+px[1] < 12) bad.push(`${rel}:${line(m.index)}: text under 12px: ${px[0]}`);
    }
  }
  const set = /(?:fillStyle|strokeStyle|shadowColor|\.style\.(?:[a-zA-Z]*[cC]olor|background))\s*=\s*([^;]+)/g;
  for (const m of text.matchAll(set)) {
    const raw = m[1].match(/['"`](#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\()/);
    if (raw) bad.push(`${rel}:${line(m.index)}: raw color ${raw[1]} (use a token: css('--name') / col)`);
  }
  return bad;
}

// docs/spec.md §6 lists the same keys as src/core/shortcuts.js DEFAULT_KEYS. A row whose text says '(Shift = …)'
// also covers its keys with Shift; '숫자패드' covers the number pad's +/-; wheel rows are the mouse
function specKeys() {
  const md = fs.readFileSync(path.join(root, 'docs', 'spec.md'), 'utf8');
  const rows = md.slice(md.indexOf('\n## 6')).split('\n').filter((l) => /^\| /.test(l) && !/^\| 키 \|/.test(l));
  const alias = { Esc: 'Escape', '메뉴 키': 'ContextMenu' }, keys = new Set();
  for (const r of rows) {
    const [cell, what] = r.slice(2, -2).split(' | ');
    const ks = cell.replace(/\([^)]*\)/g, '').split(/ \/ |, /).map((k) => k.trim()).filter((k) => k && !/휠/.test(k));
    for (const k of ks) keys.add(alias[k] || k);
    if (/\(Shift = /.test(what)) for (const k of ks) keys.add('Shift+' + k);
    if (/숫자패드/.test(cell)) { keys.add('Ctrl+Num +'); keys.add('Ctrl+Num -'); }
  }
  return keys;
}
// Korean text on screen never types an app key (설정 > 단축키 can change it): tips.js named() / hints() build it. The
// split window's own keys and Esc / Enter are fixed and may be typed.
// shortcut: finds keys with a modifier, F-keys and Space; a bare letter ('R 새 테이크') is left to review
function typedKeys(file) {
  if (file.includes(path.join('ui', 'split'))) return [];
  const K = require('../src/core/shortcuts'), rel = path.relative(root, file), bad = [];
  const keys = new Set(Object.keys(K.DEFAULT_KEYS).map(K.pretty).filter((k) => /\+|^F\d|^Space$/.test(k)));
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const code = file.endsWith('.html') ? l.replace(/<!--.*?-->/g, '') : l.replace(/^\s*\/\/.*$|\s\/\/ .*$/, '');
    const texts = file.endsWith('.html') ? [code] : [...code.matchAll(/'[^']*'|`[^`]*`|"[^"]*"/g)].map((m) => m[0]);
    if (file.endsWith('.html') && /<kbd>/.test(code)) bad.push(`${rel}:${i + 1}: a key typed in <kbd> (made in code)`);
    for (const t of texts.filter((x) => /[가-힣]/.test(x))) {
      const hit = [...keys].find((k) => new RegExp(`(^|[^\\w+])${k.replace(/[+]/g, '\\+')}(?![\\w+])`).test(t));
      if (hit) bad.push(`${rel}:${i + 1}: the key ${hit} typed in text (use named() / hints() from src/ui/tips.js)`);
    }
  });
  return bad;
}

// shortcut: compares the keys only, not which command each runs (F6 and F8 swapped in the code would pass); upgrade
// by matching each row's '동작' text to the command labels if that slip ever happens
function keyTable() {
  const K = require('../src/core/shortcuts'), code = new Set(Object.keys(K.DEFAULT_KEYS).map(K.pretty));
  const spec = specKeys(), only = (a, b) => [...a].filter((k) => !b.has(k));
  return [...only(code, spec).map((k) => `docs/spec.md §6: no row for ${k} (shortcuts.js has it)`),
    ...only(spec, code).map((k) => `docs/spec.md §6: ${k} is not in shortcuts.js DEFAULT_KEYS`)];
}

const every = [...files(path.join(root, 'src')), ...files(path.join(root, 'test')), path.join(root, 'main.js')];
const styles = files(path.join(root, 'src', 'ui', 'styles'));
const drawn = [...files(path.join(root, 'src', 'ui')), ...files(path.join(root, 'src', 'audio'))]
  .filter((f) => f.endsWith('.js'));
const screen = [...drawn.filter((f) => f.includes(path.join('src', 'ui'))), path.join(root, 'src', 'ui', 'index.html')];
const all = [...every.flatMap(check), ...styles.flatMap(cssRules), ...drawn.flatMap(jsRules), ...keyTable(),
  ...screen.flatMap(typedKeys)];
if (all.length) {
  console.log(all.join('\n') + `\n\n${all.length} breaches of the size limits and design rules`);
  process.exit(1);
}
console.log('size limits, design rules and the shortcut table ok');
