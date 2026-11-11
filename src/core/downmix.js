// Files with more than two channels come in as stereo (pure, unit-tested). Channels are taken in the order WAV files
// use for each count (3: L R C · 4: L R SL SR · 5: L R C SL SR · 5.1: L R C LFE SL SR · 6.1: + back centre before
// SL SR · 7.1: L R C LFE BL BR SL SR), mixed the way Web Audio's speaker rules do for quad and 5.1: centre and
// surrounds -3 dB into their side, LFE left out. A count with no standard layout goes to both sides evenly
const H = Math.SQRT1_2;
const MIX = { // count -> [left gain, right gain] per channel
  3: [[1, 0], [0, 1], [H, H]],
  4: [[0.5, 0], [0, 0.5], [0.5, 0], [0, 0.5]],
  5: [[1, 0], [0, 1], [H, H], [H, 0], [0, H]],
  6: [[1, 0], [0, 1], [H, H], [0, 0], [H, 0], [0, H]],
  7: [[1, 0], [0, 1], [H, H], [0, 0], [0.5, 0.5], [H, 0], [0, H]],
  8: [[1, 0], [0, 1], [H, H], [0, 0], [H, 0], [0, H], [H, 0], [0, H]],
};
function toStereo(ch) {
  const n = ch.length, len = ch[0].length, gains = MIX[n] || ch.map(() => [1 / n, 1 / n]);
  return [0, 1].map((side) => {
    const out = new Float32Array(len);
    ch.forEach((c, i) => { const g = gains[i][side]; if (g) for (let j = 0; j < len; j++) out[j] += g * c[j]; });
    return out;
  });
}

module.exports = { toStereo };
