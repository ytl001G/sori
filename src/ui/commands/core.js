// The command registry and what every command group shares: the selection, the tracks on screen, the current line.
const D = require('../dialogs');
const { state, trackById, sr } = require('../../core/state');

const cmds = {};
// checked(): menu items show a check mark (toggles)
const def = (name, label, run, enabled, checked) => { cmds[name] = { name, label, run, enabled, checked }; };
function run(name, ...args) {
  const c = cmds[name];
  if (!c || (c.enabled && !c.enabled())) return;
  return Promise.resolve(c.run(...args)).catch((e) => D.toast('문제가 생겼어요: ' + e.message, 'error'));
}
const tl = () => require('../timeline'); // lazy: timeline requires commands too

const T = () => state.project.tracks;
const frames = (sec) => Math.round(sec * sr());
const hasAudio = () => T().some((t) => t.clips.length);
const selClips = () => T().flatMap((t) => t.clips.filter((c) => state.sel.clipIds.has(c.id)).map((c) => ({ t, c })));
const rangeTracks = () => (state.sel.range ? T().filter((t) => state.sel.range.trackIds.has(t.id)) : []);
// the range's tracks, else the current track, else all
function targetTracks() {
  const r = rangeTracks();
  if (r.length) return r;
  const a = trackById(state.sel.activeTrackId);
  return a ? [a] : T();
}
const setClips = (id, clips) => { state.project.tracks = T().map((t) => (t.id === id ? { ...t, clips } : t)); };
const clearSel = () => { state.sel.range = null; state.sel.clipIds = new Set(); };
const hasSel = () => !!state.sel.range || state.sel.clipIds.size > 0;
const activeTrack = () => trackById(state.sel.activeTrackId);

// script mode (spec §5-5): project.tracks = the current line's takes
const SC = () => state.project.script;
const curLine = () => SC() && SC().lines.find((l) => l.id === SC().lineId);
const setLine = (id, patch) => { SC().lines = SC().lines.map((l) => (l.id === id ? { ...l, ...patch } : l)); };

module.exports = {
  cmds, def, run, tl, T, frames, hasAudio, selClips, rangeTracks, targetTracks, setClips, clearSel, hasSel,
  activeTrack, SC, curLine, setLine,
};
