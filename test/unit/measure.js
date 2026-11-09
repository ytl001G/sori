// sori measure: the numbers of a rendered piece (src/core/measure.js) and the command (src/cli/measure.js).
const fs = require('fs');
const { assert, t, sr, cp, run, fails } = require('./helpers');
const M = require('../../src/core/measure');

let seed = 7;
const room = (n) => Float32Array.from({ length: n }, () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return 0.001 * (seed / 1073741824 - 1);
});
const tone = (n) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 1000 * i / sr));
const join = (...xs) => { const o = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0;
  for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

t('measure: loudness, peak, places over 0 dBFS, room noise, quiet stretches', () => {
  const x = join(room(sr), tone(sr), room(sr), tone(sr / 2));
  x[Math.round(3.1 * sr)] = 1.5; x[Math.round(3.1 * sr) + 3] = -1.2; x[Math.round(3.3 * sr)] = 1.5;
  const m = M.measure([x, x], sr);
  assert.deepStrictEqual([m.seconds, m.clipped], [3.5, { count: 2, at: [3.1, 3.3] }]);
  near(m.peakDb, 3.5, 0.05, 'peak 1.5');
  assert(m.lufs > -20 && m.lufs < -8, 'lufs ' + m.lufs);
  assert(m.noiseDb < -55 && m.noiseDb > -75 && m.speechDb > -15, JSON.stringify(m));
  assert.strictEqual(m.quiet.length, 2, JSON.stringify(m.quiet));
  near(m.quiet[0].from, 0, 0.02, 'quiet 1 from'); near(m.quiet[0].to, 1, 0.02, 'quiet 1 to');
  near(m.quiet[1].from, 2, 0.02, 'quiet 2 from'); near(m.quiet[1].to, 3, 0.02, 'quiet 2 to');
  const z = M.measure([new Float32Array(sr)], sr);
  assert.deepStrictEqual([z.lufs, z.peakDb, z.noiseDb, z.clipped.count, z.quiet], [null, null, null, 0,
    [{ from: 0, to: 1 }]]);
});

t('cli measure: each track alone + the mix; --from/--to; a script project measures ★ takes', async () => {
  fs.writeFileSync(cp('m.wav'), 'x');
  await run('new', '잰.vproj');
  await run('import', '잰.vproj', 'm.wav');
  let r = await run('measure', '잰.vproj');
  assert.deepStrictEqual([r.tracks.length, r.tracks[0].track, r.tracks[0].seconds, r.tracks[0].peakDb, r.mix.seconds],
    [1, 1, 1, 0, 1]);
  r = await run('measure', '잰.vproj', '--track', '1', '--from', '0.5');
  assert(r.tracks[0].seconds === 0.5 && !r.mix, JSON.stringify(r));
  r = await run('measure', '잰.vproj', '--from', '2');
  assert(r.tracks[0].empty && r.mix.empty, JSON.stringify(r));
  await fails('BAD_ARG', 'measure', '잰.vproj', '--from', '0.5', '--to', '0.2');
  await fails('NOT_SCRIPT', 'measure', '잰.vproj', '--line', '철수-001');
  fs.writeFileSync(cp('m.txt'), '철수: 하나\n철수: 둘\n영희: 셋\n');
  await run('script', 'import', '잰대본.vproj', 'm.txt');
  await run('script', 'take', 'add', '잰대본.vproj', '--line', '철수-001', 'm.wav');
  r = await run('measure', '잰대본.vproj');
  assert.deepStrictEqual([r.lines.map((l) => [l.line, l.take, l.seconds]), r.skipped],
    [[['철수-001', '테이크 1', 1]], ['철수-002', '영희-001']]);
  r = await run('measure', '잰대본.vproj', '--char', '영희');
  assert.deepStrictEqual([r.lines, r.skipped], [[], ['영희-001']]);
  r = await run('measure', '잰대본.vproj', '--line', '철수-001', '--take', '1', '--to', '0.25');
  assert.deepStrictEqual(r.lines.map((l) => [l.take, l.seconds]), [['테이크 1', 0.25]]);
  await fails('BAD_ARG', 'measure', '잰대본.vproj', '--track', '1');
  await fails('BAD_ARG', 'measure', '잰대본.vproj', '--take', '1');
  await fails('NO_CHAR', 'measure', '잰대본.vproj', '--char', '캐릭터Z');
});
