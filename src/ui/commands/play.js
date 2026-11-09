// Playback: play / pause / stop, the play position, loop, the metronome while playing. afterEdit restarts playback
// on the edited project.
const E = require('../../core/edit');
const SCR = require('../../core/script');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const { cmds, def, tl, T, frames, SC, curLine } = require('./core');
const { state, changed } = require('../../core/state');

// what plays in a script project: the selected take, fixed when playback starts. Whatever is playing keeps
// playing until it stops (★, another take only change the next play); moving to another line stops it,
// so it is always a take on screen. Takes have no M/S: stored flags are ignored.
// ★ is what exports.
let playTake = null, playStart = 0;
function audible() {
  const l = curLine();
  if (!l) return T();
  const id = state.playing ? playTake : state.sel.activeTrackId, t = T().find((x) => x.id === id);
  return t ? [{ ...SCR.takeView(t, SC().chars[l.char]), mute: false, solo: false }] : [];
}
// stopping a take that is no longer on screen (its ✕ while playing): this line starts at 0
const landAt = (f) => (curLine() && !T().some((t) => t.id === playTake) ? 0 : f);

const metroOpts = () => ({
  on: S.get().metronome, bpm: state.project.bpm, beats: state.project.beats, volume: S.get().metroVol / 100 * 0.8,
});
const syncMetro = () => engine.setMetro(metroOpts()); // running playback/recording keeps going
function startPlay(from, countIn = 0) {
  if (!state.playing) playTake = curLine() ? state.sel.activeTrackId : null;
  const opts = { metro: metroOpts(), countIn }, r = state.sel.range;
  // shortcut: a loop pass ends at r.b and tick restarts it (~50 ms gap); gapless needs the next pass pre-scheduled
  const to = state.loop && r && from < r.b ? r.b : Infinity;
  engine.play(audible(), state.project.master, Math.max(0, Math.round(from)), to, opts);
  state.playing = true;
}
function pause() {
  if (!state.playing) return;
  state.sel.playhead = landAt(Math.round(engine.position()));
  engine.stop();
  state.playing = false;
}
function afterEdit() {
  if (state.playing && !state.recording) startPlay(engine.position());
  changed();
}

def('playPause', '재생 / 일시정지', () => {
  if (state.recording) return cmds.record.run();
  if (state.playing) { pause(); return changed(); }
  let f = state.sel.playhead;
  const r = state.sel.range;
  if (state.loop && r && (f < r.a || f >= r.b)) f = r.a;
  else if (f >= E.projectEnd(T())) f = 0;
  playStart = f;
  startPlay(f);
  changed();
}, () => state.playing || state.recording || E.projectEnd(audible()) > 0); // nothing to play: greyed out
def('stop', '정지', () => {
  if (state.recording) return cmds.record.run();
  if (state.playing) state.sel.playhead = landAt(S.get().stopReturn ? playStart : Math.round(engine.position()));
  engine.stop();
  state.playing = false;
  changed();
});

// called every animation frame by app.js
function tick() {
  if (!state.playing) return;
  let pos = engine.position();
  const r = state.sel.range, end = E.projectEnd(audible()); // script mode: the end of the take being heard
  const tail = engine.tailLen(audible(), state.project.master); // plays on until the reverb/echo tail ends, as export
  if (state.loop && r && pos >= r.b && !state.recording) { startPlay(r.a); pos = r.a; }
  else if (!state.recording && pos >= end + tail + frames(0.05)) {
    engine.stop(); state.playing = false; pos = landAt(end);
  }
  state.sel.playhead = Math.round(pos);
}

// follow=false for mouse clicks: the view must not jump under the pointer
const seek = (f, follow = true) => {
  const p = Math.max(0, Math.round(f));
  state.sel.playhead = p;
  if (state.playing && !state.recording) { playStart = p; startPlay(p); }
  if (follow) tl().reveal(p);
  changed();
};
def('toHome', '처음으로', () => seek(0));
def('toEnd', '끝으로', () => seek(E.projectEnd(T())));
def('back1', '1초 뒤로', () => seek(state.sel.playhead - frames(1)));
def('fwd1', '1초 앞으로', () => seek(state.sel.playhead + frames(1)));
def('back01', '0.1초 뒤로', () => seek(state.sel.playhead - frames(0.1)));
def('fwd01', '0.1초 앞으로', () => seek(state.sel.playhead + frames(0.1)));
def('toggleLoop', '반복 재생', () => { state.loop = !state.loop; changed(); });

module.exports = { audible, metroOpts, syncMetro, pause, afterEdit, tick, seek };
