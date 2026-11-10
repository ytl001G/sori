// Track verbs on a script project's takes: --line NAME picks the lanes, --take / --to-take stand for
// --track / --to-track, replies name takes. One project (k.vproj), built step by step.
const fs = require('fs');
const { assert, t, cp, run, fails } = require('./helpers');

const K = 'k.vproj', L = ['--line', '철수-001'], Y = ['--line', '영희-001'];
const line = async (n = 0) => (await run('script', 'info', K)).lines[n];
const clips = (l) => l.takes.map((x) => x.name + ':' + x.clips.map((c) => c.start + '-' + c.end).join('/')).join(' ');

t('cli takes: clip and range verbs on one line\'s takes, replies name takes, script info has take clips', async () => {
  fs.writeFileSync(cp('k.txt'), '철수: 하나\n영희: 둘\n');
  fs.writeFileSync(cp('k.wav'), 'x'); // the fake decode gives 1 s
  await run('script', 'import', K, 'k.txt');
  await run('script', 'take', 'add', K, ...L, 'k.wav', 'k.wav');
  let r = await run('clip', 'split', K, ...L, '--take', '2', '--at', '0.5');
  assert.deepStrictEqual([r.line.name, r.split], ['철수-001', ['테이크 2']], 'the reply names the take');
  assert.strictEqual(clips(await line()), '테이크 1:0-1 테이크 2:0-0.5/0.5-1');
  r = await run('clip', 'move', K, ...L, '--take', '2', '--clip', '2', '--to-take', '1', '--to', '2');
  assert.deepStrictEqual([r.clip.take, r.clip.clip, r.clip.start], ['테이크 1', 2, 2], 'moved to another take');
  r = await run('range', 'delete', K, ...L, '--from', '0', '--to', '0.25');
  assert.deepStrictEqual(r.deleted.takes, ['테이크 1', '테이크 2'], 'no --take: every take of the line');
  assert.strictEqual(clips(await line()), '테이크 1:0-0.75/1.75-2.25 테이크 2:0-0.25');
  await run('clip', 'merge', K, ...L, '--take', '1');
  await run('range', 'insert', K, ...L, '--take', '2', '--at', '0', '--length', '0.5');
  r = await run('clip', 'set', K, ...L, '--take', '테이크 2', '--clip', '1', '--fade-in', '0.1');
  assert.deepStrictEqual([r.clip.take, r.clip.fadeIn], ['테이크 2', 0.1], 'a take by its name');
  await run('range', 'keep', K, ...L, '--take', '1', '--from', '0', '--to', '1');
  await run('clip', 'trim', K, ...L, '--take', '1', '--clip', '1', '--end', '0.5');
  assert.strictEqual(clips(await line()), '테이크 1:0-0.5 테이크 2:0.5-0.75');
  await run('clip', 'delete', K, ...L, '--take', '2', '--clip', '1');
  const l = await line();
  assert.deepStrictEqual([clips(l), l.star, (await line(1)).takes.length], ['테이크 1:0-0.5 테이크 2:', '테이크 1', 0],
    'the other line is untouched');
});

t('cli takes: import onto a take or as new takes (★ rule), apply, fx = the character\'s, markers, tempo', async () => {
  await fails('NOTHING_TO_DO', 'apply', K, 'fxGain', ...Y);
  let r = await run('import', K, 'k.wav', ...Y);
  assert.deepStrictEqual([r.imported[0].take, r.line.star], ['테이크 1', '테이크 1'], 'a new take; no ★ yet: it gets ★');
  await run('import', K, 'k.wav', 'k.wav', ...Y, '--take', '1', '--at', '2');
  assert.strictEqual(clips(await line(1)), '테이크 1:0-1/2-3 테이크 2:0-1', 'onto take 1 at 2 s, the next file a new take');
  r = await run('apply', K, 'fxGain', ...Y, '--take', '1,2', '--from', '0', '--to', '0.5', '--db', '6');
  assert.deepStrictEqual(r.changed.map((x) => x.take), ['테이크 1', '테이크 2'], 'apply names takes');
  r = await run('fx', K, ...Y, '--take', '2', 'eq', '--low', '3');
  const info = await run('script', 'info', K), ch = info.characters.find((x) => x.name === '영희');
  assert.deepStrictEqual([r.char, ch.fx.eq.low, ch.fx.eq.on], ['영희', 3, true], 'a take\'s effect is its character\'s');
  await run('fx', K, '--master', 'limiter', '--on');
  await run('marker', 'add', K, '--at', '1');
  await run('tempo', K, '--bpm', '100');
  await run('script', 'take', 'move', K, ...Y, '--take', '2', '--to', '1');
  assert.strictEqual(clips(await line(1)), '테이크 2:0-0.5/0.5-1 테이크 1:0-0.5/0.5-1/2-3',
    'take move: order like the grip drag (apply split the clips at 0.5 s)');
});

t('cli takes: refused where takes have no such thing, wrong names, flags of the other kind of project', async () => {
  await fails('BAD_ARG', 'clip', 'split', K, '--at', '0.5'); // which line?
  await fails('BAD_ARG', 'clip', 'split', K, ...L, '--track', '1', '--at', '0.5');
  await fails('NO_TAKE', 'clip', 'split', K, ...L, '--take', '9', '--at', '0.5');
  await fails('NO_LINE', 'clip', 'split', K, '--line', '캐릭터Z-001', '--at', '0.5');
  await fails('BAD_ARG', 'clip', 'delete', K, ...L, '--clip', '1');
  const r = await fails('NO_CLIP', 'clip', 'delete', K, ...L, '--take', '1', '--clip', '9');
  assert(/테이크 1 has no clip 9/.test(r.message), 'messages name the take: ' + r.message);
  for (const argv of [['track', 'add', K], ['track', 'set', K, '--track', '1', '--mute', 'on'], ['info', K]]) {
    const e = await fails('SCRIPT_PROJECT', ...argv);
    assert(/script (take|info)/.test(e.message), argv.join(' ') + ' names its script command: ' + e.message);
  }
  await fails('NOT_SCRIPT', 'clip', 'split', '단편.vproj', ...L, '--at', '0.5');
  await fails('BAD_ARG', 'fx', K, '--master', ...L, '--take', '1', 'eq', '--on'); // like --track with --master
  // nothing to change: the message names only flags the command takes
  const { VERBS } = require('../../src/cli/verbs');
  for (const [v, argv] of [['track set', ['track', 'set', '단편.vproj', '--track', '1']],
    ['script take set', ['script', 'take', 'set', K, ...L, '--take', '1']]]) {
    const named = (await fails('BAD_ARG', ...argv)).message.match(/--[a-z-]+/g);
    const flags = VERBS.find((x) => x.name === v).flags;
    assert(named.every((f) => f.slice(2) in flags), `${v} names a flag it does not take: ${named}`);
  }
});
t('cli: a take named exactly like the ref comes first, else 2 means 테이크 2', () => {
  const { takeByRef } = require('../../src/cli/project');
  const takes = [{ name: '테이크 2' }, { name: '2' }, { name: '테이크 3' }];
  assert.strictEqual(takeByRef(takes, ' 2 '), takes[1], 'exact name first');
  assert.strictEqual(takeByRef(takes, '3'), takes[2], 'no exact name: 3 = 테이크 3');
  assert.strictEqual(takeByRef(takes, '4'), undefined);
});
