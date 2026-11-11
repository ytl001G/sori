// The real sori command line (a child process): an edit of a project the app has open runs there, and live
// requests over the pipe. Needs 단편.vproj from cli.js.
const path = require('path');
const { execFile } = require('child_process');
const { assert, t, cliDir, cp } = require('./helpers');

const SORI = path.join(__dirname, '../../src/cli/sori.js');
// output that is not JSON (a crash) fails this check, not the whole run with an uncaught throw in the callback
const cli = (...argv) => new Promise((res, rej) => execFile(process.execPath, [SORI, ...argv],
  { cwd: cliDir, env: process.env }, (e, out, err) => {
    try { res(JSON.parse(out)); } catch { rej(new Error(`sori ${argv.join(' ')}: ${err || e}`)); }
  }));

t('cli: an edit of a project the app has open runs there (sori live); live requests go over the pipe', async () => {
  const pipe = require('../../src/cli/pipe');
  process.env.SORI_PIPE = 'sori-test-' + process.pid;
  const p = cp('단편.vproj'), got = [];
  let deadline;
  const srv = pipe.serve(async ({ deadline: d, ...req }) => {
    deadline = d; got.push(req);
    return { ok: true, app: { filePath: p, dirty: true } };
  });
  try {
    let r = await cli('track', 'add', '--type', 'voice', '단편.vproj');
    assert(r.ok && r.inApp && r.saved === false && /unsaved changes/.test(r.note), JSON.stringify(r));
    assert.deepStrictEqual(got.at(-1), { op: 'verb', argv: ['track', 'add', '--type', 'voice'], cwd: cliDir },
      'the same command, without the project file');
    r = await cli('info', '단편.vproj'); // reading is fine
    assert(r.ok);
    r = await cli('new', 'other.vproj');
    assert(r.ok, JSON.stringify(r));
    await cli('live', 'run', 'fxNormalize', '--db=-1', '--preset', 'x');
    assert.deepStrictEqual(got.at(-1), { op: 'run', name: 'fxNormalize', args: { db: '-1', preset: 'x' } });
    assert(deadline > Date.now(), 'each request carries the time the CLI stops waiting');
    await cli('live', 'select', '--from', '1', '--to', '2', '--track', '1,2', '--clip', '1:1');
    assert.deepStrictEqual(got.at(-1), { op: 'select', from: 1, to: 2, track: [1, 2], clip: [[1, 1]] });
    r = await cli('live', 'run', 'split', 'extra');
    assert.strictEqual(r.error, 'BAD_ARG');
  } finally { srv.close(); }
  const r = await cli('live', 'state');
  assert.strictEqual(r.error, 'NO_APP', JSON.stringify(r));
});
t('cli: help for one command or a group, a guess at a mistyped one; "help" as a value is a value', async () => {
  const text = (...argv) => new Promise((res) => execFile(process.execPath, [SORI, ...argv], { cwd: cliDir },
    (e, out) => res(out)));
  assert.match(await text('help', 'export'), /^sori export <project> .*\n {4}render like 내보내기/);
  assert.match(await text('clip', 'move', '--help'), /^sori clip move <project> --track N\|NAME/);
  const group = await text('help', 'marker');
  assert(['marker add', 'marker remove', 'marker set'].every((n) => group.includes('sori ' + n)), group);
  assert.match(await text('help', 'script', 'line'), /^sori script line set /, 'the file command, not the live one');
  assert.match(await text('help', 'find'), /^sori live find /, 'a live-only command');
  let r = await cli('help', 'expor');
  assert(r.error === 'UNKNOWN_COMMAND' && /did you mean "export"/.test(r.message), JSON.stringify(r));
  r = await cli('state');
  assert(r.error === 'UNKNOWN_COMMAND' && /did you mean "live state"/.test(r.message), JSON.stringify(r));
  await cli('new', 'h.vproj');
  const m = await cli('marker', 'add', 'h.vproj', '--at', '1:02', '--name', 'help');
  assert(m.ok && m.marker.name === 'help' && m.marker.at === 62, JSON.stringify(m));
});

t('pipe: the app serves a random name and writes it down for the CLI; nothing written: no name', async () => {
  const pipe = require('../../src/cli/pipe'), fs = require('fs'), was = process.env.SORI_PIPE;
  const file = path.join(cliDir, 'pipe-name', 'live-pipe');
  delete process.env.SORI_PIPE;
  try {
    assert.strictEqual(pipe.name(file), null, 'no app yet'); // (never a request to the default: the user's own app)
    const srv = pipe.serve(async (req) => ({ ok: true, op: req.op }), file);
    await new Promise((r) => srv.once('listening', r));
    const id = fs.readFileSync(file, 'utf8');
    assert(/^sori-live-[0-9a-f]{32}$/.test(id), 'not a random name: ' + id);
    process.env.SORI_PIPE = id; // the CLI side, as it reads the name from the file
    try { assert.deepStrictEqual(await pipe.request({ op: 'state' }, 3000), { ok: true, op: 'state' }); }
    finally { srv.close(); }
  } finally { if (was === undefined) delete process.env.SORI_PIPE; else process.env.SORI_PIPE = was; }
});
