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
// Brickwall limiter with the rule of worklets.js Limiter (moving average of a trailing min-hold, 5 ms) but offline,
// so without delay: every averaged value covers the sample it lands on, so no sample goes above the ceiling.
// A 50 ms release follows; it only ever lowers the gain further.
function limit(ch, sr, ceilingDb = -1) {
  const n = ch[0].length, L = Math.max(2, Math.round(sr * 0.005)), c = 10 ** (ceilingDb / 20);
  const need = new Float32Array(n + L - 1).fill(1);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const x of ch) p = Math.max(p, Math.abs(x[i]));
    if (p > c) need[i] = c / p;
  }
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

// to `target` LUFS, peaks held at -1 dB; null when it cannot be measured. Limiting lowers the loudness a little, so
// the gain is corrected and the limiter run again (up to 4 times, within 0.1 LU)
function toLoudness(ch, sr, target) {
  const now = integrated(ch, sr);
  if (!Number.isFinite(now)) return null;
  let gainDb = target - now, y = null;
  for (let pass = 0; pass < 4; pass++) {
    const k = 10 ** (gainDb / 20);
    y = limit(ch.map((x) => x.map((v) => v * k)), sr, -1);
    const off = target - integrated(y, sr);
    if (Math.abs(off) < 0.1) break;
    gainDb += off;
  }
  return y;
}

module.exports = { integrated, limit, toLoudness, kStages };
