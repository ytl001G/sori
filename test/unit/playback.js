// Pure parts of playback and import: loop passes (src/core/passes.js), more than two channels to stereo
// (src/core/downmix.js).
const { assert, t } = require('./helpers');
const P = require('../../src/core/passes');
const D = require('../../src/core/downmix');

t('loop passes follow each other with no gap; the position wraps into the range', () => {
  const sr = 100, p = { t0: 10, from: 50, loop: { a: 100, b: 300 } };
  const s = [0, 1, 2].map((k) => P.passAt(p, k, sr));
  assert.deepStrictEqual(s, [{ at: 10, from: 50, to: 300 }, { at: 12.5, from: 100, to: 300 },
    { at: 14.5, from: 100, to: 300 }]);
  // each pass ends where the next starts
  assert.deepStrictEqual(s.slice(0, 2).map((x) => P.passEnd(x, sr)), [s[1].at, s[2].at]);
  assert.deepStrictEqual([9, 11, 12.5, 13, 15].map((x) => P.frameAt(p, x, sr)), [50, 150, 100, 150, 150]);
  const once = { t0: 0, from: 20, loop: null };
  assert.deepStrictEqual([P.passAt(once, 0, sr), P.passAt(once, 1, sr), P.frameAt(once, 3, sr)],
    [{ at: 0, from: 20, to: Infinity }, null, 320]);
});

t('3 to 8 channels mix into stereo with nothing dropped (LFE aside); other counts go evenly', () => {
  const ch = (n, k) => Array.from({ length: n }, (_, i) => Float32Array.of(i === k ? 1 : 0));
  const lr = (n, k) => D.toStereo(ch(n, k)).map((c) => Math.round(c[0] * 1000) / 1000);
  assert.deepStrictEqual([lr(3, 2), lr(5, 4), lr(6, 3), lr(7, 4), lr(8, 4), lr(8, 7)],
    [[0.707, 0.707], [0, 0.707], [0, 0], [0.5, 0.5], [0.707, 0], [0, 0.707]]);
  assert.deepStrictEqual([lr(4, 0), lr(6, 0), lr(10, 9)], [[0.5, 0], [1, 0], [0.1, 0.1]]);
});
