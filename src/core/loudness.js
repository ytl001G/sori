// Loudness (ITU-R BS.1770 / EBU R128): K-weighted, gated integrated loudness in LUFS, and an offline lookahead peak
// limiter. Used by 음량 맞추기 (voice.js). Pure, no DOM. A mono channel counts once, as the standard says: a centred
// mono track leaves the stereo panner at -3 dB per side, so its export measures the same.
const FX = require('./effects');

// K-weighting: high shelf (+4 dB above ~1.7 kHz) then high pass (~38 Hz), for any sample rate
function kStages(sr) {
  const tq = (f0, q) => { const K = Math.tan(Math.PI * f0 / sr); return { K, q, a0: 1 + K / q + K * K }; };
  const s = tq(1681.974450955533, 0.7071752369554196), Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416, K2 = s.K * s.K;
  const shelf = [(Vh + Vb * s.K / s.q + K2) / s.a0, 2 * (K2 - Vh) / s.a0, (Vh - Vb * s.K / s.q + K2) / s.a0,
    2 * (K2 - 1) / s.a0, (1 - s.K / s.q + K2) / s.a0];
  const h = tq(38.13547087602444, 0.5003270373238773), H2 = h.K * h.K;
  return [shelf, [1, -2, 1, 2 * (H2 - 1) / h.a0, (1 - h.K / h.q + H2) / h.a0]];
}
const lufsOf = (z) => -0.691 + 10 * Math.log10(z);
// mean square of 400 ms blocks every 100 ms, summed over channels
function blocks(ch, sr) {
  const st = kStages(sr), B = Math.round(0.4 * sr), H = Math.round(0.1 * sr), n = ch[0].length, out = [];
  const pre = ch.map((c) => {
    const x = st.reduce((y, s) => FX.runBiquad(y, s), c), p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + x[i] * x[i];
    return p;
  });
  for (let s = 0; s + B <= n; s += H) out.push(pre.reduce((z, p) => z + (p[s + B] - p[s]) / B, 0));
  return out;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// integrated loudness: blocks above -70 LUFS, then above (their loudness - 10); -Infinity when nothing is left
// (silence, or shorter than one 400 ms block)
function integrated(ch, sr) {
  const z = blocks(ch, sr).filter((v) => lufsOf(v) > -70);
  if (!z.length) return -Infinity;
  const rel = lufsOf(mean(z)) - 10, g = z.filter((v) => lufsOf(v) > rel);
  return lufsOf(mean(g));
}

// out[j] = min(a[j-L+1 .. j]) (monotonic queue)
function slideMin(a, L) {
  const out = new Float32Array(a.length), q = new Int32Array(a.length);
  let h = 0, t = 0;
  for (let j = 0; j < a.length; j++) {
    while (t > h && a[q[t - 1]] >= a[j]) t--;
    q[t++] = j;
    if (q[h] <= j - L) h++;
    out[j] = a[q[h]];
  }
  return out;
}
// True peak (as BS.1770 Annex 2, with a longer filter): the wave a player draws between samples can rise above every
// sample (a 12 kHz sine at 45 deg: +3 dB; bright noise limited to -1 dB by samples alone: +4.1 dBTP), so the limiters
// read it 4x: rows[p - 1] gives the point p/4 of the way from x[i] to x[i + 1] from x[i - TP_HALF + 1 .. i + TP_HALF]
// (Blackman-windowed sinc, unit gain). 64 taps: bright noise -0.67 dBTP after a -1 dB limit, 48: -0.38 (8x reference).
const TP_HALF = 32;
function tpTaps() {
  const T = TP_HALF, w = (t) => 0.42 + 0.5 * Math.cos(Math.PI * t / T) + 0.08 * Math.cos(2 * Math.PI * t / T);
  return [1, 2, 3].map((p) => {
    const row = Float32Array.from({ length: 2 * T }, (_, k) => {
      const t = k - T + 1 - p / 4;
      return (Math.sin(Math.PI * t) / (Math.PI * t)) * w(t);
    });
    const sum = row.reduce((a, b) => a + b, 0);
    return Float64Array.from(row, (v) => v / sum);
  });
}
const TAPS = tpTaps(), REACH = Math.max(...TAPS.map((r) => r.reduce((a, v) => a + Math.abs(v), 0)));
// per frame: the largest |x| from it up to the next frame (itself and the 3 points after it), over the channels.
// A point is at most REACH x the largest |x| it is read from: where that stays <= floor the filter is skipped (the
// frame's own |x| stands), exact for anything above floor; a limiter needs no more
function peaks(ch, floor = 0) {
  const n = ch[0].length, H = TP_HALF, B = 1 << 16, out = new Float32Array(n), [r1, r2, r3] = TAPS;
  // B frames at a time (memory stays small: the whole take at once briefly held 7x its size, audit 2026-11-12)
  const p = new Float32Array(B + 2 * H), neg = new Float32Array(B + 2 * H);
  for (const x of ch) {
    for (let s = 0; s < n; s += B) {
      const m = Math.min(B, n - s), w = m + 2 * H - 1;
      for (let j = 0; j < w; j++) { // p[i + k] = x[s + i - H + 1 + k], zeros outside
        const at = s - H + 1 + j;
        p[j] = at >= 0 && at < n ? x[at] : 0;
        neg[j] = -Math.abs(p[j]);
      }
      const near = slideMin(neg.subarray(0, w), 2 * H); // -max |p[j - 2H + 1 .. j]|
      for (let i = 0; i < m; i++) {
        out[s + i] = Math.max(out[s + i], Math.abs(x[s + i]));
        if (-near[i + 2 * H - 1] * REACH <= floor) continue;
        let a = 0, b = 0, c = 0;
        for (let k = 0; k < 2 * H; k++) {
          const v = p[i + k];
          a += v * r1[k]; b += v * r2[k]; c += v * r3[k];
        }
        out[s + i] = Math.max(out[s + i], Math.abs(a), Math.abs(b), Math.abs(c));
      }
    }
  }
  return out;
}
// Brickwall limiter with the rule of worklets.js Limiter (moving average of a trailing min-hold, 5 ms) but offline,
// so without delay: every averaged value covers the frame it lands on, so no frame and no point up to the next one
// (pk, true peak) goes above the ceiling. A 50 ms release follows; it only ever lowers the gain further.
function limit(ch, sr, ceilingDb = -1, pk = peaks(ch, 10 ** (ceilingDb / 20))) {
  const n = ch[0].length, L = Math.max(2, Math.round(sr * 0.005)), c = 10 ** (ceilingDb / 20);
  const need = new Float32Array(n + L - 1).fill(1);
  for (let i = 0; i < n; i++) if (pk[i] > c) need[i] = c / pk[i];
  const hold = slideMin(need, L), g = new Float32Array(n), rel = 1 - Math.exp(-1 / (sr * 0.05));
  let sum = 0, r = 1;
  for (let j = 0; j < L - 1; j++) sum += hold[j];
  for (let k = 0; k < n; k++) {
    sum += hold[k + L - 1];
    const avg = sum / L;
    sum -= hold[k];
    r = avg < r ? avg : r + (avg - r) * rel;
    g[k] = r;
  }
  return ch.map((x) => x.map((v, i) => v * g[i]));
}

// to `target` LUFS, true peaks held at -1 dB; null when it cannot be measured. Limiting lowers the loudness a little,
// so the gain is corrected and the limiter run again (up to 4 times, within 0.1 LU)
function toLoudness(ch, sr, target) {
  const now = integrated(ch, sr);
  if (!Number.isFinite(now)) return null;
  let gainDb = target - now, y = null, pk = null, floor = Infinity;
  for (let pass = 0; pass < 4; pass++) {
    const k = 10 ** (gainDb / 20), f = 10 ** (-1 / 20) / k;
    // peaks scale with the gain: read once, exact down to half the ceiling's level (a later pass raises it a little)
    if (f < floor) pk = peaks(ch, (floor = f / 2));
    y = limit(ch.map((x) => x.map((v) => v * k)), sr, -1, pk.map((v) => v * k));
    const off = target - integrated(y, sr);
    if (Math.abs(off) < 0.1) break;
    gainDb += off;
  }
  return y;
}

module.exports = { integrated, limit, toLoudness, kStages, peaks, tpTaps, TP_HALF };
