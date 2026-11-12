// Right effect panel (spec §5-1): the always-on effects of one channel (master or a track).
// Changes are live (C.setFx) and not undo steps.
const C = require('../commands');
const P = require('../../core/fxparams');
const eqgraph = require('./eq');
const { el, fmt } = require('../dialogs');
const { state, trackById, changed } = require('../../core/state');

let root, body, picker, sig = '', cards = [];

const tgt = () => state.ui.fxTarget;
// script mode: 'char:<name>' = that character's effect set
const charOf = (k) => {
  const s = state.project.script;
  return s && String(k).startsWith('char:') ? s.chars[k.slice(5)] : null;
};
const charNames = () => {
  const s = state.project.script;
  return s ? [...new Set(s.lines.map((l) => l.char))] : [];
};
function values(kind) {
  const m = state.project.master;
  if (tgt() === 'master') return kind === 'gain' ? { gainDb: m.gainDb } : m.fx[kind];
  if (charOf(tgt())) return charOf(tgt()).fx[kind];
  const t = trackById(tgt());
  return t ? t.fx[kind] : P.clampFx(kind);
}
const show = (fl, v) => {
  if (fl.key === 'lowcut' && v === 0) return '꺼짐';
  if (fl.key === 'highcut' && v >= 20000) return '꺼짐';
  return `${fmt(v, fl.step)} ${fl.unit}`.trim();
};

function slider(fl, kind, label) {
  const id = `fx-${kind}-${fl.key}`;
  const r = el('input', { type: 'range', id, min: fl.min, max: fl.max, step: fl.step, className: 'frange' });
  const val = el('span', { className: 'fval' });
  r.oninput = () => C.setFx(tgt(), kind, { [fl.key]: +r.value });
  r.ondblclick = () => { r.value = fl.value; C.setFx(tgt(), kind, { [fl.key]: fl.value }); };
  r.title = '더블클릭: 기본값';
  const row = el('div', { className: 'frow' }, el('label', { htmlFor: id, textContent: label || fl.label }), r, val);
  return { row, r, val, fl };
}

function card(kind) {
  const sec = el('section', { className: 'fxcard' });
  const sw = el('button', { className: 'switch', type: 'button' });
  sw.setAttribute('aria-label', P.LABELS[kind] + ' 켜기');
  sw.onclick = () => C.setFx(tgt(), kind, { on: !values(kind).on });
  const sel = el('select', { className: 'preset' }, el('option', { value: '', textContent: '직접 조절' }),
    ...P.PRESETS[kind].map((p, i) => el('option', { value: String(i), textContent: p.name })));
  sel.setAttribute('aria-label', P.LABELS[kind] + ' 프리셋');
  sel.onchange = () => {
    const p = P.PRESETS[kind][+sel.value];
    if (p) C.setFx(tgt(), kind, { ...p.values, on: true });
  };
  const fbody = el('div', { className: 'fxbody' });
  const eq = { get: () => values('eq'), set: (patch) => C.setFx(tgt(), 'eq', patch), height: 140 };
  const graph = kind === 'eq' ? eqgraph.mount(fbody, eq) : null;
  const rows = P.FIELDS[kind].map((fl) => slider(fl, kind));
  fbody.append(...rows.map((x) => x.row));
  sec.append(el('div', { className: 'fxhead' }, sw, el('h3', { textContent: P.LABELS[kind] }), sel), fbody);
  return { kind, sec, sw, sel, fbody, rows, graph, last: '' };
}

function build() {
  cards = [];
  body.replaceChildren();
  const master = tgt() === 'master';
  if (master) {
    const g = slider(P.MASTER_GAIN, 'gain');
    const head = el('div', { className: 'fxhead' }, el('h3', { textContent: '마스터 볼륨' }));
    body.append(el('section', { className: 'fxcard on' }, head, el('div', { className: 'fxbody' }, g.row)));
    cards.push({ kind: 'gain', rows: [g] });
  }
  for (const kind of master ? P.MASTER_KINDS : P.TRACK_KINDS) {
    const c = card(kind);
    cards.push(c);
    body.append(c.sec);
  }
}

