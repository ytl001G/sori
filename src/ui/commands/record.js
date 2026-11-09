// Recording: into a new track (overdub) or, in a script project, a new take of the current line.
const E = require('../../core/edit');
const SCR = require('../../core/script');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { def, T, SC, curLine, setLine } = require('./core');
const { metroOpts, pause } = require('./play');
const { newTake } = require('./script');
const { state, history, makeTrack, setDirty, changed, sr } = require('../../core/state');

let rec = null; // { trackId, start, lineId }
let recBusy = false; // mic opening / stopping: ignore repeated presses
const recInfo = () => rec;
const busy = () => recBusy;
// frames cut from the take's start: audio from before playback was audible + the mic latency setting
const recTrim = (leadSec) => Math.round((leadSec + S.get().latencyMs / 1000) * sr());

// the take being recorded: on screen, or (script mode) in its line's takes when the person moved to another line
// while recording (buttons keep working, the sound stays in this take)
function recSpot(id, lineId) {
  const i = T().findIndex((t) => t.id === id);
  if (i >= 0) {
    const put = (t) => (t ? T().map((x) => (x.id === id ? t : x)) : T().filter((x) => x.id !== id));
    return { t: T()[i], set: (t) => { state.project.tracks = put(t); } };
  }
  const l = lineId && SC() && SC().lines.find((x) => x.id === lineId);
  const k = l ? l.takes.findIndex((t) => t.id === id) : -1;
  if (k < 0) return null;
  const put = (t) => (t ? l.takes.map((x) => (x.id === id ? t : x)) : l.takes.filter((x) => x.id !== id));
  return { t: l.takes[k], set: (t) => setLine(l.id, { takes: put(t) }) };
}

// the recorded sound goes into its take; a line's first take gets ★ (★ never jumps to another take by itself)
function keepTake(at, ch, { trackId, start, lineId }, quiet) {
  const t = { ...at.t, clips: E.sortClips([...at.t.clips, E.makeClip(E.makeSource(ch), start, at.t.name)]) };
  at.set(t);
  const l = lineId && SC().lines.find((x) => x.id === lineId), here = l && l.id === SC().lineId;
  const first = l && !l.star, starred = l && (first || l.star === trackId);
  if (first) setLine(l.id, SCR.withStar(trackId));
  if (here) { state.sel.playhead = 0; state.sel.activeTrackId = trackId; } // the new take selected: Space plays it
  else if (!l) state.sel.playhead = start + ch[0].length;
  if (quiet) return;
  const star = starred ? '★ 이 테이크를 내보내요' : '이 테이크를 내보내려면 ★를 누르세요';
  D.toast(!l ? '녹음을 추가했어요' : `${here ? '' : SCR.lineName(l) + ' '}${t.name} 녹음했어요 · ${star}`);
}
async function stopRecording(quiet) {
  recBusy = true;
  let res;
  try { res = (await engine.stopRecording()) || { ch: null, lead: 0 }; } finally { recBusy = false; }
  const lead = recTrim(res.lead);
  const ch = res.ch && res.ch[0].length > lead ? res.ch.map((c) => c.slice(lead)) : null;
  engine.stop();
  state.recording = false; state.playing = false;
  const done = rec;
  rec = null;
  const at = recSpot(done.trackId, done.lineId);
  // the take becomes one undo step now, on its line (still hidden from this snapshot)
  if (ch && at) history.commit(done.lineId);
  history.hide = null;
  if (at && !ch) at.set(null); // nothing kept (stopped during the count-in): no empty take
  else if (at) keepTake(at, ch, done, quiet);
  return changed();
}
// before 대본 넣기 or an unsaved-changes question: a recording stops first and its take is kept; false while the
// mic is still opening or closing
async function stopFirst() {
  if (recBusy) return false;
  if (state.recording) await stopRecording();
  return true;
}
// a new project or file: the recording ends without a take
function dropRecording() {
  if (!state.recording) return;
  engine.stopRecording(); rec = null; state.recording = false;
}

// mic first: a refusal must not leave a track or undo step behind
async function openMic() {
  const s = S.get();
  recBusy = true;
  try {
    const r = await engine.startRecording({ deviceId: s.inputId, channels: s.recChannels });
    if (r.fellBack) D.toast('설정에서 고른 마이크가 없어서 기본 마이크로 녹음해요');
    return true;
  } catch (e) {
    D.toast('마이크를 쓸 수 없어요. Windows 설정 > 개인 정보 > 마이크에서 앱 접근을 허용했는지, 설정 > 오디오 장치에서 '
      + '마이크를 골랐는지 확인하세요', 'error');
    return false;
  } finally { recBusy = false; }
}
def('record', '녹음', async () => {
  if (recBusy) return;
  if (state.recording) return stopRecording();
  pause();
  if (!(await openMic())) return changed();
  const line = curLine(), n = T().filter((x) => x.name.startsWith('녹음')).length + 1;
  const t = line ? newTake() : makeTrack({ name: '녹음 ' + n });
  setDirty(true); // the undo step comes on stop; edits made while recording are their own steps
  history.hide = t.id;
  state.project.tracks = [...T(), t];
  // a take always starts at 0 s
  rec = { trackId: t.id, start: line ? 0 : state.sel.playhead, lineId: line ? line.id : null };
  state.sel.activeTrackId = t.id;
  state.recording = true;
  const countIn = S.get().countIn * state.project.beats * 60 / state.project.bpm;
  // overdub: hear the other tracks; count-in clicks first (the mic audio from that time is cut on stop)
  // takes: hear only yourself
  const others = line ? [] : T().filter((x) => x.id !== t.id);
  engine.play(others, state.project.master, rec.start, Infinity, { metro: metroOpts(), countIn });
  state.playing = true;
  changed();
});

module.exports = { recInfo, recTrim, busy, recSpot, stopRecording, stopFirst, dropRecording };
