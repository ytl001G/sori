// Editing: undo / redo, copy / cut / paste / delete, select, split, merge, duplicate, keep, insert silence, nudge.
const E = require('../../core/edit');
const SCR = require('../../core/script');
const D = require('../dialogs');
const {
  cmds, def, T, frames, hasAudio, selClips, rangeTracks, targetTracks, setClips, clearSel, hasSel, SC, setLine,
  curLine,
} = require('./core');
const { afterEdit, pause } = require('./play');
const { recInfo, recSpot, stopFirst } = require('./record');
const { viewTakes, newTake } = require('./script');
const { state, history, makeTrack, changed, trackById, trackIndex, sr } = require('../../core/state');

// the take being recorded stays through undo / redo: a snapshot without it (taken before it had clips) gets
// it back empty, its sound still recording. `back` cancels a step that would remove the line it is recorded into, or
// turn the project into the other kind.
function keepRecording(rec, keep, back) {
  const lineOf = () => SC() && SC().lines.find((x) => x.id === rec.lineId);
  if (!rec.lineId !== !SC()) {
    back(); D.toast('대본 넣기 · 보통 프로젝트로 바꾸기 단계라서, 녹음을 멈춘 뒤에 되돌릴 수 있어요');
  } else if (rec.lineId && !lineOf()) {
    back(); D.toast('녹음 중인 대사가 없어지는 단계라서, 녹음을 멈춘 뒤에 되돌릴 수 있어요');
  }
  if (recSpot(rec.trackId, rec.lineId)) return; // the snapshot kept it, with the clips edited onto it
  const l = rec.lineId && lineOf(), t = { ...keep.t, clips: [] };
  if (!l || l.id === SC().lineId) state.project.tracks = [...T(), t];
  else setLine(l.id, { takes: [...l.takes, t] });
}
// a refused step goes back to the line that was on screen (the step's own line is stashed as it is)
function backTo(id) {
  const s = SC();
  if (!s || s.lineId === id || !s.lines.some((x) => x.id === id)) return;
  setLine(s.lineId, { takes: T() });
  s.lineId = id;
  state.project.tracks = s.lines.find((x) => x.id === id).takes;
}
// a script step can land on another line (it opens with ★ selected) or bring back takes to re-view
const undoRedo = (fn, back) => {
  const id = SC() && SC().lineId, rec = recInfo(), keep = rec && recSpot(rec.trackId, rec.lineId);
  if (!fn()) return;
  if (keep) keepRecording(rec, keep, () => { back(); backTo(id); });
  // to another line: stop; never engine.stop mid-take, never a second stop while one is keeping it
  const moved = SC() && SC().lineId !== id, stopping = moved && (state.recording ? stopFirst() : pause());
  if (SC()) { if (moved) clearSel(); viewTakes(state.sel.activeTrackId); }
  else if (!trackById(state.sel.activeTrackId)) state.sel.activeTrackId = T()[0] ? T()[0].id : null;
  afterEdit();
  return stopping;
};
def('undo', '실행취소', () => undoRedo(() => history.undo(), () => history.redo()), () => history.canUndo());
def('redo', '다시실행', () => undoRedo(() => history.redo(), () => history.undo()), () => history.canRedo());

function copySelection() {
  const r = state.sel.range;
  if (r) {
    const ts = rangeTracks();
    const tracks = ts.map((t) => E.renderRegion(t.clips, r.a, r.b));
    state.clipboard = { kind: 'range', sr: sr(), len: r.b - r.a, tracks };
    return true;
  }
  const sc = selClips();
  if (!sc.length) return false;
  const minTi = Math.min(...sc.map(({ t }) => trackIndex(t.id))), minStart = Math.min(...sc.map(({ c }) => c.start));
  const item = ({ t, c }) => ({ trackOffset: trackIndex(t.id) - minTi, startOffset: c.start - minStart, clip: c });
  state.clipboard = { kind: 'clips', sr: sr(), items: sc.map(item) };
  return true;
}
// markers follow ripple edits only when the edit spans every track
function rippleMarkers(trackIds, a, b, newLen) {
  if (!T().length || !T().every((t) => trackIds.has(t.id))) return;
  state.project.markers = state.project.markers.map((m) => ({ ...m, frame: E.remapFrame(m.frame, a, b, newLen) }));
}
function deleteSelection() {
  const r = state.sel.range;
  if (r) {
    for (const t of rangeTracks()) setClips(t.id, E.rippleDelete(t.clips, r.a, r.b));
    rippleMarkers(r.trackIds, r.a, r.b, 0);
    state.sel.playhead = r.a;
    state.sel.range = null;
    return true;
  }
  const ids = state.sel.clipIds;
  if (!ids.size) return false;
  for (const t of T()) if (t.clips.some((c) => ids.has(c.id))) setClips(t.id, t.clips.filter((c) => !ids.has(c.id)));
  state.sel.clipIds = new Set();
  return true;
}

