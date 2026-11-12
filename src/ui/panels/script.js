// Script mode views (spec §5-5): the line list on the left and the line bar above the takes
// (a prompter while recording: this line big, the next one small). Commands live in commands.js.
const C = require('../commands');
const SCR = require('../../core/script');
const { el, setText } = require('../dialogs');
const engine = require('../../audio/engine');
const { state } = require('../../core/state');

const $ = (id) => document.getElementById(id);
let panel, bar, tabs, list, todo, count, live; // live: 이어 녹음's time + level
let lastLines = null, lastChars = null, lastKey = '', lastLine = null, lastView = '', emptyText = null;

function tab(label, char, done, total, color) {
  const n = el('span', { className: 'n', textContent: `${done}/${total}` });
  const dot = color ? el('span', { className: 'dot' }) : null;
  const b = el('button', { type: 'button', className: 'sp-tab' }, dot, label, n);
  if (color) b.style.setProperty('--ch', color);
  b.setAttribute('aria-pressed', String(state.ui.scriptView.char === char));
  b.setAttribute('aria-label', `${label} ${total}개 중 ${done}개 녹음`);
  b.onclick = () => C.setScriptView({ char });
  return b;
}

function row(l, s, cue) {
  const cur = l.id === s.lineId, done = SCR.isDone(l);
  // 이어 녹음: only the cued line stands out
  const className = 'line-row' + (cur && !cue ? ' cur' : '') + (cue && cue.id === l.id ? ' cue' : '')
    + (done ? ' done' : '') + (l.state ? ' ' + l.state : '');
  const takes = l.takes.length ? `${done ? '★ ' : ''}테이크 ${l.takes.length}` : '녹음 전';
  const b = el('button', { type: 'button', className, title: '더블클릭: 대사 고치기' },
    el('span', { className: 'lr-name', textContent: SCR.lineName(l) }),
    el('span', { className: 'lr-take', textContent: takes }),
    el('span', { className: 'lr-text', textContent: l.text || '(메모만)' }),
    l.memo ? el('span', { className: 'lr-memo', textContent: l.memo }) : null,
    l.state === 'redo' ? el('span', { className: 'lr-badge', textContent: '다시 녹음 필요' }) : null);
  b.style.setProperty('--ch', s.chars[l.char].color);
  if (cur) b.setAttribute('aria-current', 'true');
  b.onclick = () => C.goLine(l.id);
  b.ondblclick = () => C.run('editLine');
  return b;
}

function build(s) {
  const vis = C.visibleLines(); // first: it may set the view back to 전체
  const now = SCR.linesNow(state.project), chars = [...new Set(now.map((l) => l.char))];
  const count = (ls) => [ls.filter(SCR.isDone).length, ls.length];
  const charTab = (c) => tab(c, c, ...count(now.filter((l) => l.char === c)), s.chars[c].color);
  tabs.replaceChildren(tab('전체', '', ...count(now)), ...chars.map(charTab));
  const focused = list.contains(document.activeElement);
  const none = el('div', { className: 'sp-empty', textContent: '맞는 대사가 없어요' });
  const cue = C.cue();
  list.replaceChildren(...(vis.length ? vis.map((l) => row(l, s, cue)) : [none]));
  const cur = list.querySelector(cue ? '.cue' : '.cur') || list.querySelector('.cur');
  const at = cue ? cue.id : s.lineId, v = state.ui.scriptView, view = `${v.char}|${v.todo}`;
  // another tab or filter: a new list, the line being looked at stays in sight (in the middle)
  if (cur && view !== lastView) cur.scrollIntoView({ block: 'center' });
  else if (cur && (focused || at !== lastLine)) cur.scrollIntoView({ block: 'nearest' });
  if (cur && focused) cur.focus();
  lastLine = at; lastView = view;
  todo.setAttribute('aria-pressed', String(state.ui.scriptView.todo));
}

