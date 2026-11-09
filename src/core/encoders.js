// WAV and MP3 encoders (Float32Array channels -> file bytes); fileio.js re-exports them.

function encodeWav(ch, sr, bits = 16) {
  const nch = ch.length, n = ch[0].length, bps = bits / 8, data = n * nch * bps;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true);
  v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, data, true);
  const max = 2 ** (bits - 1) - 1;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < nch; k++) {
      const s = Math.round(Math.max(-1, Math.min(1, ch[k][i])) * max);
      if (bits === 16) v.setInt16(o, s, true);
      else { v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); }
      o += bps;
    }
  }
  return new Uint8Array(buf);
}

function encodeMp3(ch, sr, kbps = 192) {
  // package "exports" hides this ESM file; CJS entry exports nothing;
  const lame = require('path').join(__dirname, '../../node_modules/@breezystack/lamejs/dist/lamejs.js');
  const { Mp3Encoder } = require(lame);
  const nch = Math.min(2, ch.length), enc = new Mp3Encoder(nch, sr, kbps), n = ch[0].length;
  const toI16 = (c, a, b) => Int16Array.from(c.subarray(a, b), (x) => Math.max(-1, Math.min(1, x)) * 32767);
  const parts = [];
  for (let i = 0; i < n; i += 1152) {
    const e = Math.min(n, i + 1152), l = toI16(ch[0], i, e);
    const out = nch === 2 ? enc.encodeBuffer(l, toI16(ch[1], i, e)) : enc.encodeBuffer(l);
    if (out.length) parts.push(out);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  const res = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}

module.exports = { encodeWav, encodeMp3 };
