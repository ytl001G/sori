// Audio in .vproj v4 and backups: a source's samples as integers, 16-bit when every sample is
// exactly one (lossless), else rounded to 24 bits (about -144 dB, far below any mic's noise), coded like FLAC's fixed
// predictors: per 4096-frame block and channel the best order 0-4 (the o-th difference), residuals Rice-coded per 512
// frames. A source with |x| > 1 (or NaN) stays raw float32. pack() decodes its own output and keeps raw float32 when
// it differs, so a codec bug can cost size, never sound. Blob: kind byte (0 raw, 16, 24), then raw floats or bits.
const BLOCK = 4096, PART = 512, ESC = 24;
const bad = () => new Error('소리 데이터가 손상됐어요');

// ---- bit writer: w = { out, n, acc, bits }; put takes up to 24 bits ----
function put(w, v, k) {
  w.acc = (w.acc << k) | v; w.bits += k;
  while (w.bits >= 8) {
    w.bits -= 8;
    if (w.n === w.out.length) { const o = new Uint8Array(w.out.length * 2); o.set(w.out); w.out = o; }
    w.out[w.n++] = (w.acc >>> w.bits) & 255;
  }
  w.acc &= (1 << w.bits) - 1;
}
const putWide = (w, v, k) => { put(w, Math.floor(v / 4096), k - 12); put(w, v % 4096, 12); }; // v >= 0, k <= 36

// residuals of every order for x[a, a+n) into D[o] (valid from index o); returns the order with the smallest sum
const D = Array.from({ length: 5 }, () => new Int32Array(BLOCK));
function differences(x, a, n) {
  const [d0, d1, d2, d3, d4] = D, s = [0, 0, 0, 0, 0];
  let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
  for (let j = 0; j < n; j++) {
    const e0 = x[a + j], e1 = e0 - p0, e2 = e1 - p1, e3 = e2 - p2, e4 = e3 - p3;
    d0[j] = e0; d1[j] = e1; d2[j] = e2; d3[j] = e3; d4[j] = e4;
    if (j >= 4) {
      s[0] += Math.abs(e0); s[1] += Math.abs(e1); s[2] += Math.abs(e2); s[3] += Math.abs(e3); s[4] += Math.abs(e4);
    }
    p0 = e0; p1 = e1; p2 = e2; p3 = e3;
  }
  let o = 0;
  for (let k = 1; k <= Math.min(4, n - 1); k++) if (s[k] < s[o]) o = k;
  return o;
}
// one block of one channel: order, warm-up samples (offset binary, `width` bits), Rice-coded partitions
function encodeBlock(w, x, a, n, width) {
  const o = differences(x, a, n), r = D[o], off = 2 ** (width - 1);
  put(w, o, 3);
  for (let j = 0; j < o; j++) putWide(w, x[a + j] + off, width);
  for (let p = o; p < n;) { // partitions end at multiples of PART from the block start
    const end = Math.min(n, (Math.floor(p / PART) + 1) * PART);
    let sum = 0;
    for (let j = p; j < end; j++) sum += (r[j] << 1) ^ (r[j] >> 31);
    let k = 0;
    while (k < 24 && (end - p) * 2 ** (k + 1) < sum) k++;
    put(w, k, 5);
    riceWrite(w, r, p, end, k);
    p = end;
  }
}
// zigzag residuals r[p, end) with Rice parameter k; the writer's state in locals (the hot loop)
function riceWrite(w, r, p, end, k) {
  const need = w.n + (end - p) * 7 + 8; // at most 56 bits a sample (an escape)
  if (w.out.length < need) { const o = new Uint8Array(need * 2); o.set(w.out); w.out = o; }
  const out = w.out, mask = (1 << k) - 1;
  let n = w.n, acc = w.acc, bits = w.bits;
  for (let j = p; j < end; j++) {
    const u = ((r[j] << 1) ^ (r[j] >> 31)) >>> 0, q = u >>> k;
    if (q >= ESC) { // escape: ESC ones, then u in 32 bits
      w.n = n; w.acc = acc; w.bits = bits;
      put(w, (1 << ESC) - 1, ESC); putWide(w, u, 32);
      n = w.n; acc = w.acc; bits = w.bits;
      continue;
    }
    acc = (acc << (q + 1)) | ((1 << (q + 1)) - 2); bits += q + 1; // q ones, a zero
    while (bits >= 8) { bits -= 8; out[n++] = (acc >>> bits) & 255; }
    acc &= (1 << bits) - 1;
    if (k) {
      acc = (acc << k) | (u & mask); bits += k;
      while (bits >= 8) { bits -= 8; out[n++] = (acc >>> bits) & 255; }
      acc &= (1 << bits) - 1;
    }
  }
  w.n = n; w.acc = acc; w.bits = bits;
}

