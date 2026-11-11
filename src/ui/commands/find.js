// Ctrl+F 찾기 (spec §2): the search core/find.js describes, run on the open project, and going to a hit. The box is
// ui/panels/find.js; sori live find calls find() too.
const F = require('../../core/find');
const { def, T, SC, tl } = require('./core');
const { seek } = require('./play');
const { goLine, visibleLines } = require('./script');
const { state, changed } = require('../../core/state');

const lines = () => (SC() ? visibleLines() : null);
// the hit the selection is on (a clip or marker first: it is the more exact one), and the current line's / track's
// place in its list
function where(hs) {
  const s = state.sel, on = (h) => (h.kind === 'clip' ? s.clipIds.has(h.id) && s.clipIds.size === 1
    : h.kind === 'marker' ? s.markerId === h.id : h.kind === 'line' ? SC().lineId === h.id : s.activeTrackId === h.id);
  const exact = hs.findIndex((h) => (h.kind === 'clip' || h.kind === 'marker') && on(h));
  const ord = SC() ? lines().findIndex((l) => l.id === SC().lineId) : T().findIndex((t) => t.id === s.activeTrackId);
  return { at: exact >= 0 ? exact : hs.findIndex(on), ord: Math.max(0, ord) };
}
// a track or clip: it becomes the current one and its lane comes into view; a clip or marker: the play position goes
// there (Space plays from it); a line: that line, as clicking it in the list
async function go(h) {
  const s = state.sel;
  if (h.kind === 'line') return goLine(h.id);
  s.clipIds = new Set(h.kind === 'clip' ? [h.id] : []);
  if (h.kind === 'clip') s.range = null;
  s.markerId = h.kind === 'marker' ? h.id : null;
  if (h.kind !== 'marker') {
    s.activeTrackId = h.trackId || h.id;
    tl().revealLane(T().findIndex((t) => t.id === s.activeTrackId));
  }
  if (h.frame !== undefined) seek(h.frame); else changed();
}
// q, o = { clips, markers, memo }; dir 0 = typing, 1 / -1 = Enter / Shift+Enter. move = false: count only (typing
// while recording: going to another line would stop it). -> { count, at (0-based, -1 none), hit }
async function find(q, o = {}, dir = 0, move = true) {
  const hs = F.hits(state.project, q, lines(), o), { at, ord } = where(hs);
  const i = !move && dir === 0 ? at : F.pick(hs, at, ord, dir);
  if (move && i >= 0 && i !== at) await go(hs[i]);
  return { count: hs.length, at: i, hit: hs[i] || null };
}

def('find', '찾기', () => require('../panels/find').open());

module.exports = { find };