def('copy', '복사', () => { if (copySelection()) D.toast('복사했어요'); }, hasSel);
def('cut', '잘라내기', () => {
  if (!hasSel()) return;
  copySelection(); history.commit(); deleteSelection(); afterEdit();
}, hasSel);
def('delete', '삭제', () => { // only what is selected, in every project (a take goes with its ✕ button)
  if (!hasSel()) return state.sel.markerId && cmds.markerDelete.run(); // a selected marker (clicked or jumped to)
  history.commit(); deleteSelection(); afterEdit();
}, () => hasSel() || !!state.sel.markerId);

// a copied range: a gap on each track, its sound in it; returns the new clip ids and the length
function pasteRange(cb, first, at) {
  const ids = new Set();
  cb.tracks.forEach((ch, i) => {
    const t = T()[first + i];
    let clips = E.insertGap(t.clips, at, cb.len);
    if (ch) { const c = E.makeClip(E.makeSource(ch), at, t.name); clips = E.sortClips([...clips, c]); ids.add(c.id); }
    setClips(t.id, clips);
  });
  rippleMarkers(new Set(T().slice(first, first + cb.tracks.length).map((t) => t.id)), at, at, cb.len);
  return { ids, len: cb.len };
}
// samples at another rate, same speed and pitch (the renderer's resampler)
async function resampleCh(ch, from, to) {
  const ctx = new OfflineAudioContext(ch.length, Math.max(1, Math.round(ch[0].length * to / from)), to);
  const b = ctx.createBuffer(ch.length, ch[0].length, from), s = ctx.createBufferSource();
  ch.forEach((c, i) => b.copyToChannel(c, i));
  s.buffer = b; s.connect(ctx.destination); s.start();
  const out = await ctx.startRendering();
  return ch.map((_, i) => out.getChannelData(i));
}
// a clipboard copied in a project at another rate, converted to rate `to`
async function atRate(cb, to, rs = resampleCh) {
  const k = to / cb.sr, f = (n) => Math.round((n || 0) * k);
  if (cb.kind === 'range') {
    const tracks = await Promise.all(cb.tracks.map((ch) => ch && rs(ch, cb.sr, to)));
    return { ...cb, sr: to, len: f(cb.len), tracks };
  }
  const srcs = new Map();
  for (const it of cb.items) if (!srcs.has(it.clip.src)) srcs.set(it.clip.src, rs(it.clip.src.ch, cb.sr, to));
  for (const [src, ch] of srcs) srcs.set(src, E.makeSource(await ch));
  const clip = (c) => {
    const src = srcs.get(c.src), offset = Math.min(f(c.offset), src.ch[0].length - 1);
    const length = Math.max(1, Math.min(f(c.length), src.ch[0].length - offset));
    const fadeIn = Math.min(f(c.fadeIn), length), fadeOut = Math.min(f(c.fadeOut), length);
    return { ...c, src, offset, length, fadeIn, fadeOut };
  };
  const item = (it) => ({ ...it, startOffset: f(it.startOffset), clip: clip(it.clip) });
  return { ...cb, sr: to, items: cb.items.map(item) };
}
// copied clips are inserted too: open a gap as long as the copied group, then place them
function pasteClips(cb, first, at) {
  const ids = new Set(), len = Math.max(...cb.items.map((it) => it.startOffset + it.clip.length)), hit = new Set();
  for (const off of new Set(cb.items.map((it) => it.trackOffset))) {
    const t = T()[first + off];
    setClips(t.id, E.insertGap(t.clips, at, len));
    hit.add(t.id);
  }
  rippleMarkers(hit, at, at, len);
  for (const it of cb.items) {
    const t = T()[first + it.trackOffset], c = { ...it.clip, id: E.uid('c'), start: at + it.startOffset };
    setClips(t.id, E.sortClips([...trackById(t.id).clips, c]));
    ids.add(c.id);
  }
  return { ids, len };
}
// script mode: a new take is 테이크 n with its character's look; the first new one gets ★ when the line has none
function addTrack(props) {
  const t = curLine() ? newTake(props) : makeTrack(props);
  state.project.tracks = [...T(), t];
  const l = curLine();
  if (l && !l.star) setLine(l.id, SCR.withStar(t.id));
  return t;
}
def('paste', '붙여넣기', async () => {
  if (!state.clipboard) return;
  const cb = state.clipboard.sr && state.clipboard.sr !== sr() ? await atRate(state.clipboard, sr()) : state.clipboard;
  history.commit();
  const r = state.sel.range;
  let at = state.sel.playhead;
  const first = Math.max(0, trackIndex((rangeTracks()[0] || trackById(state.sel.activeTrackId) || {}).id));
  if (r) { deleteSelection(); at = r.a; } // paste replaces the selected range
  const need = (cb.kind === 'range' ? cb.tracks.length : Math.max(...cb.items.map((i) => i.trackOffset)) + 1) + first;
  while (T().length < need) addTrack();
  const { ids, len } = cb.kind === 'range' ? pasteRange(cb, first, at) : pasteClips(cb, first, at);
  state.sel.playhead = at + len;
  state.sel.range = null;
  state.sel.clipIds = ids;
  afterEdit();
}, () => !!state.clipboard);

