#!/usr/bin/env node
// `sori`: command line for AIs (and people). File commands edit/export a .vproj without the app (src/cli/verbs.js);
// `sori live ...` drives the running app over a local pipe (src/cli/pipe.js -> main.js -> src/ui/live/).
// Prints one JSON line; exit code 0 = ok, 1 = error. Guide: docs/cli.md
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const V = require('./verbs');
const pipe = require('./pipe');
const A = require('../core/args');

const LIVE = [
  ['live state', 'the open project (same shape as info) + selection, file path, unsaved flag, undo/redo, panels '
    + 'and the line list view (ui)'],
  ['live commands', 'every menu command: name, label, enabled, dialog (true = takes --FIELD values)'],
  ['live select [--from SEC] [--to SEC] [--track N,M] [--clip T:K,...] [--active N] [--marker N] [--playhead SEC] '
    + '[--none]',
  'set what the next command works on: a range (on --track or all tracks), clips, the current track, a marker, '
    + 'the play position'],
  ['live run <command> [--preset NAME] [--FIELD VALUE ...] [--path FILE ...] [--yes]',
    'run a menu command in the app (an undoable step, Ctrl+Z); fields fill its dialog, --path answers its file or '
    + 'folder window (several files for 열기), --yes answers its questions (unsaved changes, overwrite, warnings) '
    + 'with yes. What is not given, the user is asked on screen'],
  ['live <file command without <project>>', 'any file command above on the project open in the app, e.g. '
    + 'sori live track set --track 1 --volume -3. Tracks, clips, track colors, markers and lines change as one undo '
    + 'step; mixer values, names, effects, character colors and tempo are live, as in the app (undoStep says '
    + 'which). Refused while recording'],
  ['live settings [--NAME VALUE ...]', 'everything the app remembers: without options shows settings, audio '
    + 'devices, recent files, shortcuts; options change them like the window or menu (--theme light, --metronome '
    + 'on, --latencyMs 30 or auto, --key split=Ctrl+K, --keys default, --recent clear, --mic-test 2)'],
  ['live script line <NAME>', 'script project: go to that line (철수-001), as clicking it in the list'],
  ['live script star <N|NAME>', 'script project: ★ the current line\'s take N (테이크 N) or the take with that name '
    + '(undoable)'],
  ['live script view [--char NAME | --all] [--todo on|off]', 'script project: the line list\'s character tab and '
    + '녹음 안 한 것만 (what prevLine / nextLine and find walk through); live state ui.list shows it'],
  ['live find <TEXT> [--clips] [--markers] [--memo] [--next | --prev]', 'Ctrl+F: go to what matches TEXT (a part, '
    + 'no case or spaces): track names, or in a script project the listed lines (number, text). --clips / --markers '
    + '/ --memo also look in clip names, marker names, line memos. Without --next/--prev it stays on a match it is '
    + 'on, else goes to the first from the current track/line on; reply: count, at (1-based), hit'],
];
const LIVE_SELECT = {
  from: 'sec', to: 'sec', track: 'idxs', clip: 'pairs', active: 'idx', marker: 'idx', playhead: 'sec', none: 'bool',
};

function help() {
  const row = ([u, a]) => `  sori ${u}\n      ${a}\n`;
  return 'sori: command line for the Sori audio editor. Every command prints one JSON line:\n'
    + '{"ok":true,...} or {"ok":false,"error":"CODE","message":"..."}; exit code 0 or 1. Guide: docs/cli.md\n'
    + 'Tracks, clips and markers count from 1 (as in sori info). Times are seconds, volumes dB.\n'
    + 'A script project (대본 녹음 모드): clip / range / apply / import / fx work on one line\'s takes: give --line NAME,\n'
    + 'and --take N|NAME (--to-take) where they say --track (--to-track); the reply names takes.\n\n'
    + 'File commands (the app need not run; while the app has that project open, run them as '
    + 'sori live <command> without <project>):\n'
    + V.VERBS.map((v) => row([v.usage, v.about])).join('')
    + '\nLive commands (the running app):\n' + LIVE.map(row).join('');
}

const out = (res) => { process.stdout.write(JSON.stringify(res) + '\n'); process.exitCode = res && res.ok ? 0 : 1; };
const errOf = (e) => ({ ok: false, error: e.code || 'FAILED', message: e.message, ...(e.usage && { usage: e.usage }) });

// live script line NAME / star N; script line set and script star --line --take are file commands
const scriptGo = (rest) => (rest[0] === 'line' && rest[1] !== 'set')
  || (rest[0] === 'star' && !rest.slice(1).some((x) => String(x).startsWith('--')));
