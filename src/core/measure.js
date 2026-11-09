// sori measure (docs/cli.md): the numbers for one rendered piece, as heard (track or character
// effects and the master already in it): loudness, peak, places over 0 dBFS, room noise and speech level, and the
// quiet stretches by 긴 침묵 줄이기's own rule (voicedit.js quietLevels; breaths count as quiet).
const LD = require('./loudness');
const V = require('./voice');
const { quietLevels } = require('./voicedit');

const QUIET_MIN = 0.5; // s: a quiet stretch at least this long is listed
const CLIP_JOIN = 0.01; // s: samples over 0 dBFS this close together are one place
const CLIP_SHOW = 20; // places with their time; `count` has them all

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const s3 = (f, sr) => Math.round(f / sr * 1000) / 1000;

// samples past 0 dBFS (either channel): { count of places, at: the first CLIP_SHOW start times }
function overs(ch, sr) {
  const join = Math.round(CLIP_JOIN * sr), at = [];
  let count = 0, last = -Infinity;
  for (let i = 0; i < ch[0].length; i++) {
    if (!ch.some((c) => c[i] > 1 || c[i] < -1)) continue;
    if (i - last > join) { count++; if (at.length < CLIP_SHOW) at.push(s3(i, sr)); }
    last = i;
  }
  return { count, at };
}

// stretches with nothing heard over the room noise (the between-words threshold), QUIET_MIN or longer
function quietRuns(det, th, sr, len) {
  const B = Math.round(0.01 * sr), open = V.openBlocks(det, B, th), out = [];
  for (let i = 0; i < open.length; i++) {
    if (open[i]) continue;
    let j = i;
    while (j < open.length && !open[j]) j++;
    const b = j === open.length ? len : j * B; // the last block runs to the end
    if (b - i * B >= QUIET_MIN * sr) out.push({ from: s3(i * B, sr), to: s3(b, sr) });
    i = j;
  }
  return out;
}

// ch: the rendered channels -> { seconds, lufs, peakDb, clipped, noiseDb, speechDb, quiet }; dB values to 0.1, null
// when there is nothing to measure (silence; noiseDb -100 = digital silence was the quietest 0.5 s)
function measure(ch, sr) {
  const len = ch[0].length;
  let peak = 0;
  for (const c of ch) for (let i = 0; i < len; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  const { det, q, loud, talk } = quietLevels(ch, sr);
  return {
    seconds: s3(len, sr), lufs: r1(LD.integrated(ch, sr)), peakDb: r1(20 * Math.log10(peak)), clipped: overs(ch, sr),
    noiseDb: q ? r1(q.db) : null, speechDb: r1(loud), quiet: quietRuns(det, talk, sr, len),
  };
}

module.exports = { measure };
