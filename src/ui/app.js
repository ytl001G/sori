// Entry: applies settings, wires views, shortcuts, autosave and the redraw loop.
const icons = require('./icons');
const { state, history, newProjectData, changed } = require('../core/state');
const S = require('../core/settings');
const K = require('../core/shortcuts');
const C = require('./commands');
const timeline = require('./timeline');
const tracks = require('./panels/tracks');
const mixer = require('./panels/mixer');
const fxpanel = require('./panels/fx');
const scriptui = require('./panels/script');
const menus = require('./menus');
const spectro = require('../core/spectro');
const D = require('./dialogs');
const IO = require('../core/fileio');
const PK = require('../core/parked');
const engine = require('../audio/engine');
const { projectEnd } = require('../core/edit');

const SMOKE = process.argv.includes('--smoke');

// ---------- settings -> app ----------
let autosaveTimer = 0;
function apply(s, keys) {
  const has = (k) => !keys || keys.includes(k);
  if (has('theme')) document.documentElement.dataset.theme = s.theme;
  if (has('zoom')) require('electron').webFrame.setZoomFactor(s.zoom / 100);
  if (has('laneH')) {
    state.view.laneH = s.laneH;
    document.documentElement.style.setProperty('--lane', s.laneH + 'px');
  }
  if (has('undoOnlyGB')) history.budget = s.undoOnlyGB * 1e9;
  if (has('outputId') && keys) engine.setSink(s.outputId); // startup sink is set after the context is ready
  if (has('follow')) state.view.follow = s.follow;
  if (has('keys')) K.setOverrides(s.keys);
  if (keys && (has('metronome') || has('metroVol'))) C.syncMetro();
  if (has('autosaveMin')) {
    clearInterval(autosaveTimer);
    if (s.autosaveMin && !SMOKE) autosaveTimer = setInterval(() => C.autosave(), s.autosaveMin * 60000);
  }
  if (has('mixer')) state.ui.mixer = s.mixer; // the menu (setPanel) and sori live settings
  if (has('fxPanel')) state.ui.fxPanel = s.fxPanel;
  changed();
}
const settings = S.load();
apply(settings);
S.onChange(apply);
if (!SMOKE) setInterval(() => C.backupNow(), C.BACKUP_MS); // 자동 백업: every 10 min when something changed
if (settings.sampleRate !== state.project.sampleRate) {
  state.project = newProjectData(settings.sampleRate);
  engine.setSampleRate(settings.sampleRate);
}
engine.whenReady().then(() => { if (settings.outputId) engine.setSink(settings.outputId); });

icons.hydrate();
timeline.init();
tracks.init();
mixer.init();
fxpanel.init();
scriptui.init();
menus.init();
require('./live'); // sori live: the AI command line drives the app's commands (docs/cli.md)

for (const b of document.querySelectorAll('[data-cmd]')) b.addEventListener('click', () => C.run(b.dataset.cmd));
const $ = (id) => document.getElementById(id);
$('bpm').addEventListener('change', () => {
  C.setTempo($('bpm').value, state.project.beats);
  $('bpm').value = state.project.bpm;
});
$('bpm').addEventListener('keydown', (e) => { // Enter keeps the typed tempo, Escape puts the old one back
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  if (e.key === 'Escape') $('bpm').value = state.project.bpm;
  $('bpm').blur();
});
$('beats').addEventListener('change', () => C.setTempo(state.project.bpm, $('beats').value));

// only text entry blocks shortcuts; sliders and buttons keep Space/Ctrl+Z/Delete working
const TYPING = 'textarea, [contenteditable], select, input:not([type=range]):not([type=button])';
const isTyping = (e) => e.target.closest && e.target.closest(TYPING);
window.addEventListener('keydown', (e) => {
  if (D.isModalOpen()) return;
  if (menus.isOpen() && e.key !== 'Escape') return;
  const name = K.bindings()[K.keyOf(e)];
  if (!name) return;
  if (isTyping(e) && !(e.ctrlKey && ['save', 'saveAs', 'export', 'open'].includes(name))) return;
  // a focused slider keeps its own arrow keys; Space is always play/pause (Enter still activates buttons)
  if (e.target.closest && e.target.closest('input[type=range]') && /^Arrow/.test(e.code) && !e.altKey) return;
  e.preventDefault();
  menus.close();
  C.run(name);
});