function rebuildPicker() {
  picker.replaceChildren(el('option', { value: 'master', textContent: '마스터 (전체 소리)' }), ...(state.project.script
    ? charNames().map((n) => el('option', { value: 'char:' + n, textContent: '캐릭터 · ' + n }))
    : state.project.tracks.map((t) => el('option', { value: t.id, textContent: t.name }))));
  picker.value = tgt();
}

// which channel is shown: color band + card edges (track color / master --secondary like its mixer strip) + title (spec
// §5-1)
function labelChannel() {
  const t = trackById(tgt()), c = charOf(tgt());
  root.style.setProperty('--ch', c ? c.color : t ? t.color : 'var(--secondary)');
  const title = c ? `캐릭터 효과 · ${tgt().slice(5)}` : t ? `트랙 효과 · ${t.name}` : '마스터 효과 · 전체 소리에';
  const where = c ? '이 캐릭터의 모든 대사 · 테이크에 걸려요.' : t ? '이 트랙에만 걸려요.' : '모든 트랙이 섞인 뒤에 걸려요.';
  document.getElementById('fx-title').textContent = title;
  document.getElementById('fx-note').textContent = where + ' 원본은 그대로고, 재생과 내보내기에 모두 들어가요.';
}

// the two tabs: 효과 and 실행취소 기록 (panels/history.js fills its pane)
function tabs() {
  const hist = state.ui.fxTab === 'history';
  root.classList.toggle('hist', hist);
  for (const t of root.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === state.ui.fxTab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  document.getElementById('fx-pane').hidden = hist;
  document.getElementById('hist-pane').hidden = !hist;
  return hist;
}
function render() {
  root.hidden = !state.ui.fxPanel;
  if (root.hidden || tabs()) return;
  if (tgt() !== 'master' && !trackById(tgt()) && !charOf(tgt())) state.ui.fxTarget = 'master';
  // the picker and title follow the channels' names and colors; the cards are rebuilt for another channel
  const sc = state.project.script, { tracks } = state.project; // a character's color can change (sori script color)
  const chans = sc ? charNames().map((n) => n + sc.chars[n].color) : tracks.map((t) => t.id + ':' + t.name + t.color);
  const s = tgt() + '|' + chans.join(',');
  if (s !== sig) {
    sig = s; rebuildPicker(); labelChannel();
    if (!cards.length || cards.tgt !== tgt()) { build(); cards.tgt = tgt(); }
  }
  for (const c of cards) {
    const v = values(c.kind);
    if (c.sw) {
      c.sw.setAttribute('aria-pressed', String(v.on));
      c.sec.classList.toggle('on', v.on);
      c.fbody.hidden = !v.on;
      const m = P.PRESETS[c.kind].findIndex((p) => p.name === P.matchPreset(c.kind, v));
      if (document.activeElement !== c.sel) c.sel.value = m >= 0 ? String(m) : '';
    }
    for (const x of c.rows) {
      if (document.activeElement !== x.r) x.r.value = v[x.fl.key];
      x.val.textContent = show(x.fl, v[x.fl.key]);
    }
    const key = JSON.stringify(v) + document.documentElement.dataset.theme; // colors come from the theme
    if (c.graph && c.last !== key && v.on) { c.last = key; c.graph.update(); }
  }
}

function init() {
  root = document.getElementById('fxpanel');
  body = document.getElementById('fx-body');
  picker = document.getElementById('fx-target');
  picker.onchange = () => { state.ui.fxTarget = picker.value; changed(); };
  // a key or a tab click shows its tab; on the tab shown the same key closes the panel, the X always closes
  const cmd = (tab) => (tab === 'history' ? 'toggleHistory' : 'toggleFxPanel');
  document.getElementById('fx-close').onclick = () => C.run(cmd(state.ui.fxTab));
  for (const t of root.querySelectorAll('[role="tab"]')) {
    t.onclick = () => { if (t.dataset.tab !== state.ui.fxTab) C.run(cmd(t.dataset.tab)); };
    // arrow keys move between the tabs (WAI tabs pattern)
    t.onkeydown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const other = root.querySelector(`[role="tab"]:not([data-tab="${t.dataset.tab}"])`);
      C.run(cmd(other.dataset.tab));
      other.focus();
      e.preventDefault(); e.stopPropagation(); // not also the app's ←/→ (the play position)
    };
  }
}

module.exports = { init, render };
