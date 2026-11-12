// Pure edit ops on clip arrays. Clips/Sources are immutable; every op returns a new array.
// All positions are integer frames at the project sample rate.

let seq = 0;
const uid = (p) => p + Date.now().toString(36) + (seq++).toString(36);

const makeSource = (ch) => ({ id: uid('s'), ch });
const srcLen = (src) => src.frames || src.ch[0].length; // frames: a parked source (parked.js)
// gain: linear clip volume; fadeIn/fadeOut: frames from the clip edges (linear ramps)
const makeClip = (src, start, name, offset = 0, length = srcLen(src) - offset) =>
  ({ id: uid('c'), name, start, src, offset, length, gain: 1, fadeIn: 0, fadeOut: 0 });
const clipEnd = (c) => c.start + c.length;
const sortClips = (clips) => clips.slice().sort((x, y) => x.start - y.start);

function splitClip(c, f) {
  if (f <= c.start || f >= clipEnd(c)) return [c];
  const k = f - c.start, { fadeInShape, fadeOutShape, ...rest } = c;
  // DAW rule: the left part keeps the fade-in, the right part keeps the fade-out (each with its shape only: a fade
  // made later on the cut side starts 직선)
  return [
    { ...rest, ...(fadeInShape && { fadeInShape }), id: uid('c'), length: k, fadeIn: Math.min(c.fadeIn || 0, k),
      fadeOut: 0 },
    {
      ...rest, ...(fadeOutShape && { fadeOutShape }), id: uid('c'), start: f, offset: c.offset + k,
      length: c.length - k, fadeIn: 0, fadeOut: Math.min(c.fadeOut || 0, c.length - k),
    },
  ];
}

const splitAt = (clips, f) => clips.flatMap((c) => splitClip(c, f));
const inside = (c, a, b) => c.start >= a && clipEnd(c) <= b;
const shiftFrom = (clips, f, d) => clips.map((c) => (c.start >= f ? { ...c, start: c.start + d } : c));

function rippleDelete(clips, a, b) {
  const s = splitAt(splitAt(clips, a), b).filter((c) => !inside(c, a, b));
  return shiftFrom(s, b, a - b);
}

const insertGap = (clips, f, len) => shiftFrom(splitAt(clips, f), f, len);
const clearRange = (clips, a, b) => splitAt(splitAt(clips, a), b).filter((c) => !inside(c, a, b));
const keepRange = (clips, a, b) => splitAt(splitAt(clips, a), b).filter((c) => inside(c, a, b));

