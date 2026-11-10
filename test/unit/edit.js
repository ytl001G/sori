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
  const r = E.renderRegion(out, 0, 80)[0];
  assert.strictEqual(r[39], 39); assert.strictEqual(r[40], 60);
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
