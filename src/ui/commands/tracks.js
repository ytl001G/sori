// Tracks: add (empty, typed, duplicate), move, remove, mixer values; track / master / character effects and the
// mixer and effect panels (live, not in history: spec §5-1).
const E = require('../../core/edit');
const P = require('../../core/fxparams');
const V = require('../../core/voice');
const SCR = require('../../core/script');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { named } = require('../tips');
const { cmds, def, T, activeTrack, SC, curLine, setLine } = require('./core');
const { newTake } = require('./script');
const { audible, afterEdit } = require('./play');
const R = require('./record');
const {
  state, history, makeTrack, setDirty, changed, trackById, trackIndex, sr, sortByName,
} = require('../../core/state');

function insertTrack(t) { // right below the current track
  history.commit();
  const ts = [...T()], i = trackIndex(state.sel.activeTrackId);
  ts.splice(i < 0 ? ts.length : i + 1, 0, t);
  state.project.tracks = ts;
  state.sel.activeTrackId = t.id;
  afterEdit();
}
const fxOn = (kind, values) => P.clampFx(kind, { ...values, on: true });
const preset = (kind, name) => P.PRESETS[kind].find((p) => p.name === name).values;
const typedTrack = (name, db, fx = () => ({})) => () => insertTrack(makeTrack({
  name, gain: 10 ** (db / 20), fx: { ...P.defaultFx(P.TRACK_KINDS), ...fx() },
}));
const plain = () => !SC(); // script mode adds takes by recording, not tracks
// a script project: an empty take at the bottom of the current line, selected, ★ as it was ([+ 테이크]);
// one command and key (Ctrl+Shift+N) for both kinds of project: an empty row
function addTake() {
  history.commit();
  const t = newTake();
  state.project.tracks = [...T(), t];
  state.sel.activeTrackId = t.id;
  afterEdit();
}
def('addTrack', '빈 트랙', () => (SC() ? addTake() : insertTrack(makeTrack())),
  () => plain() || (!!curLine() && !state.recording));
Object.defineProperty(cmds.addTrack, 'label', { get: () => (SC() ? '빈 테이크' : '빈 트랙') });
def('dupTrack', '지금 트랙 복제', () => {
  const t = activeTrack();
  if (!t) return;
  const { id, color } = makeTrack(); // fx is replaced, never mutated (setFx), so sharing it is safe
  insertTrack({ ...t, id, color, name: t.name + ' 복제', clips: t.clips.map((c) => ({ ...c, id: E.uid('c') })) });
}, () => plain() && !!activeTrack());
const voiceFx = () => ({ eq: fxOn('eq', preset('eq', '목소리 또렷하게')), comp: fxOn('comp', preset('comp', '목소리 고르게')) });
def('addVoiceTrack', '목소리 트랙', typedTrack('목소리', 0, voiceFx), plain);
// leaves room for a voice
def('addMusicTrack', '배경음악 트랙', typedTrack('배경음악', -12, () => ({ eq: fxOn('eq', { mid: -3, midFreq: 2500 }) })), plain);
def('addSfxTrack', '효과음 트랙', typedTrack('효과음', -6), plain);

function moveTrack(id, to) {
  const ts = [...T()], i = ts.findIndex((t) => t.id === id);
  to = Math.max(0, Math.min(ts.length - 1, to));
  if (i < 0 || i === to) return;
  history.commit(null, SCR.unit(state.project) + ' 옮기기');
  ts.splice(to, 0, ...ts.splice(i, 1));
  state.project.tracks = ts;
  state.sel.activeTrackId = id;
  afterEdit();
}
const shiftTrack = (d) => { const t = activeTrack(); if (t) moveTrack(t.id, trackIndex(t.id) + d); };
def('trackUp', '트랙 위로 옮기기', () => shiftTrack(-1), () => trackIndex(state.sel.activeTrackId) > 0);
def('trackDown', '트랙 아래로 옮기기', () => shiftTrack(1),
  () => !!activeTrack() && trackIndex(activeTrack().id) < T().length - 1);
