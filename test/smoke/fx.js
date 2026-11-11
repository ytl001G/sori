// Smoke steps: Effects, playback, export, the effect chain in the mix, clip volume and fades.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const engine = require('../../src/audio/engine');
const P = require('../../src/core/fxparams');
const { state, changed, makeTrack, history } = require('../../src/core/state');
const { dir, stub, wait, painted, invokeOrig, assert, sr, T, end, sel, toasts } = require('./kit');

const peakOf = (ch) => ch.reduce((m, c) => { for (const v of c) m = Math.max(m, Math.abs(v)); return m; }, 0);
// the first lane's first clip on screen at 200 px/s: cl() reads it, at(type, x, y) sends a mouse event, hx, hy = its
// fade-in handle while it has no fade
async function fadeKit() {
  const cv = document.getElementById('timeline'), rc = cv.getBoundingClientRect();
  Object.assign(state.view, { pxPerSec: 200, scrollX: 0, scrollY: 0 }); state.sel.range = null;
  state.sel.clipIds = new Set(); changed(); await painted();
  const id = T()[0].clips[0].id, cl = () => T()[0].clips.find((c) => c.id === id);
  const xOf = (f) => (f / sr - state.view.scrollX) * state.view.pxPerSec;
  const at = (type, x, y, target = cv) =>
    target.dispatchEvent(new MouseEvent(type,
      { clientX: rc.left + x, clientY: rc.top + y, button: type === 'contextmenu' ? 2 : 0, bubbles: true }));
  return { id, cl, xOf, at, hx: xOf(cl().start) + 4, hy: 28 + 4 + 18 + 4 };
}
module.exports = [
  ['fxTempo ripples', async () => {
    sel(0, 1); stub.modal = { percent: 200 }; await C.run('fxTempo'); stub.modal = {};
    assert(Math.abs(end() - 1.5 * sr) < sr * 0.01, 'tempo end ' + end());
    await C.run('undo');
  }],
  ['fxTempo on everything moves markers', async () => {
    state.sel.range = null; state.sel.clipIds = new Set();
    state.project.markers = [{ id: 'mk', frame: sr, name: 't' }]; // 1 s into a 2 s project
    stub.modal = { percent: 200 }; await C.run('fxTempo'); stub.modal = {};
    assert(Math.abs(state.project.markers[0].frame - sr / 2) < sr * 0.01, 'marker '
      + state.project.markers[0].frame / sr);
    await C.run('undo'); state.project.markers = [];
  }],
  ['noise profile + reduce', async () => {
    sel(0, 0.3); await C.run('fxProfile'); assert(state.noiseProfile, 'profile');
    sel(0.3, 1.3); await C.run('fxNoise'); await C.run('undo');
  }],
  ['insert silence + keep', async () => {
    state.sel.range = null; state.sel.playhead = 0; stub.modal = { sec: 1 };
    await C.run('insertSilence'); stub.modal = {};
    assert(Math.abs(end() - 3 * sr) < 2, 'silence ' + end());
    const step = history.top();
    sel(0, 0.9); await C.run('fxReverse'); // only the inserted silence: no sound there
    assert(history.top() === step && toasts.at(-1) === '선택한 구간에 소리가 없어요 — 바뀐 것 없어요',
      'an effect on no sound: ' + toasts.at(-1));
    await C.run('duplicate');
    assert(history.top() === step && toasts.at(-1) === '선택한 구간에 소리가 없어요 — 바뀐 것 없어요', 'duplicate no sound');
    sel(1, 2); await C.run('keep'); assert(Math.abs(end() - 2 * sr) < 2, 'keep');
    await C.run('undo'); await C.run('undo');
  }],
  ['playback advances', async () => {
    state.sel.range = null; state.sel.playhead = 0;
    await C.run('playPause'); await wait(1200);
    await C.run('playPause'); // pause() reads the exact engine position
    const p = state.sel.playhead;
    assert(p > sr * 0.5 && p < sr * 1.4, 'playhead ' + p);
  }],
  ['loop playback keeps looping while the window is minimized', async () => {
    sel(0.2, 0.6); state.loop = true; state.sel.playhead = Math.round(0.2 * sr);
    await invokeOrig('win', 'minimize'); await wait(300);
    await C.run('playPause'); await wait(1500);
    const p = engine.position() / sr, lp = engine.looping(); // engine time: does not depend on the redraw loop
    await C.run('playPause'); state.loop = false; state.sel.range = null;
    await invokeOrig('win', 'restore'); await wait(300);
    assert(p >= 0.2 && p < 0.65, 'loop stopped while minimized, position ' + p.toFixed(2) + ' s');
    assert(lp && lp.a === Math.round(0.2 * sr) && lp.b === Math.round(0.6 * sr), 'the engine repeats the range itself');
  }],
  ['loop: a range change restarts playback once; a range being dragged waits for the release', async () => {
    const cv = document.getElementById('timeline'), rc = cv.getBoundingClientRect();
    Object.assign(state.view, { pxPerSec: 200, scrollX: 0, scrollY: 0 });
    sel(0.2, 0.6); state.loop = true; state.sel.playhead = Math.round(0.2 * sr); changed();
    await C.run('playPause'); await painted();
    const l1 = engine.looping(); await painted(); await painted();
    assert(l1 && engine.looping() === l1, 'no restart while nothing changes');
    sel(0.3, 0.7); await painted();
    const l2 = engine.looping(); await painted();
    assert(l2 !== l1 && l2.a === Math.round(0.3 * sr) && engine.looping() === l2, 'one restart on the new range');
    const ev = (type, sec, target = window) => target.dispatchEvent(new MouseEvent(type,
      { clientX: rc.left + sec * 200, clientY: rc.top + 80, button: 0, bubbles: true }));
    ev('mousedown', 0.1, cv); ev('mousemove', 0.3); await painted(); ev('mousemove', 0.5); await painted();
    const during = engine.looping();
    ev('mouseup', 0.5); await painted();
    const after = engine.looping();
    await C.run('playPause'); state.loop = false; state.sel.range = null;
    assert(!during, 'no loop restarts while dragging (the press cleared the range)');
    assert(after && Math.abs(after.a - 0.1 * sr) < sr * 0.01 && Math.abs(after.b - 0.5 * sr) < sr * 0.01,
      'the dragged range loops after the release ' + JSON.stringify(after));
  }],
  ['export wav + mp3', async () => {
    stub.save = path.join(dir, 'out.wav'); state.sel.range = null;
    await C.run('export'); assert(fs.statSync(stub.save).size > 44 + sr * 2 * 2 * 2 - 100, 'wav size');
    stub.save = path.join(dir, 'out.mp3'); stub.modal = { format: 'mp3_192' };
    await C.run('export'); stub.modal = {};
    const m = fs.readFileSync(stub.save);
    assert(m.length > 20000 && m[0] === 0xff && (m[1] & 0xe0) === 0xe0, 'mp3 from the encoding worker: size, sync');
    assert(require('../../src/core/workers').WORKERS >= 1 && typeof Worker === 'function', 'workers in the renderer');
  }],
  ['이 클립만 내보내기: one selected clip alone, from its start to its end; in the right-click menu', async () => {
    const M = require('../../src/ui/menus'), x0 = T()[0].clips[0];
    state.sel.range = null; state.sel.clipIds = new Set([x0.id]); state.sel.playhead = x0.start + Math.round(sr * 0.3);
    await C.run('split');
    const [a, x] = T()[0].clips;
    state.sel.clipIds = new Set([x.id]);
    M.openContext(10, 10); await painted();
    const rows = [...document.querySelectorAll('.menu > *')].map((r) => r.textContent).join();
    M.close();
    assert(rows.includes('이 클립만 내보내기…') && C.cmds.exportClip.enabled(), 'right-click menu ' + rows);
    stub.save = path.join(dir, 'clip.wav'); stub.modal = { format: 'wav16' };
    await C.run('exportClip'); stub.modal = {};
    const frames = () => (fs.statSync(stub.save).size - 44) / 4, n = frames();
    state.sel.clipIds = new Set([a.id]); stub.save = path.join(dir, 'clip0.wav'); stub.modal = { format: 'wav16' };
    await C.run('exportClip'); stub.modal = {};
    // each file is its clip alone: the same effect tail after each
    assert(n - x.length === frames() - a.length && frames() - a.length >= 0, `clip frames ${n} ${frames()}`);
    state.sel.clipIds = new Set(); assert(!C.cmds.exportClip.enabled(), 'greyed without one clip');
    await C.run('undo'); assert(T()[0].clips[0] === x0, 'undo the split');
  }],
  ['export only the current track: muted track still exports, empty track refuses', async () => {
    await C.run('addTrack'); const empty = T().find((t) => t.id === state.sel.activeTrackId), t0 = T()[0];
    C.mixer(t0.id, { mute: true }); state.sel.range = null; state.sel.activeTrackId = t0.id;
    stub.save = path.join(dir, 'track.wav'); stub.modal = { format: 'wav16', tracks: 'cur', range: 'all' };
    await C.run('export');
    const n = (fs.statSync(stub.save).size - 44) / 4; // 16-bit stereo frames
    assert(Math.abs(n - E.projectEnd([t0])) < sr * 0.05, 'track frames ' + n);
    state.sel.activeTrackId = empty.id; stub.save = path.join(dir, 'empty.wav');
    await C.run('export'); stub.modal = {};
    assert(!fs.existsSync(stub.save), 'empty track wrote a file');
    C.mixer(t0.id, { mute: false }); await C.run('undo'); // the added track
    assert(!T().some((t) => t.id === empty.id), 'cleanup');
  }],
  ['master limiter holds its ceiling in export', async () => {
    C.setFx('master', 'gain', { gainDb: 12 });
    C.setFx('master', 'limiter', { on: true, ceiling: -3, drive: 0 });
    const pk = peakOf(await engine.mixdown(T(), state.project.master, 0, end()));
    assert(pk <= Math.pow(10, -3 / 20) + 2e-3 && pk > 0.6, 'peak ' + pk);
    C.setFx('master', 'gain', { gainDb: 0 }); C.setFx('master', 'limiter', { on: false });
  }],
  ['track reverb adds a tail; master EQ + comp + echo render', async () => {
    const t = T()[0];
    C.setFx(t.id, 'reverb', { on: true });
    for (const k of ['eq', 'comp', 'echo']) C.setFx('master', k, { on: true });
    const out = await engine.mixdown(T(), state.project.master, 0, end());
    assert(out[0].length > end() + sr * 0.2, 'tail ' + (out[0].length - end()));
    assert(peakOf(out) > 0.1 && Number.isFinite(peakOf(out)), 'level ' + peakOf(out));
    C.setFx(t.id, 'reverb', { on: false });
    for (const k of ['eq', 'comp', 'echo']) C.setFx('master', k, { on: false });
  }],
  ['overlapping clips crossfade to an even level (engine envelopes)', async () => {
    const one = () => new Float32Array(sr).fill(0.5), src = E.makeSource([one(), one()]);
    const tr = makeTrack({ clips: [E.makeClip(src, 0, 'a'), E.makeClip(src, Math.round(0.6 * sr), 'b')] });
    const out = await engine.mixdown([tr], P.defaultMaster(), 0, Math.round(1.6 * sr));
    for (const s of [0.3, 0.65, 0.8, 0.95, 1.3]) {
      const v = out[0][Math.round(s * sr)];
      assert(Math.abs(v - 0.5) < 0.02, `level at ${s}s: ${v}`);
    }
  }],
  ['clip volume + fade-in (dialog) shape the mix, undo restores', async () => {
    state.sel.range = null; state.sel.clipIds = new Set([T()[0].clips[0].id]);
    stub.modal = { db: -6, fi: 0.5, fo: 0 }; await C.run('clipProps'); stub.modal = {};
    const c = T()[0].clips[0];
    assert(Math.abs(c.gain - 0.501) < 0.01 && Math.abs(c.fadeIn - 0.5 * sr) < 2, `props ${c.gain} ${c.fadeIn}`);
    const out = await engine.mixdown(T(), state.project.master, 0, sr);
    assert(peakOf([out[0].subarray(0, sr * 0.02)]) < 0.03, 'fade start not quiet');
    const top = history.top(); await C.run('clipProps'); // 확인 with the values it shows
    assert(history.top() === top, 'clip dialog unchanged: no empty undo step');
    // a dragged fade (any frame count) and a volume off the 0.5 dB steps are shown rounded, and stay as they are
    const odd = { ...T()[0].clips[0], fadeIn: 1234, gain: 0.7 };
    state.project.tracks = T().map((t, i) => (i ? t : { ...t, clips: [odd, ...t.clips.slice(1)] }));
    await C.run('clipProps');
    const k = T()[0].clips[0];
    assert(history.top() === top && k.fadeIn === 1234 && k.gain === 0.7, `rounded on 확인: ${k.fadeIn} ${k.gain}`);
    await C.run('undo'); assert(T()[0].clips[0].fadeIn === 0 && T()[0].clips[0].gain === 1, 'undo');
  }],
  ['fade shapes: handle right-click menu, new fade takes the last shape, dialog, curve in the mix', async () => {
    const { id, cl, xOf, at, hx, hy } = await fadeKit();
    at('contextmenu', hx, hy);
    const items = [...document.querySelectorAll('.menu .item')];
    assert(items.length === 4 && items[0].getAttribute('aria-checked') === 'true', 'shape menu '
      + items.map((b) => b.textContent));
    items.find((b) => b.textContent.includes('천천히')).click();
    assert(cl().fadeInShape === 'slow' && !document.querySelector('.menu'), 'menu sets the shape');
    const top = history.top();
    at('contextmenu', hx, hy);
    [...document.querySelectorAll('.menu .item')].find((b) => b.textContent.includes('천천히')).click();
    assert(history.top() === top && cl().fadeInShape === 'slow', 'the shape it has again: no empty undo step');
    await C.run('undo'); assert(!cl().fadeInShape, 'undo shape');
    at('mousedown', hx, hy); at('mousemove', hx + 50, hy, window); at('mousemove', hx + 100, hy, window);
    at('mouseup', hx + 100, hy, window);
    // fade ends under the pointer
    assert(Math.abs(cl().fadeIn - (hx + 100) / state.view.pxPerSec * sr) < sr * 0.01 && !cl().fadeInShape,
      `new fade ${cl().fadeIn} ${cl().fadeInShape}: always 직선, not the shape picked before`);
    const flat = [{ ...T()[0], fx: P.defaultFx(P.TRACK_KINDS), gain: 1, pan: 0, mute: false, solo: false }];
    const mid = async () => {
      const o = await engine.mixdown([{ ...flat[0], clips: T()[0].clips }], P.defaultMaster(), 0, sr);
      return Math.sqrt(o[0].subarray(sr * 0.2, sr * 0.3).reduce((s, v) => s + v * v, 0) / (sr * 0.1));
    };
    C.setFadeShape(id, 'fadeIn', 'slow'); const slow = await mid(); C.setFadeShape(id, 'fadeIn', 'linear');
    const lin = await mid();
    assert(slow / lin < 0.45, `slow/linear level at mid-fade ${slow / lin}`);
    state.sel.clipIds = new Set([id]); stub.modal = { fis: 'fast', fos: 'smooth' }; await C.run('clipProps');
    stub.modal = {};
    assert(cl().fadeInShape === 'fast' && cl().fadeOutShape === 'smooth', 'dialog shapes');
    const fx = xOf(cl().start + cl().fadeIn); // the handle dragged back to the clip start: no fade, no shape left
    at('mousedown', fx, hy); at('mousemove', hx - 50, hy, window); at('mouseup', hx - 50, hy, window);
    assert(!cl().fadeIn && !cl().fadeInShape, `fade dragged away: ${cl().fadeIn} ${cl().fadeInShape}`);
    C.setFadeShape(id, 'fadeIn', 'slow'); // picked for no fade yet: a drag out and back in keeps it
    at('mousedown', hx, hy); at('mousemove', hx + 50, hy, window); at('mousemove', hx - 50, hy, window);
    at('mouseup', hx - 50, hy, window);
    assert(!cl().fadeIn && cl().fadeInShape === 'slow', `picked shape kept: ${cl().fadeIn} ${cl().fadeInShape}`);
    for (let i = 0; i < 6; i++) await C.run('undo');
    assert(!cl().fadeIn && !cl().fadeInShape && !cl().fadeOutShape, 'undo chain');
    state.sel.clipIds = new Set();
  }],
];
