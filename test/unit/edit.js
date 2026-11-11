// Edit operations on clips (src/core/edit.js).
const { assert, E, t, clip, ones } = require('./helpers');

t('split keeps samples and positions', () => {
  const c = clip(100, 50);
  const [l, r] = E.splitClip(c, 120);
  assert.deepStrictEqual([l.start, l.length, r.start, r.offset, r.length], [100, 20, 120, 20, 30]);
  assert.strictEqual(E.splitClip(c, 100).length, 1);
});
t('rippleDelete closes the gap', () => {
  const out = E.rippleDelete([clip(0, 100), clip(200, 50)], 40, 60);
  assert.deepStrictEqual(out.map((c) => [c.start, c.length, c.offset]), [[0, 40, 0], [40, 40, 60], [180, 50, 0]]);
  // as it sounds: the sound itself away from the join, and no step at it (crossfaded over the deleted sound)
  const long = E.rippleDelete([clip(0, 1000)], 400, 600), r = E.renderRegion(long, 0, 800)[0], H = E.EDGE;
  assert(r[399 - H] === 399 - H && r[400 + H] === 600 + H, 'the sound outside the crossfade');
  let step = 0;
  for (let i = 400 - H; i < 400 + H; i++) step = Math.max(step, Math.abs(r[i + 1] - r[i]));
  assert(step < 3, 'a step at the join: ' + step); // raw: 200 in one sample
});
t('insertGap / clearRange / keepRange', () => {
  assert.deepStrictEqual(E.insertGap([clip(0, 100)], 30, 10).map((c) => c.start), [0, 40]);
  assert.deepStrictEqual(E.clearRange([clip(0, 100)], 30, 40).map((c) => [c.start, c.length]), [[0, 30], [40, 60]]);
  assert.deepStrictEqual(E.keepRange([clip(0, 100), clip(150, 10)], 30, 40).map((c) => [c.start, c.length]),
    [[30, 10]]);
});
t('renderRegion sums a clip inside another, null when empty', () => {
  const r = E.renderRegion([clip(0, 20), clip(5, 5)], 0, 30)[0];
  assert.strictEqual(r[6], 6 + 1); assert.strictEqual(r[25], 0);
  assert.strictEqual(E.renderRegion([clip(0, 10)], 20, 30), null);
});
t('partial overlap crossfades to constant level; clip gain + fades apply', () => {
  const a = E.makeClip(E.makeSource(ones(100)), 0, 'a'), b = E.makeClip(E.makeSource(ones(100)), 60, 'b');
  const r = E.renderRegion([a, b], 0, 160)[0];
  for (const i of [0, 59, 61, 80, 99, 120]) assert(Math.abs(r[i] - 1) < 1e-6, `level at ${i}: ${r[i]}`);
  const c = { ...E.makeClip(E.makeSource(ones(100)), 0, 'c'), gain: 0.5, fadeIn: 10, fadeOut: 20 };
  const q = E.renderRegion([c], 0, 100)[0];
  assert.strictEqual(q[0], 0); assert(Math.abs(q[5] - 0.25) < 1e-6); assert(Math.abs(q[50] - 0.5) < 1e-6);
  assert(Math.abs(q[90] - 0.25) < 1e-6);
  assert.deepStrictEqual(E.envBreaks(c, [10, 20]), [0, 10, 80, 100]);
});
t('split keeps fade-in left, fade-out right; trim clamps fades', () => {
  const c = { ...clip(0, 100), fadeIn: 30, fadeOut: 40, fadeInShape: 'slow', fadeOutShape: 'fast' };
  const [l, r] = E.splitClip(c, 20);
  assert.deepStrictEqual([l.fadeIn, l.fadeOut, r.fadeIn, r.fadeOut], [20, 0, 0, 40]);
  assert.deepStrictEqual([l.fadeInShape, 'fadeOutShape' in l, 'fadeInShape' in r, r.fadeOutShape],
    ['slow', false, false, 'fast'], 'each part keeps only its own fade shape');
  const t2 = E.trimClip(c, 'right', 50);
  assert.deepStrictEqual([t2.length, t2.fadeIn, t2.fadeOut], [50, 30, 20]);
});
t('markerSegments: from 0 to the end, pieces under 10 ms and markers past the end left out', () => {
  const ms = [[0, 'a'], [1000, 'b'], [1005, 'c'], [5000, 'd']].map(([frame, name]) => ({ frame, name }));
  assert.deepStrictEqual(E.markerSegments(ms, 3000, 1000), [[0, 1000, 'a'], [1005, 3000, 'c']]);
});
t('remapFrame: delete, insert, stretch', () => {
  assert.deepStrictEqual([5, 15, 30].map((f) => E.remapFrame(f, 10, 20, 0)), [5, 10, 20]);
  assert.deepStrictEqual([5, 10, 30].map((f) => E.remapFrame(f, 10, 10, 7)), [5, 17, 37]);
  assert.strictEqual(E.remapFrame(15, 10, 20, 20), 20);
});
t('replaceRegion ripple vs overlay', () => {
  const base = [clip(0, 100), clip(100, 50)];
  const longer = [new Float32Array(30)];
  assert.deepStrictEqual(E.replaceRegion(base, 10, 20, longer, 'x', true).map((c) => c.start), [0, 10, 40, 120]);
  assert.deepStrictEqual(E.replaceRegion(base, 10, 20, longer, 'x', false).map((c) => c.start), [0, 10, 20, 100]);
});
t('merge joins clips with silent gap', () => {
  const a = clip(0, 10), b = clip(20, 10);
  const { clips, clip: m } = E.merge([a, b, clip(50, 5)], new Set([a.id, b.id]));
  assert.strictEqual(clips.length, 2); assert.strictEqual(m.length, 30);
  assert.strictEqual(m.src.ch[0][15], 0); assert.strictEqual(m.src.ch[0][21], 1);
  assert.strictEqual(E.merge([a], new Set([a.id])), null);
});
t('trimClip stays inside the source', () => {
  const c = E.splitClip(clip(0, 100), 50)[1]; // start 50 offset 50
  const l = E.trimClip(c, 'left', -20);
  assert.deepStrictEqual([l.start, l.offset, l.length], [0, 0, 100]);
  const r = E.trimClip(c, 'right', 500);
  assert.strictEqual(r.length, 50);
  assert.strictEqual(E.trimClip(c, 'right', 0).length, 1);
});

