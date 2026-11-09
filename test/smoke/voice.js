// Smoke steps: 목소리 정리 (the 효과 menu group, its windows, one undo step, skipped steps) and the effect panel's
// 전기 웅 소리 / 치찰음 cards (50/60 Hz found on turning on, the live chain renders).
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const LD = require('../../src/core/loudness');
const P = require('../../src/core/fxparams');
const engine = require('../../src/audio/engine');
const { state, changed, makeTrack } = require('../../src/core/state');
const fs = require('fs');
const path = require('path');
const { stub, toasts, painted, assert, sr, T, sel, dir } = require('./kit');

// 'speech': 1 kHz bursts with quiet room noise between
function talk(parts) {
  const out = new Float32Array(parts.reduce((s, [, sec]) => s + Math.round(sec * sr), 0));
  let k = 0;
  for (const [kind, sec] of parts) {
    for (let i = 0; i < Math.round(sec * sr); i++, k++) {
      out[k] = (Math.random() - 0.5) * 0.002 + (kind === 'on' ? 0.3 * Math.sin(2 * Math.PI * 1000 * i / sr) : 0);
    }
  }
  return [out];
}
let kept, lane;
const len = () => E.projectEnd([T().find((t) => t.id === lane.id)]) / sr;
function addLane(ch) {
  kept = T();
  lane = makeTrack({ name: '목소리', clips: [E.makeClip(E.makeSource(ch), 0, '말')] });
  state.project.tracks = [...kept, lane]; state.sel.activeTrackId = lane.id; changed();
}
const drop = () => { state.project.tracks = kept; state.sel.range = null; changed(); };
// presses Esc the moment the progress bar first shows (no timing guesses); resolves with the line it showed
const stopOnBar = () => new Promise((resolve) => {
  const bar = document.getElementById('busy-progress');
  const mo = new MutationObserver(() => {
    if (bar.hidden) return;
    mo.disconnect(); resolve(document.getElementById('busy-step').textContent);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  mo.observe(bar, { attributes: true });
});

module.exports = [
  ['목소리 정리 menu: a title over its seven rows', async () => {
    const btn = document.querySelector('#menubar button[data-menu="fx"]');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await painted();
    const head = document.querySelector('.menu .head'), rows = document.querySelectorAll('.menu .item.under');
    assert(head && head.textContent === '목소리 정리' && rows.length === 7, 'menu ' + (head && head.textContent)
      + ' ' + rows.length);
    assert(rows[0].textContent.includes('한 번에 깔끔하게…'), rows[0].textContent);
    require('../../src/ui/menus').close();
  }],
  ['한 번에 깔끔하게: long pause cut, loudness 보통, one undo step; opens with the same rows again', async () => {
    addLane(talk([['on', 1.5], ['off', 2], ['on', 1.5]])); sel(0, 5, [lane]); // + 0.5 s silence each end
    await C.run('voiceClean'); // the rows it opens with: 긴 침묵 줄이기 보통 too
    assert(Math.abs(len() - 4.5) < 0.05, 'length ' + len());
    const out = E.renderRegion(T().find((t) => t.id === lane.id).clips, 0, Math.round(4.5 * sr));
    assert(Math.abs(LD.integrated(out, sr) + 16) < 0.6, 'LUFS ' + LD.integrated(out, sr));
    assert(toasts.at(-1).startsWith('한 번에 깔끔하게 적용했어요'), toasts.at(-1));
    assert(state.sel.range.b === Math.round(4.5 * sr) || Math.abs(state.sel.range.b / sr - 4.5) < 0.05, 'range');
    await C.run('undo'); assert(Math.abs(len() - 5) < 0.01, 'undo ' + len());
    // the same whole-clip range each time: a range ending inside the recording leaves that end alone
    sel(0, 5, [lane]); stub.modal = { gaps: 'off' }; await C.run('voiceClean'); stub.modal = {};
    assert(Math.abs(len() - 5) < 0.01, 'gaps 끄기: ' + len()); await C.run('undo');
    sel(0, 5, [lane]); await C.run('voiceClean');
    assert(Math.abs(len() - 4.5) < 0.05, 'back to 보통, not remembered: ' + len());
    await C.run('undo'); drop();
  }],
  ['목소리 정리 single windows: apply, or skip with a notice and no undo step', async () => {
    addLane(talk([['on', 1], ['off', 1], ['on', 1]])); sel(0, 3, [lane]);
    for (const c of ['voiceLoud', 'voiceDeess', 'voiceHum', 'voiceGate', 'voiceEven']) {
      await C.run(c); assert(toasts.at(-1).includes('적용했어요'), c + ': ' + toasts.at(-1));
      await C.run('undo');
    }
    drop();
    addLane([Float32Array.from({ length: 2 * sr }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 300 * i / sr))]);
    sel(0, 2, [lane]); const clips = T().find((t) => t.id === lane.id).clips;
    await C.run('voiceGate');
    assert(toasts.at(-1) === '작은 잡음 끄기는 건너뛰었어요 — 조용한 부분이 없어서', toasts.at(-1));
    assert(T().find((t) => t.id === lane.id).clips === clips, 'nothing changed');
    drop();
  }],
  ['effect panel: 전기 웅 소리 finds 50 Hz on turning on, presets keep it; both cards render in the mix', async () => {
    const wave = (f, a) => [Float32Array.from({ length: 2 * sr }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr))];
    const fx = () => T().find((t) => t.id === lane.id).fx;
    const level = async () => { // the second second of the mix (filters settled)
      const o = await engine.mixdown([T().find((t) => t.id === lane.id)], P.defaultMaster(), 0, 2 * sr);
      return Math.sqrt(o[0].subarray(sr).reduce((s, v) => s + v * v, 0) / sr);
    };
    addLane(wave(50, 0.2));
    C.setFx(lane.id, 'hum', { on: true });
    assert(fx().hum.freq === 50, 'freq ' + fx().hum.freq);
    C.setFx(lane.id, 'hum', { ...P.PRESETS.hum[2].values, on: true });
    assert(fx().hum.freq === 50 && fx().hum.count === 5, JSON.stringify(fx().hum));
    const hum = await level();
    assert(hum < 0.01, 'hum left ' + hum);
    drop();
    addLane(wave(1000, 0.3)); C.setFx(lane.id, 'deess', { on: true });
    const voice = await level(); // mono through the centre panner: 0.3 / sqrt(2) / sqrt(2)
    assert(Math.abs(voice - 0.15) < 0.01, 'voice ' + voice);
    drop();
  }],
  ['progress bar: 멈추기 (Esc) leaves everything as it was; 긴 침묵 per track; export stop writes no file', async () => {
    kept = T();
    const mk = (name, parts) => makeTrack({ name, clips: [E.makeClip(E.makeSource(talk(parts)), 0, name)] });
    // both 5 s like the range (a range past a track's end makes its clip that long). Old rule: one shared 1.5 s cut
    const a = mk('A', [['on', 1], ['off', 3], ['on', 1]]), b = mk('B', [['on', 2.5], ['off', 2], ['on', 0.5]]);
    state.project.tracks = [...kept, a, b]; changed(); sel(0, 5, [a, b]);
    const before = T().map((t) => t.clips), shown = stopOnBar();
    await C.run('voiceClean');
    assert(/^\d+% · .+ · [AB]$/.test(await shown), 'bar line ' + (await shown));
    assert(T().every((t, i) => t.clips === before[i]) && toasts.at(-1) === '멈췄어요 — 바뀐 것 없어요', toasts.at(-1));
    assert(document.getElementById('busy').hidden, 'overlay gone');
    await C.run('voiceClean');
    const len = (t) => E.projectEnd([T().find((x) => x.id === t.id)]) / sr;
    assert(Math.abs(len(a) - 3.5) < 0.05 && Math.abs(len(b) - 4.5) < 0.05, `each its own pause ${len(a)} ${len(b)}`);
    await C.run('undo');
    stub.save = path.join(dir, 'stopped.wav'); state.sel.range = null; // 5 s of A and B: the render reports progress
    const line = stopOnBar(); await C.run('export');
    assert(/^\d+% · 소리 섞는 중$/.test(await line) && !fs.existsSync(stub.save) && toasts.at(-1).startsWith('멈췄어요'),
      'export stop ' + toasts.at(-1));
    drop();
  }],
];
