// CLI argument parsing and field filling (src/core/args.js).
const { assert, t } = require('./helpers');

const A = require('../../src/core/args');
t('args: typed flags, --k=v, negative numbers, open fields, errors', () => {
  const spec = { track: 'idxs', at: 'sec', volume: 'num', type: ['voice', 'sfx'], rate: [44100, 48000], master: 'bool',
    mute: 'onoff', clip: 'pairs' };
  const r = A.parse(['p.vproj', '--track', '2,3', '--at=1.5', '--volume', '-6', '--type', 'voice', '--rate', '48000',
    '--master', 'eq', '--mute', 'off', '--clip', '2:1,3:4', '--low', '-3'], spec, true);
  assert.deepStrictEqual(r.pos, ['p.vproj', 'eq']);
  assert.deepStrictEqual({ ...r.o },
    { track: [2, 3], at: 1.5, volume: -6, type: 'voice', rate: 48000, master: true, mute: false, clip:
      [[2, 1], [3, 4]] });
  assert.deepStrictEqual({ ...r.fields }, { low: '-3' });
  const err = (tokens, re) =>
    assert.throws(() => A.parse(tokens, spec), (e) => e.code === 'BAD_ARG' && re.test(e.message));
  err(['--nope', '1'], /unknown option --nope/);
  err(['--at', '-1'], /seconds >= 0/);
  err(['--track', '0'], /from 1/);
  err(['--type', 'drums'], /one of: voice, sfx/);
  err(['--at'], /needs a value/);
  err(['--at', '--master'], /needs a value/);
  err(['--master=1'], /takes no value/);
  err(['--at', '86401'], /at most 86400/);
  err(['--at', ' '], /needs a number/);
  assert.strictEqual(A.parse(['--at', ' 86400 '], spec).o.at, 86400, 'trimmed, 24 h is allowed');
  assert.deepStrictEqual(A.parse(['--path', 'a', '--path', 'b'], { path: 'strs' }).o.path, ['a', 'b'], 'strs repeats');
});
t('args: fill clamps to field ranges, applies presets, checks options and names', () => {
  const P = require('../../src/core/fxparams');
  const v = A.fill(P.FIELDS.eq, P.PRESETS.eq, { low: '-99', midFreq: '2000' }, '라디오 느낌');
  assert.deepStrictEqual([v.low, v.midFreq, v.lowcut, v.highcut], [-15, 2000, 400, 4000]);
  assert.strictEqual(A.fill([{ key: 'format', options: [{ value: 'wav16' }, { value: 'mp3_192' }] }], null,
    { format: 'mp3_192' }).format, 'mp3_192');
  assert.strictEqual(A.fill([{ key: 'name', text: true, value: '' }], null, { name: '  새 이름  ' }).name, '새 이름');
  assert.throws(() => A.fill(P.FIELDS.eq, P.PRESETS.eq, { bass: '1' }), /unknown option --bass; fields: lowcut/);
  assert.throws(() => A.fill(P.FIELDS.eq, P.PRESETS.eq, {}, '없음'), /unknown preset "없음"; presets: 목소리 또렷하게/);
  assert.throws(() => A.fill(P.FIELDS.eq, null, { low: 'abc' }), /--low needs a number/);
  assert.throws(() => A.fill([{ key: 'format', options: [{ value: 'wav16' }] }], null, { format: 'flac' }),
    /one of: wav16/);
  const chars = { key: 'chars', multi: true, value: ['철수'], options: [{ value: '철수' }, { value: '영희' }] };
  assert.deepStrictEqual(A.fill([chars], null, { chars: '영희, 철수,영희' }).chars, ['영희', '철수'], 'a list, once each');
  assert.throws(() => A.fill([chars], null, { chars: '철수,캐릭터Z' }), /comma-separated list of: 철수, 영희/);
});
