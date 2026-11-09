// AudioWorklet processors, loaded with audioWorklet.addModule() into every (offline) context.
// Plain script: no require. test/run.js loads it in a vm sandbox to check the DSP.
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */

const kparam = (name, defaultValue, minValue, maxValue) => ({
  name, defaultValue, minValue, maxValue, automationRate: 'k-rate',
});

// Same algorithm as effects.js compressor (stereo-linked, dB-domain smoothing, no lookahead).
class Comp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [kparam('threshold', -18, -60, 0), kparam('ratio', 4, 1, 20), kparam('attack', 10, 0.1, 200),
      kparam('release', 120, 10, 1000), kparam('makeup', 0, 0, 24), kparam('knee', 6, 0, 24)];
  }
  constructor() { super(); this.env = 0; this.alive = true; this.port.onmessage = () => { this.alive = false; }; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return this.alive;
    const th = p.threshold[0], ratio = p.ratio[0], knee = p.knee[0], makeup = p.makeup[0];
    const ca = Math.exp(-1 / (sampleRate * p.attack[0] / 1000)), cr = Math.exp(-1 / (sampleRate * p.release[0] / 1000));
    const n = inp[0].length;
    let env = this.env;
    for (let i = 0; i < n; i++) {
      let lv = 0;
      for (let k = 0; k < inp.length; k++) { const v = Math.abs(inp[k][i]); if (v > lv) lv = v; }
      const x = 20 * Math.log10(lv + 1e-9), over = x - th;
      let gr = 0;
      if (2 * over > knee) gr = over * (1 - 1 / ratio);
      else if (2 * Math.abs(over) <= knee) gr = (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee);
      env = gr > env ? ca * env + (1 - ca) * gr : cr * env + (1 - cr) * gr;
      const g = Math.pow(10, (makeup - env) / 20);
      for (let k = 0; k < out.length; k++) out[k][i] = inp[Math.min(k, inp.length - 1)][i] * g;
    }
    this.env = env;
    return this.alive;
  }
}

// Brickwall lookahead limiter. Gain = moving average (L) of a min-hold (L) of the gain each sample
// needs, applied to the input delayed by L-1 samples: every averaged value is <= the need of the
// sample being output, so the output never exceeds the ceiling. Latency = L-1 frames (chain.js).
const LOOK_SEC = 0.005, REL_SEC = 0.05;
class Limiter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [kparam('ceiling', -1, -24, 0), kparam('drive', 0, 0, 24)]; }
  constructor() {
    super();
    const L = this.L = Math.max(2, Math.round(sampleRate * LOOK_SEC));
    this.D = L - 1;
    this.delay = [new Float32Array(this.D), new Float32Array(this.D)]; this.dp = 0;
    // min-hold deque (ring)
    this.qv = new Float32Array(L + 2); this.qi = new Float64Array(L + 2); this.qh = 0; this.qt = 0;
    this.avg = new Float32Array(L).fill(1); this.ap = 0; this.sum = L;
    this.n = 0; this.g = 1;
    this.rel = 1 - Math.exp(-1 / (sampleRate * REL_SEC));
    this.alive = true; this.port.onmessage = () => { this.alive = false; };
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    const nch = out.length, frames = out[0].length, L = this.L, Q = L + 2; // ring holds up to L+1 entries
    const ceil = Math.pow(10, p.ceiling[0] / 20), drive = Math.pow(10, p.drive[0] / 20);
    for (let i = 0; i < frames; i++) {
      let pk = 0;
      const x0 = inp.length ? inp[0][i] * drive : 0, x1 = inp.length > 1 ? inp[1][i] * drive : x0;
      pk = Math.max(Math.abs(x0), Math.abs(x1));
      const req = pk > ceil ? ceil / pk : 1, n = this.n++;
      while (this.qt !== this.qh && this.qv[(this.qt - 1 + Q) % Q] >= req) this.qt = (this.qt - 1 + Q) % Q;
      this.qv[this.qt] = req; this.qi[this.qt] = n; this.qt = (this.qt + 1) % Q;
      while (this.qi[this.qh] <= n - L) this.qh = (this.qh + 1) % Q;
      const mh = this.qv[this.qh];
      this.sum += mh - this.avg[this.ap]; this.avg[this.ap] = mh;
      // stop float drift
      if (++this.ap === L) { this.ap = 0; let s = 0; for (let k = 0; k < L; k++) s += this.avg[k]; this.sum = s; }
      const target = this.sum / L;
      this.g = target < this.g ? target : this.g + (target - this.g) * this.rel;
      const d0 = this.delay[0][this.dp], d1 = this.delay[1][this.dp];
      this.delay[0][this.dp] = x0; this.delay[1][this.dp] = x1;
      if (++this.dp === this.D) this.dp = 0;
      const y0 = Math.max(-ceil, Math.min(ceil, d0 * this.g)), y1 = Math.max(-ceil, Math.min(ceil, d1 * this.g));
      out[0][i] = y0;
      if (nch > 1) out[1][i] = y1;
    }
    return this.alive;
  }
}

