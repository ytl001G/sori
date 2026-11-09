// Always-on effect chains (per track and master) built from Web Audio nodes. The same graph runs live
// and inside the OfflineAudioContext used for export, so what you hear is what you export.
const path = require('path');
const { pathToFileURL } = require('url');
const FX = require('../core/effects');
const V = require('../core/voice');
const P = require('../core/fxparams');

const WORKLETS = pathToFileURL(path.join(__dirname, 'worklets.js')).href;
const load = (c) => c.audioWorklet.addModule(WORKLETS);

const dbLin = (db) => Math.pow(10, db / 20);
// live changes glide (no zipper noise); the first value (and every offline one) is set exactly
const started = new WeakSet();
function setP(param, v, c, live) {
  if (live && started.has(param)) return param.setTargetAtTime(v, c.currentTime, 0.015);
  param.value = v;
  started.add(param);
}

// Freeverb impulse response (wet part only), cached: regenerating takes ~20-40 ms
const irCache = new Map();
function impulse(sr, { size, decay, bright }) {
  const key = [sr, size, decay, bright].join('|');
  let ir = irCache.get(key);
  if (!ir) {
    const y = FX.reverb([Float32Array.of(1)], sr, { size, decay, bright, wet: 100 }); // = 0.5*dry*(-3 dB) + wet
    y[0][0] -= 0.5 * Math.SQRT1_2; y[1][0] -= 0.5 * Math.SQRT1_2;
    ir = y;
    irCache.set(key, ir);
    if (irCache.size > 8) irCache.delete(irCache.keys().next().value);
  }
  return ir;
}

const echoTail = FX.echoTail;
const reverbTail = ({ decay }) => 1 + 5 * decay / 100;

function stopNode(n) { try { n.port.postMessage('stop'); } catch { /* not a worklet */ } }

const UNITS = {
  eq(c, live) {
    const mk = (type, freq, q) => {
      const b = c.createBiquadFilter();
      b.type = type; b.frequency.value = freq;
      if (q != null) b.Q.value = q;
      return b;
    };
    // Q of highpass/lowpass is in dB in Web Audio: 0.7071 -> -3.01 dB (same curve as effects.js)
    const hp = mk('highpass', 0, -3.0103), ls = mk('lowshelf', 120), pk = mk('peaking', 1000, 0.9);
    const hs = mk('highshelf', 8000), lp = mk('lowpass', c.sampleRate / 2, -3.0103);
    hp.connect(ls).connect(pk).connect(hs).connect(lp);
    return {
      in: hp, out: lp, nodes: [hp, ls, pk, hs, lp],
      set(p) {
        setP(hp.frequency, p.lowcut, c, live); // 0 Hz highpass = identity
        setP(ls.gain, p.low, c, live); setP(ls.frequency, p.lowFreq, c, live);
        setP(pk.gain, p.mid, c, live); setP(pk.frequency, p.midFreq, c, live); setP(pk.Q, p.midQ, c, live);
        setP(hs.gain, p.high, c, live); setP(hs.frequency, p.highFreq, c, live);
        setP(lp.frequency, p.highcut >= 20000 ? c.sampleRate / 2 : p.highcut, c, live); // lowpass at Nyquist = identity
      },
    };
  },
  comp(c, live) {
    const n = new AudioWorkletNode(c, 'sori-comp');
    return {
      in: n, out: n, nodes: [n],
      set(p) {
        for (const k of ['threshold', 'ratio', 'attack', 'release', 'makeup']) setP(n.parameters.get(k), p[k], c);
      },
    };
  },
  reverb(c, live) {
    const input = c.createGain(), out = c.createGain(), dry = c.createGain(), wet = c.createGain();
    const mono = c.createGain(), conv = c.createConvolver(), pan = c.createStereoPanner();
    // freeverb feeds (L+R)/2
    mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    conv.normalize = false;
    // pan 0: a mono dry plays at -3 dB per side like the track panner (stereo passes unchanged)
    input.connect(dry).connect(pan).connect(out);
    input.connect(mono).connect(conv).connect(wet).connect(out);
    let key = '', timer = null;
    const loadIr = (p) => {
      const ir = impulse(c.sampleRate, p), b = c.createBuffer(2, ir[0].length, c.sampleRate);
      ir.forEach((d, k) => b.copyToChannel(d, k));
      conv.buffer = b;
    };
    return {
      in: input, out, nodes: [input, out, dry, wet, mono, conv, pan],
      set(p) {
        setP(dry.gain, 1 - p.wet / 200, c, live); setP(wet.gain, p.wet / 100, c, live);
        const k = [p.size, p.decay, p.bright].join('|');
        if (k === key) return;
        key = k;
        clearTimeout(timer);
        if (live && conv.buffer) timer = setTimeout(() => loadIr(p), 150); // slider drags: rebuild once it settles
        else loadIr(p);
      },
      dispose() { clearTimeout(timer); },
    };
  },
  echo(c, live) {
    const input = c.createGain(), out = c.createGain(), sum = c.createGain(), delay = c.createDelay(2.5);
    const fb = c.createGain(), wet = c.createGain();
    input.connect(out); // dry
    input.connect(sum).connect(delay).connect(fb).connect(sum); // line = x[n-D] + fb * line[n-D]
    delay.connect(wet).connect(out);
    return {
      in: input, out, nodes: [input, out, sum, delay, fb, wet],
      set(p) {
        setP(delay.delayTime, p.delayMs / 1000, c, live); setP(fb.gain, p.feedback / 100, c, live);
        setP(wet.gain, p.wet / 100, c, live);
      },
    };
  },
  // notches on the mains frequency and its multiples (voice.js hum); a new count rebuilds the filters
  hum(c) {
    const input = c.createGain(), out = c.createGain(), nodes = [input, out];
    let key = '', filters = [];
    return {
      in: input, out, nodes,
      set(p) {
        const hz = V.humFreqs(c.sampleRate, p), k = hz.join(',');
        if (k === key) return;
        key = k;
        input.disconnect();
        for (const b of filters) { b.disconnect(); nodes.splice(nodes.indexOf(b), 1); }
        filters = hz.map((f) => {
          const b = c.createBiquadFilter();
          b.type = 'notch'; b.frequency.value = f; b.Q.value = V.HUM_Q; nodes.push(b);
          return b;
        });
        filters.reduce((n, b) => n.connect(b), input).connect(out);
      },
    };
  },
  deess(c) {
    const n = new AudioWorkletNode(c, 'sori-deess');
    const set = (p) => { for (const k of ['amount', 'freq']) setP(n.parameters.get(k), p[k], c); };
    return { in: n, out: n, nodes: [n], set };
  },
  gain(c, live) {
    const g = c.createGain();
    return { in: g, out: g, nodes: [g], set(p) { setP(g.gain, dbLin(p.db), c, live); } };
  },
  limiter(c) {
    const n = new AudioWorkletNode(c, 'sori-limiter');
    return {
      in: n, out: n, nodes: [n],
      set(p) { for (const k of ['ceiling', 'drive']) setP(n.parameters.get(k), p[k], c); },
    };
  },
};