// 이어 녹음: the cued line instead of the current one, N / Shift+N / Shift+R in the hint
function renderBar(s) {
  const cue = C.cue(), l = cue || C.curLine(), nx = cue ? C.cueNextLine() : C.lineAfter(1), rec = state.recording;
  bar.classList.toggle('rec', rec);
  bar.style.setProperty('--ch', s.chars[l.char].color);
  bar.querySelector('.sb-name').textContent = SCR.lineName(l) + (l.state === 'redo' ? ' · 다시 녹음 필요' : '');
  bar.querySelector('.sb-text').textContent = l.text || '(대사 없음 · 메모만)';
  const memo = bar.querySelector('.sb-memo');
  memo.textContent = l.memo; memo.hidden = !l.memo;
  const next = bar.querySelector('.sb-next');
  next.textContent = nx ? `다음 · ${SCR.lineName(nx)}  ${nx.text || nx.memo}` : '마지막 대사예요';
  next.hidden = !rec;
  bar.querySelector('.sb-hint').textContent = cue ? '이어 녹음 · N 다음 대사 · Shift+N 되돌리기 · Shift+R 멈춤'
    : rec ? '녹음 중 · R로 멈춤' : 'R 새 테이크 · Shift+R 이어 녹음 · ↑/↓ 대사 이동';
  live.hidden = !cue;
}

// 이어 녹음's time and input level, every frame (hidden from screen readers: the bar is a live region)
function liveInfo() {
  const r = engine.recording(), sec = r ? Math.floor(r.length / engine.sampleRate()) : 0;
  setText(live.firstChild, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  const pk = Math.max(...engine.level('input'));
  const bar = live.lastChild.firstChild, t = `scaleX(${Math.min(100, Math.round(pk * 100)) / 100})`; // no layout
  if (bar.style.transform !== t) bar.style.transform = t;
  live.classList.toggle('clip', engine.isClipped('input'));
}

// the take count, [+ 테이크] / [이어 녹음] and what the empty timeline (a line without takes) says (spec §5-5);
// cueing = 이어 녹음 runs (its lane is on the timeline then, the empty text hidden)
function heads(cueing) {
  setText($('empty').querySelector('.empty-title'), 'R 을 눌러 이 대사를 녹음하세요');
  setText($('empty').querySelector('.empty-sub'), '녹음할 때마다 테이크가 하나씩 생겨요. 내보낼 테이크는 ★로 골라요');
  setText(count, `테이크 ${C.takeCount()}개`);
  const add = count.nextElementSibling, noAdd = !C.cmds.addTrack.enabled(); // [+ 테이크]: not while recording
  if (add.disabled !== noAdd) add.disabled = noAdd;
  const cont = bar.querySelector('.cont-rec'), noCont = state.recording && !cueing; // 이어 녹음: it stops it
  if (cont.disabled !== noCont) cont.disabled = noCont;
  setText(cont.lastChild, cueing ? '이어 녹음 멈춤' : '이어 녹음');
  cont.classList.toggle('on', cueing);
}

function render() {
  const s = state.project.script, on = !!(s && C.curLine());
  if (document.body.classList.contains('script') !== on) {
    document.body.classList.toggle('script', on);
    const sub = $('empty').querySelector('.empty-sub');
    // kbd tags
    if (!on) { $('empty').querySelector('.empty-title').textContent = emptyText[0]; sub.innerHTML = emptyText[1]; }
    lastLines = null;
  }
  for (const x of [panel, bar]) if (x.hidden === on) x.hidden = !on;
  if (!on) return;
  // 대사 목록 접기 (F7): scripts.css moves the line bar and the takes left
  if (document.body.classList.contains('lines-off') === state.ui.lines) {
    document.body.classList.toggle('lines-off', !state.ui.lines);
  }
  heads(!!C.cue());
  const v = state.ui.scriptView;
  // emptying the ★ take changes it
  const l = C.curLine(), done = SCR.isDone({ ...l, takes: state.project.tracks });
  const cue = C.cue();
  if (cue) liveInfo();
  const key = `${s.lineId}|${state.project.tracks.length}|${done}|${v.char}|${v.todo}|${state.recording}|`
    + (cue ? cue.id : '');
  // chars: a color set from the CLI (script color) replaces it
  if (s.lines === lastLines && s.chars === lastChars && key === lastKey) return;
  lastLines = s.lines; lastChars = s.chars; lastKey = key;
  build(s);
  renderBar(s);
}

function init() {
  panel = $('script-panel'); bar = $('script-bar'); tabs = $('sp-tabs'); list = $('sp-list');
  todo = $('sp-todo');
  emptyText = [$('empty').querySelector('.empty-title').textContent, $('empty').querySelector('.empty-sub').innerHTML];
  todo.onclick = () => C.setScriptView({ todo: !state.ui.scriptView.todo });
  count = $('headers-top').querySelector('.takes-count');
  live = el('div', { className: 'sb-live', hidden: true }, el('span'), el('span', { className: 'sb-meter' }, el('i')));
  live.setAttribute('aria-hidden', 'true');
  bar.querySelector('.sb-side').prepend(live);
}

module.exports = { init, render };
