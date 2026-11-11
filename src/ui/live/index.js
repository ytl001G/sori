// `sori live` (docs/cli.md): requests from the AI command line arrive from main.js and act in the app like the user:
// menu commands (run.js), the file commands on the open project (verb), the settings (settings.js), the line
// list, the selection. The user sees it happen; Ctrl+Z undoes edits.
const path = require('path');
const { ipcRenderer } = require('electron');
const engine = require('../../audio/engine');
const V = require('../../cli/verbs');
const C = require('../commands');
const D = require('../dialogs');
const E = require('../../core/edit');
const SCR = require('../../core/script');
const A = require('../../core/args');
const { takeByRef } = require('../../cli/project');
const { run } = require('./run');
const { settings, RECORDING } = require('./settings');
const { describe, describeScript } = require('../../core/summary');
const { state, history, changed, trackIndex } = require('../../core/state');

const bad = (message) => ({ ok: false, error: 'BAD_ARG', message });

function selection(p, sel) {
  const r = sel.range, s = (f) => Math.round(f / p.sampleRate * 1e4) / 1e4, no = (id) => trackIndex(id) + 1 || null;
  const picked = (t, i) => t.clips.flatMap((c, k) => (sel.clipIds.has(c.id) ? [{ track: i + 1, clip: k + 1 }] : []));
  return {
    range: r && { from: s(r.a), to: s(r.b), tracks: p.tracks.filter((t) => r.trackIds.has(t.id)).map((t) => no(t.id)) },
    clips: p.tracks.flatMap(picked),
    marker: p.markers.findIndex((m) => m.id === sel.markerId) + 1 || null,
    activeTrack: no(sel.activeTrackId),
    playhead: s(sel.playhead),
  };
}
function snapshot() {
  const p = state.project;
  return {
    ok: true,
    app: { filePath: state.filePath, dirty: state.dirty, playing: state.playing, recording: state.recording,
      canUndo: history.canUndo(), canRedo: history.canRedo() },
    selection: selection(p, state.sel),
    project: describe(p), // a script project: tracks = the current line's takes
    ...(p.script && { script: describeScript(p) }),
    ui: ui(),
  };
}
// `live script line|star|view`: the line list (go to a line, its tab / filter / search) and the take ★ buttons
async function script({ what, ref, view }) {
  const l = C.curLine();
  if (!l) return { ok: false, error: 'NOT_SCRIPT', message: 'the app has no script project open' };
  // the list's character tab and '녹음 안 한 것만': what ↑/↓ (prevLine / nextLine) and Ctrl+F walk through
  if (what === 'view') {
    const o = view && typeof view === 'object' ? view : {}, patch = {};
    if (o.char !== undefined && o.all) return bad('give --char or --all, not both');
    if (o.char !== undefined) {
      const all = [...new Set(SCR.linesNow(state.project).map((x) => x.char))]; // the characters with lines
      if (typeof o.char !== 'string' || !all.includes(o.char)) {
        const message = `no character "${o.char}"; characters: ${all.join(', ')}`;
        return { ok: false, error: 'NO_CHAR', message };
      }
      patch.char = o.char;
    }
    if (o.all === true) patch.char = '';
    if (o.todo !== undefined) patch.todo = o.todo === true;
    await C.setScriptView(patch);
  } else if (what === 'line') {
    const to = SCR.linesNow(state.project).find((x) => SCR.lineName(x) === String(ref).trim());
    if (!to) return { ok: false, error: 'NO_LINE', message: `no line "${ref}"; see sori live state (script.lines)` };
    await C.goLine(to.id);
  } else {
    const takes = state.project.tracks, t = takeByRef(takes, ref);
    const has = takes.map((x) => x.name).join(', ') || 'none';
    if (!t) return { ok: false, error: 'NO_TAKE', message: `${SCR.lineName(l)} has no take "${ref}"; it has ${has}` };
    C.setStar(t.id);
  }
  return { ok: true, script: describeScript(state.project), ui: ui(), canUndo: history.canUndo() };
}
// panels and list view: what the user sees besides the project
const ui = () => ({ mixer: state.ui.mixer, fxPanel: state.ui.fxPanel, spectrogram: state.view.spec,
  ...(state.project.script && list()) });
// visible first: it may set the view back to 전체
const list = () => {
  const visible = C.visibleLines().map(SCR.lineName);
  return { list: { ...state.ui.scriptView, visible } };
};

const commands = () => ({ ok: true, commands: Object.values(C.cmds).map((c) => ({
  name: c.name, label: c.label, enabled: !c.enabled || !!c.enabled(), dialog: c.label.endsWith('…'),
  ...(c.checked && { checked: !!c.checked() }),
})) });

// `sori live <file command>`: the command runs on a copy of the open project and the app takes the result
// like its own edit (commands.js takeProject). Not while recording: the take being recorded is outside the copy.
const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
async function verb(argv, cwd) {
  const args = Array.isArray(argv) && argv.every((x) => typeof x === 'string');
  if (!args || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    return { ok: false, error: 'BAD_REQUEST', message: 'verb needs argv and an absolute cwd' };
  }
  let job;
  try { job = V.parse(argv, true); } catch (e) {
    return { ok: false, error: e.code || 'BAD_ARG', message: e.message, ...(e.usage && { usage: e.usage }) };
  }
  const p = state.project, busy = () => job.verb.write && state.recording;
  if (busy()) return RECORDING;
  // the command edits a copy; was / wasScript tell whether the app changed meanwhile
  const was = { ...p }, wasScript = p.script && { ...p.script };
  const copy = { ...p, script: wasScript && { ...wasScript } };
  const res = await V.execute(argv, { cwd, audio: V.audioFor(engine), on: copy });
  if (!res.ok || !job.verb.write || res.dryRun) return res;
  // reading audio takes time: an edit the user made meanwhile must not be overwritten by the copy
  if (state.project !== p || !same(was, p) || (wasScript && !same(wasScript, p.script)) || busy()
    || D.isBusy()) {
    const message = 'the project changed in the app while the command ran (or a recording started); nothing was '
      + 'applied. Run it again';
    return { ok: false, error: 'CHANGED', message };
  }
  return { ...res, undoStep: C.takeProject(copy), canUndo: history.canUndo() };
}

