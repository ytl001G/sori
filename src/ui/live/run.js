// `sori live run` (docs/cli.md): a menu command run in the app like the user. Values fill its dialog (checked by
// src/core/args.js), --path answers its file / folder window and --yes the app's own questions (unsaved changes,
// overwrite, 대본 넣기 warnings), so the CLI can do everything the user can. Without them the user sees the
// window, as with values.
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const C = require('../commands');
const D = require('../dialogs');
const A = require('../../core/args');
const { state, history } = require('../../core/state');

const bad = (message) => ({ ok: false, error: 'BAD_ARG', message });
const resolved = (x) => Promise.resolve(x);

// why the command cannot take this request, or null
function refuse(name, keys, pick) {
  if (typeof name !== 'string' || !Object.hasOwn(C.cmds, name)) {
    return { ok: false, error: 'UNKNOWN_COMMAND', message: `unknown command "${name}"; see sori live commands` };
  }
  const c = C.cmds[name];
  if (c.enabled && !c.enabled()) {
    const why = 'nothing selected, nothing to play, or not in this kind of project (see sori live state)';
    const message = `"${name}" (${c.label}) cannot run now: ${why}`;
    return { ok: false, error: 'DISABLED', message };
  }
  if (keys.length && !c.label.endsWith('…')) {
    return bad(`"${name}" has no dialog, so it takes no arguments; set the selection with sori live select`);
  }
  const paths = Array.isArray(pick) && pick.length && pick.every((p) => typeof p === 'string' && path.isAbsolute(p));
  if (pick !== undefined && !paths) return bad('--path needs file or folder paths');
  return null;
}

// --path for the open / save window (job.err when it does not fit that window)
function answerWindow(job, ch, opts, realInvoke) {
  const { pick, yes } = job;
  job.picked = true;
  // the window's file types: a wrong one would be written or read as if it were right (an MP3 named .wav)
  const exts = ((opts && opts.filters) || []).flatMap((f) => f.extensions || []);
  const fits = (p) => exts.includes(path.extname(p).slice(1).toLowerCase());
  const off = exts.length && !exts.includes('*') && pick.find((p) => !fits(p));
  if (off) {
    job.err = `--path ${path.basename(off)}: this window takes .${exts.join(', .')}`;
    return resolved({ canceled: true });
  }
  if (ch === 'open-dialog') return resolved({ canceled: false, filePaths: pick });
  if (pick.length > 1) { job.err = 'a save window takes one --path'; return resolved({ canceled: true }); }
  // the save window asks before replacing a file; without --yes the user still decides
  if (!yes && fs.existsSync(pick[0])) {
    return D.ask({ title: `'${path.basename(pick[0])}' 파일이 이미 있어요.`, note: '덮어쓸까요?', yes: true,
      buttons: [{ label: '취소', value: false }, { label: '덮어쓰기', value: true, primary: true }] })
      .then((ok) => (ok ? { canceled: false, filePath: pick[0] } : { canceled: true }));
  }
  return resolved({ canceled: false, filePath: pick[0] });
}

// the command opens its dialog synchronously inside C.run; the values fill that first one. With --yes the CLI
// answers every later dialog too (after a file window, a warning): with their defaults.
const fillDialog = (job, realModal) => (opts) => {
  if (!job.yes) D.modal = realModal;
  const v = job.given || {};
  job.given = null; job.used = true;
  const fields = Object.fromEntries(Object.keys(v).filter((k) => k !== 'preset').map((k) => [k, v[k]]));
  try { return resolved(A.fill(opts.fields || [], opts.presets, fields, v.preset)); } catch (e) {
    job.err = e.message;
    return resolved(null); // null = 취소: nothing happens
  }
};

async function run(name, args, { path: pick, yes } = {}) {
  const keys = Object.keys(args || {}), no = refuse(name, keys, pick);
  if (no) return no;
  const realModal = D.modal, realToast = D.toast, realInvoke = ipcRenderer.invoke, realAsk = D.ask;
  const before = [state.project, history.top()];
  const job = { pick, yes, toasts: [], err: null, picked: false, used: !keys.length, given: keys.length ? args : null };
  // shortcut: while the command awaits, a window the user opens in the app is answered the same way; the CLI runs
  // one command at a time and these are short, so the hooks are not tied to the command's own calls.
  if (pick || yes) {
    ipcRenderer.invoke = (ch, ...a) => {
      if (pick && (ch === 'open-dialog' || ch === 'save-dialog')) return answerWindow(job, ch, a[0], realInvoke);
      return realInvoke.call(ipcRenderer, ch, ...a);
    };
  }
  if (yes) D.ask = (o) => resolved(o.yes); // --yes: every question gets its go-on answer
  if (keys.length || yes) D.modal = fillDialog(job, realModal);
  D.toast = (msg, kind) => { job.toasts.push({ message: msg, kind: kind || 'info' }); realToast(msg, kind); };
  try {
    const p = C.run(name);
    if (!yes) D.modal = realModal; // later dialogs (the user's own) are real again
    await p;
  } finally { D.modal = realModal; D.toast = realToast; ipcRenderer.invoke = realInvoke; D.ask = realAsk; }
  return result(name, job, before);
}
function result(name, job, before) {
  const { toasts } = job;
  if (job.err) return { ...bad(job.err), toasts };
  // an undo step made, undone or redone
  const edited = state.project !== before[0] || history.top() !== before[1];
  const warning = [!job.used && 'no dialog took the arguments', job.pick && !job.picked && 'no file window took --path']
    .filter(Boolean).join('; ');
  const errs = toasts.filter((t) => t.kind === 'error');
  const failed = errs.length && { error: 'FAILED', message: errs.map((t) => t.message).join('; ') };
  return { ok: !errs.length, ...failed, command: name, edited, toasts, ...(warning && { warning }),
    canUndo: history.canUndo() };
}

module.exports = { run };
