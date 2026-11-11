// sori batch: many commands on one project, checked first, run in order, saved only when all succeed
// (src/cli/batch.js).
const fs = require('fs');
const { assert, t, cliDir, cp, run, fails } = require('./helpers');
const B = require('../../src/cli/batch');

const P = '묶음.vproj';
const cmds = (name, ...lines) => { fs.writeFileSync(cp(name), lines.join('\r\n')); return name; };

t('batch: words keep quoted spaces and backslashes, drop a leading "sori live"', () => {
  assert.deepStrictEqual(B.words('sori live import "C:\\a b\\x.wav" --at 1'),
    ['import', 'C:\\a b\\x.wav', '--at', '1']);
  assert.deepStrictEqual(B.words('track set --track 1 --name=\'보컬 1\''),
    ['track', 'set', '--track', '1', '--name=보컬 1']);
  assert.throws(() => B.words('track add --name "열림'), /not closed/);
});

t('batch: runs in order and saves once; waves; --check changes nothing', async () => {
  await run('new', P);
  const f = cmds('a.txt', '# notes and blank lines are skipped', '', 'track add --name "보컬 1"', 'track add',
    'track set --track 2 --volume -6', 'fx --track 1 eq --preset "목소리 또렷하게"', 'marker add --at 1');
  const before = fs.readFileSync(cp(P));
  const ck = await run('batch', P, f, '--check');
  assert.deepStrictEqual([ck.dryRun, ck.commands.map((k) => k.line), ck.waves], [true, [3, 4, 5, 6, 7],
    [[3], [4], [5, 6, 7]]]);
  assert.deepStrictEqual(ck.commands.map((k) => k.touches), [['all'], ['all'], ['track 2'], ['track 1'], ['markers']]);
  assert(fs.readFileSync(cp(P)).equals(before), '--check saves nothing');
  const r = await run('batch', P, f);
  assert.deepStrictEqual(r.commands.map((k) => k.line), [3, 4, 5, 6, 7]);
  assert.strictEqual(r.commands[1].result.track.name, '트랙 2');
  const p = await run('info', P);
  assert.deepStrictEqual([p.tracks.map((x) => x.name), p.tracks[1].volumeDb, p.markers.length],
    [['보컬 1', '트랙 2'], -6, 1]);
});

t('batch: a track by name touches that track, as its number does; one an earlier line adds: all', async () => {
  const f = cmds('n.txt', 'track set --track "보컬 1" --volume -3', 'track set --track 1 --pan 0.5',
    'track set --track "트랙 2" --volume -1', 'track add --name 새트랙', 'track set --track 새트랙 --volume -2');
  const ck = await run('batch', P, f, '--check');
  assert.deepStrictEqual(ck.commands.map((k) => k.touches),
    [['track 1'], ['track 1'], ['track 2'], ['all'], ['all']]);
  assert.deepStrictEqual(ck.waves, [[1, 3], [2], [4], [5]], 'a track by name and by number: one after the other');
  await run('batch', P, f);
  const p = await run('info', P);
  assert.deepStrictEqual(p.tracks.map((x) => [x.name, x.volumeDb]), [['보컬 1', -3], ['트랙 2', -1], ['새트랙', -2]]);
});

t('batch: a failing line (or a bad one, or export) saves nothing and names the line', async () => {
  const before = fs.readFileSync(cp(P));
  let r = await fails('NO_TRACK', 'batch', P, cmds('b.txt', 'track add', 'track set --track 9 --volume 0'));
  assert(r.line === 2 && /^line 2 \(track set --track 9/.test(r.message) && /nothing was saved/.test(r.message),
    JSON.stringify(r));
  r = await fails('UNKNOWN_COMMAND', 'batch', P, cmds('c.txt', 'track add', 'trak add'));
  assert.strictEqual(r.line, 2);
  r = await fails('BAD_ARG', 'batch', P, cmds('d.txt', 'track add', 'export out.wav'));
  assert(r.line === 2 && /after the batch/.test(r.message), JSON.stringify(r));
  await fails('BAD_ARG', 'batch', P, cmds('e.txt', '# only a note'));
  await fails('NO_FILE', 'batch', P, 'missing.txt');
  assert(fs.readFileSync(cp(P)).equals(before), 'nothing saved');
});

t('batch: script lines of different characters share a wave; a character\'s effects wait for its lines', async () => {
  fs.writeFileSync(cp('s.txt'), '철수: 하나\n철수: 둘\n영희: 셋\n');
  await run('script', 'import', '대본묶음.vproj', 's.txt');
  const f = cmds('f.txt', 'script line set --line 철수-001 --memo a', 'script line set --line 영희-001 --memo b',
    'script fx --char 철수 eq --on', 'script line set --line 철수-002 --memo c', 'fx --line 영희-001 --take 1 eq --on');
  const r = await run('batch', '대본묶음.vproj', f, '--check');
  assert.deepStrictEqual(r.waves, [[1, 2], [3, 5], [4]]);
  assert.deepStrictEqual(r.commands[4].touches, ['line 영희-001', 'character 영희']);
});

t('batch on the open project (sori live): one copy, new tracks numbered against it, nothing written', async () => {
  const V = require('../../src/cli/verbs'), ST = require('../../src/core/state');
  const p = ST.state.project = ST.newProjectData(48000);
  p.tracks = [ST.makeTrack()];
  const g = cmds('g.txt', 'track add', 'track add'), copy = { ...p }, files = fs.readdirSync(cliDir).length;
  const r = await V.execute(['batch', g], { cwd: cliDir, on: copy });
  assert(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([copy.tracks.map((x) => x.name), p.tracks.length], [['트랙 1', '트랙 2', '트랙 3'], 1]);
  assert.strictEqual(fs.readdirSync(cliDir).length, files, 'nothing written');
  const x = await V.execute(['batch', cmds('h.txt', 'track add', 'track remove --track 9')], { cwd: cliDir, on: p });
  assert(x.error === 'NO_TRACK' && /nothing was applied/.test(x.message), JSON.stringify(x));
});

t('batch: - reads the commands from stdin (the real CLI)', () => {
  const sori = require('path').join(__dirname, '../../src/cli/sori.js');
  const go = (...a) => require('child_process').spawnSync(process.execPath, [sori, ...a],
    { cwd: cliDir, input: 'track add --name "표준 입력"\n', encoding: 'utf8' });
  assert.strictEqual(go('new', 'stdin.vproj').status, 0);
  const r = go('batch', 'stdin.vproj', '-'), out = r.stdout.trim().split('\n');
  assert(r.status === 0 && out.length === 1 && JSON.parse(out[0]).commands[0].result.track.name === '표준 입력',
    r.stdout + r.stderr);
});