// Pass-through peak meter: posts [peakL, peakR] about every 20 ms.
class Meter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pk = [0, 0]; this.k = 0; this.alive = true;
    this.port.onmessage = () => { this.alive = false; };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    for (let c = 0; c < out.length; c++) {
      const src = inp[Math.min(c, inp.length - 1)];
      if (src) out[c].set(src); else out[c].fill(0);
    }
    for (let c = 0; c < Math.min(2, inp.length); c++) {
      const d = inp[c];
      let m = this.pk[c];
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
      this.pk[c] = m;
    }
    if (inp.length === 1) this.pk[1] = this.pk[0];
    if (++this.k >= 8) { this.port.postMessage(this.pk); this.pk = [0, 0]; this.k = 0; }
    return this.alive;
  }
}

// Recorder: posts { frame, ch: [Float32Array...] } chunks of CHUNK frames; 'flush' posts the rest + { done }.
const CHUNK = 4096;
class Recorder extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.nch = (opts.processorOptions && opts.processorOptions.channels) || 1;
    this.buf = Array.from({ length: this.nch }, () => new Float32Array(CHUNK)); this.w = 0; this.start = -1;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data !== 'flush') return;
      this.send(); this.port.postMessage({ done: true }); this.alive = false;
    };
  }
  send() {
    if (!this.w) return;
    const ch = this.buf.map((b) => b.slice(0, this.w));
    this.port.postMessage({ start: this.start, ch }, ch.map((c) => c.buffer));
    this.w = 0;
  }
  process(inputs) {
    if (!this.alive) return false;
    const inp = inputs[0];
    if (this.start < 0) { this.start = currentFrame; this.port.postMessage({ startFrame: currentFrame }); }
    const n = inp.length ? inp[0].length : 128;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.nch; c++) {
        const s = inp[Math.min(c, inp.length - 1)];
        this.buf[c][this.w] = s ? s[i] : 0;
      }
      if (++this.w === CHUNK) this.send();
    }
    return true;
  }
}

// De-esser, the rule of voice.js deess: a Linkwitz-Riley split at `freq` (two Butterworth stages each side, the
// coefficients of effects.js biquad); the high band goes down while it is nearly as loud as the whole sound, up to
// `amount` dB. Constants = voice.js DEESS.
const DEESS = { start: -12, full: -3, floor: -50, attack: 1, release: 60 };
function deessGain(eh, ef, amount) {
  if (ef < Math.pow(10, DEESS.floor / 20)) return 1;
  const d = 20 * Math.log10((eh + 1e-9) / (ef + 1e-9));
  const t = Math.max(0, Math.min(1, (d - DEESS.start) / (DEESS.full - DEESS.start)));
  return Math.pow(10, -amount * t / 20);
}
function butter(type, f) {
  const w = 2 * Math.PI * Math.min(f, sampleRate * 0.49) / sampleRate, cs = Math.cos(w);
  const al = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + al, k = type === 'hp' ? 1 + cs : 1 - cs, b1 = type === 'hp' ? -(1 + cs) : 1 - cs;
  return [k / 2 / a0, b1 / a0, k / 2 / a0, -2 * cs / a0, (1 - al) / a0];
}
// one biquad step, state z = [x1, x2, y1, y2]; returns the output rounded like effects.js runBiquad stores it
function step(c, z, v) {
  const o = c[0] * v + c[1] * z[0] + c[2] * z[1] - c[3] * z[2] - c[4] * z[3];
  z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = o;
  return Math.fround(o);
}
class Deess extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [kparam('amount', 6, 0, 20), kparam('freq', 5000, 3000, 10000)]; }
  constructor() {
    super();
    this.eh = 0; this.ef = 0; this.f = -1;
    this.z = [0, 1].map(() => [0, 1, 2, 3].map(() => [0, 0, 0, 0])); // per channel: hp, hp, lp, lp
    this.alive = true; this.port.onmessage = () => { this.alive = false; };
  }
  // both bands of channel k at frame i
  split(k, v) {
    const z = this.z[k];
    return [step(this.lp, z[3], step(this.lp, z[2], v)), step(this.hp, z[1], step(this.hp, z[0], v))];
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return this.alive;
    if (p.freq[0] !== this.f) { this.f = p.freq[0]; this.hp = butter('hp', this.f); this.lp = butter('lp', this.f); }
    const amount = p.amount[0], nch = Math.min(2, inp.length);
    const ca = Math.exp(-1 / (sampleRate * DEESS.attack / 1000));
    const cr = Math.exp(-1 / (sampleRate * DEESS.release / 1000));
    for (let i = 0; i < inp[0].length; i++) {
      const bands = [];
      let h = 0, x = 0;
      for (let k = 0; k < nch; k++) {
        bands.push(this.split(k, inp[k][i]));
        h = Math.max(h, Math.abs(bands[k][1])); x = Math.max(x, Math.abs(inp[k][i]));
      }
      this.eh = h > this.eh ? ca * this.eh + (1 - ca) * h : cr * this.eh + (1 - cr) * h;
      this.ef = x > this.ef ? ca * this.ef + (1 - ca) * x : cr * this.ef + (1 - cr) * x;
      const g = deessGain(this.eh, this.ef, amount);
      for (let k = 0; k < out.length; k++) { const [lo, hi] = bands[Math.min(k, nch - 1)]; out[k][i] = lo + g * hi; }
    }
    return this.alive;
  }
}

registerProcessor('sori-comp', Comp);
registerProcessor('sori-limiter', Limiter);
registerProcessor('sori-meter', Meter);
registerProcessor('sori-rec', Recorder);
registerProcessor('sori-deess', Deess);