def('selectAll', '전체 선택', () => {
  if (!hasAudio()) return;
  state.sel.clipIds = new Set();
  state.sel.range = { a: 0, b: E.projectEnd(T()), trackIds: new Set(T().map((t) => t.id)) };
  changed();
});
def('deselect', '선택 해제', () => { clearSel(); state.sel.markerId = null; changed(); });

def('split', '클립 나누기', () => {
  const f = state.sel.playhead, under = (c) => c.start < f && E.clipEnd(c) > f;
  const sc = selClips().filter(({ c }) => under(c));
  const tracks = sc.length ? [...new Set(sc.map(({ t }) => t))] : targetTracks();
  const ids = sc.length ? new Set(sc.map(({ c }) => c.id)) : null;
  const hit = tracks.filter((t) => t.clips.some((c) => (!ids || ids.has(c.id)) && under(c)));
  if (!hit.length) return D.toast('재생 위치에 나눌 클립이 없어요');
  history.commit();
  for (const t of hit) setClips(t.id, t.clips.flatMap((c) => (!ids || ids.has(c.id) ? E.splitClip(c, f) : [c])));
  state.sel.clipIds = new Set();
  afterEdit();
});
def('merge', '클립 합치기', () => {
  const r = state.sel.range, groups = new Map();
  if (r) {
    const inside = (c) => c.start < r.b && E.clipEnd(c) > r.a;
    for (const t of rangeTracks()) groups.set(t.id, new Set(t.clips.filter(inside).map((c) => c.id)));
  } else {
    for (const { t, c } of selClips()) {
      if (!groups.has(t.id)) groups.set(t.id, new Set());
      groups.get(t.id).add(c.id);
    }
  }
  const jobs = [...groups].map(([id, ids]) => ({ id, res: E.merge(trackById(id).clips, ids) })).filter((j) => j.res);
  if (!jobs.length) return D.toast('같은 트랙에서 클립을 2개 이상 선택하세요');
  history.commit();
  for (const j of jobs) setClips(j.id, j.res.clips);
  state.sel.range = null;
  state.sel.clipIds = new Set(jobs.map((j) => j.res.clip.id));
  afterEdit();
});
// Audacity-style: selected audio to new track(s) at the same time
function duplicateRange(r) {
  const ts = rangeTracks().map((t) => ({ t, ch: E.renderRegion(t.clips, r.a, r.b) })).filter((x) => x.ch);
  if (!ts.length) return;
  history.commit();
  for (const { t, ch } of ts) {
    const clip = E.makeClip(E.makeSource(ch), r.a, t.name);
    addTrack({ clips: [clip], ...(!curLine() && { name: t.name + ' 복제' }) });
  }
  afterEdit();
}
def('duplicate', '복제', () => {
  if (state.sel.range) return duplicateRange(state.sel.range);
  const sc = selClips();
  if (!sc.length) return D.toast('복제할 클립이나 구간을 선택하세요');
  const dx = Math.max(...sc.map(({ c }) => E.clipEnd(c))) - Math.min(...sc.map(({ c }) => c.start));
  history.commit();
  const newIds = new Set();
  for (const { t, c } of sc) {
    const n = { ...c, id: E.uid('c'), start: c.start + dx };
    newIds.add(n.id);
    setClips(t.id, E.sortClips([...trackById(t.id).clips, n]));
  }
  state.sel.clipIds = newIds;
  afterEdit();
});
def('keep', '선택만 남기기', () => {
  const r = state.sel.range;
  if (!r) return D.toast('남길 구간을 먼저 선택하세요');
  history.commit();
  for (const t of rangeTracks()) setClips(t.id, E.keepRange(t.clips, r.a, r.b));
  afterEdit();
}, () => !!state.sel.range);
def('insertSilence', '무음 넣기…', async () => {
  const r = state.sel.range, value = r ? +((r.b - r.a) / sr()).toFixed(1) || 1 : 1;
  const v = await D.modal({ title: '무음 넣기', note: '재생 위치(선택 구간이 있으면 그 시작)에 빈 시간을 끼워 넣고 뒤를 밀어요.',
    fields: [{ key: 'sec', label: '길이', min: 0.1, max: 600, step: 0.1, value, unit: '초' }] });
  if (!v) return;
  const at = r ? r.a : state.sel.playhead, len = frames(v.sec);
  history.commit();
  const ts = targetTracks();
  for (const t of ts) setClips(t.id, E.insertGap(t.clips, at, len));
  rippleMarkers(new Set(ts.map((t) => t.id)), at, at, len);
  afterEdit();
});

