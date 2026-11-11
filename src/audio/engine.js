// Web Audio: decode, playback graph (clips -> track fx -> fader -> pan -> meter -> master chain),
// loop passes, worklet recording, mixdown, preview (meters: meters.js, metronome: metro.js, the mic tools: mic.js).
const { clipEnd, fades, envAt, envBreaks } = require('../core/edit');
const CH = require('./chain');
const M = require('./meters');
const MET = require('./metro');
const { due, frameAt } = require('../core/passes');
const BF = require('./buffers');

let ctx, ready, sinkId = '';
function createCtx(sr) {
  ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sr });
  ready = CH.load(ctx);
  ctx.resume(); // open the device now so the first Space press is not ~0.3 s late
  if (sinkId) setSink(sinkId);
}
createCtx(48000); // app.js switches to the settings rate before anything plays
BF.setRate(() => ctx.sampleRate);
const whenReady = () => ready;
const context = () => ctx;
const closing = []; // called before the context closes (a new sample rate)
const onClose = (f) => closing.push(f);

function setSampleRate(sr) {
  if (ctx.sampleRate === sr) return ready;
  stop(); stopPreview();
  closing.forEach((f) => f());
  ctx.close();
  BF.clear();
  createCtx(sr);
  return ready;
}
const sampleRate = () => ctx.sampleRate;
const decode = (arrayBuffer) => BF.decode(ctx, arrayBuffer);

async function setSink(id) {
  sinkId = id || '';
  try { if (ctx.setSinkId) await ctx.setSinkId(sinkId); return true; } catch { sinkId = ''; return false; }
}

const effectiveGain = (t, anySolo) => (t.mute || (anySolo && !t.solo) ? 0 : t.gain);

// clip volume/fade envelope scheduled on a GainNode, starting at clip-relative frame k0
function scheduleEnv(param, c, fd, k0, tAt) {
  param.setValueAtTime(envAt(c, fd, k0), tAt(k0));
  for (const b of envBreaks(c, fd)) if (b > k0) param.linearRampToValueAtTime(envAt(c, fd, b), tAt(b));
}

// The mix graph on `c` (chains, faders, pans, meters, the master chain into dest); addClips puts sound into it.
function buildGraph(c, tracks, master, dest, live) {
  const anySolo = tracks.some((t) => t.solo), nodes = new Map(), sources = new Set();
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
  }
  return { nodes, sources, mchain };
}
// the clips' sound of [from, to) into graph g, starting at context time `when`; a source leaves g when it ends
function addClips(c, g, tracks, from, to, when) {
  const sr = c.sampleRate;
  for (const t of tracks) {
    const fd = fades(t.clips), input = g.nodes.get(t.id).chain.input;
    for (const clip of t.clips) {
      if (clipEnd(clip) <= from || clip.start >= to) continue;
      const skip = Math.max(0, from - clip.start), len = Math.min(clip.length - skip, to - Math.max(from, clip.start));
      if (len <= 0) continue;
      const s = c.createBufferSource(), env = c.createGain();
      s.buffer = BF.bufferFor(c, clip.src);
      s.connect(env).connect(input);
      scheduleEnv(env.gain, clip, fd.get(clip), skip, (k) => when + (clip.start + k - from) / sr);
      s.start(when + Math.max(0, clip.start - from) / sr, (clip.offset + skip) / sr, len / sr);
      s.onended = () => { g.sources.delete(s); s.disconnect(); env.disconnect(); }; // a long loop leaves none behind
      g.sources.add(s);
    }
  }
}

let play_ = null; // { from, t0, lat, loop, graph, timer, queued } (core/passes.js reads from, t0, loop)

// opts: { countIn: seconds, metro: { on, bpm, beats, volume 0..1 }, loop: { a, b } (from < b) }. A loop's next pass
// is scheduled 0.5 s ahead (no gap, and it goes on while the window is minimized)
function play(tracks, master, from, opts = {}) {
  stop();
  BF.prune(tracks);
  if (ctx.state === 'suspended') ctx.resume();
  const countIn = opts.countIn || 0, sr = ctx.sampleRate;
  const t0 = ctx.currentTime + 0.05 + countIn, lat = CH.latency(master, sr);
  if (rec) Object.assign(rec, { t0, lat }); // the take's lead survives a stop of playback during the recording
  const p = play_ = { from, t0, lat, loop: opts.loop || null, timer: null, queued: 0,
    graph: buildGraph(ctx, tracks, master, ctx.destination, true) };
  const ahead = () => {
    for (const s of due(p, ctx.currentTime, sr)) addClips(ctx, p.graph, tracks, s.from, s.to, s.at);
  };
  ahead();
  if (opts.metro) MET.start(ctx, p, opts.metro, countIn);
  if (p.loop || opts.metro) p.timer = setInterval(() => { ahead(); MET.pump(ctx, p); }, 25);
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
  MET.silence(play_);
  play_ = null;
  M.clearLevels();
}

const position = () => (play_ ? frameAt(play_, ctx.currentTime, ctx.sampleRate) : null);
const looping = () => (play_ ? play_.loop : null);
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
  BF.prune(tracks);
  const off = new OfflineAudioContext(2, len + lat, sr);
  await CH.load(off);
  const g = buildGraph(off, tracks, master, off.destination, false);
  addClips(off, g, tracks, a, b, 0);
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
let rec = null, opening = false; // opening: the mic is opening (a start then too would leave one of them running)
async function startRecording({ deviceId = '', channels = 1 } = {}) {
  if (rec || opening) throw new Error('이미 녹음 중이에요'); // a second recorder would replace the running take
  opening = true;
  const stream = await openMic(deviceId, channels).finally(() => { opening = false; });
  const src = ctx.createMediaStreamSource(stream);
  const opts = { channelCount: channels, channelCountMode: 'explicit', processorOptions: { channels } };
  const node = new AudioWorkletNode(ctx, 'sori-rec', opts), sink = sink0();
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
  if (play_) MET.silence(play_); // the count-in / metronome stops now, not after the flush
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
  whenReady, setSampleRate, sampleRate, setSink, decode, play, setMetro, stop, position, looping, countingIn, updateMix,
  mixdown, tailLen, playPreview, stopPreview, startRecording, stopRecording, recording, recLead,
  level: M.level, isClipped: M.isClipped, resetClip: M.resetClip, heldPeak: M.heldPeak,
  // for mic.js
  context, onClose, openMic, sink0, meterFor: M.meterFor, dropLevel: M.dropLevel,
};
