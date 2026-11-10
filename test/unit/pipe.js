// The real sori command line (a child process): it refuses to edit a project the app has open, and sends live
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

t('cli: refuses to edit a project the app has open; live requests go over the pipe', async () => {
  const pipe = require('../../src/cli/pipe');
  process.env.SORI_PIPE = 'sori-test-' + process.pid;
  const p = cp('단편.vproj'), got = [];
  let deadline;
  const srv = pipe.serve(async ({ deadline: d, ...req }) => {
    deadline = d; got.push(req);
    return { ok: true, app: { filePath: p, dirty: true } };
  });
  try {
    let r = await cli('track', 'add', '단편.vproj');
    assert.strictEqual(r.error, 'OPEN_IN_APP', JSON.stringify(r));
    assert.match(r.message, /unsaved changes/);
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
