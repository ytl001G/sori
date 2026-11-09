// Destructive effects (src/core/effects.js).
const { assert, E, FX, t, sine, rms, sr } = require('./helpers');

t('gain / normalize / fades / reverse', () => {
  const x = [sine(4800, 440, sr, 0.25)];
  assert(Math.abs(FX.peak(FX.normalize(x, sr, { db: 0 })) - 1) < 1e-6);
  assert(Math.abs(FX.peak(FX.gain(x, sr, { db: 6 })) / FX.peak(x) - 1.995) < 0.01);
  const f = FX.fadeIn([new Float32Array(11).fill(1)]);
  assert.strictEqual(f[0][0], 0); assert.strictEqual(f[0][10], 1);
  assert.strictEqual(FX.reverse([Float32Array.of(1, 2, 3)])[0][0], 3);
  assert.strictEqual(x[0][0], 0); // input untouched
});
t('fade shapes: envelope values, dense breakpoints for the graph, fade effect, clamp drops linear/unknown', () => {
  const one = new Float32Array(1000).fill(1);
  const mk = (s, o) => ({ ...E.makeClip(E.makeSource([one]), 0, 'c'), fadeIn: 100, fadeOut: 100, fadeInShape: s,
    fadeOutShape: o });
  const at = (s, k, out) => E.envAt(mk(out ? undefined : s, out ? s : undefined), [100, 100], k);
  const close = (a, b) => assert(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
  close(at(undefined, 50), 0.5); close(at('smooth', 50), 0.5); close(at('fast', 50), 0.875);
  close(at('slow', 50), 0.125);
  close(at('fast', 925, true), 0.75 ** 3); close(at('slow', 925, true), 1 - 0.25 ** 3);
  close(at('linear', 925, true), 0.75);
  for (const s of ['smooth', 'fast', 'slow']) { // straight ramps between breakpoints follow the curve
    const c = mk(s, s), br = E.envBreaks(c, [100, 100]); let err = 0;
    assert(br.length >= 64, 'breaks ' + br.length);
    for (let i = 0; i + 1 < br.length; i++) for (let k = Math.ceil(br[i]); k <= br[i + 1]; k++) {
      const u = (k - br[i]) / (br[i + 1] - br[i] || 1), lin = E.envAt(c, [100, 100], br[i]) * (1 - u)
        + E.envAt(c, [100, 100], br[i + 1]) * u;
      err = Math.max(err, Math.abs(lin - E.envAt(c, [100, 100], k)));
    }
    assert(err < 0.003, s + ' max error ' + err);
  }
  assert.strictEqual(E.envBreaks(mk(), [100, 100]).length, 4);
  const f = FX.fadeIn([new Float32Array(11).fill(1)], 48000, { shape: 'slow' }),
    g = FX.fadeOut([new Float32Array(11).fill(1)], 48000, { shape: 'fast' });
  close(f[0][5], 0.125); close(g[0][5], 0.125); assert.strictEqual(f[0][10], 1); assert.strictEqual(g[0][10], 0);
  const wide = mk('slow', 'slow'); // widened into a crossfade (effective 200 > own 100): stays linear
  close(E.envAt(wide, [200, 100], 100), 0.5);
  assert.deepStrictEqual(E.envBreaks(wide, [200, 100]).filter((k) => k <= 200), [0, 200]);
  const cl = E.clampFades({ ...mk('linear', 'nope') });
  assert(!('fadeInShape' in cl) && !('fadeOutShape' in cl), 'clamp keeps only curved shapes');
});
t('tempo changes length, pitch keeps length', () => {
  const x = [sine(sr, 440, sr)];
  const fast = FX.tempo(x, sr, { percent: 200 });
  assert.strictEqual(fast[0].length, sr / 2);
  assert(rms(fast[0].subarray(1000, 20000)) > 0.25);
  const up = FX.pitch(x, sr, { semitones: 12 });
  assert.strictEqual(up[0].length, sr);
  assert(rms(up[0].subarray(5000, 40000)) > 0.25);
});
t('eq: lowcut kills 50 Hz, keeps 2 kHz', () => {
  const lo = FX.eq([sine(sr, 50, sr)], sr, { lowcut: 400 })[0],
    hi = FX.eq([sine(sr, 2000, sr)], sr, { lowcut: 400 })[0];
  assert(rms(lo.subarray(10000)) < 0.03); assert(rms(hi.subarray(10000)) > 0.33);
  const boost = FX.eq([sine(sr, 1000, sr)], sr, { mid: 6 })[0];
  assert(rms(boost.subarray(10000)) / rms(sine(sr, 1000, sr)) > 1.8);
});
t('compressor reduces loud parts only', () => {
  const loud = FX.compressor([sine(sr, 300, sr, 0.9)], sr, { threshold: -20, ratio: 4 })[0];
  const quiet = FX.compressor([sine(sr, 300, sr, 0.02)], sr, { threshold: -20, ratio: 4 })[0];
  assert(FX.peak([loud.subarray(10000)]) < 0.4);
  assert(Math.abs(FX.peak([quiet.subarray(10000)]) - 0.02) < 0.002);
});
t('echo and reverb add a tail, keep start', () => {
  const imp = new Float32Array(4800); imp[0] = 1;
  const e = FX.echo([imp], sr, { delayMs: 50, feedback: 50, wet: 100 })[0];
  assert(e.length > imp.length); assert(Math.abs(e[2400] - 1) < 1e-6); assert(Math.abs(e[4800] - 0.5) < 1e-6);
  const r = FX.reverb([sine(4800, 440, sr)], sr, {});
  assert.strictEqual(r.length, 2); assert(r[0].length > 4800);
  assert(rms(r[0].subarray(4800, 9600)) > 0.001);
});
t('noise reduction lowers noise, keeps tone', () => {
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
  const noise = Float32Array.from({ length: sr }, rnd);
  const prof = FX.noiseProfile([noise]);
  const mixed = Float32Array.from(sine(sr, 1000, sr, 0.5), (v) => v + rnd());
  const out = FX.noiseReduce([Float32Array.from(noise)], sr, { profile: prof, reduction: 18 })[0];
  assert(rms(out.subarray(4000, 44000)) < rms(noise) * 0.3, 'noise not reduced');
  const tone = FX.noiseReduce([mixed], sr, { profile: prof, reduction: 18 })[0];
  assert(rms(tone.subarray(4000, 44000)) > 0.33, 'tone lost');
  assert.strictEqual(tone.length, sr);
});
t('mono plays at -3 dB per side: reverb dry and a mono clip mixed with a stereo one', () => {
  const x = new Float32Array(4800).fill(0.5), near = (a, b) => assert(Math.abs(a - b) < 1e-6, a + ' vs ' + b);
  const r = FX.reverb([x], sr, { wet: 0 });
  near(r[0][100], 0.5 * Math.SQRT1_2); near(r[1][100], 0.5 * Math.SQRT1_2);
  near(FX.reverb([x, x], sr, { wet: 0 })[0][100], 0.5); // stereo dry unchanged
  const st = E.makeClip(E.makeSource([new Float32Array(100), new Float32Array(100)]), 0, 'st');
  const mono = E.makeClip(E.makeSource([new Float32Array(100).fill(1)]), 0, 'mono');
  const m = E.renderRegion([st, mono], 0, 100);
  near(m[0][50], Math.SQRT1_2); near(m[1][50], Math.SQRT1_2);
  near(E.renderRegion([mono], 0, 100)[0][50], 1); // mono alone stays mono
});
t('noise profile: a 0.1 s piece reads like a 1 s one', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
  const long = Float32Array.from({ length: sr }, rnd), short = long.slice(0, Math.round(sr * 0.1));
  const sum = (p) => p.reduce((s, v) => s + v, 0);
  const db = 20 * Math.log10(sum(FX.noiseProfile([short])) / sum(FX.noiseProfile([long])));
  assert(Math.abs(db) < 0.5, db + ' dB');
  assert(sum(FX.noiseProfile([long.slice(0, 1000)])) > 0); // shorter than a frame: still a profile
});
t('echo tail runs to -60 dB (cap 60 s) and fades out at the end', () => {
  const imp = new Float32Array(480); imp[0] = 1;
  assert(Math.abs(FX.echoTail({ delayMs: 500, feedback: 50 }) - (0.5 * 10 + 0.1)) < 1e-9);
  assert.strictEqual(FX.echoTail({ delayMs: 2000, feedback: 90 }), 60);
  const e = FX.echo([imp], sr, { delayMs: 2000, feedback: 90, wet: 100 })[0];
  assert(e.length <= imp.length + 60 * sr); assert(Math.abs(e[e.length - 1]) < 1e-3);
  assert(Math.abs(e[2 * sr] - 1) < 1e-6); // first repeat untouched
});
