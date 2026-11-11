// sori live: a file command run on the open project, and requests over the pipe.
const { assert, t, cliDir, cp } = require('./helpers');

t('cli: sori live runs a file command on the open project object: no <project>, nothing saved', async () => {
  const fs = require('fs'), V = require('../../src/cli/verbs'), ST = require('../../src/core/state');
  const p = ST.state.project = ST.newProjectData(48000);
  p.tracks = [ST.makeTrack()];
  const files = fs.readdirSync(cliDir).length, on = { cwd: cliDir, on: p };
  const r = await V.execute(['track', 'set', '--track', '1', '--volume', '-6'], on);
  assert(r.ok && Math.abs(p.tracks[0].gain - 10 ** (-6 / 20)) < 1e-9, JSON.stringify(r));
  assert.strictEqual(fs.readdirSync(cliDir).length, files, 'nothing written');
  let x = await V.execute(['track', 'set', 'a.vproj', '--track', '1', '--volume', '0'], on);
  assert(x.error === 'BAD_ARG' && /no <project>/.test(x.message)
    && /^sori live track set --track N\|NAME/.test(x.usage), JSON.stringify(x));
  x = await V.execute(['new'], on);
  assert(x.error === 'USE_APP_COMMAND' && /run newProject/.test(x.message), JSON.stringify(x));
  x = await V.execute(['script', 'info'], on); assert.strictEqual(x.error, 'NOT_SCRIPT');
  // 대본 넣기 on the open project: converted in place; again: the app's characters are not touched before it takes
  // the copy
  fs.writeFileSync(cp('live.txt'), '철수: 하나\n');
  x = await V.execute(['script', 'import', 'live.txt'], on);
  assert(x.ok && x.action === 'converted' && p.script && p.tracks.length === 0, JSON.stringify(x));
  const chars = p.script.chars, copy = { ...p, script: { ...p.script } };
  fs.writeFileSync(cp('live2.txt'), '철수: 하나\n캐릭터Z: 둘\n');
  x = await V.execute(['script', 'import', 'live2.txt'], { cwd: cliDir, on: copy });
  assert(x.ok && x.action === 'updated' && !Object.hasOwn(chars, '캐릭터Z') && Object.hasOwn(copy.script.chars, '캐릭터Z'),
    JSON.stringify(x));
});
