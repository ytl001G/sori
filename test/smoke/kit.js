// What every smoke step uses (test/smoke.js runs the steps). Dialogs are stubbed: modal -> its fields' values
// (+ stub.modal), toast -> recorded, save/folder dialogs -> stub.save / stub.dir, D.ask -> stub.ask or its go-on answer
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const D = require('../../src/ui/dialogs');
const E = require('../../src/core/edit');
const IO = require('../../src/core/fileio');
const engine = require('../../src/audio/engine');
const { state } = require('../../src/core/state');

const log = [], errors = [], toasts = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sori-smoke-'));
const stub = { modal: {}, save: null, dir: null };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// DOM views render in the frame loop
const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const realModal = D.modal;
const stubModal = async ({ fields = [] }) =>
  ({ ...Object.fromEntries(fields.map((f) => [f.key, f.value])), ...stub.modal });
const invokeOrig = ipcRenderer.invoke.bind(ipcRenderer);
const realAsk = D.ask, stubAsk = (o) => Promise.resolve(stub.ask !== undefined ? stub.ask : o.yes);
const assert = (c, m) => { if (!c) throw new Error(m); };
const sr = engine.sampleRate(), T = () => state.project.tracks, end = () => E.projectEnd(T());
const sel = (a, b, tracks = T()) => {
  state.sel.clipIds = new Set();
  state.sel.range = { a: Math.round(a * sr), b: Math.round(b * sr), trackIds: new Set(tracks.map((t) => t.id)) };
};
const tone = (f) => Float32Array.from({ length: sr * 2 },
  (_, i) => 0.4 * Math.sin(2 * Math.PI * f * i / sr) + (Math.random() - 0.5) * 0.02);
const wav = path.join(dir, 'tone.wav');
const packaged = __dirname.includes('.asar'); // the installed app has no node/electron to run the CLI with
const shots = process.env.SORI_SHOTS; // a folder: the screenshot steps run and write there

function install() {
  window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + (e.reason && e.reason.message)));
  D.modal = stubModal;
  const toastOrig = D.toast;
  D.toast = (msg, kind) => {
    console.log('toast: ' + msg); toasts.push(msg);
    if (kind === 'error') errors.push('toast: ' + msg);
    toastOrig(msg, kind);
  };
  ipcRenderer.invoke = (ch, ...a) => {
    if (ch === 'save-dialog') return Promise.resolve({ canceled: false, filePath: stub.save });
    const folder = ch === 'open-dialog' && a[0].properties.includes('openDirectory');
    if (folder) return Promise.resolve({ canceled: false, filePaths: [stub.dir] });
    return invokeOrig(ch, ...a);
  };
  D.ask = stubAsk;
  fs.writeFileSync(wav, IO.encodeWav([tone(440), tone(660)], sr, 16));
}
async function step(name, fn) {
  const before = errors.length, t = performance.now();
  console.log('step: ' + name); // a timeout then shows where it stopped
  try { await fn(); } catch (e) { errors.push(`${name}: ${e.stack || e.message}`); }
  log.push(`${errors.length === before ? 'ok  ' : 'FAIL'} ${name} (${Math.round(performance.now() - t)} ms)`);
}

// sori: the real command line in a child process (the hidden window does the audio)
const cli = (...argv) =>
  new Promise((res, rej) => require('child_process').execFile(process.env.npm_node_execpath || 'node',
  [path.join(__dirname, '../../src/cli/sori.js'), ...argv], { cwd: dir, env: process.env, timeout: 60000 },
  (e, out, err) => { try { res(JSON.parse(out)); } catch { rej(new Error(`sori ${argv.join(' ')}: ${err || e}`)); } }));
const ok = (r, what) => { assert(r.ok, what + ': ' + JSON.stringify(r)); return r; };

module.exports = {
  log, errors, toasts, dir, stub, wait, painted, realModal, stubModal, invokeOrig, assert, sr, T, end, sel, tone, wav,
  packaged, shots, install, step, realAsk, stubAsk, cli, ok,
};
