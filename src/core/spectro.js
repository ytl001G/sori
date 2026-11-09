// Spectrogram per Source (mono mix, log-frequency rows, 0..255 = -90..0 dB), computed a slice at a
// time from the redraw loop so long files never freeze the UI. Cached by Source identity.
const FFT = require('fft.js');

const N = 1024, HOP = 512, ROWS = 96, F_LO = 40;
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const cache = new WeakMap(), pending = new Set();
let fft = null, rowBins = null, rowSr = 0;

// row r (0 = top = highest) covers FFT bins [lo, hi)
function bins(sr) {
  if (rowSr === sr) return rowBins;
  const nyq = sr / 2, hz = N / sr;
  rowBins = Array.from({ length: ROWS }, (_, r) => {
    const f1 = F_LO * Math.pow(nyq / F_LO, 1 - r / ROWS), f0 = F_LO * Math.pow(nyq / F_LO, 1 - (r + 1) / ROWS);
    const lo = Math.max(1, Math.floor(f0 * hz)), hi = Math.max(lo + 1, Math.min(N / 2, Math.ceil(f1 * hz)));
    return [lo, hi];
  });
  rowSr = sr;
  return rowBins;
}

function get(src, sr) {
  let e = cache.get(src);
  if (!e) {
    const cols = Math.max(1, Math.ceil(src.ch[0].length / HOP));
    e = { cols, data: new Uint8Array(cols * ROWS), done: 0, sr };
    cache.set(src, e);
    pending.add({ src, e });
  }
  return e;
}

function computeCols(src, e, count) {
  if (!fft) fft = new FFT(N);
  const out = fft.createComplexArray(), frame = new Array(N), B = bins(e.sr);
  const x0 = src.ch[0], x1 = src.ch[1] || x0, n = x0.length;
  const end = Math.min(e.cols, e.done + count);
  for (let c = e.done; c < end; c++) {
    const s = c * HOP - N / 2;
    for (let i = 0; i < N; i++) { const j = s + i; frame[i] = j >= 0 && j < n ? (x0[j] + x1[j]) * 0.5 * HANN[i] : 0; }
    fft.realTransform(out, frame);
    for (let r = 0; r < ROWS; r++) {
      let m = 0;
      for (let k = B[r][0]; k < B[r][1]; k++) {
        const p = out[2 * k] * out[2 * k] + out[2 * k + 1] * out[2 * k + 1];
        if (p > m) m = p;
      }
      const db = 10 * Math.log10(m / (N * N / 16) + 1e-12); // full-scale sine ~ 0 dB
      e.data[c * ROWS + r] = Math.max(0, Math.min(255, Math.round((db + 90) / 90 * 255)));
    }
  }
  e.done = end;
}

// spend up to `ms` on pending sources; returns true when something new is ready to draw
function work(ms = 8) {
  if (!pending.size) return false;
  const t = performance.now();
  for (const job of pending) {
    while (job.e.done < job.e.cols && performance.now() - t < ms) computeCols(job.src, job.e, 64);
    if (job.e.done >= job.e.cols) pending.delete(job);
    if (performance.now() - t >= ms) break;
  }
  return true;
}

// perceptual ramp: dark navy -> teal -> amber -> pale yellow
const STOPS = [[15, 23, 42], [19, 78, 74], [13, 148, 136], [251, 191, 36], [254, 249, 195]];
const LUT = new Uint8ClampedArray(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = i / 255 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), u = t - k;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = STOPS[k][c] + (STOPS[k + 1][c] - STOPS[k][c]) * u;
}

module.exports = { get, work, computeCols, ROWS, HOP, LUT, isPending: () => pending.size > 0 };
