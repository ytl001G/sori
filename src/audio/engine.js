// Web Audio: decode, playback graph (clips -> track fx -> fader -> pan -> meter -> master chain),
// metronome + count-in, worklet recording, mixdown, preview (meters: meters.js, the mic tools: mic.js).
const { clipEnd, fades, envAt, envBreaks } = require('../core/edit');
const CH = require('./chain');
const M = require('./meters');

let ctx, ready, sinkId = '';
function createCtx(sr) {
  ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sr });
  ready = CH.load(ctx);
  ctx.resume(); // open the device now so the first Space press is not ~0.3 s late
  if (sinkId) setSink(sinkId);
}
createCtx(48000); // app.js switches to the settings rate before anything plays
const whenReady = () => ready;
const context = () => ctx;
const closing = []; // called before the context closes (a new sample rate)
const onClose = (f) => closing.push(f);

// Source -> AudioBuffer. Only sources of the current project are kept (pruned on play/mixdown),
// so undo history does not hold a second copy of every old take.
const bufCache = new Map();
function prune(tracks) {
  const live = new Set(tracks.flatMap((t) => t.clips.map((c) => c.src)));
  for (const s of bufCache.keys()) if (!live.has(s)) bufCache.delete(s);
}

function setSampleRate(sr) {
  if (ctx.sampleRate === sr) return ready;
  stop(); stopPreview();
  closing.forEach((f) => f());
  ctx.close();
  bufCache.clear();
  createCtx(sr);
  return ready;
}
const sampleRate = () => ctx.sampleRate;

async function setSink(id) {
  sinkId = id || '';
  try { if (ctx.setSinkId) await ctx.setSinkId(sinkId); return true; } catch { sinkId = ''; return false; }
}

async function decode(arrayBuffer) {
  let b = await ctx.decodeAudioData(arrayBuffer);
  if (b.numberOfChannels > 2) b = await toStereo(b);
  return Array.from({ length: b.numberOfChannels }, (_, k) => b.getChannelData(k).slice());
}
// Web Audio's speaker downmix (quad, 5.1 -> L/R). shortcut: 3/5/7.1-ch files keep only L/R (discrete rule), upgrade
// with an own mix matrix if such files show up
async function toStereo(b) {
  const off = new OfflineAudioContext(2, b.length, b.sampleRate), s = off.createBufferSource();
  s.buffer = b; s.connect(off.destination); s.start(); return off.startRendering();
}

// AudioBuffers are not tied to a context, so one buffer serves playback and offline mixdown
function bufferFor(c, src) {
  let b = bufCache.get(src);
  if (!b) {
    b = new AudioBuffer({ numberOfChannels: src.ch.length, length: src.ch[0].length, sampleRate: c.sampleRate });
    src.ch.forEach((d, k) => b.copyToChannel(d, k));
    bufCache.set(src, b);
  }
  return b;
}

const effectiveGain = (t, anySolo) => (t.mute || (anySolo && !t.solo) ? 0 : t.gain);

// clip volume/fade envelope scheduled on a GainNode, starting at clip-relative frame k0
function scheduleEnv(param, c, fd, k0, tAt) {
  param.setValueAtTime(envAt(c, fd, k0), tAt(k0));
  for (const b of envBreaks(c, fd)) if (b > k0) param.linearRampToValueAtTime(envAt(c, fd, b), tAt(b));
}

// Builds the mix graph on `c` playing [from, to) starting at context time `when`.
function buildGraph(c, tracks, master, from, to, when, dest, live) {
  const anySolo = tracks.some((t) => t.solo), sr = c.sampleRate, nodes = new Map(), sources = [];
  const mchain = CH.masterChain(c, master, live);
  let mout = mchain.output;
  if (live) { const m = M.meterFor(c, 'master'); mout.connect(m); mout = m; nodes.set('master', { meter: m }); }
  mout.connect(dest);
  for (const t of tracks) {
    const chain = CH.trackChain(c, t.fx, live), g = c.createGain(), p = c.createStereoPanner();
    g.gain.value = effectiveGain(t, anySolo); p.pan.value = t.pan;
    chain.output.connect(g).connect(p);
    let out = p, meter = null;
    if (live) { meter = M.meterFor(c, t.id); p.connect(meter); out = meter; }
    out.connect(mchain.input);
    nodes.set(t.id, { chain, g, p, meter });
    const fd = fades(t.clips);
    for (const clip of t.clips) {
      if (clipEnd(clip) <= from || clip.start >= to) continue;
      const skip = Math.max(0, from - clip.start), len = Math.min(clip.length - skip, to - Math.max(from, clip.start));
      if (len <= 0) continue;
      const s = c.createBufferSource(), env = c.createGain();
      s.buffer = bufferFor(c, clip.src);
      s.connect(env).connect(chain.input);
      scheduleEnv(env.gain, clip, fd.get(clip), skip, (k) => when + (clip.start + k - from) / sr);
      s.start(when + Math.max(0, clip.start - from) / sr, (clip.offset + skip) / sr, len / sr);
      sources.push(s);
    }
  }
  return { nodes, sources, mchain };
}

