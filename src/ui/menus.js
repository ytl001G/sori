// Top-bar dropdown menus and context menus. Items are command names, '|' (separator), '#title' (a group title; the
// rows up to the next separator sit under it), '@recent' (recent files), or { label, run, sc } objects.
const path = require('path');
const C = require('./commands');
const S = require('../core/settings');
const { labelFor } = require('../core/shortcuts');
const { el } = require('./dialogs');
const { state } = require('../core/state');

const MENUS = {
  file: ['newProject', 'open', 'openBackup', '@recent', '|', 'save', 'saveAs', '|', 'importScript', 'unscript',
    'export', '|', 'settings'],
  edit: ['undo', 'redo', '|', 'cut', 'copy', 'paste', 'delete', '|',
    'split', 'merge', 'duplicate', 'keep', 'insertSilence', 'clipProps', '|', 'selectAll', 'deselect', '|',
    'editLine', 'prevLine', 'nextLine', 'contRecord', 'splitFile'],
  track: ['addTrack', 'dupTrack', '|', 'addVoiceTrack', 'addMusicTrack', 'addSfxTrack', '|', 'trackUp', 'trackDown',
    '|', 'sortTracks'],
  marker: ['addMarker', 'prevMarker', 'nextMarker'],
  view: ['toggleMixer', 'toggleFxPanel', 'masterFx', 'trackFx', '|', 'toggleSpec', '|',
    'zoomIn', 'zoomOut', 'zoomFit', 'zoomSel', '|', 'toggleSnap', 'toggleGrid', 'toggleMetro', '|',
    'toggleTheme', 'shortcuts'],
  fx: ['#목소리 정리', 'voiceClean', 'voiceLoud', 'voiceGaps', 'voiceDeess', 'voiceHum', 'voiceGate', 'voiceEven', '|',
    'fxGain', 'fxNormalize', 'fxFadeIn', 'fxFadeOut', 'fxSilence', 'fxReverse', '|', 'fxTempo', 'fxPitch', '|',
    'fxProfile', 'fxNoise', '|', 'fxEq', 'fxComp', 'fxReverb', 'fxEcho'],
};
// rows a menu shows only in a script project; the shortcut list still has them
const SCRIPT_ONLY = new Set(['editLine', 'prevLine', 'nextLine', 'contRecord', 'splitFile']);
// [data-list] buttons
const LISTS = { addTrack: ['addTrack', 'dupTrack', '|', 'addVoiceTrack', 'addMusicTrack', 'addSfxTrack'] };
const CONTEXT = ['cut', 'copy', 'paste', 'delete', '|', 'split', 'merge', 'duplicate', 'keep', 'clipProps', '|',
  'fxFadeIn', 'fxFadeOut', 'fxSilence', '|', 'addMarker', 'selectAll'];
const MARKER_CONTEXT = ['markerRename', 'markerDelete'];

const layer = () => document.getElementById('menu-layer');
let current = null; // { menu, btn }

function close() {
  if (!current) return;
  current.menu.remove();
  if (current.btn) current.btn.setAttribute('aria-expanded', 'false');
  current = null;
}

function expand(items) {
  const out = items.flatMap((it) => {
    if (SCRIPT_ONLY.has(it) && !state.project.script) return [];
    if (it !== '@recent') return [it];
    const r = S.get().recent;
    const item = (p, i) => ({ label: `${i + 1}. ${path.basename(p)}`, title: p, run: () => C.openRecent(p) });
    return r.length ? ['|', ...r.map(item)] : [];
  });
  return out.filter((it, i) => it !== '|' || (i > 0 && i < out.length - 1 && out[i + 1] !== '|')); // no stray lines
}

// a command name or { label, run } as a menu row: check mark, label, shortcut; greyed out when it cannot run
function menuItem(it) {
  const c = typeof it === 'string' ? C.cmds[it] : it;
  const off = c.enabled && !c.enabled(), checkable = !!c.checked, on = checkable && c.checked();
  const item = el('button', { className: 'item', type: 'button' },
    el('span', { className: 'chk', textContent: on ? '✓' : '' }), el('span', { textContent: c.label }),
    el('span', { className: 'sc', textContent: typeof it === 'string' ? labelFor(it) : '' }));
  item.setAttribute('role', checkable ? 'menuitemcheckbox' : 'menuitem');
  if (checkable) item.setAttribute('aria-checked', String(on));
  if (c.title) item.title = c.title;
  if (off) item.setAttribute('aria-disabled', 'true');
  item.onclick = () => { if (off) return; close(); typeof it === 'string' ? C.run(it) : c.run(); };
  return item;
}
// ↑/↓ move between rows, Esc closes, ←/→ in a top menu opens the next one
function menuKeys(menu, btn, e) {
  const list = [...menu.querySelectorAll('.item:not([aria-disabled="true"])')];
  const i = list.indexOf(document.activeElement);
  // every row greyed out: nothing to move to
  if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
  else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
  else if (e.key === 'Escape') { const b = current && current.btn; close(); if (b) b.focus(); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && btn && btn.closest('#menubar')) {
    const bs = [...document.querySelectorAll('#menubar button')], k = bs.indexOf(btn);
    openTop(bs[(k + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length], true);
  } else return;
  e.preventDefault(); e.stopPropagation();
}
function build(items, x, y, btn, focusFirst) {
  close();
  const menu = el('div', { className: 'menu' });
  menu.setAttribute('role', 'menu');
  let under = false;
  for (const it of expand(items)) {
    if (it === '|') { under = false; menu.append(el('div', { className: 'sep', role: 'separator' })); continue; }
    if (typeof it === 'string' && it[0] === '#') {
      under = true;
      menu.append(el('div', { className: 'head', role: 'presentation', textContent: it.slice(1) }));
      continue;
    }
    const row = menuItem(it);
    if (under) row.classList.add('under');
    menu.append(row);
  }
  menu.addEventListener('keydown', (e) => menuKeys(menu, btn, e));
  layer().append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  current = { menu, btn };
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('.item:not([aria-disabled="true"])');
  menu.tabIndex = -1;
  (focusFirst && first ? first : menu).focus();
}

function openTop(btn, focusFirst = false) {
  const r = btn.getBoundingClientRect();
  build(MENUS[btn.dataset.menu] || LISTS[btn.dataset.list], r.left, r.bottom + 4, btn, focusFirst);
}

function openContext(x, y, kind) { build(kind === 'marker' ? MARKER_CONTEXT : CONTEXT, x, y, null, true); }
const openList = (items, x, y) => build(items, x, y, null, true);

function init() {
  for (const btn of document.querySelectorAll('#menubar button, [data-list]')) {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (current && current.btn === btn) close(); else openTop(btn);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation(); openTop(btn, true);
    });
    // with a top menu open, hovering another top button opens that one
    const switchTo = () => {
      if (current && current.btn && current.btn.dataset.menu && current.btn !== btn) openTop(btn);
    };
    if (btn.dataset.menu) btn.addEventListener('mouseenter', switchTo);
  }
  window.addEventListener('mousedown', (e) => { if (current && !current.menu.contains(e.target)) close(); });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
}

const isOpen = () => !!current;

module.exports = { init, openContext, openList, close, isOpen, MENUS, CONTEXT };
