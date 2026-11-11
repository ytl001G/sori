// 필요할 때만 풀기: a source whose samples have an exact packed copy (the file's blob, or the
// one prepack / a save made) lets go of its decoded samples while it is off screen and unused for IDLE_MS; s.ch
// decodes them again on use (a 5 s take: about 5 ms). s.frames and s.channels stay known without decoding.
const AP = require('./audiopack');

const IDLE_MS = 30000;
const awake = new Map(); // parked source -> { ch, drop, used } while its samples are decoded
const recs = new WeakMap(); // parked source -> the same record, decoded or not

// dims { channels, frames }: s.ch may be null (an opened take not decoded yet, fileio.packedSource)
function park(s, blob, decoded, dims) {
  if (Object.getOwnPropertyDescriptor(s, 'ch').get) return;
  const { channels, frames } = dims || { channels: s.ch.length, frames: s.ch[0].length };
  const e = { used: Date.now(), ch: decoded ? s.ch : null };
  e.drop = () => { e.ch = null; awake.delete(s); };
  recs.set(s, e);
  Object.defineProperty(s, 'ch', {
    enumerable: true,
    get() {
      if (!e.ch) e.ch = AP.unpack(blob, channels, frames, alloc && alloc(channels, frames));
      e.used = Date.now(); awake.set(s, e);
      return e.ch;
    },
  });
  Object.defineProperties(s, { frames: { value: frames }, channels: { value: channels } });
  if (decoded) awake.set(s, e);
}
// the app calls this now and then: keep = the sources on screen
function sweep(keep, now = Date.now()) {
  for (const [s, e] of awake) if (!keep.has(s) && now - e.used > IDLE_MS) e.drop();
}
const awakeCount = () => awake.size;
// the same samples in other arrays (the engine's AudioBuffer): the source uses them and its old copy can go
function adopt(s, ch) {
  const e = recs.get(s);
  if (e) e.ch = ch; else s.ch = ch;
}

// the app decodes into AudioBuffer arrays (engine.js), so playing a decoded take makes no second copy; plain Node: null
let alloc = null;
const setAlloc = (f) => { alloc = f; };

module.exports = { park, sweep, awakeCount, adopt, setAlloc, IDLE_MS };
