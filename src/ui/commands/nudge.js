// Moving the selected clips with keys: 0.1 s / 1 s left or right, one track up or down (no mouse needed).
const E = require('../../core/edit');
const D = require('../dialogs');
const { def, T, frames, selClips, setClips } = require('./core');
const { afterEdit } = require('./play');
const { state, history, trackById, trackIndex } = require('../../core/state');

// keyboard alternative to dragging clips (ui-guide: dragging-alternative)
function nudge(df) {
  if (!selClips().length) return D.toast('옮길 클립을 선택하세요');
  if (df < 0 && selClips().every(({ c }) => c.start === 0)) return; // already at the start: no undo step
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
