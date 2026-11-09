// Pure DSP effects: fx(ch: Float32Array[], sr, params) -> Float32Array[] (new arrays, input untouched).
// No DOM / AudioContext here so `npm test` runs them in Node.

const dbToLin = (db) => Math.pow(10, db / 20);
const copy = (ch) => ch.map((c) => c.slice());
const map = (ch, f) => ch.map((c) => {
  const o = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) o[i] = f(c[i], i, c.length);
  return o;
});

function peak(ch) {
  let p = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

const gain = (ch, sr, { db }) => { const g = dbToLin(db); return map(ch, (v) => v * g); };
function normalize(ch, sr, { db = -1 }) {
  const p = peak(ch);
  if (!p) return copy(ch);
  const g = dbToLin(db) / p;
  return map(ch, (v) => v * g);
}
const { fadeGain } = require('./edit');
const fadeIn = (ch, _sr, p = {}) => map(ch, (v, i, n) => v * (n > 1 ? fadeGain(p.shape, i / (n - 1)) : 1));
const fadeOut = (ch, _sr, p = {}) => map(ch, (v, i, n) => v * (n > 1 ? 1 - fadeGain(p.shape, i / (n - 1)) : 1));
const silence = (ch) => ch.map((c) => new Float32Array(c.length));
const reverse = (ch) => ch.map((c) => c.slice().reverse());

// ---- tempo / pitch (soundtouch) ----
function soundtouch(ch, sr, configure, outLen) {
  const { SoundTouch, SimpleFilter } = require('soundtouchjs');
  const st = new SoundTouch();
  st.stretch.setParameters(sr, 0, 0, 8); // auto sequence/seek windows for the real rate
  configure(st);
  const L = ch[0], R = ch[1] || ch[0], n = L.length, pad = Math.round(sr * 0.5);
  // padding with silence lets the pipe flush its tail; output is cut to outLen
  const source = {
    extract(t, frames, pos) {
      let k = 0;
      for (; k < frames && pos + k < n + pad; k++) {
        const p = pos + k;
        t[2 * k] = p < n ? L[p] : 0;
        t[2 * k + 1] = p < n ? R[p] : 0;
      }
      return k;
    },
  };
  const filter = new SimpleFilter(source, st);
  const oL = new Float32Array(outLen), oR = new Float32Array(outLen), buf = new Float32Array(8192);
  let w = 0;
  while (w < outLen) {
    const got = filter.extract(buf, 4096);
    if (!got) break;
    for (let i = 0; i < got && w < outLen; i++, w++) { oL[w] = buf[2 * i]; oR[w] = buf[2 * i + 1]; }
  }
  return ch.length > 1 ? [oL, oR] : [oL];
}
const tempo = (ch, sr, { percent }) => soundtouch(ch, sr, (st) => { st.tempo = percent / 100; },
  Math.max(1, Math.round(ch[0].length * 100 / percent)));
const pitch = (ch, sr, { semitones }) => soundtouch(ch, sr, (st) => { st.pitchSemitones = semitones; }, ch[0].length);

// ---- biquad EQ (RBJ cookbook) ----
// [b0, b1, b2, a0, a1, a2] per filter type
const BIQUAD = {
  highpass: ({ cs, al }) => [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al],
  lowpass: ({ cs, al }) => [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al],
  notch: ({ cs, al }) => [1, -2 * cs, 1, 1 + al, -2 * cs, 1 - al],
  peaking: ({ cs, al, A }) => [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A],
  lowshelf: ({ cs, A, sA }) => [
    A * ((A + 1) - (A - 1) * cs + sA), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - sA),
    (A + 1) + (A - 1) * cs + sA, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - sA,
  ],
  highshelf: ({ cs, A, sA }) => [
    A * ((A + 1) + (A - 1) * cs + sA), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - sA),
    (A + 1) - (A - 1) * cs + sA, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - sA,
  ],
};
function biquad(type, f0, sr, { db = 0, q = 0.707 } = {}) {
  const A = Math.pow(10, db / 40), w = 2 * Math.PI * Math.min(f0, sr * 0.49) / sr;
  const cs = Math.cos(w), al = Math.sin(w) / (2 * q), sA = 2 * Math.sqrt(A) * al;
  const [b0, b1, b2, a0, a1, a2] = BIQUAD[type]({ cs, al, A, sA });
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function runBiquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}
// coefficient list for the EQ; also used by the EQ graph to draw the response
function eqStages(sr, {
  lowcut = 0, low = 0, lowFreq = 120, mid = 0, midFreq = 1000, midQ = 0.9, high = 0, highFreq = 8000, highcut = 0,
}) {
  const stages = [];
  if (lowcut > 0) stages.push(biquad('highpass', lowcut, sr));
  if (low) stages.push(biquad('lowshelf', lowFreq, sr, { db: low }));
  if (mid) stages.push(biquad('peaking', midFreq, sr, { db: mid, q: midQ }));
  if (high) stages.push(biquad('highshelf', highFreq, sr, { db: high }));
  if (highcut > 0 && highcut < 20000 && highcut < sr / 2) stages.push(biquad('lowpass', highcut, sr));
  return stages;
}
function eq(ch, sr, params) {
  const stages = eqStages(sr, params);
  return ch.map((c) => stages.reduce((x, s) => runBiquad(x, s), c.slice()));
}
// |H| of one biquad at angular frequency w
function biquadMag([b0, b1, b2, a1, a2], w) {
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

// ---- compressor: stereo-linked, dB-domain gain smoothing, no lookahead (no shift) ----
function compressor(ch, sr, { threshold = -18, ratio = 4, attack = 10, release = 120, makeup = 0, knee = 6 }) {
  const n = ch[0].length, out = ch.map(() => new Float32Array(n));
  const ca = Math.exp(-1 / (sr * attack / 1000)), cr = Math.exp(-1 / (sr * release / 1000));
  let env = 0;
  for (let i = 0; i < n; i++) {
    let lv = 0;
    for (const c of ch) { const v = Math.abs(c[i]); if (v > lv) lv = v; }
    const x = 20 * Math.log10(lv + 1e-9), over = x - threshold;
    let gr = 0;
    if (2 * over > knee) gr = over * (1 - 1 / ratio);
    else if (2 * Math.abs(over) <= knee) gr = (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee);
    env = gr > env ? ca * env + (1 - ca) * gr : cr * env + (1 - cr) * gr;
    const g = dbToLin(makeup - env);
    for (let k = 0; k < ch.length; k++) out[k][i] = ch[k][i] * g;
  }
  return out;
}

// cut trailing near-silence but never below minLen (reverb/echo tails)
function trimTail(ch, minLen) {
  let end = ch[0].length;
  while (end > minLen && ch.every((c) => Math.abs(c[end - 1]) < 1e-4)) end--;
  return ch.map((c) => c.slice(0, end));
}
const withTail = (ch, sr, sec) => ch.map((c) => {
  const o = new Float32Array(c.length + Math.round(sr * sec));
  o.set(c);
  return o;
});

// ---- echo: feedback delay line ----
// seconds until the repeats fall to -60 dB, capped at 60 s (the live chain uses the same length)
const echoTail = ({ delayMs = 300, feedback = 40 }) =>
  Math.min(60, (delayMs / 1000) * Math.ceil(Math.log(1e-3) / Math.log(Math.max(feedback / 100, 0.01))) + 0.1);
// 0.5 s fade over the end of the tail (never into the original sound), so a capped tail does not click
function fadeEnd(ch, sr, from) {
  const end = ch[0].length, a = Math.max(from, end - Math.round(sr * 0.5));
  for (const c of ch) for (let i = a; i < end; i++) c[i] *= (end - i) / (end - a);
  return ch;
}
function echo(ch, sr, { delayMs = 300, feedback = 40, wet = 50 }) {
  const D = Math.max(1, Math.round(sr * delayMs / 1000)), fb = feedback / 100, w = wet / 100;
  const src = withTail(ch, sr, echoTail({ delayMs, feedback }));
  const out = src.map((x) => {
    const line = new Float32Array(x.length), y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      line[i] = i >= D ? x[i - D] + fb * line[i - D] : 0;
      y[i] = x[i] + w * line[i];
    }
    return y;
  });
  return fadeEnd(trimTail(out, ch[0].length), sr, ch[0].length);
}

