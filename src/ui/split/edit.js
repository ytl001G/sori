// 긴 녹음 나누기 window's state, edits and line list (spec §5-5; the window itself: index.js). Line boundaries
// come from people only (N while recording, or N / [쉬는 곳마다 대사 나누기] here); the quiet only cuts pieces inside
// a line.
const SPL = require('../../core/split');
const SCR = require('../../core/script');
const D = require('../dialogs');
const engine = require('../../audio/engine');
const { el } = D;

const GAP = { min: 0.3, max: 5, step: 0.1, start: 1 }; // s: 쉬는 기준
const t1 = (f, sr) => { // rounded first: never 0:60.0
  const s = +(f / sr).toFixed(1);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const secs = (f, sr) => `${(f / sr).toFixed(1)}초`;
const isField = (e) => /^(INPUT|SELECT)$/.test(e.target.tagName);

// ---- the state and its edits ----
function fresh({ ch, sr, sound, bounds, lines }) {
  const len = ch[0].length, st = { ps: SPL.pieces(sound, sr, GAP.start, bounds, len), bounds, picks: [] };
  return { ch, sr, len, sound, lines, gap: GAP.start, st, cur: 0, sel: new Set([0]), cursor: null, edited: false,
    ask: null, playing: null, undo: [], redo: [] };
}
// the window's own Ctrl+Z / Ctrl+Y: every edit below goes through edit(), which keeps the state before it
const snap = (w) => ({ st: { ...w.st }, edited: w.edited, gap: w.gap });
// by value for boundaries and picks: an edit that rebuilt them unchanged is no undo step
const same = (a, b) => a.ps === b.ps && String(a.bounds) === String(b.bounds)
  && JSON.stringify(a.picks) === JSON.stringify(b.picks);
function edit(w, fn, before = snap(w)) {
  fn(w);
  if (same(before.st, w.st)) { w.edited = before.edited; return; } // nothing changed: not 손본 either
  w.undo.push(before); w.redo = [];
}
function back(w, redo) {
  const [from, to] = redo ? [w.redo, w.undo] : [w.undo, w.redo], s = from.pop();
  if (!s) return;
  to.push(snap(w));
  Object.assign(w, { st: s.st, edited: s.edited, gap: s.gap, cursor: null });
  w.cur = Math.max(0, Math.min(w.cur, s.st.ps.length - 1)); w.sel = new Set(s.st.ps.length ? [w.cur] : []);
}
const lineAt = (w, i) => SPL.lineIndex(w.st.bounds, w.st.picks, SPL.groupOf(w.st.bounds, w.st.ps[i]));
// a change of pieces: the choice stays in range, the 나누기 point goes
function setPs(w, ps, more = {}) {
  Object.assign(w.st, { ps }, more);
  w.edited = true; w.cursor = null;
  w.cur = Math.min(w.cur, ps.length - 1); w.sel = new Set(ps.length ? [w.cur] : []);
}
function choose(w, i, how) {
  if (i < 0 || i >= w.st.ps.length) return;
  if (how === 'add') { if (w.sel.has(i) && w.sel.size > 1) w.sel.delete(i); else w.sel.add(i); }
  else if (how === 'range') { const [x, y] = [w.cur, i].sort((p, q) => p - q); w.sel = new Set(range(x, y)); }
  else w.sel = new Set([i]);
  w.cur = i; w.cursor = null;
}
const range = (x, y) => Array.from({ length: y - x + 1 }, (_, k) => x + k);
// whether a tool does anything now (else its button is greyed out)
const boundBefore = (w) => w.cur > 0 && w.st.bounds.some((x) => x > w.st.ps[w.cur - 1].a && x <= w.st.ps[w.cur].a);
const CAN = {
  merge: (w) => w.sel.size > 1,
  split: (w) => { const p = w.st.ps[w.cur]; return !!p && w.cursor != null && w.cursor > p.a && w.cursor < p.b; },
  drop: (w) => w.sel.size > 0,
  bound: (w) => w.cur > 0 && !boundBefore(w),
  unbound: boundBefore,
};
const ACTIONS = {
  merge(w) {
    const ix = [...w.sel].sort((p, q) => p - q);
    if (ix.length < 2) return D.toast('합칠 조각을 두 개 이상 고르세요 (Ctrl+클릭, Shift+클릭)');
    const st = SPL.merge(w.st, ix[0], ix[ix.length - 1]);
    w.cur = ix[0]; setPs(w, st.ps, st);
  },
  split(w) {
    const p = w.st.ps[w.cur];
    if (w.cursor == null || !p || w.cursor <= p.a || w.cursor >= p.b) return D.toast('아래 파형에서 나눌 곳을 누르세요');
    setPs(w, SPL.splitAt(w.st.ps, w.cur, w.cursor));
  },
  drop(w) {
    const all = [...w.sel].every((i) => w.st.ps[i].drop);
    setPs(w, w.st.ps.map((p, i) => (w.sel.has(i) ? { ...p, drop: !all } : p)));
  },
  bound(w) { w.st.bounds = SPL.addBound(w.st, w.cur); },
  unbound(w) { Object.assign(w.st, SPL.dropBound(w.st, w.cur)); },
  every(w) { w.st.bounds = SPL.everyPiece(w.st); },
};
function regap(w, v) {
  w.gap = v; w.ask = null;
  setPs(w, SPL.pieces(w.sound, w.sr, v, w.st.bounds, w.len));
  w.edited = false;
}
// keys instead of dragging (0.1 s a press): ←/→ the 나누기 point (first press: the piece's middle),
// Alt+←/→ the piece's start, Alt+Shift+←/→ its end
const STEP = 0.1;
function nudge(w, dir, edge) {
  const p = w.st.ps[w.cur];
  if (!p) return;
  const d = Math.round(dir * STEP * w.sr);
  if (edge) return edit(w, () => { w.st.ps = SPL.setEdge(w.st, w.cur, edge, p[edge] + d, w.len); w.edited = true; });
  const at = w.cursor == null || w.cursor <= p.a || w.cursor >= p.b ? Math.round((p.a + p.b) / 2) : w.cursor + d;
  w.cursor = Math.min(p.b - 1, Math.max(p.a + 1, at));
}
// listen to the current piece (again: stop); w.playing = { a, b, t0 } moves the playhead line on the waveforms
function play(w) {
  engine.stopPreview();
  const p = w.st.ps[w.cur];
  if (w.playing || !p) { w.playing = null; return; }
  w.playing = { a: p.a, b: p.b, t0: performance.now() };
  engine.playPreview(w.ch.map((c) => c.subarray(p.a, p.b)), () => { w.playing = null; w.redraw(); });
  const tick = () => { if (w.playing) { w.drawWaves(); requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
}

// ---- the list: a header per line, a row per piece ----
function header(w, li) {
  const l = w.lines[li];
  const text = l ? `${SCR.lineName(l)}  ${l.text || l.memo}` : '대사가 모자라요 · 이 조각은 넣지 않아요';
  return el('div', { className: 'spl-line' + (l ? '' : ' over'), textContent: text });
}
function pieceRow(w, i) {
  const p = w.st.ps[i], when = `${t1(p.a, w.sr)} · ${secs(p.b - p.a, w.sr)}`;
  const b = el('button', { type: 'button', className: 'spl-row' + (p.drop ? ' drop' : '') },
    el('span', { textContent: `조각 ${i + 1}` }), el('span', { className: 't', textContent: when }),
    p.drop ? el('span', { className: 'badge', textContent: '버림' }) : null);
  b.setAttribute('aria-pressed', String(w.sel.has(i))); // chosen (several can be)
  if (i === w.cur) b.setAttribute('aria-current', 'true');
  b.onclick = (e) => { choose(w, i, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'add' : ''); w.redraw(); };
  b.ondblclick = () => play(w);
  return b;
}
function list(w, box) {
  const kids = [];
  let last = null;
  w.st.ps.forEach((_, i) => {
    const li = lineAt(w, i);
    if (li !== last) { kids.push(header(w, li)); last = li; }
    kids.push(pieceRow(w, i));
  });
  const none = el('div', { className: 'spl-line over', textContent: '말소리를 찾지 못했어요' });
  box.replaceChildren(...(kids.length ? kids : [none]));
  const cur = box.querySelector('[aria-current]');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}
// what [적용] does, in words
function summary(w) {
  const { lines, over } = SPL.plan(w.st, w.lines.length), n = lines.reduce((k, l) => k + l.ranges.length, 0);
  const short = over ? ` · 대사가 모자라 조각 ${over}개는 빠져요` : '';
  return { n, text: `대사 ${lines.length}개에 테이크 ${n}개가 생겨요${short}` };
}
// where each line's pieces start, for the names on the whole-recording waveform
function heads(w) {
  const out = [];
  let last = null;
  w.st.ps.forEach((p, i) => {
    const li = lineAt(w, i);
    if (li !== last && w.lines[li]) out.push({ f: p.a, text: SCR.lineName(w.lines[li]) });
    last = li;
  });
  return out;
}

module.exports = {
  fresh, snap, edit, back, nudge, choose, CAN, ACTIONS, regap, play, list, summary, heads, lineAt, GAP, isField, t1,
};
