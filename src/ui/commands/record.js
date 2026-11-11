// Recording: into a new track (overdub) or, in a script project, a new take of the current line.
const E = require('../../core/edit');
const SCR = require('../../core/script');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { def, T, SC, curLine, setLine } = require('./core');
const { metroOpts, pause } = require('./play');
const { newTake } = require('./script');
const { state, history, makeTrack, setDirty, setHolding, changed, sr } = require('../../core/state');

// { trackId, start, lineId }; 이어 녹음 (spec §5-5): no take, cont = { order: line ids, at: the cued one, marks: frames
// of the raw recording where N was pressed }
let rec = null;
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
  try { res = (await engine.stopRecording(recTrim)) || { ch: null, lead: 0 }; } finally { recBusy = false; }
  const lead = recTrim(res.lead), ch = res.ch; // cut while joined: no second copy
  engine.stop();
  state.recording = false; state.playing = false;
  const done = rec;
  rec = null;
  // 이어 녹음: the whole recording goes to the 나누기 window (after the caller, e.g. a move to another line, is done)
  if (done.cont) {
    if (ch) setTimeout(() => require('./longrec').review(ch, done.cont, lead));
    else setHolding(false);
    return changed();
  }
  const at = recSpot(done.trackId, done.lineId);
  // the take becomes one undo step now, on its line (still hidden from this snapshot)
  if (ch && at) history.commit(done.lineId);
  history.hide = null;
  if (at && !ch) { // nothing kept (stopped during the count-in): no empty take
    at.set(null);
    if (history.top() === done.was.top) { setDirty(done.was.dirty); state.backupDue = done.was.due; }
  }
  else if (at) keepTake(at, ch, done, quiet);
  return changed();
}
// before 대본 넣기 or an unsaved-changes question: a recording stops first and its take is kept; false while the
// mic is still opening or closing
async function stopFirst() {
  if (recBusy) return false;
  if (rec && rec.cont) { D.toast('이어 녹음 중이에요. Shift+R로 멈추고 나눈 뒤에 해 주세요'); return false; }
  if (state.recording) await stopRecording();
  return true;
}
// a new project or file: the recording ends without a take
function dropRecording() {
  if (!state.recording) return;
  engine.stopRecording(); rec = null; state.recording = false;
  if (state.holding) setHolding(false);
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
// R: a new take (script) or track; cont (이어 녹음): one long recording, no take, the cued line on the prompter
async function begin(cont) {
  if (state.holding) return; // the last 이어 녹음 waits for its 나누기 window (a quick second Shift+R or R)
  pause();
  if (!(await openMic())) return changed();
  const line = curLine(), take = line && !cont, n = T().filter((x) => x.name.startsWith('녹음')).length + 1;
  const t = cont ? null : take ? newTake() : makeTrack({ name: '녹음 ' + n });
  if (cont) setHolding(true); // closing the app asks: this sound lives only in memory until 적용
  // nothing kept on stop (the count-in): a saved project stays saved unless an edit came meanwhile (top moves)
  const was = { dirty: state.dirty, due: state.backupDue, top: history.top() };
  if (t) {
    setDirty(true); // the undo step comes on stop; edits made while recording are their own steps
    history.hide = t.id;
    state.project.tracks = [...T(), t];
    state.sel.activeTrackId = t.id;
  }
  // a take always starts at 0 s
  rec = { trackId: t && t.id, start: line ? 0 : state.sel.playhead, lineId: take ? line.id : null, cont, was };
  state.recording = true;
  const countIn = S.get().countIn * state.project.beats * 60 / state.project.bpm;
  // overdub: hear the other tracks; count-in clicks first (the mic audio from that time is cut on stop)
  // takes: hear only yourself
  const others = line ? [] : T().filter((x) => x.id !== t.id);
  engine.play(others, state.project.master, rec.start, { metro: metroOpts(), countIn });
  state.playing = true;
  changed();
}
def('record', '녹음', async () => {
  if (recBusy) return;
  if (state.recording) return stopRecording();
  return begin(null);
});

module.exports = { recInfo, recTrim, busy, recSpot, stopRecording, stopFirst, dropRecording, begin };
