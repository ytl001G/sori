// Smoke steps: Mixer, effect panel, markers, recording, settings, shortcuts, spectrogram, snap.
const fs = require('fs');
const C = require('../../src/ui/commands');
const D = require('../../src/ui/dialogs');
const engine = require('../../src/audio/engine');
const mic = require('../../src/audio/mic');
const S = require('../../src/core/settings');
const P = require('../../src/core/fxparams');
const spectro = require('../../src/core/spectro');
const { state, history, setDirty } = require('../../src/core/state');
const { errors, dir, stub, wait, painted, assert, sr, T, sel } = require('./kit');

module.exports = [
  ['mixer panel: strips, fader, double-click, meters move', async () => {
    await C.run('toggleMixer'); await wait(100);
    assert(document.querySelectorAll('#mixer .strip').length === T().length + 1, 'strips');
    const f = document.querySelector('#mixer-strips .fader');
    f.value = -6; f.dispatchEvent(new Event('input'));
    assert(Math.abs(T()[0].gain - 0.501) < 0.01, 'fader gain ' + T()[0].gain);
    f.dispatchEvent(new MouseEvent('dblclick')); assert(T()[0].gain === 1, 'dblclick');
    state.sel.range = null; state.sel.playhead = 0;
    await C.run('playPause'); await wait(600);
    const lv = engine.level('master'), lt = engine.level(T()[0].id);
    await C.run('playPause');
    assert(lv[0] > 0.1 && lt[0] > 0.1, `meters ${lv} ${lt}`);
    await C.run('toggleMixer');
  }],
  ['effect panel: switch, preset, EQ graph drag', async () => {
    const t = T()[0];
    C.showFx(t.id); await wait(120);
    assert(!document.getElementById('fxpanel').hidden, 'panel hidden');
    const fp = document.getElementById('fxpanel'), title = () => document.getElementById('fx-title').textContent;
    assert(title() === '트랙 효과 · ' + t.name && fp.style.getPropertyValue('--ch') === t.color, 'track channel label '
      + title());
    C.showFx('master'); await painted();
    assert(title() === '마스터 효과 · 전체 소리에' && /secondary/.test(fp.style.getPropertyValue('--ch')),
      'master channel label');
    C.showFx(t.id); await painted();
    const cards = [...document.querySelectorAll('#fx-body .fxcard')];
    assert(cards.length === P.TRACK_KINDS.length, 'cards ' + cards.length);
    const card = (k) => cards[P.TRACK_KINDS.indexOf(k)];
    card('eq').querySelector('.switch').click(); await wait(120);
    assert(T()[0].fx.eq.on, 'eq on');
    const ps = card('comp').querySelector('select');
    ps.value = '0'; ps.dispatchEvent(new Event('change'));
    assert(T()[0].fx.comp.on && P.matchPreset('comp', T()[0].fx.comp) === P.PRESETS.comp[0].name, 'preset');
    const cv = card('eq').querySelector('canvas.eqgraph'), r = cv.getBoundingClientRect();
    const x = r.left + 8 + Math.log(T()[0].fx.eq.midFreq / 20) / Math.log(1000) * (r.width - 16), y = r.top
      + r.height / 2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y - 40 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y - 40 }));
    assert(T()[0].fx.eq.mid > 6, 'mid after drag ' + T()[0].fx.eq.mid);
    C.setFx(t.id, 'eq', { on: false, mid: 0 }); C.setFx(t.id, 'comp', { on: false });
    await C.run('toggleFxPanel');
  }],
  // ---------- markers, recording, settings ----------
  ['markers: add, jump, ripple on full-track delete, export per segment', async () => {
    state.sel.range = null; state.sel.playhead = sr; await C.run('addMarker');
    state.sel.playhead = Math.round(1.5 * sr); await C.run('addMarker');
    assert(state.project.markers.length === 2, 'add');
    state.sel.playhead = 0; await C.run('nextMarker'); assert(state.sel.playhead === sr, 'next');
    sel(0.2, 0.7); await C.run('delete');
    assert(state.project.markers[0].frame === Math.round(0.5 * sr), 'ripple ' + state.project.markers[0].frame);
    await C.run('undo'); assert(state.project.markers[0].frame === sr, 'undo marker');
    // the last export picked mp3
    state.sel.range = null; stub.dir = dir; stub.modal = { range: 'markers', format: 'wav16' };
    await C.run('export'); stub.modal = {};
    const files = fs.readdirSync(dir).filter((f) => /^\d+ .*\.wav$/.test(f));
    assert(files.length === C.markerSegments().length && files.length === 3, 'files ' + files);
    await C.run('undo'); await C.run('undo'); assert(state.project.markers.length === 0, 'undo add');
  }],
  ['record from the fake mic with count-in + metronome', async () => {
    S.set({ countIn: 1, metronome: true }); C.setTempo(240, 2); // count-in 0.5 s
    state.sel.range = null; state.sel.playhead = 0;
    const n = T().length, m0 = state.project.markers.length;
    // stopped during the count-in: no take, and a saved project stays saved with no backup due
    setDirty(false); state.backupDue = false;
    await C.run('record'); await C.run('record');
    assert(T().length === n && !state.dirty && !state.backupDue, 'a cancelled recording left the project unsaved');
    // a step to undo while recording
    state.sel.playhead = Math.round(sr * 0.123); await C.run('addMarker'); state.sel.playhead = 0;
    await C.run('record'); assert(state.recording, 'not recording');
    let refused = false; await mic.measureLatency('', 1).catch(() => { refused = true; });
    assert(refused && engine.recording(), 'latency measure replaced the take');
    await wait(800);
    assert(C.recTrim(engine.recLead()) >= sr * 0.5, 'live view ignores the count-in: ' + C.recTrim(engine.recLead()));
    await C.run('toggleMetro'); assert(state.recording && !S.get().metronome, 'metronome toggle while recording');
    await C.run('undo');
    assert(state.recording && T().length === n + 1 && state.project.markers.length === m0,
        'Ctrl+Z while recording undoes the step before it, the recording goes on');
    await C.run('redo');
    assert(state.recording && T().length === n + 1 && state.project.markers.length === m0 + 1, 'Ctrl+Y too');
    await wait(800); await C.run('record');
    assert(T().length === n + 1 && !state.recording, 'no track');
    const c = T()[n].clips[0];
    assert(c && c.length > sr * 0.4 && c.length < sr * 1.6, 'rec length ' + (c && c.length / sr));
    S.set({ countIn: 0, metronome: false }); C.setTempo(120, 4);
    await C.run('undo'); assert(T().length === n, 'undo rec');
    await C.run('undo'); assert(state.project.markers.length === m0, 'then the marker');
    await C.run('record'); await wait(400); await C.removeTrack(T()[n].id);
    assert(!state.recording && T().length === n, "the recording take's ✕ stops it and deletes the take");
    await C.run('undo');
    assert(T().length === n + 1 && T()[n].clips.length === 1, 'Ctrl+Z brings it back with its sound');
    await C.run('undo'); assert(T().length === n, 'and the take step');
  }],
  ['latency measure returns ms or null, never throws; one recorder at a time', async () => {
    const ms = await mic.measureLatency('', 1);
    assert(ms === null || (ms >= 0 && ms <= 500), 'ms ' + ms);
    // two starts while the mic opens (R and sori live --latencyMs auto): one is refused, none left running
    const two = await Promise.allSettled([engine.startRecording(), engine.startRecording()]);
    await engine.stopRecording();
    assert(two.filter((x) => x.status === 'rejected').length === 1 && !engine.recording(), 'two starts at once');
    // 마이크 테스트 pressed twice, or stopped (settings closed) while the mic opens: no mic left on
    const md = navigator.mediaDevices, gum = md.getUserMedia, streams = [];
    md.getUserMedia = async (c) => { const s = await gum.call(md, c); streams.push(s); return s; };
    try {
      const t = await Promise.all([mic.startInputTest('', 1), mic.startInputTest('', 1)]);
      const u = mic.startInputTest('', 1); mic.stopInputTest();
      assert(t[0] === null && t[1] === false && (await u) === null, 'superseded tests say so ' + t);
      mic.stopInputTest();
    } finally { md.getUserMedia = gum; }
    const live = streams.flatMap((s) => s.getTracks()).filter((x) => x.readyState === 'live');
    assert(streams.length === 3 && !live.length, `mic tracks left on: ${live.length} of ${streams.length}`);
  }],
  ['settings window: 4 tabs render, lane height + zoom apply, Esc closes', async () => {
    const p = C.run('settings'); await wait(300);
    const tabs = [...document.querySelectorAll('.snav [role=tab]')];
    assert(tabs.length === 4, 'tabs ' + tabs.length);
    for (const b of tabs) {
      b.click(); await wait(200);
      assert(document.querySelector('.spanel').children.length > 2, 'empty tab ' + b.textContent);
      const unnamed = [...document.querySelectorAll('.spanel [role=group]')].filter((x) =>
        !x.getAttribute('aria-label'));
      assert(!unnamed.length,
        `unnamed choice group in ${b.textContent}: ${unnamed.map((x) => x.textContent).join(' | ')}`);
    }
    tabs[0].click(); tabs[1].click(); await wait(300); // ↓ before the audio tab's device list came
    const rows = [...document.querySelectorAll('.spanel .slabel')].map((x) => x.textContent);
    assert(rows[0] === '카운트인' && !rows.includes('마이크'), 'two tabs at once: ' + rows.join(', '));
    S.set({ laneH: 128, zoom: 110 }); await wait(80);
    assert(document.querySelector('.track-h').offsetHeight === 128, 'lane '
      + document.querySelector('.track-h').offsetHeight);
    assert(Math.abs(require('electron').webFrame.getZoomFactor() - 1.1) < 1e-6, 'zoom');
    S.set({ laneH: 96, zoom: 100 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
    assert(!D.isModalOpen(), 'still open');
  }],
  ['shortcut remap via settings: new key works, old key freed', async () => {
    const p = require('../../src/ui/settings').open('view'); await wait(250);
    document.querySelector('.keyrow[data-cmd="addMarker"] .btn').click();
    const e0 = errors.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true }));
    // expected error toast, not a failure
    assert(errors.length === e0 + 1 && /Tab/.test(errors.pop()), 'no refusal toast');
    assert(!S.get().keys.addMarker, 'Tab was taken as a shortcut');
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    assert(S.get().keys.addMarker[0] === 'KeyJ', 'captured ' + JSON.stringify(S.get().keys));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
    state.sel.range = null; state.sel.playhead = Math.round(0.25 * sr);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
    assert(state.project.markers.length === 1, 'markers ' + state.project.markers.length);
    S.set({ keys: {} }); await C.run('undo');
  }],
  ['shortcut list opens and closes', async () => {
    const p = C.run('shortcuts'); await wait(150);
    assert(document.querySelectorAll('.sgroups .keyrow').length > 30, 'rows');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await p;
  }],
  ['spectrogram view: the whole timeline, not an edit; computes in the background', async () => {
    const dirty = state.dirty, undo = history.canUndo();
    state.sel.activeTrackId = null; await C.run('toggleSpec'); await wait(100); // no track picked: still works
    assert(state.view.spec && state.dirty === dirty && history.canUndo() === undo, 'view only');
    for (let i = 0; i < 60 && spectro.isPending(); i++) await wait(50);
    assert(!spectro.isPending(), 'still pending');
    await C.run('toggleSpec');
  }],
  ['snap toggle + zoom to selection', async () => {
    const s0 = S.get().snap; await C.run('toggleSnap'); assert(S.get().snap === !s0, 'snap'); await C.run('toggleSnap');
    sel(0.5, 1.0); await C.run('zoomSel');
    assert(state.view.pxPerSec > document.getElementById('timeline').clientWidth, 'px ' + state.view.pxPerSec);
    state.sel.range = null; await C.run('zoomFit');
  }],
];
