// Ctrl+F 찾기 box (spec §2, ui-guide): floats at the top right of the timeline. Typing goes to the first match from
// here (only the count while recording: going to another line would stop it), Enter / Shift+Enter or ↑ ↓ walk the
// matches, Esc closes. 고급 unfolds: clip names, marker names, memo (script). Opens empty and folded every time.
const C = require('../commands');
const { el } = require('../dialogs');
const { hydrate } = require('../icons');
const { state } = require('../../core/state');

let box = null, input, count, more, adv;
const KEYS = [['clips', '클립 이름'], ['markers', '마커 이름'], ['memo', '대사 메모']];
const checked = (k) => adv.querySelector(`input[data-k=${k}]`).checked;
const opts = () => ({ clips: checked('clips'), markers: checked('markers'),
  memo: !!state.project.script && checked('memo') });

// one search at a time, in order (going to a line waits for its takes); recount: the count only, nothing moves
let queue = Promise.resolve();
function search(dir, recount = false) {
  queue = queue.then(async () => {
    const q = input.value, r = await C.find(q, opts(), dir, !recount && !(dir === 0 && state.recording));
    count.textContent = !q.trim() ? '' : r.at >= 0 ? `${r.at + 1}/${r.count}` : `${r.count}개`;
    count.classList.toggle('none', !!q.trim() && !r.count);
  }).catch(() => {});
}
function close() {
  if (!box || box.hidden) return;
  box.hidden = true;
  document.getElementById('timeline').focus();
}
const data = (e, k, v) => { e.dataset[k] = v; return e; }; // el() cannot set dataset
const iconBtn = (icon, label, onclick) => el('button', { className: 'icon', type: 'button', title: label,
  ariaLabel: label, onclick }, data(el('i'), 'icon', icon));
function build() {
  input = el('input', { type: 'text', placeholder: '찾기', ariaLabel: '찾기', spellcheck: false });
  count = el('span', { className: 'find-count mono', ariaLive: 'polite' });
  more = el('button', { className: 'btn-small find-more', type: 'button', textContent: '고급' });
  adv = el('div', { className: 'find-adv', hidden: true }, ...KEYS.map(([k, label]) => data(el('label', {},
    data(el('input', { type: 'checkbox', onchange: () => search(0) }), 'k', k), label), 'k', k)));
  more.onclick = () => { adv.hidden = !adv.hidden; more.setAttribute('aria-expanded', String(!adv.hidden)); };
  box = el('div', { id: 'find', role: 'search', hidden: true },
    el('div', { className: 'find-row' }, input, count, iconBtn('caret-up', '이전 (Shift+Enter)', () => search(-1)),
      iconBtn('caret-down', '다음 (Enter)', () => search(1)), more, iconBtn('x', '닫기 (Esc)', close)), adv);
  input.oninput = () => search(0);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  document.getElementById('timeline-wrap').append(box);
  hydrate(box);
}
// Ctrl+F: a fresh box (empty, 고급 folded and off); pressed again while it is open: its text is selected
function open() {
  if (!box) build();
  if (box.hidden) {
    box.hidden = false; input.value = ''; count.textContent = ''; adv.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    for (const c of adv.querySelectorAll('input')) c.checked = false;
  }
  adv.querySelector('label[data-k=memo]').hidden = !state.project.script; // memo: lines only
  input.focus(); input.select();
}

// every redraw while open: what the hits depend on (project, names, list view, where the selection is); a change
// counts again without moving (a tab switched, a track renamed, another project opened)
let last = [];
function render() {
  if (!box || box.hidden) return;
  const p = state.project, sc = p.script, v = state.ui.scriptView, s = state.sel;
  const now = [p, p.tracks, p.markers, T().map((t) => t.name).join('|'), sc && sc.lines, sc && sc.lineId, v.char,
    v.todo, s.activeTrackId, s.markerId, s.clipIds];
  if (now.length === last.length && now.every((x, i) => x === last[i])) return;
  last = now;
  adv.querySelector('label[data-k=memo]').hidden = !sc; // memo: lines only
  if (input.value.trim()) search(0, true);
}
const T = () => state.project.tracks;

module.exports = { open, close, render };
