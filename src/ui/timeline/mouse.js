// Pressing and dragging on the timeline: seek and scrub, range select, move clips, trim edges, drag fades and markers.
// A drag commits history once when it first moves; dragged back to where it started, the step is dropped.
const E = require('../../core/edit');
const engine = require('../../audio/engine');
const C = require('../commands');
const { state, history, changed, trackById } = require('../../core/state');
const { cv, T, v, pps, xToFrame, laneAt } = require('./view');
const { hit, snapTargets, snapDelta } = require('./hit');

const DRAG_PX = 4;
let drag = null;

function extendRange(d, f, idx) {
  const n = T().length;
  const i0 = Math.max(0, Math.min(d.anchorIdx, idx)), i1 = Math.min(n - 1, Math.max(d.anchorIdx, idx));
  const a = Math.min(d.anchor, f), b = Math.max(d.anchor, f);
  state.sel.range = b > a ? { a, b, trackIds: new Set(T().slice(i0, i1 + 1).map((t) => t.id)) } : null;
}
// what a press starts, by what is under it
function pressMarker(h, x) {
  state.sel.markerId = h.marker.id;
  C.seek(h.marker.frame, false);
  return { kind: 'marker', id: h.marker.id, start: h.marker.frame, x0: x, orig: null };
}
function pressEdge(h, x) { // a fade handle or a clip edge: that clip alone is selected
  const sel = state.sel, kind = h.part.startsWith('fade') ? 'fade' : 'trim';
  sel.range = null; sel.clipIds = new Set([h.clip.id]); sel.activeTrackId = h.track.id;
  return { kind, edge: h.part, clipId: h.clip.id, trackId: h.track.id, x0: x, orig: null };
}
function pressStrip(h, e, x, y) {
  const sel = state.sel, id = h.clip.id, wasSel = sel.clipIds.has(id);
  if (e.ctrlKey || e.metaKey) {
    const s = new Set(sel.clipIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    sel.clipIds = s;
  } else if (!wasSel) sel.clipIds = new Set([id]);
  sel.range = null; sel.activeTrackId = h.track.id;
  if (!sel.clipIds.has(id)) return null; // Ctrl+click let it go: a drag from it moves nothing (no empty undo step)
  return { kind: 'move', x0: x, y0: y, orig: null, clickId: !e.ctrlKey && wasSel ? id : null };
}
// a new range from here; Shift: the range (or the playhead) stretched to here
function pressLane(h, e, x) {
  const sel = state.sel, r = sel.range, ix = (id) => T().findIndex((t) => t.id === id);
  if (!e.shiftKey) {
    sel.range = null; sel.clipIds = new Set(); sel.activeTrackId = h.track.id;
    C.seek(h.frame, false);
    return { kind: 'range', anchor: h.frame, anchorIdx: h.idx, x0: x, moved: false };
  }
  const anchor = r ? (Math.abs(h.frame - r.a) < Math.abs(h.frame - r.b) ? r.b : r.a) : sel.playhead;
  const anchorIdx = r ? Math.min(...[...r.trackIds].map(ix)) : Math.max(0, ix(sel.activeTrackId));
  const d = { kind: 'range', anchor, anchorIdx, x0: x, moved: true };
  extendRange(d, h.frame, h.idx);
  return d;
}
function press(h, e, x, y) {
  if (h.zone === 'marker') return pressMarker(h, x);
  if (h.zone === 'ruler') { C.seek(h.frame, false); return { kind: 'scrub' }; }
  if (h.zone !== 'lane') { state.sel.range = null; state.sel.clipIds = new Set(); return null; }
  if (h.clip && ['fadeIn', 'fadeOut', 'left', 'right'].includes(h.part)) return pressEdge(h, x);
  if (h.clip && h.part === 'strip') return pressStrip(h, e, x, y);
  return pressLane(h, e, x);
}
function onDown(e) {
  if (e.button !== 0) return;
  cv.canvas.focus();
  const x = e.offsetX, y = e.offsetY, h = hit(x, y);
  if (h.zone !== 'marker') state.sel.markerId = null;
  drag = press(h, e, x, y);
  changed();
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp, { once: true });
}

function localXY(e) {
  const rc = cv.canvas.getBoundingClientRect();
  return [e.clientX - rc.left, e.clientY - rc.top];
}
function onMove(e) {
  if (!drag) return;
  const [x, y] = localXY(e);
  if (x < 16 && v.scrollX > 0) v.scrollX = Math.max(0, v.scrollX - 12 / pps()); // edge auto-scroll
  else if (x > cv.W - 16) v.scrollX += 12 / pps();
  if (drag.kind === 'scrub') { C.seek(xToFrame(x), false); return; }
  if (drag.kind === 'range') {
    if (!drag.moved && Math.abs(x - drag.x0) < DRAG_PX) return;
    drag.moved = true;
    extendRange(drag, xToFrame(x), laneAt(y));
    return changed();
  }
  if (Math.abs(x - drag.x0) < DRAG_PX && !drag.orig) return;
  // an undo or another change since the drag last wrote: its start state is stale, so the drag ends here
  if (drag.orig && drag.last !== written()) { drag = null; return changed(); }
  ({ move: moveClips, trim: trimEdge, fade: dragFade, marker: dragMarker })[drag.kind](x, y);
  if (drag) drag.last = written();
}
// what a drag writes: the markers, or the tracks
const written = () => (drag.kind === 'marker' ? state.project.markers : T());

