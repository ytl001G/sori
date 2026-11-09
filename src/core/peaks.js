// Waveform min/max pyramid per Source (channels combined). Pure; cached by Source identity.
// Levels grow x16 so one screen column never scans more than ~32 blocks.
const SIZES = [256, 4096, 65536];
const cache = new WeakMap();

function build(src) {
  const n = src.ch[0].length, k = Math.ceil(n / SIZES[0]);
  const mn = new Float32Array(k).fill(Infinity), mx = new Float32Array(k).fill(-Infinity);
  for (const c of src.ch) {
    for (let i = 0; i < n; i++) {
      const j = (i / SIZES[0]) | 0, v = c[i];
      if (v < mn[j]) mn[j] = v;
      if (v > mx[j]) mx[j] = v;
    }
  }
  const levels = [{ B: SIZES[0], mn, mx }];
  for (let l = 1; l < SIZES.length; l++) {
    const prev = levels[l - 1], f = SIZES[l] / SIZES[l - 1], m = Math.ceil(prev.mn.length / f);
    const a = new Float32Array(m).fill(Infinity), b = new Float32Array(m).fill(-Infinity);
    for (let j = 0; j < prev.mn.length; j++) {
      const q = (j / f) | 0;
      if (prev.mn[j] < a[q]) a[q] = prev.mn[j];
      if (prev.mx[j] > b[q]) b[q] = prev.mx[j];
    }
    levels.push({ B: SIZES[l], mn: a, mx: b });
  }
  cache.set(src, levels);
  return levels;
}

// [min, max] of src over frames [f0, f1); block levels may include a few frames past the edges
function minmax(src, f0, f1) {
  let a = Infinity, b = -Infinity;
  if (f1 - f0 <= SIZES[0] * 2) {
    for (const c of src.ch) {
      for (let i = Math.max(0, f0), e = Math.min(c.length, f1); i < e; i++) {
        const v = c[i];
        if (v < a) a = v;
        if (v > b) b = v;
      }
    }
  } else {
    const levels = cache.get(src) || build(src);
    let L = levels[0];
    for (const lv of levels) if (lv.B * 2 <= f1 - f0) L = lv;
    for (let j = Math.max(0, Math.floor(f0 / L.B)), e = Math.min(L.mn.length, Math.ceil(f1 / L.B)); j < e; j++) {
      if (L.mn[j] < a) a = L.mn[j];
      if (L.mx[j] > b) b = L.mx[j];
    }
  }
  return a === Infinity ? [0, 0] : [a, b];
}

module.exports = { minmax };