// Effective [fadeIn, fadeOut] per clip: its own fades, widened to an automatic crossfade where it
// partly overlaps another clip of the same track (a clip fully inside another just plays on top).
function fades(clips) {
  const s = sortClips(clips), m = new Map(s.map((c) => [c, [c.fadeIn || 0, c.fadeOut || 0]]));
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    for (let j = i + 1; j < s.length && s[j].start < clipEnd(a); j++) {
      const b = s[j];
      if (clipEnd(b) <= clipEnd(a)) continue;
      const ov = clipEnd(a) - b.start;
      m.get(a)[1] = Math.max(m.get(a)[1], ov);
      m.get(b)[0] = Math.max(m.get(b)[0], ov);
    }
  }
  return m;
}
// The clips as they sound (never stored). A cut joins two waves at any value, so the sound jumps there in one sample:
// a click (a 220 Hz sine cut at random: a step 49x its largest normal one). Where one clip's end meets another's start
// on a track, both play on into the sound each has past the edge (up to EDGE frames a side, its "handle") and the
// overlap crossfades them, so the wave goes from one to the other without a step; a plain split (the same source,
// contiguous) crossfades the same samples and sounds exactly as before. silence: an edge against silence (no clip
// meeting it) fades over 2 * EDGE (playback and export); edits leave that out, or every effect would bake it in again.
// An edge with its own fade is left as it is; at a join with one, the other side fades over EDGE in its own sound.
const EDGE = 120; // frames: 2.5 ms at 48 kHz, 2.7 ms at 44.1 kHz
// with no handle on either side: does the sound jump where a's end meets b's start? The next sample foreseen from a's
// last two (with clip volume) is off from b's first by more than twice their own steps. A sound cut in two and
// processed piece by piece (each piece a new source, no handle) meets itself (a 220 Hz sine: 0.0004 against steps of
// 0.014) and is left as it is: two fades there made a dip (audit 2026-11-12); a real cut jumps (up to 0.7) and fades
function jumps(a, b) {
  if (a.length < 2 || b.length < 2) return true;
  const ca = a.src.ch, cb = b.src.ch, e = a.offset + a.length, ga = a.gain ?? 1, gb = b.gain ?? 1;
  for (let k = 0; k < Math.max(ca.length, cb.length); k++) {
    const p = ca[Math.min(k, ca.length - 1)], q = cb[Math.min(k, cb.length - 1)];
    const a1 = ga * p[e - 1], a0 = ga * p[e - 2], b0 = gb * q[b.offset], b1 = gb * q[b.offset + 1];
    if (Math.abs(b0 - 2 * a1 + a0) > 2 * Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0)) + 1e-4) return true;
  }
  return false;
}
// [from, to): only clips within 3 EDGE of it count (a join further away changes nothing there, and jumps() would
// read, so decode, sources parked far away)
function played(clips, silence = false, from = -Infinity, to = Infinity) {
  const M = 3 * EDGE, s = sortClips(clips.filter((c) => c.start < to + M && clipEnd(c) > from - M));
  const out = new Map(s.map((c) => [c, { ...c }])), byStart = new Map();
  const metIn = new Set(), metOut = new Set();
  for (const c of s) byStart.set(c.start, [...(byStart.get(c.start) || []), c]);
  for (const a of s) {
    const next = (byStart.get(clipEnd(a)) || []).filter((b) => b !== a), A = out.get(a);
    if (!next.length) continue;
    metOut.add(a);
    next.forEach((b) => metIn.add(b));
    if (a.fadeOut || next.some((b) => b.fadeIn)) { // an own fade: no overlap, short fades where there is none
      if (!a.fadeOut) A.fadeOut = EDGE;
      for (const b of next) if (!b.fadeIn) out.get(b).fadeIn = EDGE;
      continue;
    }
    const y = Math.max(0, Math.min(EDGE, srcLen(a.src) - a.offset - a.length));
    A.length = a.length + y;
    for (const b of next) {
      const B = out.get(b), x = Math.max(0, Math.min(EDGE, b.offset, b.start));
      Object.assign(B, { start: b.start - x, offset: b.offset - x, length: b.length + x });
      if (x + y === 0 && jumps(a, b)) { A.fadeOut = EDGE; B.fadeIn = EDGE; } // no handles: short fades on a jump
    }
  }
  if (silence) {
    for (const c of s) {
      const C = out.get(c);
      if (!c.fadeIn && !metIn.has(c)) C.fadeIn = 2 * EDGE;
      if (!c.fadeOut && !metOut.has(c)) C.fadeOut = 2 * EDGE;
    }
  }
  return s.map((c) => out.get(c));
}
// Fade shapes: fade-in gain at progress x in [0, 1]. A fade-out is 1 - shape(progress), so 'fast' changes
// fast at the start of either fade and 'slow' at the end. Clips store fadeInShape/fadeOutShape only when not linear.
const FADE_SHAPES = {
  linear: (x) => x, smooth: (x) => (1 - Math.cos(Math.PI * x)) / 2, fast: (x) => 1 - (1 - x) ** 3, slow: (x) => x ** 3,
};
const fadeGain = (shape, x) => (FADE_SHAPES[shape] || FADE_SHAPES.linear)(Math.max(0, Math.min(1, x)));
const curved = (shape) => !!FADE_SHAPES[shape] && shape !== 'linear';
const CURVE_STEPS = 32; // linear segments per curved fade in the live/export graph (|error| < 0.3% of full scale)
// shapes of the effective fades: a fade widened into an automatic crossfade stays linear
const fadeShapes = (c, [fi, fo]) => [
  fi === (c.fadeIn || 0) ? c.fadeInShape : undefined,
  fo === (c.fadeOut || 0) ? c.fadeOutShape : undefined,
];

// clip volume at clip-relative frame k (0..length)
function envAt(c, [fi, fo], k) {
  let v = 1;
  const [si, so] = fadeShapes(c, [fi, fo]);
  if (fi > 0 && k < fi) v = Math.min(v, fadeGain(si, k / fi));
  if (fo > 0 && k > c.length - fo) v = Math.min(v, 1 - fadeGain(so, 1 - (c.length - k) / fo));
  return Math.max(0, v) * (c.gain ?? 1);
}
// clip-relative frames where the envelope bends; curved fades are sampled so straight ramps between points follow them
function envBreaks(c, [fi, fo]) {
  const n = c.length, pts = [0, n], [si, so] = fadeShapes(c, [fi, fo]);
  if (fi > 0) pts.push(Math.min(fi, n));
  if (fo > 0) pts.push(Math.max(0, n - fo));
  if (fi > 0 && fo > 0 && fi + fo > n) pts.push(n * fi / (fi + fo)); // the two ramps cross
  for (let i = 1; i < CURVE_STEPS; i++) {
    if (fi > 0 && curved(si)) pts.push(Math.min(n, fi * i / CURVE_STEPS));
    if (fo > 0 && curved(so)) pts.push(Math.max(0, n - fo * i / CURVE_STEPS));
  }
  return [...new Set(pts)].sort((x, y) => x - y);
}
const flatEnv = (c, fd) => (c.gain ?? 1) === 1 && !fd[0] && !fd[1];