// ---- bit reader: s = { b, i, acc, bits } ----
function fill(s, k) {
  while (s.bits < k) {
    if (s.i >= s.b.length) throw bad();
    s.acc = ((s.acc << 8) | s.b[s.i++]) >>> 0; s.bits += 8;
  }
}
function get(s, k) { // k <= 24
  fill(s, k);
  s.bits -= k;
  const v = (s.acc >>> s.bits) & ((1 << k) - 1);
  s.acc &= (1 << s.bits) - 1;
  return v;
}
const getWide = (s, k) => get(s, k - 12) * 4096 + get(s, 12);
// Rice residuals [p, end) into R; the reader's state in locals (the hot loop), refilled up to 31 bits
const R = new Int32Array(BLOCK);
function riceRead(s, p, end, k) {
  const b = s.b, len = b.length, mask = (1 << k) - 1;
  let acc = s.acc, bits = s.bits, i = s.i;
  for (let j = p; j < end; j++) {
    let q = 0, u;
    for (;;) { // unary: ones before a zero, or ESC ones
      while (bits <= 23 && i < len) { acc = ((acc << 8) | b[i++]) >>> 0; bits += 8; }
      if (!bits) throw bad();
      const inv = ~acc & ((1 << bits) - 1), ones = inv ? Math.clz32(inv) - (32 - bits) : bits;
      const take = ones < ESC - q ? ones : ESC - q;
      q += take;
      if (q === ESC) { bits -= take; acc &= (1 << bits) - 1; break; }
      if (take < bits) { bits -= take + 1; acc &= (1 << bits) - 1; break; }
      bits = 0; acc = 0;
    }
    if (q === ESC) {
      s.acc = acc; s.bits = bits; s.i = i;
      u = getWide(s, 32);
      acc = s.acc; bits = s.bits; i = s.i;
    } else if (k) {
      while (bits < k) { if (i >= len) throw bad(); acc = ((acc << 8) | b[i++]) >>> 0; bits += 8; }
      bits -= k;
      u = ((q << k) | ((acc >>> bits) & mask)) >>> 0;
      acc &= (1 << bits) - 1;
    } else u = q;
    R[j] = (u >>> 1) ^ -(u & 1);
  }
  s.acc = acc; s.bits = bits; s.i = i;
}
function decodeBlock(s, x, a, n, width) {
  const o = get(s, 3), off = 2 ** (width - 1);
  if (o > 4 || o > n) throw bad();
  for (let j = 0; j < o; j++) x[a + j] = getWide(s, width) - off;
  for (let p = o; p < n;) {
    const end = Math.min(n, (Math.floor(p / PART) + 1) * PART), k = get(s, 5);
    if (k > 24) throw bad();
    riceRead(s, p, end, k);
    p = end;
  }
  // undo the o-th difference: one loop per order
  const e = a + n;
  if (o === 0) for (let i = a; i < e; i++) x[i] = R[i - a];
  else if (o === 1) for (let i = a + 1; i < e; i++) x[i] = R[i - a] + x[i - 1];
  else if (o === 2) for (let i = a + 2; i < e; i++) x[i] = R[i - a] + 2 * x[i - 1] - x[i - 2];
  else if (o === 3) for (let i = a + 3; i < e; i++) x[i] = R[i - a] + 3 * (x[i - 1] - x[i - 2]) + x[i - 3];
  else for (let i = a + 4; i < e; i++) x[i] = R[i - a] + 4 * (x[i - 1] + x[i - 3]) - 6 * x[i - 2] - x[i - 4];
}

