// 실행취소 기록 (spec §5-1): the right panel's second tab (F6). Every undo step by name, oldest first; the current
// state is marked, the steps redo would bring back are dimmed. A row goes back to just after its step.
const C = require('../commands');
const SCR = require('../../core/script');
const { el, setText } = require('../dialogs');
const { named } = require('../tips');
const { state, history } = require('../../core/state');

let list, note, last = null;

const clock = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
// script projects: the line a step changed (it can be gone since)
function lineOf(id) {
  const s = state.project.script, l = s && id && s.lines.find((x) => x.id === id);
  return l ? SCR.lineName(l) : '';
}
function row(n, label, info, cur, undone) {
  const b = el('button', { className: 'hist-row' + (cur ? ' cur' : '') + (undone ? ' undone' : ''), type: 'button' },
    el('span', { className: 'hl-name', textContent: label }));
  if (info) {
    b.append(el('span', { className: 'hl-time', textContent: clock(info.time) }));
    const where = lineOf(info.line);
    if (where) b.append(el('span', { className: 'hl-line', textContent: where }));
  }
  if (cur) b.setAttribute('aria-current', 'step');
  // dimmed is only a color: a screen reader says it too
  if (undone) b.setAttribute('aria-description', '되돌린 단계. 누르거나 다시실행으로 돌아와요');
  b.onclick = () => { if (!cur) C.run('historyTo', n); };
  return el('li', {}, b);
}
function build() {
  const { done, undone } = history.steps();
  const rows = [row(0, '처음 (더 되돌릴 수 없는 곳)', null, !done.length, false),
    ...done.map((s, i) => row(i + 1, s.label, s, i === done.length - 1, false)),
    ...undone.map((s, j) => row(done.length + j + 1, s.label, s, false, true))];
  const focused = list.contains(document.activeElement); // a row pressed with the keyboard: focus stays in the list
  list.replaceChildren(...rows);
  const cur = list.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  if (cur && focused) cur.focus();
}

function render() {
  if (!state.ui.fxPanel || state.ui.fxTab !== 'history') { last = null; return; }
  setText(note, '누르면 그 단계 바로 뒤로 돌아가요. 그 뒤 단계는 흐리게 남아서 다시 누르거나 '
    + named('redo', '다시실행') + '으로 돌아올 수 있어요. 새로 편집하면 흐린 단계는 사라져요.');
  // a new top object after every commit, undo and redo; the lines for their names
  const key = [history.top(), history.depth(), history.redoDepth(), state.project.script && state.project.script.lines];
  if (last && key.every((x, i) => x === last[i])) return;
  last = key;
  build();
}
function init() { list = document.getElementById('hist-list'); note = document.getElementById('hist-note'); }

module.exports = { init, render };
