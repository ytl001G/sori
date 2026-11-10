// 긴 녹음 나누기 window (spec §5-5): waveforms, tools, the line list and [취소] [적용]. open() resolves to the
// final { ps, bounds, picks } on [적용], null on cancel. `lost`: the recording lives only here (이어 녹음), so
// closing without 적용 asks first.
const SPL = require('../../core/split');
const SCR = require('../../core/script');
const D = require('../dialogs');
const U = require('./edit');
const W = require('./draw');
const engine = require('../../audio/engine');
const { el } = D;
const { button } = require('../controls');

const TOOLS = [ // [action, label, key hint]
  ['merge', '합치기', 'Ctrl+J'], ['split', '나누기', 'S'], ['drop', '버리기 · 되살리기', 'Delete'],
  ['bound', '여기부터 다음 대사', 'N'], ['unbound', '대사 경계 지우기', ''],
];
const KEYS = { KeyS: 'split', Delete: 'drop', Backspace: 'drop', KeyN: 'bound' };

function lineSelect(w) {
  const s = el('select', { className: 'spl-pick' });
  s.setAttribute('aria-label', '고른 조각의 대사');
  w.lines.forEach((l, k) => s.append(el('option', { value: String(k),
    textContent: `${SCR.lineName(l)}  ${(l.text || l.memo).slice(0, 40)}` })));
  s.onchange = () => {
    U.edit(w, () => { w.st.picks = SPL.pickLine(w.st, SPL.groupOf(w.st.bounds, w.st.ps[w.cur]), +s.value); });
    w.redraw();
  };
  return s;
}
function gapInput(w) {
  const g = U.GAP, i = el('input', { type: 'number', min: g.min, max: g.max, step: g.step, value: g.start,
    className: 'numin' });
  i.setAttribute('aria-label', '쉬는 기준 (초)');
  i.onchange = () => {
    const v = Math.min(g.max, Math.max(g.min, Math.round(+i.value * 10) / 10 || g.start));
    i.value = v;
    if (v === w.gap) return;
    if (w.edited) w.ask = { gap: v }; else U.edit(w, () => U.regap(w, v));
    w.redraw();
  };
  return i;
}
function tools(w) {
  const box = el('div', { className: 'spl-tools' });
  const hear = w.ui.hear = button('듣기 (Space)', 'btn small');
  hear.onclick = () => { U.play(w); w.redraw(); };
  box.append(hear);
  w.ui.tools = {};
  for (const [act, label, key] of TOOLS) {
    const b = w.ui.tools[act] = button(key ? `${label} (${key})` : label, 'btn small');
    b.onclick = () => { U.edit(w, U.ACTIONS[act]); w.redraw(); };
    box.append(b);
  }
  return box;
}
// the foot: what 적용 makes + [취소] [적용], or a question asked in place (a second window would close this one)
function foot(w, close) {
  const box = w.ui.foot, q = w.ask;
  const btn = (t, f, primary) => { const b = button(t, primary ? 'btn primary' : 'btn'); b.onclick = f; return b; };
  if (q) {
    const gap = q.gap !== undefined;
    const note = gap ? '손본 조각이 처음으로 돌아가요 (대사 경계는 그대로)' : '나누지 않고 닫으면 이 녹음은 사라져요';
    const back = btn(gap ? '그대로 두기' : '돌아가기', () => { w.ask = null; w.ui.gap.value = w.gap; w.redraw(); });
    const regap = () => { U.edit(w, () => U.regap(w, q.gap)); w.redraw(); };
    const go = btn(gap ? '다시 나누기' : '버리고 닫기', () => (gap ? regap() : close(null)), true);
    return box.replaceChildren(el('span', { className: 'note warn', textContent: note }), back, go);
  }
  const s = U.summary(w), ok = btn(`적용 (테이크 ${s.n}개)`, () => close(w.st), true);
  ok.disabled = !s.n;
  box.replaceChildren(el('span', { className: 'note', textContent: s.text }), btn('취소', () => cancel(w, close)), ok);
}
function cancel(w, close) {
  if (!w.lost) return close(null);
  w.ask = 'cancel'; w.redraw();
  w.ui.foot.querySelector('.primary').focus();
}

function mouse(w) {
  const { over, detail } = w.ui;
  over.onmousedown = (e) => {
    U.choose(w, W.pieceAt(over, w, e.clientX), e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'add' : '');
    w.redraw();
  };
  detail.onmousedown = (e) => {
    const hit = W.detailHit(detail, w, e.clientX);
    if (!hit.edge) { w.cursor = hit.at; return w.redraw(); }
    const before = U.snap(w); // one undo step per drag
    const move = (m) => {
      const f = hit.toF(m.clientX - detail.getBoundingClientRect().left);
      w.st.ps = SPL.setEdge(w.st, w.cur, hit.edge, f, w.len); w.edited = true; w.drawWaves(); // the list: on release
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      U.edit(w, () => {}, before); w.redraw();
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
}
// keys while the window is open (true = handled); typing in the gap box and the line list stays theirs
function onKey(w, close, e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (w.ask) { w.ask = null; w.redraw(); } else cancel(w, close);
    return true;
  }
  const lr = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
  if (U.isField(e) || (e.altKey && !lr)) return false;
  const ctrl = e.ctrlKey || e.metaKey, act = ctrl ? (e.code === 'KeyJ' ? 'merge' : null) : KEYS[e.code];
  const undo = ctrl && e.code === 'KeyZ' && !e.shiftKey;
  const redo = ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey));
  if (undo || redo) U.back(w, redo);
  else if (!ctrl && e.code === 'Space') U.play(w);
  else if (!ctrl && lr) U.nudge(w, e.code === 'ArrowLeft' ? -1 : 1, e.altKey ? (e.shiftKey ? 'b' : 'a') : null);
  else if (!ctrl && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
    U.choose(w, w.cur + (e.code === 'ArrowUp' ? -1 : 1), e.shiftKey ? 'range' : '');
  } else if (act) U.edit(w, U.ACTIONS[act]);
  else return false;
  e.preventDefault();
  w.redraw();
  return true;
}

