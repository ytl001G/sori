// Inline Phosphor (regular) SVGs for <i data-icon="name">.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'node_modules', '@phosphor-icons', 'core', 'assets', 'regular');
const cache = new Map();

function svg(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(dir, name + '.svg'), 'utf8'));
  return cache.get(name);
}

function hydrate(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]:not([data-done])')) {
    el.innerHTML = svg(el.dataset.icon);
    el.setAttribute('aria-hidden', 'true');
    el.dataset.done = '1';
  }
}

module.exports = { hydrate, svg };
