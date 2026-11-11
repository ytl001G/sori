// Metronome + count-in: short sine clicks straight to the speakers (never exported), on the project's beat grid
// wherever playback is (each loop pass starts on its own project time, core/passes.js).
const { passAt, passEnd } = require('../core/passes');

// p.clicks: the clicks scheduled and not over yet, so stopping silences them at once (a count-in is scheduled whole)
function click(ctx, p, t, accent, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.06);
  p.clicks = (p.clicks || []).filter((c) => c.t + 0.06 > ctx.currentTime);
  p.clicks.push({ t, o, g });
}
// playback or recording stops: the clicks still to come never sound, and no new ones are scheduled
function silence(p) {
  for (const c of p.clicks || []) {
    try { c.o.stop(); } catch { /* already stopped */ }
    c.g.disconnect();
  }
  p.clicks = [];
  p.metro = null;
}

// p: the playback (core/passes.js fields); metro: { on, bpm, beats, volume 0..1 }; countIn: seconds before p.t0.
// The count-in leads into the next grid beat when the metronome runs, else into the playback start
function start(ctx, p, metro, countIn) {
  const sr = ctx.sampleRate, base = p.t0 - p.from / sr, beat = 60 / metro.bpm; // base: ctx time of project frame 0
  const bar = (n) => ((n % metro.beats) + metro.beats) % metro.beats === 0;
  const n0 = Math.round(countIn / beat), nf = metro.on ? Math.ceil((p.t0 - base) / beat - 1e-6) : n0;
  const lead = metro.on ? base + nf * beat : p.t0;
  for (let j = 0; j < n0; j++) click(ctx, p, lead - (n0 - j) * beat, bar(nf - n0 + j), metro.volume);
  Object.assign(p, { metro, next: p.t0, beatPass: 0 });
}
// every 25 ms: clicks up to 0.15 s ahead. Reads p.metro each time so toggles and tempo changes apply without a restart
function pump(ctx, p) {
  const m = p.metro, sr = ctx.sampleRate, b = m && 60 / m.bpm;
  if (!m || !m.on) return;
  const lo = Math.max(p.next, ctx.currentTime - 0.01), hi = ctx.currentTime + 0.15;
  while (passEnd(passAt(p, p.beatPass, sr), sr) <= lo) p.beatPass++; // passes already over
  for (let k = p.beatPass, s; (s = passAt(p, k, sr)) && s.at < hi; k++) {
    const base = s.at - s.from / sr, end = Math.min(hi, passEnd(s, sr));
    for (let n = Math.ceil((Math.max(lo, s.at) - base) / b - 1e-6), t; (t = base + n * b) < end; n++) {
      click(ctx, p, t, n % m.beats === 0, m.volume);
      p.next = t + 1e-3;
    }
  }
}

module.exports = { start, pump, silence };
