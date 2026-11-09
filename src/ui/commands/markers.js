// Markers (undoable, saved in the project) and the tempo grid, metronome and snap.
const E = require('../../core/edit');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { def, frames } = require('./core');
const { seek, syncMetro } = require('./play');
const { state, history, setDirty, changed } = require('../../core/state');

const MK = () => state.project.markers;
const sortM = (ms) => ms.slice().sort((a, b) => a.frame - b.frame);
const selMarker = () => MK().find((m) => m.id === state.sel.markerId);
const nowFrame = () => (state.playing ? Math.round(engine.position()) : state.sel.playhead);

def('addMarker', '마커 추가', () => {
  const f = nowFrame();
  if (MK().some((m) => m.frame === f)) return D.toast('이 위치에 이미 마커가 있어요');
  const used = new Set(MK().map((m) => m.name));
  let n = MK().length + 1;
  while (used.has('마커 ' + n)) n++;
  history.commit();
  const m = { id: E.uid('m'), frame: f, name: '마커 ' + n };
  state.project.markers = sortM([...MK(), m]);
  state.sel.markerId = m.id;
  changed();
});
function jumpMarker(dir) {
  const p = nowFrame(), grace = state.playing ? frames(0.3) : 0; // while playing, [ skips the marker just passed
  const m = dir > 0 ? MK().find((x) => x.frame > p) : [...MK()].reverse().find((x) => x.frame < p - grace);
  if (!m) return;
  state.sel.markerId = m.id;
  seek(m.frame);
}
def('prevMarker', '이전 마커로', () => jumpMarker(-1), () => MK().length > 0);
def('nextMarker', '다음 마커로', () => jumpMarker(1), () => MK().length > 0);
def('markerRename', '마커 이름 바꾸기…', async () => {
  const m = selMarker();
  if (!m) return;
  const v = await D.modal({ title: '마커 이름', fields: [{ key: 'name', label: '이름', text: true, value: m.name }],
    okLabel: '바꾸기' });
  const name = v && String(v.name).trim().slice(0, 100);
  if (!name || name === m.name) return;
  history.commit();
  state.project.markers = MK().map((x) => (x.id === m.id ? { ...x, name } : x));
  changed();
}, () => !!selMarker());
def('markerDelete', '마커 삭제', () => {
  const m = selMarker();
  if (!m) return;
  history.commit();
  state.project.markers = MK().filter((x) => x.id !== m.id);
  state.sel.markerId = null;
  changed();
  D.toast(`'${m.name}' 마커를 삭제했어요 · Ctrl+Z로 되돌리기`);
}, () => !!selMarker());
// timeline drag; the caller commits history once per drag
function moveMarker(id, frame) {
  state.project.markers = sortM(MK().map((m) => (m.id === id ? { ...m, frame: Math.max(0, Math.round(frame)) } : m)));
  changed();
}

// tempo is a project setting like the mixer: saved, not an undo step
function setTempo(bpm, beats) {
  const p = state.project;
  const nb = Math.max(20, Math.min(300, Math.round(+bpm) || p.bpm));
  const nbe = Math.max(1, Math.min(12, Math.round(+beats) || p.beats));
  if (nb === p.bpm && nbe === p.beats) return;
  p.bpm = nb; p.beats = nbe;
  syncMetro();
  setDirty(true);
}
def('toggleGrid', '박자 격자', () => {
  state.project.grid = state.project.grid === 'beats' ? 'time' : 'beats';
  setDirty(true);
}, null, () => state.project.grid === 'beats');
// app.js applies it live
def('toggleMetro', '메트로놈', () => S.set({ metronome: !S.get().metronome }), null, () => S.get().metronome);
def('toggleSnap', '스냅 (끝·박자에 붙기)', () => S.set({ snap: !S.get().snap }), null, () => S.get().snap);

module.exports = { moveMarker, setTempo };