// Sum of clips (with clip volume, fades, crossfades and the crossfaded joins of `played`) over [a, b), for edits
// (effects, merge, copy...). Returns null when nothing overlaps.
function renderRegion(stored, a, b) {
  const clips = played(stored, false, a, b), hit = clips.filter((c) => c.start < b && clipEnd(c) > a);
  if (!hit.length) return null;
  const fd = fades(clips);
  const nch = Math.max(...hit.map((c) => c.src.ch.length));
  const out = Array.from({ length: nch }, () => new Float32Array(b - a));
  for (const c of hit) {
    const i0 = Math.max(a, c.start), i1 = Math.min(b, clipEnd(c)), f = fd.get(c), flat = flatEnv(c, f);
    for (let k = 0; k < nch; k++) {
      const s = c.src.ch[Math.min(k, c.src.ch.length - 1)], o = out[k];
      const base = c.offset - c.start, g = c.src.ch.length < nch ? Math.SQRT1_2 : 1; // mono in stereo: -3 dB a side
      if (flat) for (let i = i0; i < i1; i++) o[i - a] += s[base + i] * g;
      else for (let i = i0; i < i1; i++) o[i - a] += s[base + i] * g * envAt(c, f, i - c.start);
    }
  }
  return out;
}

// Replace [a, b) with `ch`. ripple=true shifts later clips by the length change (tempo);
// ripple=false lays a longer result (reverb/echo tail) over what follows.
function replaceRegion(clips, a, b, ch, name, ripple = true) {
  let s = clearRange(clips, a, b);
  const len = ch[0].length;
  if (ripple && len !== b - a) s = shiftFrom(s, b, len - (b - a));
  return sortClips([...s, makeClip(makeSource(ch), a, name)]);
}

function merge(clips, ids) {
  const sel = clips.filter((c) => ids.has(c.id));
  if (sel.length < 2) return null;
  const a = Math.min(...sel.map((c) => c.start)), b = Math.max(...sel.map(clipEnd));
  const ch = renderRegion(sel, a, b);
  const merged = makeClip(makeSource(ch), a, sel.sort((x, y) => x.start - y.start)[0].name);
  return { clips: sortClips([...clips.filter((c) => !ids.has(c.id)), merged]), clip: merged };
}

function trimClip(c, edge, f) {
  const end = clipEnd(c);
  if (edge === 'left') {
    const ns = Math.max(c.start - c.offset, Math.min(f, end - 1), 0);
    return clampFades({ ...c, start: ns, offset: c.offset + (ns - c.start), length: end - ns });
  }
  const ne = Math.min(c.start + srcLen(c.src) - c.offset, Math.max(f, c.start + 1));
  return clampFades({ ...c, length: ne - c.start });
}
// fades stay inside the clip and never cross each other; unknown or linear shapes are dropped
function clampFades(c) {
  const fi = Math.max(0, Math.min(Math.round(c.fadeIn || 0), c.length));
  const r = { ...c, fadeIn: fi, fadeOut: Math.max(0, Math.min(Math.round(c.fadeOut || 0), c.length - fi)) };
  for (const k of ['fadeInShape', 'fadeOutShape']) if (!curved(r[k])) delete r[k];
  return r;
}

// Map frames (markers) through an edit that turned [a, b) into [a, a + newLen): before a unchanged,
// inside scaled, after shifted. Covers delete (newLen 0), insert (a = b) and tempo changes.
function remapFrame(f, a, b, newLen) {
  if (f < a) return f;
  if (f >= b) return f + newLen - (b - a);
  return a + Math.round((f - a) * newLen / (b - a));
}
// [start, end, name] between markers, from 0 ('시작') to `end`: 내보내기 > 마커 구간별 in the app and the CLI
// (pieces under 10 ms skipped)
function markerSegments(markers, end, sr) {
  const cuts = [{ frame: 0, name: '시작' }, ...markers.filter((m) => m.frame < end)], out = [];
  cuts.forEach((m, i) => {
    const a = m.frame, b = i + 1 < cuts.length ? cuts[i + 1].frame : end;
    if (b - a >= Math.round(0.01 * sr)) out.push([a, b, m.name]);
  });
  return out;
}

const projectEnd = (tracks) => Math.max(0, ...tracks.flatMap((t) => t.clips.map(clipEnd)));

module.exports = {
  uid, makeSource, makeClip, srcLen, clipEnd, sortClips, splitClip, splitAt, rippleDelete, insertGap,
  clearRange, keepRange, renderRegion, replaceRegion, merge, trimClip, projectEnd, shiftFrom,
  fades, envAt, envBreaks, clampFades, remapFrame, markerSegments, fadeGain, fadeShapes, FADE_SHAPES, played, EDGE,
};
