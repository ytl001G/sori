// 긴 녹음 나누기 (spec §5-5): a long recording -> pieces and line boundaries, shared by the app's window and
// `sori script split`. Pure, frames throughout.
// sound = the runs heard (voicedit's between-words threshold), measured once per recording.
// A piece = { a, b, drop } = what its take keeps (the speech + up to MARGIN s each side). bounds = sorted frames
// where a new line starts; people place them (N while recording, or in the window), never the quiet alone.
// picks = [{ at, line }]: from the boundary at frame `at` (0 = the start) on, groups count from line index `line`.
const E = require('./edit');
const V = require('./voice');
const SCR = require('./script');
const { quietLevels } = require('./voicedit');
const { makeTrack } = require('./state');

const MIN_SOUND = 0.3; // s: shorter sound is no piece (lip noise, a click)
const MARGIN = 0.3; // s of quiet each take keeps before and after the speech, at most to the middle of the quiet
const SNAP = 2; // s around an N press searched for quiet
const SNAP_QUIET = 0.2; // s: a quiet stretch this long can take an N cut

// [[a, b]] frames of sound, at 10 ms blocks
function soundRuns(ch, sr) {
  const B = Math.round(0.01 * sr), { det, talk } = quietLevels(ch, sr), open = V.openBlocks(det, B, talk), out = [];
  for (let i = 0; i < open.length; i++) {
    if (!open[i]) continue;
    let j = i;
    while (j < open.length && open[j]) j++;
    out.push([i * B, j * B]);
    i = j;
  }
  return out;
}

// an N press at frame m -> the boundary: the middle of the nearest quiet stretch (SNAP_QUIET s or longer, the time
// before the first sound and after the last included) within SNAP s, else m itself
function snap(sound, m, sr, len) {
  const edges = [0, ...sound.flat(), len], far = SNAP * sr;
  let best = null, dist = Infinity;
  for (let k = 0; k < edges.length; k += 2) {
    const qa = edges[k], qb = edges[k + 1];
    if (qb - qa < SNAP_QUIET * sr) continue;
    const d = m < qa ? qa - m : m > qb ? m - qb : 0;
    if (d <= far && d < dist) { dist = d; best = Math.round((qa + qb) / 2); }
  }
  return best ?? Math.round(m);
}

const lastBound = (bounds, f) => bounds.filter((x) => x <= f).pop() ?? 0;
const nextBound = (bounds, f, len) => bounds.find((x) => x > f) ?? len;
// pieces for a gap (s): within a line, sound closer than gap is one piece, shorter than MIN_SOUND none; never across
// a boundary (sound is cut there first, so a piece ends with its own speech, not the quiet up to the boundary);
// margins never cross the middle of the quiet to a neighbour or a boundary
function pieces(sound, sr, gap, bounds, len) {
  const runs = sound.flatMap(([a, b]) => {
    const at = [a, ...bounds.filter((x) => x > a && x < b), b];
    return at.slice(1).map((x, k) => [at[k], x]);
  });
  const sp = [], line = (f) => bounds.filter((x) => x <= f).length;
  for (const [a, b] of runs) {
    const p = sp[sp.length - 1];
    if (p && a - p[1] <= gap * sr && line(a) === line(p[0])) p[1] = b; else sp.push([a, b]);
  }
  const cut = sp.filter(([a, b]) => b - a >= MIN_SOUND * sr);
  const m = Math.round(MARGIN * sr);
  return cut.map(([a, b], i) => {
    const lo = Math.max(i ? Math.ceil((cut[i - 1][1] + a) / 2) : 0, lastBound(bounds, a));
    const hi = Math.min(i < cut.length - 1 ? Math.floor((b + cut[i + 1][0]) / 2) : len, nextBound(bounds, a, len));
    return { a: Math.max(lo, a - m), b: Math.min(hi, b + m), drop: false };
  });
}

// the group (0 = before the first boundary) and the line index each piece goes to (null past the last line)
const groupOf = (bounds, p) => bounds.filter((x) => x <= p.a).length;
function lineIndex(bounds, picks, g) {
  const starts = (pk) => (pk.at ? bounds.filter((x) => x <= pk.at).length : 0);
  const pk = picks.filter((x) => starts(x) <= g).sort((x, y) => starts(x) - starts(y)).pop() || { at: 0, line: 0 };
  return pk.line + g - starts(pk);
}
// keeps only picks at the start or at a boundary that still exists
const tidyPicks = (bounds, picks) => picks.filter((x) => !x.at || bounds.includes(x.at));