// ---- reverb: Freeverb (8 lowpass-feedback combs + 4 allpasses per channel) ----
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], ALLPASS = [556, 441, 341, 225], SPREAD = 23;
function reverb(ch, sr, { size = 60, decay = 60, wet = 30, bright = 50 }) {
  const scale = sr / 44100 * (0.5 + size / 100), fbk = 0.7 + 0.28 * decay / 100;
  const damp = 0.05 + 0.6 * (1 - bright / 100), w = wet / 100;
  const src = withTail(ch, sr, 1 + 5 * decay / 100), R = src[1] || src[0];
  const g = src[1] ? 1 : Math.SQRT1_2; // mono dry plays at -3 dB per side, like the track panner
  const n = src[0].length, mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (src[0][i] + R[i]) * 0.5 * 0.015; // freeverb input gain
  const out = [0, 1].map((side) => {
    const acc = new Float32Array(n);
    for (const len of COMBS) {
      const L = Math.round((len + side * SPREAD) * scale), buf = new Float32Array(L);
      let idx = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const o = buf[idx];
        store = o * (1 - damp) + store * damp;
        buf[idx] = mono[i] + store * fbk;
        acc[i] += o;
        if (++idx >= L) idx = 0;
      }
    }
    for (const len of ALLPASS) {
      const L = Math.round((len + side * SPREAD) * scale), buf = new Float32Array(L);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx], v = acc[i];
        acc[i] = -v + b;
        buf[idx] = v + b * 0.5;
        if (++idx >= L) idx = 0;
      }
    }
    const dry = side ? R : src[0], y = new Float32Array(n), dg = g * (1 - w * 0.5);
    for (let i = 0; i < n; i++) y[i] = dry[i] * dg + acc[i] * w * 3;
    return y;
  });
  return trimTail(out, ch[0].length); // always stereo, even from mono input
}