// always the same order (no reverse); a script project keeps its takes as they are
def('sortTracks', '이름순 정렬', () => {
  const ts = sortByName(T());
  if (ts.every((t, i) => t === T()[i])) return D.toast('이미 이름순이에요');
  history.commit();
  state.project.tracks = ts;
  afterEdit();
}, () => !state.project.script && T().length > 1);
function removeTrack(id) {
  const t = trackById(id), rec = R.recInfo();
  if (!t || R.busy()) return;
  // the recording stops, its take goes
  if (rec && rec.trackId === id) return R.stopRecording(true).then(() => removeTrack(id));
  history.commit(null, SCR.unit(state.project) + ' 삭제');
  state.project.tracks = T().filter((x) => x.id !== id);
  if (state.sel.activeTrackId === id) state.sel.activeTrackId = T()[0] ? T()[0].id : null;
  if (state.sel.range) state.sel.range.trackIds.delete(id);
  const l = curLine();
  if (l && l.star === id) setLine(l.id, { star: null }); // no ★ until the person picks one
  afterEdit();
  const back = `${named('undo', '실행취소')}로 되돌리기`;
  D.toast(l ? `지웠어요: ${t.name} · ${back}` : `'${t.name}' 트랙을 삭제했어요 · ${back}`);
}
// live: heard at once, saved, not an undo step
function liveChange() {
  engine.updateMix(audible(), state.project.master);
  state.backupDue = true; // setDirty is skipped while already unsaved (no IPC per slider move), the edit still counts
  if (state.dirty) state.edits++; else setDirty(true);
  changed();
}
function mixer(id, patch) { // live, not in history
  const t = trackById(id);
  if (!t) return;
  Object.assign(t, patch);
  liveChange();
}

// 전기 웅 소리 turned on: listen once to that channel's sound for 50 or 60 Hz; null = no sound to go by.
// A character: its takes as saved (linesNow: the current line's takes are the lanes)
function heardHum(target) {
  const name = String(target).startsWith('char:') && target.slice(5);
  const lanes = name ? SCR.linesNow(state.project).filter((l) => l.char === name).flatMap((l) => l.takes)
    : [trackById(target)];
  return V.heardHum(lanes, sr());
}
function setFx(target, kind, patch) {
  const next = (fx) => {
    const n = P.clampFx(kind, { ...fx[kind], ...patch });
    if (kind === 'hum' && n.on && !fx[kind].on && patch.freq === undefined) n.freq = heardHum(target) || n.freq;
    return { ...fx, [kind]: n };
  };
  if (target === 'master') {
    const m = state.project.master;
    if (kind === 'gain') m.gainDb = P.clampMaster({ ...m, gainDb: patch.gainDb }).gainDb;
    else m.fx = next(m.fx);
  } else if (String(target).startsWith('char:')) { // one set per character: every take of every line
    const name = target.slice(5), c = SC() && SC().chars[name];
    if (!c) return;
    c.fx = next(c.fx);
    if (curLine().char === name) for (const t of T()) t.fx = c.fx;
  } else {
    const t = trackById(target);
    if (!t) return;
    t.fx = next(t.fx);
  }
  liveChange();
}
function setPanel(key, on) { state.ui[key] = on; S.set({ [key]: on }); changed(); }
// a take's effects are its character's (script mode)
const fxKey = (id) => (curLine() && id !== 'master' && !String(id).startsWith('char:') ? 'char:' + curLine().char : id);
function showFx(target) {
  state.ui.fxTarget = fxKey(target);
  state.ui.fxTab = 'fx';
  if (!state.ui.fxPanel) setPanel('fxPanel', true);
  changed();
}
// the right panel's two tabs: F8 효과, F6 실행취소 기록. Each key shows its tab; on its own tab it closes the panel
const showing = (tab) => state.ui.fxPanel && state.ui.fxTab === tab;
function panelTab(tab) {
  if (showing(tab)) return setPanel('fxPanel', false);
  state.ui.fxTab = tab;
  setPanel('fxPanel', true);
}
def('toggleMixer', '믹서', () => setPanel('mixer', !state.ui.mixer), null, () => state.ui.mixer);
def('toggleFxPanel', '효과 패널', () => panelTab('fx'), null, () => showing('fx'));
def('toggleHistory', '실행취소 기록', () => panelTab('history'), null, () => showing('history'));
// script mode: the line list on the left (F7); the line bar above stays, so ↑/↓ still move through the lines
def('toggleLines', '대사 목록', () => setPanel('lines', !state.ui.lines), () => !!state.project.script,
  () => state.ui.lines);
def('masterFx', '마스터 효과', () => showFx('master'));
def('trackFx', '이 트랙 효과', () => { const t = activeTrack(); if (t) showFx(t.id); }, () => !!activeTrack());
// the whole timeline: a view, not an edit (no undo step, not saved); every launch starts as 파형
def('toggleSpec', '스펙트로그램으로 보기', () => { state.view.spec = !state.view.spec; changed(); }, null,
  () => state.view.spec);

module.exports = { removeTrack, moveTrack, mixer, setFx, showFx, fxKey };
