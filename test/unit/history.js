// Waveform peaks and undo / redo history.
const { assert, E, t, clip } = require('./helpers');

t('peaks match a brute-force scan on block-aligned spans', () => {
  const { minmax } = require('../../src/core/peaks');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const src = E.makeSource([Float32Array.from({ length: 300000 }, rnd), Float32Array.from({ length: 300000 }, rnd)]);
  for (const [a, b] of [[0, 100], [4096, 4096 * 4], [65536, 65536 * 4], [0, 300000]]) {
    let mn = Infinity, mx = -Infinity;
    for (const c of src.ch) for (let i = a; i < Math.min(b, 300000); i++) { mn = Math.min(mn, c[i]);
      mx = Math.max(mx, c[i]); }
    assert.deepStrictEqual(minmax(src, a, b), [mn, mx], `span ${a}-${b}`);
  }
});
t('undo/redo restores clips, keeps live mixer, byte budget trims oldest', () => {
  const { state, history, makeTrack } = require('../../src/core/state');
  history.clear();
  const tr = makeTrack({ clips: [clip(0, 1000)] });
  state.project.tracks = [tr];
  history.commit();
  state.project.tracks = [{ ...tr, clips: E.rippleDelete(tr.clips, 0, 500) }];
  state.project.tracks[0].gain = 0.25; // mixer change after the edit
  assert(history.undo());
  assert.strictEqual(E.projectEnd(state.project.tracks), 1000);
  assert.strictEqual(state.project.tracks[0].gain, 0.25, 'mixer kept');
  assert(history.redo()); assert.strictEqual(E.projectEnd(state.project.tracks), 500);
  history.clear();
  history.budget = 1000 * 4 * 3.5; // room for ~3 distinct 1000-frame mono sources only undo keeps
  for (let i = 0; i < 6; i++) { history.commit(); state.project.tracks = [{ ...tr, clips: [clip(0, 1000)] }]; }
  // the newest step still shares the present's sound when it is committed: it counts from the next commit
  assert(history.depth() <= 4 && history.depth() >= 1, 'depth ' + history.depth());
  history.budget = 0.5e9; history.clear();
});
t("history.hide keeps the take being recorded out of every snapshot (normal and script projects)", () => {
  const { state, history, makeTrack, newProjectData } = require("../../src/core/state");
  const a = makeTrack({ clips: [clip(0, 1000)] }), rec = makeTrack();
  state.project = newProjectData(48000); state.project.tracks = [a, rec];
  history.clear(); history.hide = rec.id;
  history.commit(); state.project.tracks = [a];
  history.undo();
  assert.deepStrictEqual(state.project.tracks.map((t) => t.id), [a.id], "normal: the snapshot never had it");
  const l = { id: "l1", char: "철수", num: 1, text: "x", memo: "", takes: [a, rec], star: rec.id };
  state.project = newProjectData(48000,
    { script: { lines: [l], lineId: "l1", chars: { 철수: { color: "#38BDF8", fx: a.fx } } } });
  state.project.tracks = [a, rec];
  history.commit(); history.undo();
  assert.deepStrictEqual([state.project.tracks.map((t) => t.id), state.project.script.lines[0].star], [[a.id], null],
    "script: not in the takes, not the ★");
  history.clear(); assert.strictEqual(history.hide, null);
});
t('tidySel: the effect panel leaves a character whose lines all went (its look is still there)', () => {
  const { state, newProjectData, tidySel } = require('../../src/core/state');
  const look = { color: '#38BDF8', fx: null }, l = { id: 'l1', char: '철수', num: 1, text: 'x', memo: '', takes: [] };
  state.project = newProjectData(48000, { script: { lines: [l], lineId: 'l1', chars: { 철수: look, 영희: look } } });
  const after = (target) => { state.ui.fxTarget = target; tidySel(); return state.ui.fxTarget; };
  assert.deepStrictEqual([after('char:철수'), after('char:영희'), after('char:')], ['char:철수', 'master', 'master']);
});
t('history: a recording take with clips edited onto it stays in snapshots; drop() brings redo back', () => {
  const { state, history, makeTrack, newProjectData, setDirty } = require('../../src/core/state');
  const rec = makeTrack();
  state.project = newProjectData(48000); state.project.tracks = [rec];
  history.clear(); history.hide = rec.id;
  history.commit(); state.project.tracks = [{ ...rec, clips: [clip(0, 100)] }]; // pasted onto the take
  history.commit(); state.project.tracks = [{ ...rec, clips: [] }];
  history.undo();
  assert.strictEqual(state.project.tracks[0].clips.length, 1, 'the edited take comes back with its clip');
  assert(history.canRedo());
  setDirty(false); state.backupDue = false; history.commit(); history.drop();
  assert(history.canRedo(), 'a dropped commit leaves redo as it was');
  assert.deepStrictEqual([state.dirty, state.backupDue], [false, false], 'a saved project saved, no backup due');
  history.clear();
});
t('필요할 때만 풀기: a loaded take decodes on use and lets go off screen; the budget counts only undo', () => {
  const IO = require('../../src/core/fileio'), PK = require('../../src/core/parked');
  const { state, history, makeTrack } = require('../../src/core/state');
  const x = Float32Array.from({ length: 4800 }, (_, i) => Math.round(8000 * Math.sin(i / 5)) / 32768 + 0); // + 0: no -0
  const p = IO.loadProject(IO.saveProject({ sampleRate: 48000, tracks: [makeTrack({ clips: [clip(0, 4800, [x])] })] }));
  PK.sweep(new Set(), Infinity); // earlier tests' sources
  const src = p.tracks[0].clips[0].src, n = PK.awakeCount();
  assert.strictEqual(E.srcLen(src), 4800, 'length known');
  assert.strictEqual(PK.awakeCount(), n, 'not decoded by its length');
  assert.deepStrictEqual(src.ch[0], x, 'decoded on use, as saved');
  assert.strictEqual(PK.awakeCount(), n + 1);
  PK.sweep(new Set([src]), Date.now() + PK.IDLE_MS + 1);
  assert.strictEqual(PK.awakeCount(), n + 1, 'on screen: kept');
  PK.sweep(new Set(), Date.now() + PK.IDLE_MS + 1);
  assert.strictEqual(PK.awakeCount(), n, 'off screen and idle: let go');
  assert.deepStrictEqual(src.ch[0], x, 'decoded again, the same');
  const shared = [Float32Array.from(x)]; // the engine's AudioBuffer arrays (engine.bufferFor)
  PK.adopt(src, shared);
  assert.strictEqual(src.ch, shared, 'adopted: one copy of the samples');
  PK.sweep(new Set(), Date.now() + PK.IDLE_MS + 1);
  assert.deepStrictEqual(src.ch[0], x, 'let go and decoded again');
  const plain = { ch: [x] };
  PK.adopt(plain, shared);
  assert.strictEqual(plain.ch, shared, 'a source without a packed copy takes the arrays');
  history.clear();
  history.budget = 1000; // under one 4800-frame source: undo still keeps a step, the project's own is not counted
  state.project.tracks = p.tracks;
  history.commit(); history.commit();
  assert.strictEqual(history.depth(), 2, 'only sources undo alone keeps count');
  history.budget = 0.5e9; history.clear();
});
