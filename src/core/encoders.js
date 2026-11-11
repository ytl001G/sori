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
  return withInfoFrame(parts, n);
}

// The encoder starts the sound ENC_DELAY samples late and fills the last frame with silence; without saying so a
// player plays both (a line set to start after exactly 0.5 s started after 0.523 s). LAME's own fix, which players
// read (FFmpeg, so Chromium, foobar, iTunes...): a first frame carrying no sound with an "Info" tag and a LAME tag
// giving the delay and the padding, so they are cut on playback. lamejs writes no such frame.
const ENC_DELAY = 576;
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]; // MPEG-1 Layer III, kbps
const BITRATES2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]; // MPEG-2 / 2.5 Layer III
const RATES = [44100, 48000, 32000];
// one MP3 frame header -> { size, spf (samples per frame), side (bytes of side info) }; MPEG-2/2.5 (low rates) too
function frameOf(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const v = (b[i + 1] >> 3) & 3, one = v === 3, mono = (b[i + 2 + 1] >> 6) === 3;
  const br = (one ? BITRATES : BITRATES2)[b[i + 2] >> 4];
  const sr = RATES[(b[i + 2] >> 2) & 3] / (one ? 1 : v === 2 ? 2 : 4), pad = (b[i + 2] >> 1) & 1;
  return { size: Math.floor((one ? 144 : 72) * br * 1000 / sr) + pad, spf: one ? 1152 : 576,
    side: one ? (mono ? 17 : 32) : (mono ? 9 : 17) };
}
// CRC-16 as LAME's tag uses it (polynomial 0x8005, reflected: CRC-16/ARC)
function crc16(b, end) {
  let c = 0;
  for (let i = 0; i < end; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xA001 : c >>> 1;
  }
  return c;
}
function withInfoFrame(parts, n) {
  const audio = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { audio.set(p, o); o += p.length; }
  const first = frameOf(audio, 0);
  if (!first) return audio; // nothing encoded
  let frames = 0;
  for (let i = 0, f; i < audio.length && (f = frameOf(audio, i)); i += f.size) frames++;
  const info = new Uint8Array(first.size), v = new DataView(info.buffer);
  info.set(audio.subarray(0, 4)); info[2] &= ~2; // the first frame's header, no padding byte
  const at = 4 + first.side, lame = at + 120, pad = frames * first.spf - n - ENC_DELAY;
  info.set([73, 110, 102, 111], at); // "Info": a constant bitrate stream
  // all four Xing fields (frames, bytes, a seek table: even steps for a constant bitrate, quality), as LAME: readers
  // look for the LAME tag after them
  v.setUint32(at + 4, 15); v.setUint32(at + 8, frames); v.setUint32(at + 12, info.length + audio.length);
  for (let k = 0; k < 100; k++) info[at + 16 + k] = Math.floor(k * 256 / 100);
  info.set([...'LAME3.100'].map((c) => c.charCodeAt(0)), lame);
  info[lame + 21] = ENC_DELAY >> 4; info[lame + 22] = ((ENC_DELAY & 15) << 4) | (pad >> 8); info[lame + 23] = pad & 255;
  v.setUint32(lame + 28, info.length + audio.length);
  v.setUint16(lame + 34, crc16(info, lame + 34));
  const out = new Uint8Array(info.length + audio.length);
  out.set(info); out.set(audio, info.length);
  return out;
}

module.exports = { encodeWav, encodeMp3 };
