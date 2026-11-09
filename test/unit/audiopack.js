// Audio packing for .vproj v4 (src/core/audiopack.js): exact for 16-bit audio, 24-bit rounding otherwise, raw for
// anything outside [-1, 1]; every edge (lengths around blocks and partitions, full scale, spikes, silence) round-trips.
const { assert, t } = require('./helpers');
const AP = require('../../src/core/audiopack');

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const q = (v, bits) => Math.fround(Math.round(v * 2 ** (bits - 1)) / 2 ** (bits - 1));
const back = (chs) => { const b = AP.pack(chs); return { b, out: AP.unpack(b, chs.length, chs[0].length) }; };

t('audiopack: 16-bit audio is exact and small, other audio rounds to 24 bits', () => {
  const n = 48000, x16 = Float32Array.from({ length: n }, (_, i) => q(0.3 * Math.sin(i / 20) + 0.001 * rnd(), 16));
  let r = back([x16]);
  assert(r.b[0] === 16 && r.out[0].every((v, i) => v === x16[i]), '16-bit exact');
  assert(r.b.length < n * 4 * 0.3, 'small: ' + r.b.length);
  const xf = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i / 20) + 1e-5 * rnd());
  r = back([xf, x16]);
  assert(r.b[0] === 24 && r.out[0].every((v, i) => v === q(xf[i], 24)) && r.out[1].every((v, i) => v === x16[i]),
    '24-bit: rounded, the 16-bit channel exact');
});
t('audiopack: edges round-trip (lengths, full scale, spikes, silence); out of range stays raw', () => {
  const sigs = {
    silence: () => 0, full: () => (rnd() > 0 ? 1 : -1), noise: () => rnd(), spike: (i) => (i % 777 === 0 ? -1 : 0),
    square: (i) => (Math.floor(i / 3) % 2 ? 0.999 : -0.999),
  };
  for (const n of [1, 2, 3, 4, 5, 511, 512, 513, 4095, 4096, 4097, 9000]) {
    for (const [name, f] of Object.entries(sigs)) {
      const x = Float32Array.from({ length: n }, (_, i) => f(i)), { b, out } = back([x, x.map((v) => -v)]);
      const want = (v) => (b[0] ? q(v, 24) : v); // raw when packing would not be smaller
      assert(out[0].every((v, i) => v === want(x[i])) && out[1].every((v, i) => v === want(-x[i])), `${name} ${n}`);
    }
  }
  for (const odd of [1.5, NaN, -2]) {
    const x = Float32Array.of(0, 0.5, odd, 0.25), { b, out } = back([x]);
    assert(b[0] === 0 && out[0].every((v, i) => Object.is(v, x[i])), 'raw keeps ' + odd);
  }
  assert.throws(() => AP.unpack(Uint8Array.of(16, 255), 1, 1000), /손상/);
  assert.throws(() => AP.unpack(Uint8Array.of(9), 1, 1), /손상/);
});
t('audiopack: unpack reads the whole stream (trailing bytes are damage)', () => {
  const x = Float32Array.from({ length: 5000 }, (_, i) => q(0.2 * Math.sin(i / 9), 16)), b = AP.pack([x]);
  const longer = new Uint8Array(b.length + 1); longer.set(b);
  assert.throws(() => AP.unpack(longer, 1, x.length), /손상/);
  assert.throws(() => AP.unpack(b, 1, x.length - 100), /손상/, 'a stated length shorter than the stream');
});
