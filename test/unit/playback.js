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

t('a loop too short to keep up is scheduled at most 20 passes a call, late passes skipped', () => {
  const sr = 48000, p = { t0: 1, from: 0, loop: { a: 0, b: 2 }, queued: 0 }; // 2 frames: 24000 passes a second
  const first = P.due(p, 0.95, sr);
  assert.deepStrictEqual([first.length, first[0].at, p.queued], [20, 1, 20]);
  const later = P.due(p, 2, sr); // 1 s on: the passes in between are skipped, none starts in the past
  assert(later.length === 20 && later.every((s) => s.at >= 2) && later[0].at - 2 < 2 / sr, JSON.stringify(later[0]));
  const plain = { t0: 1, from: 5, loop: null, queued: 0 };
  assert.deepStrictEqual([P.due(plain, 0.95, sr).length, P.due(plain, 9, sr).length], [1, 0]);
  const slow = { t0: 1, from: 0, loop: { a: 0, b: 48000 }, queued: 0 }; // 1 s loop: only what starts within 0.5 s
  assert.deepStrictEqual([P.due(slow, 0.95, sr).length, P.due(slow, 0.95, sr).length, P.due(slow, 1.6, sr).length],
    [1, 0, 1]);
});

t('stopping silences the count-in clicks still to come, and no new ones are scheduled', () => {
  const MET = require('../../src/audio/metro');
  const made = [], node = () => ({ connect: (x) => x, disconnect() { this.off = true; } });
  const ramp = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const osc = () => {
    const o = { ...node(), frequency: {}, start() {}, stop() { o.stops = (o.stops || 0) + 1; } };
    made.push(o);
    return o;
  };
  const ctx = { currentTime: 0, sampleRate: 100, destination: {}, createOscillator: osc,
    createGain: () => ({ ...node(), gain: ramp }) };
  const p = { t0: 2, from: 0, loop: null };
  MET.start(ctx, p, { on: true, bpm: 120, beats: 4, volume: 1 }, 2); // 4 clicks before t0
  assert.strictEqual(p.clicks.length, 4, 'the count-in is scheduled whole');
  MET.silence(p);
  assert(made.every((o) => o.stops === 2) && p.clicks.length === 0 && p.metro === null, 'all stopped now');
  MET.pump(ctx, p);
  assert.strictEqual(made.length, 4, 'nothing new after stopping');
});

t('a stopped recording: its chunks joined with the lead cut, at every place the cut can fall; chunks let go', () => {
  const BF = require('../../src/audio/buffers');
  const make = () => [0, 1, 2].map((j) => [0, 1].map((k) => Float32Array.from([0, 1, 2], (x) => k * 100 + j * 3 + x)));
  for (const skip of [0, 1, 2, 3, 4, 8]) {
    const chunks = make(), out = BF.join(chunks, 2, 9, skip);
    const want = (k) => Array.from({ length: 9 - skip }, (_, i) => k * 100 + skip + i);
    assert.deepStrictEqual(out.map((d) => Array.from(d)), [want(0), want(1)], 'skip ' + skip);
    assert(chunks.every((c) => c === null), 'a chunk was kept');
  }
});