// kinds in signal order; fx = { kind: { on, ...params } }
function makeChain(c, kinds, live) {
  const input = c.createGain(), output = c.createGain(), units = {};
  let sig = null;
  function rewire() {
    input.disconnect();
    for (const k of kinds) if (units[k]) units[k].out.disconnect();
    let n = input;
    for (const k of kinds) if (units[k]) { n.connect(units[k].in); n = units[k].out; }
    n.connect(output);
  }
  function set(fx) {
    for (const k of kinds) {
      const on = !!(fx[k] && fx[k].on);
      if (on && !units[k]) units[k] = UNITS[k](c, live);
      if (!on && units[k]) { dispose1(units[k]); delete units[k]; }
      if (on) units[k].set(fx[k]);
    }
    const s = kinds.filter((k) => units[k]).join(',');
    if (s !== sig) { sig = s; rewire(); }
  }
  function dispose1(u) { u.dispose && u.dispose(); for (const n of u.nodes) { n.disconnect(); stopNode(n); } }
  function dispose() {
    input.disconnect(); output.disconnect();
    for (const k of kinds) if (units[k]) dispose1(units[k]);
  }
  return { input, output, set, dispose };
}

const masterFx = (m) => ({ ...m.fx, gain: { on: true, db: m.gainDb } });
const MASTER_ORDER = ['eq', 'comp', 'reverb', 'echo', 'gain', 'limiter'];
const trackChain = (c, fx, live) => { const ch = makeChain(c, P.TRACK_KINDS, live); ch.set(fx); return ch; };
const masterChain = (c, m, live) => { const ch = makeChain(c, MASTER_ORDER, live); ch.set(masterFx(m)); return ch; };

// seconds of sound an enabled chain adds after the input stops
function tail(fx) {
  let s = 0;
  if (fx.reverb && fx.reverb.on) s += reverbTail(fx.reverb);
  if (fx.echo && fx.echo.on) s += echoTail(fx.echo);
  return s;
}
// frames the master output lags its input (limiter lookahead, see worklets.js)
const latency = (m, sr) => (m.fx.limiter.on ? Math.max(2, Math.round(sr * 0.005)) - 1 : 0);

function meterNode(c, onPeak) {
  const n = new AudioWorkletNode(c, 'sori-meter');
  n.port.onmessage = (e) => onPeak(e.data);
  return n;
}

module.exports = { load, trackChain, masterChain, masterFx, tail, latency, meterNode, stopNode, impulse };
