// Sample memory for playback: Source -> AudioBuffer, decoding, and one copy of the samples, not two (see
// architecture.md, Sound graph). Used by engine.js.
const PK = require('../core/parked');
const { toStereo } = require('../core/downmix');

let rate = () => 48000; // the live context's rate (engine.js sets it)
const setRate = (f) => { rate = f; };
// Source -> AudioBuffer. Only sources of the current project are kept (pruned on play/mixdown),
// so undo history does not hold a second copy of every old take.
const bufCache = new Map();
function prune(tracks) {
  const live = new Set(tracks.flatMap((t) => t.clips.map((c) => c.src)));
  for (const s of bufCache.keys()) if (!live.has(s)) bufCache.delete(s);
}

const clear = () => bufCache.clear();

// sample arrays that are an AudioBuffer's own (decoded files): playback uses that buffer, no copy
const owner = new WeakMap();
async function decode(ctx, arrayBuffer) {
  const b = await ctx.decodeAudioData(arrayBuffer);
  const ch = Array.from({ length: b.numberOfChannels }, (_, k) => b.getChannelData(k));
  if (ch.length > 2) return toStereo(ch); // more channels: core/downmix.js
  owner.set(ch[0], b);
  return ch;
}
// saved takes decode straight into an AudioBuffer's arrays too
PK.setAlloc((n, length) => {
  const b = new AudioBuffer({ numberOfChannels: n, length, sampleRate: rate() });
  const ch = Array.from({ length: n }, (_, k) => b.getChannelData(k));
  owner.set(ch[0], b);
  return ch;
});

// AudioBuffers are not tied to a context, so one buffer serves playback and offline mixdown. The source then uses
// the buffer's own arrays (sources never change their samples): one copy of the sound in memory, not two
function bufferFor(c, src) {
  let b = bufCache.get(src);
  if (b) return b;
  const ch = src.ch, own = owner.get(ch[0]);
  const mine = own && own.sampleRate === c.sampleRate && own.numberOfChannels === ch.length
    && ch.every((d, k) => own.getChannelData(k) === d);
  if (mine) b = own;
  else {
    b = new AudioBuffer({ numberOfChannels: ch.length, length: ch[0].length, sampleRate: c.sampleRate });
    ch.forEach((d, k) => b.copyToChannel(d, k));
    PK.adopt(src, ch.map((_, k) => b.getChannelData(k)));
    owner.set(b.getChannelData(0), b);
  }
  bufCache.set(src, b);
  return b;
}

module.exports = { decode, bufferFor, prune, clear, setRate };
