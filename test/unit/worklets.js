// Live effect worklets and the chain math (src/audio/worklets.js).
const { assert, E, FX, t, sine, rms, sr } = require('./helpers');
const LD = require('../../src/core/loudness');

// load worklets.js in a sandbox and run a processor over a signal in 128-frame blocks
function loadAll(sampleRate = sr) {
  const vm = require('vm'), reg = {};
  class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } }
  vm.runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '../../src/audio/worklets.js'), 'utf8'),
    { AudioWorkletProcessor, registerProcessor: (n, c) => { reg[n] = c; }, sampleRate, currentFrame: 0, Math,
      Float32Array, Float64Array });
  return reg;
}
function proc(name, params, input, sampleRate = sr, outCh = input.length) {
  const C = loadAll(sampleRate)[name], desc = C.parameterDescriptors || [];
  const p = new C({ processorOptions: { taps: LD.tpTaps() } }); // only the limiter reads it
  const pv = Object.fromEntries(desc.map((d) => [d.name, [params[d.name] ?? d.defaultValue]]));
  const out = Array.from({ length: outCh }, () => new Float32Array(input[0].length));
  for (let i = 0; i < input[0].length; i += 128) {
    const ins = [input.map((c) => c.subarray(i, i + 128))], outs = [out.map((c) => c.subarray(i, i + 128))];
    p.process(ins, outs, pv);
  }
  return out;
}
t('limiter: never above the ceiling, between samples too; delays by lookahead-1 + the true-peak read', () => {
  const x = [Float32Array.from(sine(sr, 220, sr, 2.0))];
  const y = proc('sori-limiter', { ceiling: -1, drive: 0 }, x)[0];
  assert(FX.peak([y]) <= Math.pow(10, -1 / 20) + 1e-6, 'peak ' + FX.peak([y]));
  assert(rms(y.subarray(10000)) > 0.5, 'too quiet ' + rms(y.subarray(10000)));
  const imp = new Float32Array(1024); imp[0] = 0.5;
  const d = proc('sori-limiter', { ceiling: 0 }, [imp])[0];
  assert.strictEqual(d.indexOf(0.5), Math.round(sr * 0.005) - 1 + LD.TP_HALF);
  // 12 kHz at 45 deg: every sample at 0.707 of the wave's top, so a sample-peak limiter lets the wave reach +3 dB
  const hi = Float32Array.from({ length: sr }, (_, i) => 1.5 * Math.sin(2 * Math.PI * 12000 * i / sr + Math.PI / 4));
  const top = Math.SQRT2 * rms(proc('sori-limiter', { ceiling: -1 }, [hi])[0].subarray(sr / 2));
  assert(top <= Math.pow(10, -1 / 20) * 1.001, 'the wave between samples tops at ' + top);
});
t('compressor worklet matches effects.js compressor', () => {
  const x = [sine(sr / 2, 300, sr, 0.9)],
    prm = { threshold: -20, ratio: 4, attack: 10, release: 120, makeup: 2, knee: 6 };
  const a = proc('sori-comp', prm, x)[0], b = FX.compressor(x, sr, prm)[0];
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  assert(m < 1e-4, 'max diff ' + m);
});
t('reverb worklet = the wet part of effects.js reverb, stereo and mono in; a size change keeps sound', () => {
  const prm = { size: 70, decay: 55, bright: 40 }, n = sr; // 1 s: input and its ringing tail
  const l = sine(sr / 4, 300, sr, 0.5), st = [new Float32Array(n), new Float32Array(n)];
  st[0].set(l); for (let i = 0; i < l.length; i++) st[1][i] = l[i] * 0.3;
  for (const x of [st, [st[0]]]) {
    const want = FX.reverb(x, sr, { ...prm, wet: 100 }), g = x[1] ? 1 : Math.SQRT1_2;
    const got = proc('sori-reverb', prm, x, sr, 2);
    let m = 0;
    for (let k = 0; k < 2; k++) {
      const dry = x[Math.min(k, x.length - 1)];
      for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(got[k][i] - (want[k][i] - dry[i] * g * 0.5)));
    }
    assert(m < 1e-5, `${x.length} ch: max diff ${m}`);
  }
  const C = loadAll()['sori-reverb'], p = new C({}), o = [new Float32Array(128), new Float32Array(128)];
  const run = (size, v) => p.process([[new Float32Array(128).fill(v)]], [o],
    { size: [size], decay: [60], bright: [50] });
  for (let i = 0; i < 40; i++) run(50, 0.5);
  run(80, 0);
  assert(rms(o[0]) > 1e-3, 'tail still rings after a size change ' + rms(o[0]));
});
t('eq graph response: peaking band reaches its gain at its frequency', () => {
  const st = FX.eqStages(sr, { mid: 6, midFreq: 1000, midQ: 0.9 });
  const db = 20 * Math.log10(FX.biquadMag(st[0], 2 * Math.PI * 1000 / sr));
  assert(Math.abs(db - 6) < 0.01, 'db ' + db);
  assert.strictEqual(FX.eqStages(sr, { lowcut: 0, highcut: 20000 }).length, 0, 'neutral EQ has no stages');
});
t('spectrogram puts a 1 kHz tone in the right row', () => {
  const SP = require('../../src/core/spectro');
  const src = E.makeSource([sine(sr / 4, 1000, sr, 0.9)]);
  const e = SP.get(src, sr);
  SP.computeCols(src, e, e.cols);
  const col = 10, rows = [...e.data.subarray(col * SP.ROWS, (col + 1) * SP.ROWS)],
    best = rows.indexOf(Math.max(...rows));
  const f1 = 40 * Math.pow(24000 / 40, 1 - best / SP.ROWS), f0 = 40 * Math.pow(24000 / 40, 1 - (best + 1) / SP.ROWS);
  assert(f0 <= 1100 && f1 >= 900, `row ${best}: ${f0.toFixed(0)}-${f1.toFixed(0)} Hz`);
});
