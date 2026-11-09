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
  const k = f - c.start;
  // DAW rule: the left part keeps the fade-in, the right part keeps the fade-out
  return [
    { ...c, id: uid('c'), length: k, fadeIn: Math.min(c.fadeIn || 0, k), fadeOut: 0 },
    {
      ...c, id: uid('c'), start: f, offset: c.offset + k, length: c.length - k,
      fadeIn: 0, fadeOut: Math.min(c.fadeOut || 0, c.length - k),
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

// Sum of clips (with clip volume, fades and crossfades) over [a, b). Returns null when nothing overlaps.
function renderRegion(clips, a, b) {
  const hit = clips.filter((c) => c.start < b && clipEnd(c) > a);
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

const projectEnd = (tracks) => Math.max(0, ...tracks.flatMap((t) => t.clips.map(clipEnd)));

module.exports = {
  uid, makeSource, makeClip, srcLen, clipEnd, sortClips, splitClip, splitAt, rippleDelete, insertGap,
  clearRange, keepRange, renderRegion, replaceRegion, merge, trimClip, projectEnd, shiftFrom,
  fades, envAt, envBreaks, clampFades, remapFrame, fadeGain, fadeShapes, FADE_SHAPES,
};