// each live subcommand's arguments -> the pipe request
const LIVE_REQ = {
  state: (rest) => { if (rest.length) throw A.bad('live state takes no arguments'); return { op: 'state' }; },
  commands: (rest) => { if (rest.length) throw A.bad('live commands takes no arguments'); return { op: 'commands' }; },
  select(rest) {
    const { pos, o } = A.parse(rest, LIVE_SELECT);
    if (pos.length) throw A.bad('live select takes only options');
    return { op: 'select', ...o };
  },
  run(rest) {
    const { pos, o, fields } = A.parse(rest, { preset: 'str', path: 'strs', yes: 'bool' }, true);
    if (pos.length !== 1) throw A.bad('give one command name (see sori live commands)');
    return { op: 'run', name: pos[0], args: { ...fields, ...(o.preset !== undefined && { preset: o.preset }) },
      // the app's cwd is not ours
      ...(o.path && { path: o.path.map((p) => path.resolve(p)) }), ...(o.yes && { yes: true }) };
  },
  script(rest, argv) {
    if (scriptGo(rest)) {
      if (rest.length !== 2) throw A.bad('live script line NAME | live script star N');
      return { op: 'script', what: rest[0], ref: rest[1] };
    }
    if (rest[0] !== 'view') return LIVE_REQ.verb(rest, argv);
    const { pos, o } = A.parse(rest.slice(1), { char: 'str', all: 'bool', todo: 'onoff' });
    if (pos.length) throw A.bad('live script view takes only options');
    return { op: 'script', what: 'view', view: { ...o } };
  },
  find(rest) {
    const { pos, o } = A.parse(rest, { clips: 'bool', markers: 'bool', memo: 'bool', next: 'bool', prev: 'bool' });
    if (pos.length !== 1 || !String(pos[0]).trim()) throw A.bad('give the text to find: live find TEXT');
    if (o.next && o.prev) throw A.bad('give --next or --prev, not both');
    return { op: 'find', text: pos[0], clips: !!o.clips, markers: !!o.markers, memo: !!o.memo,
      dir: o.next ? 1 : o.prev ? -1 : 0 };
  },
  settings(rest) {
    const { pos, fields } = A.parse(rest, {}, true);
    if (pos.length) throw A.bad('live settings takes only --NAME VALUE options');
    return { op: 'settings', set: { ...fields } };
  },
  verb(rest, argv) {
    V.parse(argv.slice(1), true); // usage errors here, without the app
    return { op: 'verb', argv: argv.slice(1), cwd: process.cwd() };
  },
};
const LIVE_LIST = 'live commands: state, commands, select, run, find, settings, script line|star|view, '
  + 'or any file command without <project>';
// ops that may wait for a dialog or a measurement
const SLOW = ['run', 'verb', 'settings'];

async function live(argv) {
  const sub = argv[1], rest = argv.slice(2);
  if (sub === undefined) return { ok: false, error: 'UNKNOWN_COMMAND', message: LIVE_LIST };
  const own = Object.prototype.hasOwnProperty.call(LIVE_REQ, sub) && sub !== 'verb';
  const req = (own ? LIVE_REQ[sub] : LIVE_REQ.verb)(rest, argv);
  // a batch may run many heavy commands; measure renders every line
  const long = req.op === 'verb' && ['batch', 'measure'].includes(req.argv[0]);
  const ms = long ? 3600000 : SLOW.includes(req.op) ? 120000 : 10000;
  try {
    return await pipe.request(req, ms);
  } catch (e) {
    const maybe = e.code === 'TIMEOUT' && req.op !== 'state' && req.op !== 'select';
    const note = maybe ? '; the command may still be running (a dialog waiting for the user?)' : '';
    return { ok: false, error: e.code, message: e.message + note };
  }
}

// file commands must not race the app: a project open there would be overwritten by its next save (or vice versa)
async function openInApp(file) {
  let res;
  try { res = await pipe.request({ op: 'state' }, 3000); } catch (e) {
    if (e.code === 'NO_APP') return null;
    const message = `Sori is running but did not answer (${e.message}); it may be showing a dialog. Try again`;
    return { ok: false, error: 'APP_NOT_RESPONDING', message };
  }
  const fp = res && res.app && res.app.filePath;
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (!fp || norm(fp) !== norm(file)) return null;
  const message = `this project is open in Sori${res.app.dirty ? ' with unsaved changes' : ''}. Run the same `
    + 'command as "sori live <command>" without the project file (an undo step there), or close it in the app '
    + 'first, so neither side\'s work is lost';
  return { ok: false, error: 'OPEN_IN_APP', message };
}

// import/export need Web Audio: run the same command in a hidden Electron window (main.js --cli=<job dir>)
async function headless(argv) {
  let electron;
  try { electron = require('electron'); } catch {
    const message = 'import/export need the Electron binary (npm install in the Sori folder)';
    return { ok: false, error: 'NO_ELECTRON', message };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sori-cli-'));
  try {
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ argv, cwd: process.cwd() }));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // else the binary starts as plain Node
    const log = await new Promise((resolve) => {
      let err = '';
      const opts = { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true };
      const p = spawn(electron, [path.join(__dirname, '..', '..'), '--cli=' + dir], opts);
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', (e) => resolve(e.message));
      p.on('close', () => resolve(err));
    });
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch {
      const message = 'the hidden Sori window stopped without a result: ' + log.trim().slice(-500);
      return { ok: false, error: 'HEADLESS_FAILED', message };
    }
  } finally {
    // a leftover temp folder is harmless
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* kept */ }
  }
}

// `batch <project> -` / `live batch -`: the commands come on stdin; the hidden window and the app read a file, so
// they go to a temp one
async function stdinFile(argv, go) {
  if (!(argv[0] === 'batch' || (argv[0] === 'live' && argv[1] === 'batch')) || argv[2] !== '-') return go(argv);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sori-batch-')), file = path.join(dir, 'commands.txt');
  try {
    fs.writeFileSync(file, fs.readFileSync(0));
    return await go([...argv.slice(0, 2), file, ...argv.slice(3)]);
  } finally {
    // a leftover temp folder is harmless; a throw here would print a second result
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* kept */ }
  }
}

async function main(argv) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) return process.stdout.write(help());
  if (argv[0] === 'live') return out(await live(argv).catch(errOf));
  let job;
  try { job = V.parse(argv); } catch (e) { return out(errOf(e)); }
  if (job.verb.write) {
    const busy = await openInApp(job.pos[0]);
    if (busy) return out(busy);
  }
  const audio = job.verb.audio || (job.verb.name === 'batch' && require('./batch').needsAudio(job.pos[1]));
  out(audio ? await headless(argv) : await V.execute(argv));
}

stdinFile(process.argv.slice(2), main).catch((e) => out(errOf(e)));