// keyboard alternative to dragging clips (ui-guide: dragging-alternative)
function nudge(df) {
  if (!selClips().length) return D.toast('옮길 클립을 선택하세요');
  history.commit();
  const ids = state.sel.clipIds, moved = (c) => (ids.has(c.id) ? { ...c, start: Math.max(0, c.start + df) } : c);
  for (const t of T()) if (t.clips.some((c) => ids.has(c.id))) setClips(t.id, E.sortClips(t.clips.map(moved)));
  afterEdit();
}
function moveTracks(dir) {
  const sc = selClips();
  if (!sc.length) return D.toast('옮길 클립을 선택하세요');
  if (sc.some(({ t }) => !T()[trackIndex(t.id) + dir])) return;
  history.commit();
  const ids = state.sel.clipIds, moving = sc.map(({ t, c }) => ({ to: T()[trackIndex(t.id) + dir].id, c }));
  for (const t of T()) setClips(t.id, t.clips.filter((c) => !ids.has(c.id)));
  for (const { to, c } of moving) setClips(to, E.sortClips([...trackById(to).clips, c]));
  afterEdit();
}
def('nudgeLeft', '클립 0.1초 왼쪽', () => nudge(-frames(0.1)));
def('nudgeRight', '클립 0.1초 오른쪽', () => nudge(frames(0.1)));
def('nudgeLeftBig', '클립 1초 왼쪽', () => nudge(-frames(1)));
def('nudgeRightBig', '클립 1초 오른쪽', () => nudge(frames(1)));
def('clipsUp', '클립을 위 트랙으로', () => moveTracks(-1));
def('clipsDown', '클립을 아래 트랙으로', () => moveTracks(1));

module.exports = { rippleMarkers };
