// Random editing (`SORI_FUZZ=<actions> npm run smoke`, SORI_FUZZ_SEED=<n> to replay): the app's own edit commands
// on random selections, in random order with undo / redo between them. After every action: the clip rules hold, an
// action that changed the project left exactly one undo step, undo / redo return exactly the state before / after,
// nothing rendered is NaN; now and then the project is saved with 다른 이름으로 저장 and the file plays the same.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const IO = require('../../src/core/fileio');
const { state, history } = require('../../src/core/state');
const { dir, stub, painted, assert, sr, T, end, wav } = require('./kit');

const ACTIONS = +process.env.SORI_FUZZ || 0, ROUND = 100;
const SEED = +process.env.SORI_FUZZ_SEED || (Date.now() % 1e9);
let s = SEED;
const rnd = () => { // mulberry32: the same seed replays the same run
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const R = (n) => Math.floor(rnd() * n);
const some = (xs) => xs.filter(() => rnd() < 0.5);

// [command, weight, stub.modal maker]
const EDITS = [
  ['delete', 3], ['cut', 2], ['copy', 2], ['paste', 3], ['split', 3], ['merge', 2], ['duplicate', 2], ['keep', 1],
  ['insertSilence', 1], ['nudgeLeft', 1], ['nudgeRight', 1], ['nudgeLeftBig', 1], ['nudgeRightBig', 1],
  ['clipsUp', 1], ['clipsDown', 1], ['addMarker', 1], ['markerDelete', 1], ['addTrack', 1], ['dupTrack', 1],
  ['trackUp', 1], ['trackDown', 1], ['clipProps', 1],
  ['fxGain', 1, () => ({ db: R(25) - 12 })], ['fxNormalize', 1], ['fxFadeIn', 1], ['fxFadeOut', 1],
  ['fxSilence', 1], ['fxReverse', 1], ['fxTempo', 1, () => ({ percent: 60 + R(120) })],
  ['fxPitch', 1, () => ({ semitones: R(9) - 4 })], ['fxEcho', 1], ['fxReverb', 1],
  ['undo', 6], ['redo', 3],
];
const BAG = EDITS.flatMap((e) => Array(e[1]).fill(e));

// the state undo restores: track order, clips, markers (mixer props and effects are live, not undo steps)
const fp = () => JSON.stringify([T().map((t) => [t.id, t.clips.map((c) => ({ ...c, src: c.src.id }))]),
  state.project.markers]);

function broken() {
  const ids = new Set();
  for (const t of T()) {
    for (const c of t.clips) {
      if (ids.has(c.id)) return 'clip id twice ' + c.id;
      ids.add(c.id);
      const ints = [c.start, c.offset, c.length, c.fadeIn, c.fadeOut].every(Number.isInteger);
      if (!ints || c.start < 0 || c.offset < 0 || c.length <= 0) return 'frames ' + JSON.stringify({ ...c, src: 0 });
      if (c.offset + c.length > E.srcLen(c.src)) return `clip past its source: ${c.offset}+${c.length}`;
      if (c.fadeIn < 0 || c.fadeOut < 0 || c.fadeIn + c.fadeOut > c.length) return `fades ${c.fadeIn}/${c.fadeOut}`;
      if (!(c.gain >= 0 && Number.isFinite(c.gain))) return 'gain ' + c.gain;
    }
  }
  for (const id of state.sel.clipIds) if (!ids.has(id)) return 'a selected clip that is gone';
  const fr = state.project.markers.map((m) => m.frame);
  if (fr.some((f, i) => !Number.isInteger(f) || f < 0 || (i && f <= fr[i - 1]))) return 'markers ' + fr;
  return null;
}

// a random selection, current track, playhead and marker, as a person would leave them
function select() {
  const ts = T(), e = Math.max(end(), sr), mk = state.project.markers;
  state.sel.activeTrackId = ts.length ? ts[R(ts.length)].id : null;
  state.sel.playhead = R(e + sr / 2);
  state.sel.markerId = mk.length && rnd() < 0.7 ? mk[R(mk.length)].id : null;
  state.sel.clipIds = new Set();
  state.sel.range = null;
  if (rnd() < 0.6) {
    const a = R(e), pick = some(ts);
    state.sel.range = { a, b: a + 1 + R(sr * 1.5), trackIds: new Set((pick.length ? pick : ts).map((t) => t.id)) };
  } else state.sel.clipIds = new Set(some(ts.flatMap((t) => t.clips)).map((c) => c.id));
  return state.sel.range ? `range ${state.sel.range.a}-${state.sel.range.b} on ${state.sel.range.trackIds.size}`
    : `${state.sel.clipIds.size} clips`;
}

// the undo the app should do, kept beside it: u = states before each step, r = states undo left
const model = { u: [], r: [] };
const reset = () => { history.clear(); model.u = []; model.r = []; };
const stats = { actions: 0, steps: 0, emptySteps: {}, multi: {}, saves: 0 };

async function act(name, modal) {
  const before = fp(), d0 = history.depth();
  stub.modal = modal ? modal() : {};
  await C.run(name);
  await painted();
  stub.modal = {};
  const after = fp(), d = history.depth() - d0;
  stats.actions++;
  if (name === 'undo' || name === 'redo') {
    const [from, to] = name === 'undo' ? [model.u, model.r] : [model.r, model.u];
    if (!from.length) return assert(after === before, name + ' with nothing to ' + name + ' changed the project');
    const want = from.pop();
    to.push(before);
    return assert(after === want, name + ' did not return the exact state');
  }
  if (d === 0) return assert(after === before, 'changed the project without an undo step');
  if (d > 1) { stats.multi[name] = (stats.multi[name] || 0) + 1; return reset(); }
  if (after === before) stats.emptySteps[name] = (stats.emptySteps[name] || 0) + 1;
  stats.steps++;
  model.u.push(before);
  model.r = [];
}

// 다른 이름으로 저장 through the app, then the file read back: same tracks, markers and sound
async function saveCheck(k) {
  stub.save = path.join(dir, `fuzz${k % 3}.vproj`);
  await C.run('saveAs');
  const back = IO.loadProject(fs.readFileSync(stub.save));
  const e = end();
  assert(back.tracks.length === T().length, 'saved track count');
  assert(JSON.stringify(back.markers.map((m) => [m.frame, m.name])) ===
    JSON.stringify(state.project.markers.map((m) => [m.frame, m.name])), 'saved markers');
  T().forEach((t, i) => {
    const a = E.renderRegion(t.clips, 0, e), b = E.renderRegion(back.tracks[i].clips, 0, e);
    if (!a || !b) return assert(!a && !b, `track ${i + 1}: sound only on one side`); // null: no sound there
    for (let k2 = 0; k2 < a.length; k2++) {
      for (let j = 0; j < a[k2].length; j++) {
        if (!Number.isFinite(a[k2][j])) throw new Error(`track ${i + 1}: not a number at ${j}`);
        if (Math.abs(a[k2][j] - b[k2][j]) > 1e-5) throw new Error(`track ${i + 1}: saved sound differs at ${j}`);
      }
    }
  });
  stats.saves++;
}

async function round(k) {
  const trail = [];
  try {
    for (let i = 0; i < ROUND && stats.actions < ACTIONS; i++) {
      if (history.depth() > 90) reset(); // the app keeps 100 steps
      let [name, , modal] = BAG[R(BAG.length)];
      if ((name === 'addTrack' || name === 'dupTrack') && T().length >= 6) name = 'undo';
      if (['paste', 'insertSilence', 'fxTempo', 'duplicate'].includes(name) && end() > 20 * sr) name = 'delete';
      trail.push(`${name} [${select()}]`);
      await act(name, modal);
      const bad = broken();
      if (bad) throw new Error(bad);
    }
    await saveCheck(k);
  } catch (e) {
    throw new Error(`seed ${SEED}, action ${stats.actions}: ${e.message}\n    last: ${trail.slice(-8).join(' | ')}`);
  }
}

module.exports = [
  ['fuzz: start (seed ' + SEED + ')', async () => {
    await C.importAudio([wav]);
    await C.importAudio([wav]);
    assert(T().length === 2, 'two tracks');
    reset();
  }],
  ...Array.from({ length: Math.ceil(ACTIONS / ROUND) }, (_, k) => [`fuzz: round ${k + 1}`, () => round(k)]),
  ['fuzz: summary', () => console.log('fuzz: ' + JSON.stringify(stats))],
];
