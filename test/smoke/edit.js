// Smoke steps: Editing: import, ripple delete, split / merge, clipboard, tracks, mouse drags, sliders, effects.
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const { state, history, changed } = require('../../src/core/state');
const { wait, painted, assert, sr, T, end, sel, wav } = require('./kit');

const ids = () => T().map((t) => t.id), act = (t) => { state.sel.activeTrackId = t.id; };
const key = (code, mods) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, ...mods, bubbles: true }));

module.exports = [
  ['empty project: the mixer shows the master strip, 재생 greyed out', async () => {
    await C.run('toggleMixer'); await painted();
    const ok = !!document.querySelector('#mixer-master .strip.master') && document.getElementById('btn-play').disabled;
    await C.run('toggleMixer'); assert(ok, 'master strip / disabled play');
  }],
  ['import wav', async () => {
    await C.importAudio([wav]);
    assert(T().length === 1 && Math.abs(end() - 2 * sr) < 2, 'length ' + end());
  }],
  ['ripple delete + undo/redo', async () => {
    sel(0.5, 1.0); await C.run('delete');
    assert(Math.abs(end() - 1.5 * sr) < 2, 'after delete ' + end());
    await C.run('undo'); assert(Math.abs(end() - 2 * sr) < 2, 'after undo');
    await C.run('redo'); assert(Math.abs(end() - 1.5 * sr) < 2, 'after redo');
    await C.run('undo');
    // a range past every clip: Delete and cut change nothing, no undo step
    const depth = history.depth(), dirty = state.dirty;
    for (const cmd of ['delete', 'cut']) {
      sel(3, 4); await C.run(cmd);
      assert(history.depth() === depth && state.dirty === dirty && Math.abs(end() - 2 * sr) < 2, cmd + ' past the end');
    }
  }],
  ['split + merge', async () => {
    state.sel.range = null; state.sel.clipIds = new Set(); state.sel.activeTrackId = T()[0].id; state.sel.playhead = sr;
    await C.run('split'); assert(T()[0].clips.length === 2, 'split');
    state.sel.clipIds = new Set(T()[0].clips.map((c) => c.id));
    await C.run('merge'); assert(T()[0].clips.length === 1, 'merge');
  }],
  ['copy + paste (range)', async () => {
    sel(0, 0.5); await C.run('copy'); state.sel.range = null; state.sel.playhead = 0;
    await C.run('paste'); assert(Math.abs(end() - 2.5 * sr) < 2, 'paste ' + end());
    await C.run('undo');
  }],
  ['paste copied clip inserts and pushes later audio', async () => {
    state.sel.range = null; state.sel.clipIds = new Set([T()[0].clips[0].id]);
    await C.run('copy'); state.sel.clipIds = new Set(); state.sel.playhead = sr; // 1 s, inside the clip
    await C.run('paste');
    assert(Math.abs(end() - 4 * sr) < 2, 'clip paste end ' + end());
    assert(T()[0].clips.some((c) => c.start === sr && c.length === 2 * sr), 'pasted at playhead');
    await C.run('undo');
  }],
  ['duplicate + nudge + move track', async () => {
    state.sel.range = null; state.sel.clipIds = new Set([T()[0].clips[0].id]);
    await C.run('duplicate'); assert(T()[0].clips.length === 2, 'dup');
    await C.run('nudgeRight');
    const step = history.top(), at = T()[0].clips[0];
    state.sel.clipIds = new Set([at.id]); await C.run('nudgeLeft'); // a clip at 0: nothing moves
    assert(at.start === 0 && history.top() === step, 'nudge at 0: no undo step');
    state.sel.range = { a: 0, b: end(), trackIds: new Set(T().map((t) => t.id)) }; await C.run('keep');
    assert(history.top() === step, 'keep everything: no undo step');
    state.sel.range = null; await C.run('addTrack'); state.sel.clipIds = new Set([T()[0].clips[1].id]);
    await C.run('clipsDown'); assert(T()[1].clips.length === 1, 'moved down');
    for (let i = 0; i < 4; i++) await C.run('undo');
    assert(T().length === 1 && T()[0].clips.length === 1, 'undo chain');
  }],
  ['add tracks: below the current one, duplicate, typed tracks, the ▾ list', async () => {
    const t0 = T()[0];
    act(t0); await C.run('addTrack'); const x1 = T()[1];
    act(t0); await C.run('addTrack');
    assert(T()[1].id === state.sel.activeTrackId && T()[2] === x1, 'new track goes below the current one');
    act(t0); await C.run('dupTrack'); const d = T()[1];
    assert(d.name === t0.name + ' 복제' && d.clips.length === t0.clips.length && d.clips[0].id !== t0.clips[0].id &&
      d.clips[0].src === t0.clips[0].src, 'duplicate');
    await C.run('addVoiceTrack'); const v = T()[2];
    assert(v.name === '목소리' && v.fx.eq.on && v.fx.eq.midFreq === 3000 && v.fx.comp.on && v.fx.comp.threshold === -20 &&
      v.gain === 1, 'voice track');
    await C.run('addMusicTrack'); const mu = T()[3];
    assert(Math.abs(20 * Math.log10(mu.gain) + 12) < 1e-9 && mu.fx.eq.on && mu.fx.eq.mid === -3 &&
      mu.fx.eq.midFreq === 2500 && !mu.fx.comp.on, 'music track');
    await C.run('addSfxTrack'); const fx = T()[4];
    assert(Math.abs(20 * Math.log10(fx.gain) + 6) < 1e-9 && !Object.values(fx.fx).some((f) => f.on), 'sfx track');
    await painted();
    const more = document.querySelector('[data-list=addTrack]');
    more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert(document.querySelectorAll('.menu .item').length === 5 && more.getAttribute('aria-expanded') === 'true',
      '▾ list');
    more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert(!document.querySelector('.menu'), '▾ list toggles closed');
  }],
  ['reorder tracks by key and grip drag (Esc cancels), undo back to one track', async () => {
    const t0 = T()[0], d = T()[1]; // the track and its duplicate from the step before
    act(t0); key('ArrowDown', { ctrlKey: true, altKey: true });
    assert(ids()[1] === t0.id && ids()[0] === d.id, 'Ctrl+Alt+↓ moves the current track down');
    await painted();
    const grip = document.querySelector(`.track-h[data-id="${t0.id}"] .grip`),
      top = document.getElementById('headers-inner').getBoundingClientRect().top;
    const drag = (y, esc) => {
      grip.dispatchEvent(new PointerEvent('pointerdown',
        { button: 0, clientY: grip.getBoundingClientRect().top, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: y }));
      if (esc) key('Escape');
      window.dispatchEvent(new PointerEvent('pointerup', { clientY: y }));
    };
    const before = ids(); drag(top + 2, true);
    assert(String(ids()) === String(before) && !document.querySelector('.drop-line'), 'Esc cancels the drag');
    drag(top + 2); assert(ids()[0] === t0.id, 'grip drag to the top');
    await C.run('undo'); assert(ids()[1] === t0.id, 'undo the drag');
    for (let i = 0; i < 7; i++) await C.run('undo');
    assert(T().length === 1 && T()[0].id === t0.id, 'undo chain');
  }],
  ['mouse drag: move, trim, drag-back leaves no undo step', async () => {
    const cv = document.getElementById('timeline'), rc = cv.getBoundingClientRect();
    Object.assign(state.view, { pxPerSec: 200, scrollX: 0, scrollY: 0 });
    state.sel.range = null; state.sel.clipIds = new Set(); state.sel.playhead = Math.round(1.9 * sr); changed();
    await wait(50);
    const c0 = T()[0].clips[0];
    const ev = (type, x, y, target = window) =>
      target.dispatchEvent(new MouseEvent(type,
        { clientX: rc.left + x, clientY: rc.top + y, button: 0, bubbles: true }));
    const xOf = (f) => (f / sr - state.view.scrollX) * state.view.pxPerSec, yStrip = 28 + 4 + 8;
    const dragTo = (x0, y0, xs) => {
      ev('mousedown', x0, y0, cv);
      for (const x of xs) ev('mousemove', x, y0);
      ev('mouseup', xs[xs.length - 1], y0);
    };
    dragTo(xOf(c0.start) + 30, yStrip, [xOf(c0.start) + 60, xOf(c0.start) + 90]);
    const moved = T()[0].clips[0];
    assert(Math.abs(moved.start - Math.round(0.3 * sr)) < sr * 0.01, 'moved ' + moved.start);
    const xr = xOf(E.clipEnd(moved)) - 2;
    dragTo(xr, 80, [xr - 20, xr - 40]); // below the fade handles at the top corners
    assert(T()[0].clips[0].length < moved.length - sr * 0.15, 'trimmed ' + T()[0].clips[0].length);
    const d = history.depth(), x2 = xOf(T()[0].clips[0].start) + 30;
    dragTo(x2, yStrip, [x2 + 40, x2]);
    assert(history.depth() === d, 'drag-back left an undo step');
    state.sel.clipIds = new Set([T()[0].clips[0].id]); // Ctrl+click lets the clip go: dragging on moves nothing
    cv.dispatchEvent(new MouseEvent('mousedown',
      { clientX: rc.left + x2, clientY: rc.top + yStrip, button: 0, bubbles: true, ctrlKey: true }));
    ev('mousemove', x2 + 40, yStrip); ev('mouseup', x2 + 40, yStrip);
    assert(history.depth() === d && !state.sel.clipIds.size, 'a drag after Ctrl+click let go left an undo step');
    await C.run('undo'); await C.run('undo');
    assert(T()[0].clips[0].start === c0.start && T()[0].clips[0].length === c0.length, 'undo drag');
  }],
  ['Space plays while a slider has focus', async () => {
    await painted();
    const vol = document.querySelector('.track-h .vol');
    vol.focus();
    vol.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    assert(state.playing, 'Space did not start playback');
    await C.run('stop'); vol.blur();
  }],
  ['double-click resets focused volume/pan slider at once', async () => {
    const h = document.querySelector('.track-h'), vol = h.querySelector('.vol'), pan = h.querySelector('.pan');
    for (const [s, v] of [[vol, -20], [pan, 0.5]]) {
      s.focus(); s.value = v; s.dispatchEvent(new Event('input'));
      s.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
    await wait(50);
    assert(+vol.value === 0 && +pan.value === 0, `thumbs ${vol.value} ${pan.value}`);
    assert(T()[0].gain === 1 && T()[0].pan === 0, 'model not reset');
    pan.blur();
  }],
  // each effect on a selection makes new sound (an effect that silently did nothing failed no check), then undone
  ...['fxGain', 'fxNormalize', 'fxFadeIn', 'fxFadeOut', 'fxReverse', 'fxSilence', 'fxPitch', 'fxEq', 'fxComp',
    'fxReverb', 'fxEcho'].map((fx) => [fx, async () => {
    sel(0.2, 0.8);
    const was = T()[0].clips;
    await C.run(fx);
    const made = T()[0].clips !== was && T()[0].clips.some((c) => !was.some((w) => w.src === c.src));
    await C.run('undo');
    assert(made && T()[0].clips === was, `${fx}: new sound, undone`);
  }]),
];