// ---- noise reduction: spectral gating against a noise profile ----
const N = 2048, HOP = 512;
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
function stftFrames(x, onFrame) {
  const FFT = require('fft.js'), f = new FFT(N);
  const spec = f.createComplexArray(), res = f.createComplexArray(), frame = new Array(N);
  const padded = new Float32Array(x.length + 2 * N); padded.set(x, N);
  const out = new Float32Array(padded.length);
  for (let s = 0; s + N <= padded.length; s += HOP) {
    for (let i = 0; i < N; i++) frame[i] = padded[s + i] * HANN[i];
    f.realTransform(spec, frame); f.completeSpectrum(spec);
    if (onFrame(spec, s - N) === false) continue; // s - N: the frame's first sample in x
    f.inverseTransform(res, spec);
    for (let i = 0; i < N; i++) out[s + i] += res[2 * i] * HANN[i] / 1.5; // hann^2 at hop N/4 sums to 1.5
  }
  return out.subarray(N, N + x.length);
}
// average magnitude of the frames fully inside the piece (zero-padded edge frames read too quiet); a piece shorter
// than one frame uses them all
function noiseProfile(ch) {
  const mag = new Float64Array(N / 2 + 1); let frames = 0;
  for (const c of ch) {
    stftFrames(c, (spec, at) => {
      if (c.length >= N && (at < 0 || at + N > c.length)) return false;
      for (let k = 0; k <= N / 2; k++) mag[k] += Math.hypot(spec[2 * k], spec[2 * k + 1]);
      frames++;
      return false;
    });
  }
  return Float32Array.from(mag, (m) => m / Math.max(1, frames));
}
function noiseReduce(ch, sr, { profile, reduction = 12, sensitivity = 6 }) {
  if (!profile) throw new Error('잡음 프로필이 없어요');
  const floor = dbToLin(-reduction), th = dbToLin(sensitivity), K = N / 2 + 1;
  return ch.map((c) => {
    const prev = new Float32Array(K).fill(1), g = new Float32Array(K), mag = new Float32Array(K);
    const y = stftFrames(c, (spec) => {
      // time-smoothed magnitude: random noise peaks rarely cross the gate (less "musical noise")
      for (let k = 0; k < K; k++) mag[k] = 0.5 * mag[k] + 0.5 * Math.hypot(spec[2 * k], spec[2 * k + 1]);
      for (let k = 0; k < K; k++) g[k] = mag[k] > profile[k] * th ? 1 : floor;
      for (let k = 0; k < K; k++) {
        const sm = 0.25 * g[Math.max(0, k - 1)] + 0.5 * g[k] + 0.25 * g[Math.min(K - 1, k + 1)];
        const v = sm > prev[k] ? sm : prev[k] * 0.5 + sm * 0.5; // fast open, slower close
        prev[k] = v;
        spec[2 * k] *= v; spec[2 * k + 1] *= v;
        if (k > 0 && k < N / 2) { spec[2 * (N - k)] *= v; spec[2 * (N - k) + 1] *= v; }
      }
    });
    return Float32Array.from(y);
  });
}

module.exports = {
  gain, normalize, fadeIn, fadeOut, silence, reverse, tempo, pitch, eq, eqStages, biquadMag, compressor, echo, reverb,
  echoTail, noiseProfile, noiseReduce, peak, dbToLin, biquad, runBiquad,
};
