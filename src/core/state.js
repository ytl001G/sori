// App state, selection and undo history. Views read `state`; commands mutate it.
const { uid, srcLen } = require('./edit');
const P = require('./fxparams');
const SC = require('./script');

const COLORS = ['#38BDF8', '#A78BFA', '#F472B6', '#FBBF24', '#34D399', '#FB923C', '#60A5FA', '#E879F9'];
let colorIdx = 0;

const state = {
  project: newProjectData(48000),
  sel: { range: null, clipIds: new Set(), activeTrackId: null, playhead: 0, markerId: null },
  // scrollX in seconds, scrollY in px; snap/follow/laneH come from settings + toolbar
  // 스펙트로그램 보기 is for the whole timeline; not saved anywhere, every launch starts as 파형
  view: { pxPerSec: 80, scrollX: 0, scrollY: 0, follow: true, laneH: 96, spec: false },
  // fxTarget: 'master', a track id, or 'char:<name>' (script mode: one effect set per character)
  // scriptView: line list filter (script mode) — character tab ('' = all), only unrecorded
  ui: { mixer: false, fxPanel: false, fxTarget: 'master', scriptView: { char: '', todo: false } },
  playing: false, loop: false, recording: false,
  filePath: null, dirty: false, edits: 0, clipboard: null, noiseProfile: null,
  // 자동 백업 (ui/commands/backup.js): a change since the last backup; saveHint: where 저장 suggests for an opened backup
  backupDue: false, saveHint: null,
  listeners: new Set(),
};

// markers: [{ id, frame, name }] sorted by frame; grid 'time' | 'beats'; script: null or a script project
// (core/script.js)
function newProjectData(sampleRate, props = {}) {
  return {
    sampleRate, tracks: [], master: P.defaultMaster(), markers: [], bpm: 120, beats: 4, grid: 'time', script: null,
    ...props,
  };
}

// p: the project it is numbered against (sori live batch: a copy of the open one)
function makeTrack(props = {}, p = state.project) {
  return { id: uid('t'), name: '트랙 ' + (p.tracks.length + 1), color: COLORS[colorIdx++ % COLORS.length],
    gain: 1, pan: 0, mute: false, solo: false, fx: P.defaultFx(P.TRACK_KINDS), clips: [], ...props };
}

const MAX_HISTORY = 100;
// bytes of unique sample data reachable from the given snapshots and not in `seen` (which collects them)
function sourceBytes(snaps, seen = new Set()) {
  let n = 0;
  const tracksOf = (s) => [...s.tracks, ...(s.script ? s.script.lines.flatMap((l) => l.takes) : [])];
  for (const s of snaps) for (const t of tracksOf(s)) for (const c of t.clips) {
    if (seen.has(c.src)) continue;
    seen.add(c.src);
    n += (c.src.channels || c.src.ch.length) * srcLen(c.src) * 4;
  }
  return n;
}
const undoStack = [], redoStack = [];
let lastRedo = [], lastDirty = false, lastDue = false; // what the last commit cleared / found, back with drop()
// Script projects: the snapshot holds every line with its takes (lines are replaced, never mutated) and the line it
// shows. Undo/redo show the line the step changed: the opposite stack gets the present state viewed at that line.
// history.hide = the take being recorded. While empty it is kept out of every snapshot (commands/edit.js puts it back
// after a restore) and it becomes one undo step when the recording stops; once edits put clips on it, snapshots keep
// it, so those edits undo like any other.
const takesOf = (p) => (p.script ? SC.linesNow(p).flatMap((l) => l.takes) : p.tracks);
function emptyHide(p) {
  const t = history.hide && takesOf(p).find((x) => x.id === history.hide);
  return t && !t.clips.length ? t.id : null;
}
const snapshot = (lineId) => {
  const p = state.project, h = emptyHide(p), out = (ts) => ts.filter((t) => t.id !== h).map((t) => ({ ...t }));
  if (!p.script) return { tracks: out(p.tracks), markers: p.markers, script: null };
  const unhide = (x) => ({ ...x, takes: x.takes.filter((t) => t.id !== h), star: x.star === h ? null : x.star });
  const lines = SC.linesNow(p).map((x) => (h && x.takes.some((t) => t.id === h) ? unhide(x) : x));
  const l = lines.find((x) => x.id === (lineId || p.script.lineId)) || lines.find((x) => x.id === p.script.lineId);
  // chars ride along only for undoing 보통 프로젝트로 바꾸기; while a script exists its character effects stay live
  const script = { lines, lineId: l ? l.id : p.script.lineId, chars: p.script.chars };
  return { tracks: l ? out(l.takes) : out(p.tracks), markers: p.markers, script };
};
const viewOf = (snap) => snap.script && snap.script.lineId;

