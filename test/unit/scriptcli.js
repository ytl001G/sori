// sori script follows the script-mode rules. The checks build one script project (s.vproj) step by step, in order;
// 단편.vproj comes from cli.js.
const { assert, t, cp, run, fails } = require('./helpers');

const S = 's.vproj';
const info = () => run('script', 'info', S);
const takes = (i) => i.lines[0].takes.map((x) => x.name + (x.star ? '★' : '')).join();
const L1 = ['--line', '철수-001'];

t('cli script: import creates a project or converts a plain one (dry run first), info', async () => {
  const fs = require('fs');
  fs.writeFileSync(cp('대본.txt'), '철수: 안녕\n영희-005: 반가워 (웃으며)\n철수: 둘째\n');
  fs.writeFileSync(cp('t.wav'), 'x');
  const made = await run('script', 'import', S, '대본.txt');
  assert.deepStrictEqual([made.action, made.lines, made.characters], ['created', 3, ['철수', '영희']]);
  await fails('SCRIPT_PROJECT', 'info', S);
  await fails('SCRIPT_PROJECT', 'track', 'sort', S); // its takes keep their order
  fs.copyFileSync(cp('단편.vproj'), cp('plain.vproj'));
  const count = async () => (await run('info', 'plain.vproj')).tracks.length, before = await count();
  const conv = await run('script', 'import', 'plain.vproj', '대본.txt', '--dry-run');
  assert.deepStrictEqual([conv.action, conv.deletedTracks, await count()], ['converted', before, before],
    'dry run: told, nothing changed');
  await run('script', 'import', 'plain.vproj', '대본.txt');
  const pi = await run('script', 'info', 'plain.vproj');
  assert.deepStrictEqual([pi.lines.length, pi.lines.every((l) => !l.takes.length)], [3, true],
    'a plain project became a script project, its tracks gone');
  await fails('NOT_SCRIPT', 'script', 'info', '단편.vproj');
  const i = await info();
  assert.deepStrictEqual([i.lines.map((l) => l.name), i.lines[1].memo, i.current],
    [['철수-001', '영희-005', '철수-002'], '웃으며', '철수-001']);
});

t('cli script: takes: add, remove, ★, take values, names', async () => {
  await run('script', 'take', 'add', S, ...L1, 't.wav', 't.wav', 't.wav');
  assert.strictEqual(takes(await info()), '테이크 1★,테이크 2,테이크 3', 'the first new take of a line without ★ gets it');
  await run('script', 'take', 'remove', S, ...L1, '--take', '2');
  await fails('NO_TAKE', 'script', 'star', S, ...L1, '--take', '2');
  await run('script', 'star', S, ...L1, '--take', '3');
  const r = await run('script', 'take', 'set', S, ...L1, '--take', '3', '--volume', '-6', '--pan', '0.5');
  assert.deepStrictEqual([r.take.name, r.take.volumeDb, r.take.pan], ['테이크 3', -6, 0.5], 'take header values');
  await fails('BAD_ARG', 'script', 'take', 'set', S, ...L1, '--take', '3');
  await run('script', 'take', 'add', S, ...L1, 't.wav');
  assert.strictEqual(takes(await info()), '테이크 1,테이크 3★,테이크 4', 'names stay, the next one after the highest, ★ stays');
  await run('script', 'take', 'remove', S, ...L1, '--take', '테이크 3');
  assert.strictEqual(takes(await info()), '테이크 1,테이크 4', 'removing ★ leaves none');
});

t('cli script: new text -> redo, export lists it, ★ again clears it; character effects and color', async () => {
  await run('script', 'star', S, ...L1, '--take', '4');
  await run('script', 'line', 'set', S, ...L1, '--text', '안녕하세요');
  let i = await info();
  assert.deepStrictEqual([i.lines[0].state, i.lines[0].done, i.progress], ['redo', false, { done: 0, lines: 3 }],
    'recorded + new text -> redo');
  const ex = await run('script', 'export', S, '납품', ...L1);
  assert.deepStrictEqual([ex.files.length, ex.redo], [1, ['철수-001']], 'a redo line with ★ is exported and listed');
  await run('script', 'star', S, ...L1, '--take', '4');
  i = await info();
  assert.deepStrictEqual([i.lines[0].state, i.progress.done], [null, 1], 'picking ★ again clears redo');
  await fails('NO_LINE', 'script', 'star', S, '--line', '철수-9', '--take', '1');
  await fails('BAD_ARG', 'script', 'line', 'set', S, ...L1, '--text', 'x'.repeat(1001));
  await run('script', 'fx', S, '--char', '철수', 'eq', '--low', '4');
  i = await info(); assert(i.characters[0].fx.eq.on && i.characters[0].fx.eq.low === 4, 'character eq');
  await fails('NO_CHAR', 'script', 'fx', S, '--char', '캐릭터Z', 'eq', '--on');
  await run('script', 'color', S, '--char', '철수', '--color', 'f472b6');
  i = await info(); assert.strictEqual(i.characters[0].color, '#F472B6', 'character color, upper case');
  await fails('BAD_ARG', 'script', 'color', S, '--char', '철수', '--color', 'F4B');
});

