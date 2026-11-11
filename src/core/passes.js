// Playback as passes over the project (pure, unit-tested; audio/engine.js schedules them): pass 0 plays from `from`;
// with a loop [a, b) it ends at b and passes of a..b follow back to back, each scheduled ahead, so no gap.
// p: { t0 (context time of pass 0), from (frame), loop: { a, b } | null }; times in seconds, frames at `sr`.
function passAt(p, k, sr) {
  if (!k) return { at: p.t0, from: p.from, to: p.loop ? p.loop.b : Infinity };
  if (!p.loop) return null;
  const { a, b } = p.loop;
  return { at: p.t0 + (b - p.from + (k - 1) * (b - a)) / sr, from: a, to: b };
}
// the project frame heard at context time t
function frameAt(p, t, sr) {
  const f = p.from + Math.max(0, t - p.t0) * sr;
  return !p.loop || f < p.loop.b ? f : p.loop.a + ((f - p.loop.b) % (p.loop.b - p.loop.a));
}
// context time where pass k ends
const passEnd = (s, sr) => s.at + (s.to - s.from) / sr;
// the passes to schedule at context time `now`, from p.queued on (moved past them): those starting within `ahead` s,
// at most `max` a call. A loop under about 1 ms needs more than that and plays rough: a pass already late is skipped,
// never started late, so a tiny loop cannot flood the graph with thousands of sources
function due(p, now, sr, ahead = 0.5, max = 20) {
  const out = [];
  while (p.loop && p.queued && passAt(p, p.queued, sr).at < now) p.queued++;
  for (let s; out.length < max && (s = passAt(p, p.queued, sr)) && (!p.queued || s.at < now + ahead); p.queued++) {
    out.push(s);
  }
  return out;
}

module.exports = { passAt, frameAt, passEnd, due };