// ---- edits from the window (each returns the new { ps, bounds, picks } or ps) ----
// pieces i..j become one; the quiet between them stays; boundaries inside go
function merge(st, i, j) {
  const { ps, bounds } = st, a = ps[i].a, b = ps[j].b;
  const nb = bounds.filter((x) => x <= ps[i].a || x > ps[j].a);
  const one = { a, b, drop: false };
  return { ps: [...ps.slice(0, i), one, ...ps.slice(j + 1)], bounds: nb, picks: tidyPicks(nb, st.picks) };
}
// piece i in two at frame f
const splitAt = (ps, i, f) => (f <= ps[i].a || f >= ps[i].b ? ps
  : [...ps.slice(0, i), { ...ps[i], b: f }, { ...ps[i], a: f }, ...ps.slice(i + 1)]);
// moves an edge: never over a neighbour, a boundary or the other edge; the same ps when it cannot move (no undo step)
function setEdge(st, i, side, f, len) {
  const { ps, bounds } = st, p = ps[i];
  const lo = side === 'a' ? Math.max(i ? ps[i - 1].b : 0, lastBound(bounds, p.a)) : p.a + 1;
  const hi = side === 'a' ? p.b - 1 : Math.min(i < ps.length - 1 ? ps[i + 1].a : len, nextBound(bounds, p.a, len));
  const v = Math.round(Math.min(hi, Math.max(lo, f)));
  if (v === p[side]) return ps;
  return ps.map((x, k) => (k === i ? { ...x, [side]: v } : x));
}
// a new line from piece i on (the middle of the quiet before it), or that boundary gone
function addBound(st, i) {
  const { ps, bounds } = st, x = i ? Math.round((ps[i - 1].b + ps[i].a) / 2) : null;
  return x == null || bounds.includes(x) ? bounds : [...bounds, x].sort((p, q) => p - q);
}
function dropBound(st, i) {
  const { ps, bounds } = st, nb = bounds.filter((x) => !(i && x > ps[i - 1].a && x <= ps[i].a));
  return { bounds: nb, picks: tidyPicks(nb, st.picks) };
}
// a boundary before every piece
const everyPiece = (st) => st.ps.reduce((b, _, i) => addBound({ ps: st.ps, bounds: b }, i), st.bounds);
// picks for "this group is line L": later groups count on from it
const pickLine = (st, g, line) => {
  const at = g ? st.bounds[g - 1] : 0;
  return [...st.picks.filter((x) => x.at !== at), { at, line }];
};

// what applying gives: [{ line: index, ranges: [[a, b]] }] in line order, and the kept pieces past the last line
function plan(st, lineCount) {
  const by = new Map();
  let over = 0;
  for (const p of st.ps) {
    if (p.drop) continue;
    const li = lineIndex(st.bounds, st.picks, groupOf(st.bounds, p));
    if (li < 0 || li >= lineCount) { over++; continue; }
    (by.get(li) || by.set(li, []).get(li)).push([p.a, p.b]);
  }
  return { lines: [...by.keys()].sort((x, y) => x - y).map((line) => ({ line, ranges: by.get(line) })), over };
}

// a line with a new take per range (테이크 n, from 0 s, the character's look); ★ on the first new one if it had none
function addTakes(line, ch, ranges, look) {
  let next = line;
  for (const [a, b] of ranges) {
    const name = SCR.nextTakeName(next.takes);
    const clip = E.makeClip(E.makeSource(ch.map((c) => c.slice(a, b))), 0, name);
    const t = SCR.takeView(makeTrack({ name, clips: [clip] }), look);
    next = { ...next, takes: [...next.takes, t], ...(!next.star && SCR.withStar(t.id)) };
  }
  return next;
}

module.exports = {
  MIN_SOUND, MARGIN, SNAP, soundRuns, snap, pieces, groupOf, lineIndex, merge, splitAt, setEdge, addBound, dropBound,
  everyPiece, pickLine, plan, addTakes,
};
