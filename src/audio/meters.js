// Level meters for the mixer and the mic tools: id (a track id, 'master', 'input') -> the latest [peakL, peakR] a
// sori-meter worklet reported (every ~21 ms), and the highest peak since reset (>= 1 = clipped, latched until reset).
const CH = require('./chain');

const levels = new Map(), held = new Map();
const setLevel = (id, pk) => { levels.set(id, pk); held.set(id, Math.max(held.get(id) || 0, pk[0], pk[1])); };
const meterFor = (c, id) => CH.meterNode(c, (pk) => setLevel(id, pk));
const level = (id) => levels.get(id) || [0, 0];
const dropLevel = (id) => levels.delete(id);
const clearLevels = () => levels.clear();
const resetClip = (id) => held.delete(id);
const heldPeak = (id) => held.get(id) || 0;
const isClipped = (id) => heldPeak(id) >= 1;

module.exports = { setLevel, meterFor, level, dropLevel, clearLevels, resetClip, heldPeak, isClipped };