// Space must not also click the focused button (it activates on keyup)
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !isTyping(e) && !D.isModalOpen()) e.preventDefault();
}, true);
// drops outside the timeline do nothing (the timeline handles its own)
for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault());

// new sound is packed for saving while the app is idle (fileio.prepack), never while recording; a change wakes it
let packing = false;
function packLater() {
  if (packing || state.recording) return;
  packing = true;
  requestIdleCallback((d) => {
    packing = false;
    if (!state.recording && IO.prepack(state.project, () => d.timeRemaining() > 2)) packLater();
  });
}
state.listeners.add(packLater);
// 필요할 때만 풀기: a take off screen lets go of its decoded sound after a while (core/parked.js)
setInterval(() => PK.sweep(new Set(state.project.tracks.flatMap((t) => t.clips.map((c) => c.src)))), 5000);

// ---------- redraw loop ----------
let dirty = true;
state.listeners.add(() => { dirty = true; });

const fmt = (f) => { // rounded first: never 00:60.000
  const s = +(Math.max(0, f) / state.project.sampleRate).toFixed(3), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

function setPressed(id, on, labelOn, labelOff) {
  const b = $(id);
  b.setAttribute('aria-pressed', String(on));
  if (labelOn) b.setAttribute('aria-label', on ? labelOn : labelOff);
}

function updateChrome() {
  const sel = state.sel, r = sel.range, p = state.project;
  $('time').textContent = engine.countingIn() ? '카운트인' : fmt(sel.playhead);
  $('seltime').textContent = r ? `선택 ${fmt(r.a)} – ${fmt(r.b)} (${((r.b - r.a) / p.sampleRate).toFixed(3)}초)` : '';
  setPressed('btn-play', state.playing && !state.recording, '일시정지', '재생');
  $('btn-play').disabled = !C.cmds.playPause.enabled();
  setPressed('btn-rec', state.recording, '녹음 정지', '녹음');
  setPressed('btn-loop', state.loop);
  setPressed('btn-metro', S.get().metronome);
  setPressed('btn-grid', p.grid === 'beats');
  setPressed('btn-snap', S.get().snap);
  setPressed('btn-mixer', state.ui.mixer);
  setPressed('btn-fx', state.ui.fxPanel);
  if (document.activeElement !== $('bpm')) $('bpm').value = p.bpm;
  if (!$('beats').querySelector(`option[value="${p.beats}"]`)) {
    $('beats').append(Object.assign(document.createElement('option'), { value: p.beats, textContent: `${p.beats}/4` }));
  }
  $('beats').value = String(p.beats);
  const dark = document.documentElement.dataset.theme === 'dark';
  $('btn-theme').setAttribute('aria-label', dark ? '밝은 테마로 전환' : '어두운 테마로 전환');
  $('empty').hidden = p.tracks.length > 0;
  const count = p.script ? `테이크 ${C.takeCount()}` : `트랙 ${p.tracks.length}`;
  $('info').textContent = `${p.sampleRate} Hz · ${count}개 · ${fmt(projectEnd(p.tracks))}`;
  const name = state.filePath ? require('path').basename(state.filePath, '.vproj') : '새 프로젝트';
  document.title = `${state.dirty ? '• ' : ''}${name} — Sori`;
}

function frame() {
  try { draw(); } finally { requestAnimationFrame(frame); } // a render that throws must not stop the loop
}
function draw() {
  C.tick();
  if (spectro.isPending() && spectro.work(8)) dirty = true; // spectrogram columns are computed a slice per frame
  mixer.render(); // meters animate every frame while the mixer is open
  if (dirty || state.playing || state.recording || engine.countingIn()) {
    dirty = false;
    scriptui.render();
    tracks.render();
    timeline.draw();
    timeline.syncScrollbar();
    fxpanel.render();
    updateChrome();
  }
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => { engine.stop(); });

if (SMOKE) require('../../test/smoke').run();
else { // crash recovery first, then the .vproj Sori was started with (double-click)
  engine.whenReady().then(async () => {
    await C.recoverAutosave();
    const f = await require('electron').ipcRenderer.invoke('start-file');
    if (f) await C.openProject(f);
    C.backupNow(); // tidies the backups (30 days) now, not only after 10 min
  });
}
