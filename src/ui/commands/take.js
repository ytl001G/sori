// `sori live <file command>` (src/ui/live.js): the command ran on a copy; take its result like an app edit. Only what
// the app's undo covers (tracks, clips, track colors, markers, lines) is an undo step; mixer values, names, effects,
// character colors and tempo are live in the app too.
const SCR = require('../../core/script');
const { T, curLine } = require('./core');
const { afterEdit } = require('./play');
const { showLine, viewTakes, enterScript, leaveScript } = require('./script');
const { state, history, setDirty, tidySel, trackById } = require('../../core/state');

// restore() brings back ids, order and clips (+ a track's color, lines' text, memo, state, ★); the rest stays live
const same = (a, b, color) => a.length === b.length
  && a.every((t, i) => t.id === b[i].id && t.clips === b[i].clips && (!color || t.color === b[i].color));
const LINE_KEYS = ['text', 'memo', 'state', 'star'];
// { step: whether it is an undo step, at: the line undo should show }
function undoStep(p, next) {
  const s = p.script;
  if (!!s !== !!next.script || next.markers !== p.markers) return { step: true };
  if (!s) return { step: !same(next.tracks, p.tracks, true) };
  const was = new Map(SCR.linesNow(p).map((l) => [l.id, l])), now = SCR.linesNow(next);
  const moved = now.filter((l) => {
    const o = was.get(l.id);
    return !o || LINE_KEYS.some((k) => o[k] !== l[k]) || !same(o.takes, l.takes);
  });
  // undo shows the line the step changed
  const at = moved.length === 1 && moved[0].id !== s.lineId ? moved[0].id : undefined;
  return { step: moved.length > 0 || now.length !== was.size, at };
}

// Returns whether it made an undo step.
function takeProject(next) {
  const p = state.project, s = p.script, { step, at } = undoStep(p, next);
  if (step) history.commit(at);
  else setDirty(true);
  const { range, clipIds, activeTrackId } = state.sel;
  Object.assign(p, next);
  if (!s && p.script) enterScript(); // 대본 넣기 / 보통 프로젝트로 바꾸기 from the CLI: what the menu command shows
  else if (s && !p.script) leaveScript();
  else if (p.script && p.script.lineId !== s.lineId) showLine(curLine()); // the current line left the script
  else if (p.script) { // re-view the line: its takes, character colors and effects; the selection stays where it can
    viewTakes(activeTrackId);
    Object.assign(state.sel, { range, clipIds });
  } else if (!trackById(activeTrackId)) state.sel.activeTrackId = T()[0] ? T()[0].id : null; // like removeTrack
  tidySel();
  afterEdit();
  return !!step;
}

module.exports = { takeProject };