t('cli script: re-import (dry run, a gone line takes its take), export, unscript', async () => {
  const fs = require('fs'), path = require('path');
  fs.writeFileSync(cp('대본2.txt'), '철수: 안녕하세요\n영희-005: 반가워\n영희: 새 대사\n');
  await run('script', 'take', 'add', S, '--line', '철수-002', 't.wav');
  let i = await info();
  const dry = await run('script', 'import', S, '대본2.txt', '--dry-run');
  assert.deepStrictEqual([dry.action, dry.counts, dry.added, dry.changed, dry.gone],
    ['updated', { added: 1, changed: 0, gone: 1, goneTakes: 1, same: 2 }, ['영희-006'], [], ['철수-002']]);
  assert.strictEqual(JSON.stringify(await info()), JSON.stringify(i), 'a dry run changes nothing');
  await run('script', 'import', S, '대본2.txt');
  i = await info();
  assert.deepStrictEqual([i.lines.map((l) => l.name), i.lines[1].memo], [['철수-001', '영희-005', '영희-006'], ''],
    'a missing line goes with its take, memo updated');
  const out = await run('script', 'export', S, '납품'); // every line: a folder per character
  const rel = (f) => path.relative(cp('.'), f).split(path.sep).slice(-2).join('/');
  assert.deepStrictEqual([out.files.map((f) => [rel(f.file), f.take, f.seconds]), out.skipped],
    [[['철수/철수-001.wav', '테이크 4', 1]], ['영희-005', '영희-006']]);
  assert(fs.existsSync(cp(path.join('납품', '철수', '철수-001.wav'))), 'file written');
  await fails('EXISTS', 'script', 'export', S, '납품'); // it is there now: the app would ask first
  await run('script', 'export', S, '납품', '--overwrite');
  await fails('NOTHING_TO_EXPORT', 'script', 'export', S, '납품', '--char', '영희');
  await run('script', 'take', 'add', S, '--line', '영희-005', 't.wav');
  const two = await run('script', 'export', S, '납품2', '--char', '철수, 영희'); // several characters
  assert.deepStrictEqual(two.files.map((f) => rel(f.file)), ['철수/철수-001.wav', '영희/영희-005.wav']);
  await fails('NO_CHAR', 'script', 'export', S, '납품3', '--char', '철수,캐릭터Z');
  await fails('BAD_ARG', 'script', 'export', S, '납품3', '--char', ',');
  const un = await run('script', 'unscript', S, '--dry-run');
  assert.deepStrictEqual(un.tracks, ['철수-001 테이크 1', '철수-001 테이크 4', '영희-005 테이크 1']);
  await run('script', 'unscript', S);
  const plain = await run('info', S);
  assert.deepStrictEqual([plain.tracks.map((x) => x.name), plain.tracks[0].fx.eq.low, plain.tracks[0].color],
    [un.tracks, 4, '#F472B6'], 'plain again: takes are tracks with the character color and effects');
  await fails('NOT_SCRIPT', 'script', 'unscript', S);
});

t('cli script: text numbers (1-01) survive save and load, and name lines in commands', async () => {
  require('fs').writeFileSync(cp('n.csv'), '번호,화자,대사\n1-01,캐릭터C,하나\n1-02,캐릭터C,둘 (작게)\n');
  await run('script', 'import', 'n.vproj', 'n.csv');
  const i = await run('script', 'info', 'n.vproj');
  assert.deepStrictEqual(i.lines.map((l) => [l.name, l.num, l.memo]),
    [['캐릭터C-1-01', '1-01', ''], ['캐릭터C-1-02', '1-02', '작게']]);
  const r = await run('script', 'line', 'set', 'n.vproj', '--line', '캐릭터C-1-02', '--text', '셋');
  assert.strictEqual(r.line.text, '셋');
});
