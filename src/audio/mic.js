// The 설정 window's audio tools: the device list, the mic input test and 자동 측정 (latency). Recording itself is in
// engine.js (it is timed against playback).
const engine = require('./engine');
const CH = require('./chain');

// settings: live input level without recording. Returns whether the default mic stood in, or null when a stop or a
// newer start came while the mic opened (that stream is closed, never left running)
let test = null, gen = 0;
async function startInputTest(deviceId, channels) {
  stopInputTest();
  const my = gen, stream = await engine.openMic(deviceId, channels), ctx = engine.context();
  if (my !== gen) { stream.getTracks().forEach((t) => t.stop()); return null; }
  const src = ctx.createMediaStreamSource(stream), m = engine.meterFor(ctx, 'input'), sink = engine.sink0();
  src.connect(m).connect(sink);
  test = { stream, src, m, sink };
  return !!stream.fellBack;
}
function stopInputTest() {
  gen++;
  if (!test) return;
  test.src.disconnect(); test.m.disconnect(); CH.stopNode(test.m); test.sink.disconnect();
  test.stream.getTracks().forEach((t) => t.stop());
  test = null;
  engine.dropLevel('input');
}
engine.onClose(stopInputTest); // a new sample rate closes the context the test runs in

// a short 2 kHz click at context time t
function click(ctx, t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = 2000;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.04);
}
// ms from each click to where the mic heard it, beyond the output latency recording already corrects
function heard(x, times, t0, ctx) {
  const sr = ctx.sampleRate, peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0), found = [];
  if (peak < 0.02) return found;
  const th = peak * 0.3, outLat = ctx.outputLatency || 0;
  for (const t of times) {
    const i0 = Math.max(0, Math.round((t - t0 - 0.02) * sr)), i1 = Math.min(x.length, Math.round((t - t0 + 0.5) * sr));
    for (let i = i0; i < i1; i++) if (Math.abs(x[i]) > th) { found.push((i / sr - (t - t0) - outLat) * 1000); break; }
  }
  return found;
}
// Plays 4 clicks and finds them in the mic signal. Returns the mic (input) latency in ms beyond what
// recording already corrects (output latency), or null when the clicks were not heard.
async function measureLatency(deviceId, channels) {
  const r = await engine.startRecording({ deviceId, channels }), ctx = engine.context();
  const t0 = ctx.currentTime + 0.4, gap = 0.6, times = [0, 1, 2, 3].map((k) => t0 + k * gap);
  for (const t of times) click(ctx, t);
  await new Promise((res) => setTimeout(res, (times[3] - ctx.currentTime + 0.7) * 1000));
  const res = await engine.stopRecording();
  if (!res || !res.ch) return null;
  const found = heard(res.ch[0], times, r.t, ctx);
  if (found.length < 3) return null;
  found.sort((a, b) => a - b);
  return Math.max(0, Math.min(500, Math.round(found[Math.floor(found.length / 2)])));
}

async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  const real = (d) => d.deviceId !== 'default' && d.deviceId !== 'communications';
  const pick = (kind) => all.filter((d) => d.kind === kind && real(d));
  return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
}

module.exports = { startInputTest, stopInputTest, measureLatency, listDevices };