// ---- metronome: short sine clicks straight to the speakers (never exported) ----
function click(t, accent, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.06);
}

let play_ = null; // { from, t0, graph, timer }

// opts: { countIn: seconds, metro: { on, bpm, beats, volume 0..1 } }
function play(tracks, master, from, to = Infinity, opts = {}) {
  stop();
  prune(tracks);
  if (ctx.state === 'suspended') ctx.resume();
  const countIn = opts.countIn || 0, metro = opts.metro;
  const t0 = ctx.currentTime + 0.05 + countIn, lat = CH.latency(master, ctx.sampleRate);
  if (rec) Object.assign(rec, { t0, lat }); // the take's lead survives a stop of playback during the recording
  play_ = { from, t0, lat, graph: buildGraph(ctx, tracks, master, from, to, t0, ctx.destination, true), timer: null };
  if (!metro) return;
  const p = play_, base = t0 - from / ctx.sampleRate, beat = 60 / metro.bpm; // base: ctx time of project frame 0
  const bar = (n) => ((n % metro.beats) + metro.beats) % metro.beats === 0;
  // count-in leads into the next grid beat when the metronome runs, else into the playback start
  const n0 = Math.round(countIn / beat), nf = metro.on ? Math.ceil((t0 - base) / beat - 1e-6) : n0;
  const lead = metro.on ? base + nf * beat : t0;
  for (let j = 0; j < n0; j++) click(lead - (n0 - j) * beat, bar(nf - n0 + j), metro.volume);
  p.metro = metro; p.next = t0;
  const pump = () => { // reads p.metro each time so toggles and tempo changes apply without a restart
    const m = p.metro, b = 60 / m.bpm;
    if (!m.on) return;
    const first = Math.ceil((Math.max(p.next, ctx.currentTime - 0.01) - base) / b - 1e-6);
    for (let n = first, t; (t = base + n * b) < ctx.currentTime + 0.15; n++) {
      click(t, n % m.beats === 0, m.volume);
      p.next = t + 1e-3;
    }
  };
  pump();
  p.timer = setInterval(pump, 25);
}
// live metronome settings (on/off, tempo, volume) for the running playback or recording
function setMetro(m) { if (play_ && play_.metro) play_.metro = m; }

function stop() {
  if (!play_) return;
  clearInterval(play_.timer);
  for (const s of play_.graph.sources) { try { s.stop(); } catch { /* not started */ } s.disconnect(); }
  for (const n of play_.graph.nodes.values()) {
    if (n.chain) { n.chain.dispose(); n.g.disconnect(); n.p.disconnect(); }
    if (n.meter) { n.meter.disconnect(); CH.stopNode(n.meter); }
  }
  play_.graph.mchain.dispose();
  play_ = null;
  M.clearLevels();
}

const position = () => (play_ ? play_.from + Math.max(0, ctx.currentTime - play_.t0) * ctx.sampleRate : null);
const countingIn = () => !!play_ && ctx.currentTime < play_.t0;

// live mixer / effect changes without restarting playback
function updateMix(tracks, master) {
  if (!play_) return;
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    const n = play_.graph.nodes.get(t.id);
    if (!n || !n.chain) continue;
    n.g.gain.setTargetAtTime(effectiveGain(t, anySolo), ctx.currentTime, 0.01);
    n.p.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.01);
    n.chain.set(t.fx);
  }
  if (master) play_.graph.mchain.set(CH.masterFx(master));
}

// frames of reverb/echo tail after the last clip (live playback runs on for them, export keeps them)
const tailLen = (ts, m) => Math.round(ctx.sampleRate * (Math.max(0, ...ts.map((t) => CH.tail(t.fx))) + CH.tail(m.fx)));
// Offline render of [a, b) through the same graph. Effect tails (reverb/echo) are kept, the
// limiter's lookahead delay is removed, trailing silence past b is cut.
// onPart(fraction), when given, is awaited at about every 2 % of the render (rendering waits meanwhile); if it throws,
// the render stops there and mixdown rejects with that error (the export's 멈추기)
async function mixdown(tracks, master, a, b, onPart) {
  const sr = ctx.sampleRate, tail = tailLen(tracks, master);
  const lat = CH.latency(master, sr), len = Math.max(1, b - a) + tail;
  prune(tracks);
  const off = new OfflineAudioContext(2, len + lat, sr);
  await CH.load(off);
  const g = buildGraph(off, tracks, master, a, b, 0, off.destination, false);
  const r = await new Promise((resolve, reject) => {
    const total = (len + lat) / sr, every = Math.max(1, total / 50);
    for (let t = every; onPart && t < total; t += every) {
      // a stop: the sources stop and the render runs out (result dropped); a context left suspended keeps their
      // audio for good (measured: +110 MB per stop of a 5-min source)
      off.suspend(t).then(() => onPart(t / total)).then(() => off.resume(), (e) => {
        for (const s of g.sources) { try { s.stop(); } catch { /* not started */ } }
        off.resume(); reject(e);
      });
    }
    off.startRendering().then(resolve, reject);
  });
  const ch = [r.getChannelData(0).subarray(lat), r.getChannelData(1).subarray(lat)];
  let end = len;
  while (end > b - a && Math.abs(ch[0][end - 1]) < 1e-4 && Math.abs(ch[1][end - 1]) < 1e-4) end--;
  return ch.map((c) => c.subarray(0, end)); // views: no second copy of a long export (callers honor byteOffset)
}