// what the buttons, the gap box and the waveform descriptions say now
function tidy(w) {
  for (const [act, b] of Object.entries(w.ui.tools)) b.disabled = !U.CAN[act](w);
  w.ui.hear.textContent = w.playing ? '멈추기 (Space)' : '듣기 (Space)';
  w.ui.hear.disabled = !w.st.ps.length;
  if (document.activeElement !== w.ui.gap) w.ui.gap.value = w.gap;
  const p = w.st.ps[w.cur];
  w.ui.over.setAttribute('aria-label', `긴 녹음 전체 ${U.t1(w.len, w.sr)}: 조각 ${w.st.ps.length}개, `
    + `대사 경계 ${w.st.bounds.length}개`);
  const piece = p ? `조각 ${w.cur + 1}: ${U.t1(p.a, w.sr)}부터 ${U.t1(p.b, w.sr)}까지` : '조각 없음';
  w.ui.detail.setAttribute('aria-label', piece);
}

function build(w, body, close) {
  w.ui = { over: el('canvas', { className: 'spl-over' }), detail: el('canvas', { className: 'spl-detail' }),
    list: el('div', { className: 'spl-list', tabIndex: 0 }), foot: el('div', { className: 'spl-foot' }),
    gap: gapInput(w), pick: lineSelect(w) };
  const every = button('쉬는 곳마다 대사 나누기', 'btn small');
  every.onclick = () => { U.edit(w, U.ACTIONS.every); w.redraw(); };
  const info = `긴 녹음 ${U.t1(w.len, w.sr)} · 쉬는 기준`;
  body.classList.add('spl');
  body.append(el('div', { className: 'spl-top' }, el('span', { textContent: info }), w.ui.gap,
    el('span', { textContent: '초' }), el('span', { className: 'spacer' }), every),
  w.ui.over, w.ui.detail, tools(w),
  el('div', { className: 'spl-tools' }, el('span', { className: 'lbl', textContent: '고른 조각의 대사' }), w.ui.pick,
    el('span', { className: 'spacer' }),
    el('span', { className: 'lbl', textContent: '←/→ 나눌 곳 · Alt+←/→ 시작 · Alt+Shift+←/→ 끝 (0.1초씩)' })),
  w.ui.list, w.ui.foot);
  for (const c of [w.ui.over, w.ui.detail]) c.setAttribute('role', 'img');
  w.ui.list.setAttribute('aria-label', '대사별 조각 (↑/↓ 고르기, Space 듣기)');
  mouse(w);
  w.drawWaves = () => { W.drawOverview(w.ui.over, w); W.drawDetail(w.ui.detail, w); };
  w.redraw = () => {
    w.heads = U.heads(w);
    w.drawWaves();
    const lost = w.ui.list.contains(document.activeElement); // a clicked row is rebuilt: keep the keys here
    U.list(w, w.ui.list);
    if (lost && !w.ui.list.contains(document.activeElement)) w.ui.list.focus({ preventScroll: true });
    tidy(w);
    const li = w.st.ps.length ? U.lineAt(w, w.cur) : 0;
    w.ui.pick.disabled = !w.st.ps.length || li < 0 || li >= w.lines.length;
    if (!w.ui.pick.disabled) w.ui.pick.value = String(li);
    foot(w, close);
  };
  requestAnimationFrame(() => w.redraw()); // canvases have their size once on screen
}

let shown = null; // the open window's state (the smoke test reads it)
function open(opts) {
  const w = shown = { ...U.fresh(opts), lost: !!opts.lost, redraw: () => {}, drawWaves: () => {}, heads: [] };
  let closeIt = null;
  const onClose = () => { engine.stopPreview(); w.playing = null; shown = null; }; // ends the playhead loop too
  return D.sheet({ title: '긴 녹음 나누기', onKey: (e) => onKey(w, closeIt, e), onClose,
    build(body, close) {
      closeIt = close;
      build(w, body, close);
      body.parentElement.querySelector('.sheet-head .icon').onclick = () => cancel(w, close); // X asks too
      w.ui.list.focus(); // not the 쉬는 기준 box: there ↑/↓ would change the number instead of the piece
    } });
}

module.exports = { open, shown: () => shown };