// live select's options checked against the project: { range, clips, active, marker, playhead }; throws on a bad one
function readSelect(o, p) {
  const frame = (x, k) => {
    if (!(Number.isFinite(x) && x >= 0 && x <= A.MAX_SEC)) {
      throw new Error(`--${k} needs seconds >= 0, at most ${A.MAX_SEC} (24 h)`);
    }
    return Math.round(x * p.sampleRate);
  };
  const tr = (n) => {
    const t = Number.isInteger(n) && p.tracks[n - 1];
    if (!t) throw new Error(`track ${n} does not exist; the project has ${p.tracks.length}`);
    return t;
  };
  const ranged = o.from !== undefined || o.to !== undefined;
  if (ranged && o.clip) throw new Error('select a range or clips, not both');
  if (o.track && !ranged) {
    throw new Error('--track picks the tracks of a range: add --from/--to (--active sets the current track)');
  }
  const a = ranged && (o.from === undefined ? 0 : frame(o.from, 'from'));
  const b = ranged && (o.to === undefined ? E.projectEnd(p.tracks) : frame(o.to, 'to'));
  if (ranged && b <= a) throw new Error('--to must be after --from');
  const on = o.track ? [].concat(o.track).map(tr) : p.tracks;
  const range = ranged && { a, b, trackIds: new Set(on.map((t) => t.id)) };
  const clips = o.clip && (Array.isArray(o.clip) ? o.clip : [null]).map((x) => {
    const c = Array.isArray(x) && Number.isInteger(x[1]) && tr(x[0]).clips[x[1] - 1];
    if (!c) throw new Error(`no clip ${JSON.stringify(x)}; give TRACK:CLIP pairs from sori live state`);
    return c.id;
  });
  const marker = o.marker !== undefined && p.markers[o.marker - 1];
  if (marker === undefined) throw new Error(`marker ${o.marker} does not exist; the project has ${p.markers.length}`);
  const active = o.active !== undefined && tr(o.active);
  return { range, clips, active, marker, playhead: o.playhead !== undefined && frame(o.playhead, 'playhead') };
}
function select(o) {
  const sel = state.sel;
  let got;
  try { got = readSelect(o, state.project); } catch (e) { return bad(e.message); }
  const { range, clips, active, marker, playhead } = got;
  if (o.none) { sel.range = null; sel.clipIds = new Set(); sel.markerId = null; }
  if (range) { sel.range = range; sel.clipIds = new Set(); }
  if (clips) { sel.clipIds = new Set(clips); sel.range = null; }
  if (active) sel.activeTrackId = active.id;
  if (marker) sel.markerId = marker.id;
  if (playhead !== false) C.seek(playhead);
  changed();
  return { ok: true, selection: snapshot().selection };
}

// `live find`: Ctrl+F from the command line (commands/find.js); it goes to the hit like the box does
async function find({ text, clips, markers, memo, dir }) {
  if (typeof text !== 'string' || !text.trim()) return bad('give the text to find');
  const o = { clips: !!clips, markers: !!markers, memo: !!memo };
  const r = await C.find(text, o, [1, -1].includes(dir) ? dir : 0);
  const hit = r.hit && { kind: r.hit.kind, name: r.hit.name };
  return { ok: true, count: r.count, at: r.at + 1 || null, hit, selection: snapshot().selection,
    ...(state.project.script && { line: SCR.lineName(C.curLine()) }) };
}

function handle(req) {
  // the CLI gave up waiting (it reported TIMEOUT): a request still queued then must not act late
  if (Number.isFinite(req.deadline) && Date.now() > req.deadline) {
    return { ok: false, error: 'TIMEOUT', message: 'the request waited past its deadline; nothing was done' };
  }
  if (req.op === 'state') return snapshot();
  if (req.op === 'commands') return commands();
  if (D.isBusy()) { // a long job with its progress bar is running; it must not see the project change under it
    return { ok: false, error: 'BUSY', message: 'the app is busy with a long job (progress on screen); try later' };
  }
  if (D.isModalOpen()) { // the user is in a dialog; a change under it would be applied to stale values
    return { ok: false, error: 'BUSY', message: 'a dialog is open in the app; close it and try again' };
  }
  if (req.op === 'select') return select(req);
  if (req.op === 'find') return find(req);
  if (req.op === 'run') {
    const args = req.args && typeof req.args === 'object' ? req.args : {};
    return run(req.name, args, { path: req.path, yes: req.yes === true });
  }
  if (req.op === 'script' && ['line', 'star', 'view'].includes(req.what)) return script(req);
  if (req.op === 'verb') return verb(req.argv, req.cwd);
  if (req.op === 'settings') return settings(req.set);
  return { ok: false, error: 'BAD_REQUEST', message: 'unknown op' };
}

// one request at a time, in order: a command waiting for its dialog holds the next one back
let queue = Promise.resolve();
ipcRenderer.on('live', (_e, id, req) => {
  queue = queue.then(() => handle(req)).catch((e) => ({ ok: false, error: 'FAILED', message: e.message }))
    .then((res) => ipcRenderer.send('live-reply', id, res));
});