// 16 when every sample of [a, e) is a 16-bit value, 24 when all fit in [-1, 1], else 0 (raw); k = the kind so far
function kindIn(chs, a, e, k) {
  for (const c of chs) {
    for (let i = a; i < e; i++) {
      const v = c[i];
      if (!(Math.abs(v) <= 1)) return 0;
      if (k === 16 && !Number.isInteger(v * 32768)) k = 24;
    }
  }
  return k;
}
const raw = (chs) => {
  const out = new Uint8Array(1 + chs.length * chs[0].length * 4);
  chs.forEach((c, k) => out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), 1 + k * c.byteLength));
  return out;
};
const scale = (kind) => 2 ** (kind - 1);
// one block of one channel as integers, into Q (encode and check work a block at a time: no full-size copies)
const Q = new Int32Array(BLOCK), V = new Int32Array(BLOCK);
const quant = (c, a, n, s) => { for (let j = 0; j < n; j++) Q[j] = Math.round(c[a + j] * s); };
const same = (n) => { for (let j = 0; j < n; j++) if (Q[j] !== V[j]) return false; return true; };
const STEP = 16; // blocks between yields: about 2 ms of work
// the blob for a source's channels, checked by decoding it again; yields between pieces of work (fileio's idle-time
// packing) and returns the blob. Each yield falls between whole blocks, so the module's scratch arrays stay free.
function* packSteps(chs) {
  const len = chs[0].length, big = 1 + chs.length * len * 4;
  let kind = 16;
  for (let a = 0; a < len && kind; a += BLOCK * STEP) {
    kind = kindIn(chs, a, Math.min(len, a + BLOCK * STEP), kind);
    yield;
  }
  if (!kind) return raw(chs);
  const sc = scale(kind), w = { out: new Uint8Array(64 + len * chs.length * 2), n: 0, acc: 0, bits: 0 };
  put(w, kind, 8);
  for (let a = 0, g = 1; a < len; a += BLOCK, g++) {
    const n = Math.min(BLOCK, len - a);
    for (const c of chs) { quant(c, a, n, sc); encodeBlock(w, Q, 0, n, kind + 2); }
    if (g % STEP === 0) yield;
  }
  if (w.bits) put(w, 0, 8 - w.bits);
  const b = w.out.slice(0, w.n), r = { b, i: 1, acc: 0, bits: 0 };
  if (b.length >= big) return raw(chs);
  try {
    for (let a = 0, g = 1; a < len; a += BLOCK, g++) {
      for (const c of chs) {
        const n = Math.min(BLOCK, len - a);
        quant(c, a, n, sc); decodeBlock(r, V, 0, n, kind + 2);
        if (!same(n)) return raw(chs);
      }
      if (g % STEP === 0) yield;
    }
  } catch { return raw(chs); }
  return b;
}
// runs a pack to its end (a save that cannot wait)
const finish = (gen) => { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; };
const pack = (chs) => finish(packSteps(chs));
// Float32Array[] (each channel `length` long) from a blob
function unpack(b, channels, length) {
  if (b[0] === 0) {
    if (b.length !== 1 + channels * length * 4) throw bad();
    const at = (k) => 1 + k * length * 4;
    const part = (k) => Uint8Array.prototype.slice.call(b, at(k), at(k + 1)); // a copy, also from a Buffer
    return Array.from({ length: channels }, (_, k) => new Float32Array(part(k).buffer));
  }
  if (b[0] !== 16 && b[0] !== 24) throw bad();
  const s = 1 / scale(b[0]), r = { b, i: 1, acc: 0, bits: 0 };
  const out = Array.from({ length: channels }, () => new Float32Array(length));
  for (let a = 0; a < length; a += BLOCK) {
    const n = Math.min(BLOCK, length - a);
    for (const f of out) {
      decodeBlock(r, V, 0, n, b[0] + 2);
      for (let j = 0; j < n; j++) f[a + j] = V[j] * s;
    }
  }
  if (r.i !== b.length || r.bits >= 8 || r.acc) throw bad(); // the whole stream, then only zero padding
  return out;
}

module.exports = { pack, packSteps, finish, unpack };