// ---- preview (effect dialogs) ----
let preview = null;
function playPreview(ch, onEnd) {
  stopPreview();
  const b = ctx.createBuffer(2, ch[0].length, ctx.sampleRate), m = !ch[1] && ch[0].map((v) => v * Math.SQRT1_2);
  (m ? [m, m] : ch).forEach((d, k) => b.copyToChannel(d, k)); // mono: -3 dB per side
  const s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination);
  s.onended = () => { if (preview === s) { preview = null; onEnd && onEnd(); } };
  if (ctx.state === 'suspended') ctx.resume();
  s.start();
  preview = s;
}
function stopPreview() { if (preview) { const p = preview; preview = null; try { p.stop(); } catch { /* ended */ } } }

// ---- microphone ----
async function openMic(deviceId, channels) {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: channels };
  if (deviceId) audio.deviceId = { exact: deviceId };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio }); } catch (e) {
    if (!deviceId || e.name !== 'OverconstrainedError') throw e;
    delete audio.deviceId; // chosen mic unplugged: fall back to the default one
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    stream.fellBack = true;
  }
  await ready;
  if (ctx.state === 'suspended') await ctx.resume();
  return stream;
}
// keeps worklets pulled
const sink0 = () => { const z = ctx.createGain(); z.gain.value = 0; z.connect(ctx.destination); return z; };

// recording: AudioWorklet chunks (exact samples, live peaks); rec.t = context time of the first sample, t0/lat: play
let rec = null;
async function startRecording({ deviceId = '', channels = 1 } = {}) {
  if (rec) throw new Error('이미 녹음 중이에요'); // a second recorder would replace the running take
  const stream = await openMic(deviceId, channels);
  const src = ctx.createMediaStreamSource(stream);
  const opts = { channelCount: channels, channelCountMode: 'explicit', processorOptions: { channels } };
  const node = new AudioWorkletNode(ctx, 'sori-rec', opts);
  const sink = sink0();
  const r = {
    stream, src, node, sink, chunks: [], peaks: [], length: 0, t: ctx.currentTime, chunk: 4096, channels,
    fellBack: !!stream.fellBack,
  };
  node.port.onmessage = (e) => {
    const d = e.data;
    if (d.startFrame !== undefined) { r.t = d.startFrame / ctx.sampleRate; return; }
    if (d.done) { r.flushed && r.flushed(); return; }
    r.chunks.push(d.ch); r.length += d.ch[0].length;
    let mn = 0, mx = 0, pl = 0, pr = 0;
    d.ch[0].forEach((v) => { if (v < mn) mn = v; if (v > mx) mx = v; });
    pl = Math.max(-mn, mx);
    pr = d.ch[1] ? d.ch[1].reduce((m, v) => Math.max(m, Math.abs(v)), 0) : pl;
    r.peaks.push([mn, mx]);
    M.setLevel('input', [pl, pr]);
  };
  src.connect(node).connect(sink);
  rec = r;
  return r;
}
// returns { ch, lead }: lead (leadSec) is cut; mic latency is the user setting latencyMs (자동 측정 in 설정)
async function stopRecording() {
  if (!rec) return null;
  const r = rec; rec = null;
  const lead = leadSec(r);
  await new Promise((res) => { r.flushed = res; r.node.port.postMessage('flush'); setTimeout(res, 500); });
  r.src.disconnect(); r.node.disconnect(); r.sink.disconnect();
  r.stream.getTracks().forEach((t) => t.stop());
  M.dropLevel('input');
  if (!r.length) return { ch: null, lead };
  const out = Array.from({ length: r.channels }, () => new Float32Array(r.length));
  let o = 0;
  for (const c of r.chunks) { out.forEach((d, k) => d.set(c[k], o)); o += c[0].length; }
  return { ch: out, lead, fellBack: r.fellBack };
}
const recording = () => rec;
// seconds captured before playback was audible (count-in, start gap, output latency, limiter lookahead); cut on stop
const leadSec = (r) => Math.max(0, (r.t0 ?? r.t) - r.t + (ctx.outputLatency || 0) + (r.lat || 0) / ctx.sampleRate);
const recLead = () => (rec ? leadSec(rec) : 0);

module.exports = {
  whenReady, setSampleRate, sampleRate, setSink, decode, play, setMetro, stop, position, countingIn, updateMix, mixdown,
  tailLen, playPreview, stopPreview, startRecording, stopRecording, recording, recLead,
  level: M.level, isClipped: M.isClipped, resetClip: M.resetClip, heldPeak: M.heldPeak,
  // for mic.js
  context, onClose, openMic, sink0, meterFor: M.meterFor, dropLevel: M.dropLevel,
};