function dragMarker(x) {
  if (!drag.orig) { history.commit(null, '마커 옮기기'); drag.orig = true; drag.snaps = snapTargets(new Set(), drag.id); }
  let f = xToFrame(x);
  f = Math.max(0, f + snapDelta([f], drag.snaps));
  drag.moved = f !== drag.start;
  C.moveMarker(drag.id, f);
}
const dragged = () => trackById(drag.trackId).clips.find((c) => c.id === drag.clipId);
// the dragged clip replaced by nc in its track (sorted again when its start can move)
function setClip(nc, sort) {
  const swap = (tr) => tr.clips.map((c) => (c.id === drag.clipId ? nc : c));
  const put = (tr) => ({ ...tr, clips: sort ? E.sortClips(swap(tr)) : swap(tr) });
  state.project.tracks = T().map((tr) => (tr.id === drag.trackId ? put(tr) : tr));
  changed();
}
function dragFade(x) {
  if (!drag.orig) { history.commit(null, '페이드 조절'); drag.orig = dragged(); }
  const o = drag.orig;
  if (!o) return;
  const f = xToFrame(x);
  const nc = drag.edge === 'fadeIn'
    ? { ...o, fadeIn: Math.max(0, Math.min(f - o.start, o.length - (o.fadeOut || 0))) }
    : { ...o, fadeOut: Math.max(0, Math.min(E.clipEnd(o) - f, o.length - (o.fadeIn || 0))) };
  // a fade dragged away: one made again starts 직선 (a shape picked on purpose for a zero-length fade stays)
  if (!nc[drag.edge] && o[drag.edge]) delete nc[drag.edge + 'Shape'];
  drag.changed = (nc.fadeIn || 0) !== (o.fadeIn || 0) || (nc.fadeOut || 0) !== (o.fadeOut || 0);
  setClip(nc, false);
}
function trimEdge(x) {
  if (!drag.orig) {
    history.commit(null, '클립 끝 다듬기');
    drag.orig = dragged();
    drag.snaps = snapTargets(new Set([drag.clipId]));
  }
  if (!drag.orig) return;
  let f = xToFrame(x);
  f += snapDelta([f], drag.snaps);
  const nc = E.trimClip(drag.orig, drag.edge, f);
  drag.changed = nc.start !== drag.orig.start || nc.length !== drag.orig.length;
  setClip(nc, true);
}
// the first move: an undo step, the clips as they were, what moves, where it can snap
function startMove() {
  const ids = state.sel.clipIds, tracks = T();
  history.commit(null, '클립 옮기기');
  drag.orig = tracks.map((t) => ({ id: t.id, clips: t.clips }));
  drag.items = tracks.flatMap((t, i) => t.clips.filter((c) => ids.has(c.id)).map((c) => ({ c, i })));
  drag.snaps = snapTargets(ids);
  cv.canvas.style.cursor = 'grabbing';
}
function moveClips(x, y) {
  if (!drag.orig) startMove();
  const ids = state.sel.clipIds, n = drag.orig.length, items = drag.items;
  const minStart = -Math.min(...items.map(({ c }) => c.start));
  let df = Math.max(xToFrame(x) - xToFrame(drag.x0), minStart);
  df = Math.max(df + snapDelta(items.flatMap(({ c }) => [c.start + df, E.clipEnd(c) + df]), drag.snaps), minStart);
  let dt = laneAt(y) - laneAt(drag.y0);
  dt = Math.max(dt, -Math.min(...items.map(({ i }) => i)));
  dt = Math.min(dt, n - 1 - Math.max(...items.map(({ i }) => i)));
  const next = drag.orig.map((o) => o.clips.filter((c) => !ids.has(c.id)));
  for (const { c, i } of items) next[i + dt].push({ ...c, start: c.start + df });
  drag.df = df; drag.dt = dt;
  const byId = new Map(T().map((t) => [t.id, t]));
  state.project.tracks = drag.orig.map((o, i) => ({ ...byId.get(o.id), clips: E.sortClips(next[i]) }));
  if (dt && items.length) state.sel.activeTrackId = drag.orig[items[0].i + dt].id;
  changed();
}

function onUp() {
  window.removeEventListener('mousemove', onMove);
  const d = drag;
  drag = null;
  if (!d) return;
  // plain click on a multi-selection
  if (d.kind === 'move' && !d.orig && d.clickId) state.sel.clipIds = new Set([d.clickId]);
  const edit = ['move', 'trim', 'fade'].includes(d.kind);
  const noop = (d.kind === 'move' && !d.df && !d.dt) || ((d.kind === 'trim' || d.kind === 'fade') && !d.changed)
    || (d.kind === 'marker' && !d.moved);
  if (d.orig && noop) history.drop(); // dragged back: no undo step
  if (edit && d.orig && !noop && state.playing) C.seek(engine.position());
  changed();
}

module.exports = { onDown, localXY, dragging: () => !!drag };