// edit.played: how clip edges sound (cut joins crossfaded over the handle, short fades against silence)
const maxStep = (x, a, b) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i + 1] - x[i]));
  return m;
};
const wave = (n) => [Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / 48000))];
t('played: a plain split sounds exactly as before; a cut in a sine has no step at the join', () => {
  const src = E.makeSource(wave(48000)), whole = E.makeClip(src, 0, 'c');
  const a = E.renderRegion([whole], 0, 48000)[0], b = E.renderRegion(E.splitAt([whole], 20000), 0, 48000)[0];
  assert(a.every((v, i) => Math.abs(v - b[i]) < 1e-6), 'a split changed the sound');
  const cut = E.renderRegion(E.rippleDelete([whole], 24000, 31237), 0, 40000)[0];
  // the sine's own largest step is 0.0144; raw, this join jumps 0.708 in one sample
  assert(maxStep(cut, 23000, 25000) < 0.03, 'step at the join ' + maxStep(cut, 23000, 25000));
});
t('played: without sound past the edges, short fades in the kept sound; one handle is enough', () => {
  const x = wave(9000), H = E.EDGE;
  const a = E.makeClip(E.makeSource(x), 0, 'a', 0, 4000), b = E.makeClip(E.makeSource([x[0].slice(6000)]), 4000, 'b');
  const one = E.renderRegion([a, b], 0, 7000)[0]; // a has sound past its end, b none before its start
  assert(maxStep(one, 3800, 4200) < 0.03 && Math.abs(one[4000 + H] - x[0][6000 + H]) < 1e-6, 'one-sided join');
  const c = E.makeClip(E.makeSource([x[0].slice(0, 4000)]), 0, 'c');
  const none = E.renderRegion([c, b], 0, 7000)[0];
  assert(maxStep(none, 3800, 4200) < 0.03 && Math.abs(none[3999]) < 0.01, 'no handles: faded to the join');
});
t('played: edges against silence fade (playback only); own fades and the stored clips stay', () => {
  const x = wave(9000), c = E.makeClip(E.makeSource(x), 1000, 'c', 37, 3000), H = E.EDGE;
  const [p] = E.played([c], true);
  assert(p.fadeIn === 2 * H && p.fadeOut === 2 * H && c.fadeIn === 0 && c.start === 1000, 'silence fades on a copy');
  assert.strictEqual(E.played([c])[0].fadeIn, 0, 'edits: no silence fades');
  const own = { ...E.makeClip(E.makeSource(x), 0, 'o', 0, 4000), fadeOut: 50 };
  const b = E.makeClip(E.makeSource(x), 4000, 'b', 6000, 100);
  const [po, pb] = E.played([own, b]);
  assert(po.length === 4000 && po.fadeOut === 50, 'an own fade-out stays as it is');
  assert(pb.start === 4000 && pb.fadeIn === H, 'the clip after it fades in over its own sound');
});
