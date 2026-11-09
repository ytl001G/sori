// The settings window's controls: a labelled row, a choice group and an on/off switch, each bound to one setting.
const S = require('../core/settings');
const { el } = require('./dialogs');

function row(label, control, hint) {
  // '끄기' alone does not say which setting
  if (control.getAttribute('role') === 'group' && !control.hasAttribute('aria-label')) {
    control.setAttribute('aria-label', label);
  }
  const tip = hint ? el('div', { className: 'shint', textContent: hint }) : null;
  return el('div', { className: 'srow' },
    el('div', { className: 'slabel', textContent: label }), el('div', { className: 'sctl' }, control, tip));
}

function seg(key, options, after) {
  const box = el('div', { className: 'choices' });
  box.setAttribute('role', 'group');
  const sync = () => box.querySelectorAll('button')
    .forEach((b, i) => b.setAttribute('aria-pressed', String(S.get()[key] === options[i][0])));
  for (const [v, label] of options) {
    const b = el('button', { type: 'button', textContent: label });
    b.onclick = () => { S.set({ [key]: v }); sync(); after && after(v); };
    box.append(b);
  }
  sync();
  return box;
}

function toggle(key, label) {
  const b = el('button', { className: 'switch', type: 'button' });
  b.setAttribute('aria-label', label);
  const sync = () => b.setAttribute('aria-pressed', String(!!S.get()[key]));
  b.onclick = () => { S.set({ [key]: !S.get()[key] }); sync(); };
  sync();
  return b;
}

const button = (text, cls = 'btn') => el('button', { className: cls, type: 'button', textContent: text });

module.exports = { row, seg, toggle, button };
