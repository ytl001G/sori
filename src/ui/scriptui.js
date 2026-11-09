// Script mode views (spec §5-5): the line list on the left and the line bar above the takes
// (a prompter while recording: this line big, the next one small). Commands live in commands.js.
const C = require('./commands');
const SCR = require('../core/script');
const { el } = require('./dialogs');
const { state } = require('../core/state');

const $ = (id) => document.getElementById(id);
let panel, bar, tabs, list, search, todo, count, lastLines = null, lastKey = '', lastLine = null, emptyText = null;
const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; }; // per frame: touch the DOM only on change

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

function row(l, s) {
  const cur = l.id === s.lineId, done = SCR.isDone(l);
  const className = 'line-row' + (cur ? ' cur' : '') + (done ? ' done' : '') + (l.state ? ' ' + l.state : '');
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
  const now = SCR.linesNow(state.project), chars = [...new Set(now.map((l) => l.char))];
  const count = (ls) => [ls.filter(SCR.isDone).length, ls.length];
  const charTab = (c) => tab(c, c, ...count(now.filter((l) => l.char === c)), s.chars[c].color);
  tabs.replaceChildren(tab('전체', '', ...count(now)), ...chars.map(charTab));
  const focused = list.contains(document.activeElement), vis = C.visibleLines();
  const none = el('div', { className: 'sp-empty', textContent: '맞는 대사가 없어요' });
  list.replaceChildren(...(vis.length ? vis.map((l) => row(l, s)) : [none]));
  const cur = list.querySelector('.cur');
  if (cur && (focused || s.lineId !== lastLine)) cur.scrollIntoView({ block: 'nearest' });
  if (cur && focused) cur.focus();
  lastLine = s.lineId;
  todo.setAttribute('aria-pressed', String(state.ui.scriptView.todo));
}

function renderBar(s) {
  const l = C.curLine(), nx = C.lineAfter(1), rec = state.recording;
  bar.classList.toggle('rec', rec);
  bar.style.setProperty('--ch', s.chars[l.char].color);
  bar.querySelector('.sb-name').textContent = SCR.lineName(l) + (l.state === 'redo' ? ' · 다시 녹음 필요' : '');
  bar.querySelector('.sb-text').textContent = l.text || '(대사 없음 · 메모만)';
  const memo = bar.querySelector('.sb-memo');
  memo.textContent = l.memo; memo.hidden = !l.memo;
  const next = bar.querySelector('.sb-next');
  next.textContent = nx ? `다음 · ${SCR.lineName(nx)}  ${nx.text || nx.memo}` : '마지막 대사예요';
  next.hidden = !rec;
  bar.querySelector('.sb-hint').textContent = rec ? '녹음 중 · R로 멈춤' : 'R 새 테이크 · ↑/↓ 대사 이동';
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
  panel.hidden = bar.hidden = !on;
  if (!on) return;
  // the take count + what the empty timeline (a line without takes) says (spec §5-5)
  setText($('empty').querySelector('.empty-title'), 'R 을 눌러 이 대사를 녹음하세요');
  setText($('empty').querySelector('.empty-sub'), '녹음할 때마다 테이크가 하나씩 생겨요. 내보낼 테이크는 ★로 골라요');
  setText(count, `테이크 ${C.takeCount()}개`);
  count.nextElementSibling.disabled = !C.cmds.addTrack.enabled(); // [+ 테이크]: not while recording
  const v = state.ui.scriptView;
  if (document.activeElement !== search && search.value !== v.q) search.value = v.q;
  // emptying the ★ take changes it
  const l = C.curLine(), done = SCR.isDone({ ...l, takes: state.project.tracks });
  const key = `${s.lineId}|${state.project.tracks.length}|${done}|${v.char}|${v.todo}|${v.q}|${state.recording}`;
  if (s.lines === lastLines && key === lastKey) return;
  lastLines = s.lines; lastKey = key;
  build(s);
  renderBar(s);
}

function init() {
  panel = $('script-panel'); bar = $('script-bar'); tabs = $('sp-tabs'); list = $('sp-list');
  search = $('sp-search'); todo = $('sp-todo');
  emptyText = [$('empty').querySelector('.empty-title').textContent, $('empty').querySelector('.empty-sub').innerHTML];
  search.oninput = () => C.setScriptView({ q: search.value });
  search.onkeydown = (e) => {
    if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; C.setScriptView({ q: '' }); }
    else if (e.key === 'Enter' || e.key === 'Escape') search.blur();
  };
  todo.onclick = () => C.setScriptView({ todo: !state.ui.scriptView.todo });
  count = $('headers-top').querySelector('.takes-count');
}

module.exports = { init, render };