function restore(snap) {
  // structure comes from the snapshot; live mixer props stay as they are now
  const p = state.project;
  const now = [...p.tracks, ...(p.script ? SC.linesNow(p).flatMap((l) => l.takes) : [])];
  const live = new Map(now.map((t) => [t.id, t]));
  const keep = (t) => {
    const c = live.get(t.id);
    if (!c) return { ...t };
    return { ...t, gain: c.gain, pan: c.pan, mute: c.mute, solo: c.solo, name: c.name, fx: c.fx };
  };
  p.tracks = snap.tracks.map(keep);
  if (!snap.script) p.script = null; // 대본 넣기 into a plain project and 보통 프로젝트로 바꾸기 are undo steps too
  else {
    const sc = p.script || (p.script = { chars: snap.script.chars });
    const relive = (l) => (l.takes.some((t) => live.has(t.id)) ? { ...l, takes: l.takes.map(keep) } : l);
    sc.lines = snap.script.lines.map(relive);
    sc.lineId = snap.script.lineId;
    const l = sc.lines.find((x) => x.id === sc.lineId);
    // character effects are live, not undo steps
    if (l) p.tracks = p.tracks.map((t) => SC.takeView(t, sc.chars[l.char]));
  }
  p.markers = snap.markers;
  tidySel();
}
// the selection and the effect panel only point at what exists (after undo / redo, 대본 넣기 again or a sori live
// edit); a character is one with lines (its look can outlive them)
function tidySel() {
  const p = state.project;
  if (!p.markers.some((m) => m.id === state.sel.markerId)) state.sel.markerId = null;
  const fx = state.ui.fxTarget, name = p.script && String(fx).startsWith('char:') && fx.slice(5);
  const charFx = !!name && SC.linesNow(p).some((l) => l.char === name);
  if (!p.tracks.some((t) => t.id === fx) && !charFx) state.ui.fxTarget = 'master';
  const ids = new Set(state.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  for (const id of state.sel.clipIds) if (!ids.has(id)) state.sel.clipIds.delete(id);
  if (state.sel.range) {
    const tids = new Set(state.project.tracks.map((t) => t.id));
    for (const id of state.sel.range.trackIds) if (!tids.has(id)) state.sel.range.trackIds.delete(id);
  }
}

const history = {
  budget: 0.5e9, // sample bytes only undo keeps alive; long files hit this before MAX_HISTORY
  commit(lineId) { // script projects: lineId = the line the step changes, when it is not the one on screen
    undoStack.push(snapshot(lineId));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    lastRedo = redoStack.splice(0);
    const mine = new Set();
    sourceBytes([snapshot()], mine);
    while (undoStack.length > 1 && sourceBytes(undoStack, new Set(mine)) > history.budget) undoStack.shift();
    lastDirty = state.dirty; lastDue = state.backupDue;
    setDirty(true);
  },
  undo() {
    if (!undoStack.length) return false;
    const s = undoStack.pop(); redoStack.push(snapshot(viewOf(s))); restore(s); setDirty(true); return true;
  },
  redo() {
    if (!redoStack.length) return false;
    const s = redoStack.pop(); undoStack.push(snapshot(viewOf(s))); restore(s); setDirty(true); return true;
  },
  // forget the last commit when the action turned out to change nothing (a saved project stays saved, no backup due)
  drop() {
    undoStack.pop(); redoStack.push(...lastRedo); lastRedo = []; setDirty(lastDirty); state.backupDue = lastDue;
  },
  hide: null,
  clear() { undoStack.length = 0; redoStack.length = 0; lastRedo = []; history.hide = null; },
  depth: () => undoStack.length,
  top: () => undoStack[undoStack.length - 1], // a new object after every commit, undo and redo
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
};

// main asks before the window closes while this is true: unsaved changes, or a long recording that lives only in
// memory (state.holding: 이어 녹음 and its 나누기 window, spec §5-5)
// state.edits counts the changes that made the project unsaved: a save compares it before and after the write, so
// only an edit made meanwhile keeps the project unsaved (a click, a selection or a redraw does not)
function setDirty(v) {
  state.dirty = v;
  if (v) { state.backupDue = true; state.edits++; }
  tellMain(); changed();
}
function setHolding(v) { state.holding = v; tellMain(); changed(); }
function tellMain() {
  const { ipcRenderer } = require('electron'); // undefined under plain Node (tests)
  if (ipcRenderer) ipcRenderer.send('set-dirty', state.dirty || !!state.holding);
}

// views subscribe; app batches redraw
function changed() { for (const f of state.listeners) f(); }

const trackById = (id) => state.project.tracks.find((t) => t.id === id);
const trackIndex = (id) => state.project.tracks.findIndex((t) => t.id === id);
const sr = () => state.project.sampleRate;

// 트랙 > 이름순 정렬 (app and `sori track sort`): 가나다 then A-Z, numbers by size (보컬2 before 보컬10); same names keep
// their order
const NAMES = new Intl.Collator('ko', { numeric: true });
const sortByName = (tracks) => [...tracks].sort((x, y) => NAMES.compare(x.name, y.name));

module.exports = {
  state, history, makeTrack, sortByName, newProjectData, setDirty, setHolding, changed, tidySel, trackById, trackIndex,
  sr, COLORS,
};
