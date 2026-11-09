// Smoke steps: screenshots into SORI_SHOTS (only when it is set).
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const D = require('../../src/ui/dialogs');
const E = require('../../src/core/edit');
const { state, history, changed } = require('../../src/core/state');
const { wait, painted, realModal, stubModal, invokeOrig, sr, T, sel, shots, realAsk } = require('./kit');

const shot = async (n) => { await wait(150); await invokeOrig('capture', path.join(shots, n + '.png')); };
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const menus = () => require('../../src/ui/menus');
// design trial: light-theme token sets from a JSON file (SORI_VARIANTS), a voice-like clip on track 2
async function variants() {
  const vars = JSON.parse(fs.readFileSync(process.env.SORI_VARIANTS, 'utf8')), st = document.createElement('style');
  document.head.append(st);
  const vc = Float32Array.from({ length: sr * 1.6 }, (_, i) => {
    const s = i / sr, env = Math.max(0, Math.sin(Math.PI * s * 3.2)) ** 2 * (0.55 + 0.45 * Math.sin(s * 7));
    return env * (0.5 * Math.sin(2 * Math.PI * 180 * s) + 0.35 * (Math.random() - 0.5));
  });
  const mu = Float32Array.from({ length: sr * 1.9 }, (_, i) => {
    const s = i / sr, beat = Math.exp(-((s * 4) % 1) * 4);
    return (0.25 + 0.45 * beat) * (0.5 * Math.sin(2 * Math.PI * 110 * s) + 0.3 * Math.sin(2 * Math.PI * 220 * s)
      + 0.25 * (Math.random() - 0.5));
  });
  const voice = () => E.makeClip(E.makeSource([vc, vc]), Math.round(sr * 0.2), '목소리');
  const music = () => E.makeClip(E.makeSource([mu, mu]), 0, '배경음악');
  history.commit(); state.project.tracks = T().map((t, i) => ({ ...t, clips: [i ? voice() : music()] }));
  await C.run('toggleMixer');
  for (const [name, css] of Object.entries(vars)) {
    st.textContent = `:root[data-theme="light"]{${css}}`;
    await C.run('toggleTheme'); await painted(); await C.run('toggleTheme'); await painted();
    await shot('variant-' + name);
  }
  st.remove(); await C.run('toggleMixer'); await C.run('undo'); await C.run('toggleTheme');
  await C.run('toggleTheme');
}

module.exports = [
  ['screenshots: the editor (dark, fade curves, light), design variants, menus', async () => {
    state.view.pxPerSec = 300; state.view.scrollX = 0;
    await C.run('addTrack'); sel(0.4, 1.1, [T()[0]]); state.sel.clipIds = new Set();
    state.sel.playhead = Math.round(0.6 * sr); changed();
    await shot('dark');
    const faded = (c) => ({ ...c, fadeIn: sr * 0.4, fadeOut: sr * 0.5, fadeInShape: 'smooth', fadeOutShape: 'fast' });
    history.commit();
    state.project.tracks = T().map((t, i) => (i ? t : { ...t, clips: t.clips.map((c, j) => (j ? c : faded(c))) }));
    changed(); await shot('fade-curves'); await C.run('undo');
    await C.run('toggleTheme'); await shot('light');
    if (process.env.SORI_VARIANTS) await variants();
    document.querySelector('[data-menu="fx"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await shot('menu');
    menus().close();
    document.querySelector('[data-list=addTrack]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await shot('add-track-list-light');
    menus().close();
    // the top menus at the smallest window (900 x 560): 편집 must fit, the bar must not wrap
    await invokeOrig('resize', 900, 560); await wait(300);
    for (const m of ['edit', 'track']) {
      document.querySelector(`[data-menu="${m}"]`).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await shot('menu-' + m + '-small'); menus().close();
    }
    await invokeOrig('resize', 1400, 860); await wait(300);
  }, 'shots'],
  ['screenshots: EQ dialog, mixer + effect panel, settings, shortcuts, the smallest window', async () => {
    D.modal = realModal;
    let p = C.run('fxEq'); await shot('eq-dialog-light'); esc(); await p;
    await C.run('toggleTheme');
    p = C.run('fxEq'); await shot('eq-dialog'); esc(); await p;
    D.modal = stubModal;
    C.setFx('master', 'eq', { on: true, low: 3, high: 2 }); C.setFx('master', 'comp', { on: true });
    // loud enough to show the red end of the meter
    await C.run('toggleMixer'); C.showFx('master'); C.mixer(T()[0].id, { gain: 2.5 });
    await C.run('playPause'); await wait(400); await shot('mixer-fx'); await C.run('playPause');
    C.showFx(T()[0].id); await shot('fx-track'); C.showFx('master');
    await C.run('playPause'); await C.run('toggleTheme'); await wait(400); await shot('mixer-fx-light');
    await C.run('playPause'); await C.run('toggleTheme');
    C.mixer(T()[0].id, { gain: 1 });
    await C.run('toggleMixer'); await C.run('toggleFxPanel');
    p = C.run('settings'); await shot('settings'); esc(); await p;
    p = C.run('shortcuts'); await shot('shortcuts'); esc(); await p;
    await C.run('toggleMixer'); C.showFx('master'); await invokeOrig('resize', 900, 560); await wait(300);
    await shot('min-size');
    await invokeOrig('resize', 1400, 860); await C.run('toggleMixer'); await C.run('toggleFxPanel');
  }, 'shots'],
  ['screenshots: 목소리 정리 menu, windows and the effect panel cards, both themes', async () => {
    D.modal = realModal; await wait(300); // the last step's window resize closes menus when it lands
    for (const th of ['dark', 'light']) {
      document.querySelector('[data-menu="fx"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await shot('voice-menu-' + th); menus().close();
      let p = C.run('voiceClean'); await shot('voice-clean-' + th); esc(); await p;
      p = C.run('voiceLoud'); await shot('voice-loud-' + th); esc(); await p;
      const id = T()[0].id;
      C.setFx(id, 'hum', { on: true }); C.setFx(id, 'deess', { on: true }); C.showFx(id);
      await shot('voice-cards-' + th);
      C.setFx(id, 'hum', { on: false }); C.setFx(id, 'deess', { on: false }); await C.run('toggleFxPanel');
      await C.run('toggleTheme');
    }
    D.modal = stubModal;
    await D.busy('목소리 정리 적용 중', async (step) => { await step(42, 100, '잡음 줄이기 · 보컬3'); await shot('busy'); });
    const q = realAsk({ title: '저장하지 않은 변경 사항이 있어요.', note: '저장하지 않고 닫으면 변경 내용이 사라져요.',
      buttons: [{ label: '저장', value: 1, primary: true }, { label: '저장 안 함', value: 2 }, { label: '취소' }] });
    await shot('ask'); esc(); await q;
    const bk = C.run('openBackup'); // the files steps made one
    for (let i = 0; i < 50 && !document.querySelector('.backup-row'); i++) await wait(20);
    await shot('backups'); await C.run('toggleTheme'); await wait(300); await shot('backups-light');
    await C.run('toggleTheme'); esc(); await bk;
  }, 'shots'],
];
