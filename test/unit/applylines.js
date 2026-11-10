// apply 목소리 정리 on several lines' ★ takes (src/cli/apply.js applyLines): worked out on other CPUs (core/workers.js),
// put in exactly as one `apply --line L --take ★` per line would.
const fs = require('fs');
const { assert, E, IO, t, sine, sr, cp, run, fails } = require('./helpers');
const SCR = require('../../src/core/script');
const B = require('../../src/cli/batch');

// speech, 2 s of soft room noise, speech: voiceGaps cuts the pause
function talk(seed) {
  let x = seed;
  const noise = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.004;
  const ch = new Float32Array(sr * 4);
  const voice = sine(sr / 2, 180 + seed, sr, 0.3);
  ch.forEach((_, i) => { ch[i] = noise(); });
  ch.set(voice.map((v, i) => v + ch[i]), sr / 2);
  ch.set(voice.map((v, i) => v + ch[i + sr * 3]), sr * 3);
  return E.makeSource([ch]);
}
function save(name) {
  const { lines } = SCR.fromTxt('철수: 하나\n철수: 둘\n영희: 셋\n');
  const take = (n, seed) => ({ id: E.uid('t'), name: '테이크 ' + n, clips: [E.makeClip(talk(seed), 0, 'a')] });
  lines[0].takes = [take(1, 1), take(2, 2)]; lines[0].star = lines[0].takes[1].id; // ★ = 테이크 2
  lines[1].takes = [take(1, 3)]; // no ★
  lines[2].takes = [take(1, 4)]; lines[2].star = lines[2].takes[0].id;
  const p = { sampleRate: sr, tracks: lines[0].takes, script: { lines, lineId: lines[0].id, chars: {} } };
  fs.writeFileSync(cp(name), IO.saveProject(p));
}
const takeSound = (name, line, take) => {
  const p = IO.loadProject(fs.readFileSync(cp(name))), l = p.script.lines.find((x) => SCR.lineName(x) === line);
  return E.renderRegion(l.takes.find((x) => x.name === take).clips, 0, E.projectEnd(l.takes))[0];
};

t('apply on several lines: ★ takes only, the same sound as one line at a time, lines without ★ listed', async () => {
  save('many.vproj'); save('one.vproj');
  const r = await run('apply', 'many.vproj', 'voiceGaps', '--char', '철수', '--level', 'mid');
  assert.deepStrictEqual([r.changed, r.lines.map((x) => [x.line, x.take]), r.noStar],
    [1, [['철수-001', '테이크 2']], ['철수-002']]);
  assert(r.lines[0].newLength < 3 && r.lines[0].cuts > 0, JSON.stringify(r.lines[0]));
  await run('apply', 'one.vproj', 'voiceGaps', '--line', '철수-001', '--take', '2', '--level', 'mid');
  const a = takeSound('many.vproj', '철수-001', '테이크 2'), b = takeSound('one.vproj', '철수-001', '테이크 2');
  assert(a.length === b.length && a.every((v, i) => v === b[i]), 'the same as the one-line command');
  assert.strictEqual(takeSound('many.vproj', '철수-001', '테이크 1').length, sr * 4, 'other takes untouched');
  assert.strictEqual(takeSound('many.vproj', '영희-001', '테이크 1').length, sr * 4, 'other characters untouched');
  const all = await run('apply', 'many.vproj', 'voiceClean', '--all-lines');
  assert.deepStrictEqual(all.lines.map((x) => x.line), ['철수-001', '영희-001']);
  const two = await run('apply', 'one.vproj', 'voiceLoud', '--line', '영희-001, 철수-002');
  assert.deepStrictEqual([two.lines.map((x) => x.line), two.noStar], [['영희-001'], ['철수-002']]);
});

t('apply on several lines: refused shapes; batch reads what it touches', async () => {
  await fails('BAD_ARG', 'apply', 'many.vproj', 'fxGain', '--char', '철수');
  await fails('BAD_ARG', 'apply', 'many.vproj', 'voiceGaps', '--char', '철수', '--take', '1');
  await fails('BAD_ARG', 'apply', 'many.vproj', 'voiceGaps', '--all-lines', '--from', '0', '--to', '1');
  await fails('BAD_ARG', 'apply', 'many.vproj', 'voiceGaps', '--all-lines', '--char', '철수');
  await fails('NO_LINE', 'apply', 'many.vproj', 'voiceGaps', '--line', '철수-001,철수-009');
  await fails('NO_CHAR', 'apply', 'many.vproj', 'voiceGaps', '--char', '캐릭터Z');
  await run('new', 'lines-flat.vproj');
  await fails('NOT_SCRIPT', 'apply', 'lines-flat.vproj', 'voiceGaps', '--all-lines');
  const of = (s, fx) => B.touches('apply', s, () => '철수', fx);
  assert.deepStrictEqual([of({ char: '철수,영희' }), of({ line: '철수-001,영희-001' }), of({ 'all-lines': true })],
    [['character 철수', 'character 영희'], ['line 철수-001', 'line 영희-001'], ['all']]);
  // fxTempo / 긴 침묵 줄이기 move markers: never in a wave with a marker command
  assert.deepStrictEqual([B.touches('apply', { track: [1] }, () => null, 'fxTempo'),
    of({ line: '철수-001' }, 'voiceGaps'), B.touches('apply', { track: [1] }, () => null, 'fxGain')],
  [['track 1', 'markers'], ['line 철수-001', 'markers'], ['track 1']]);
  // split fills the lines after --line too
  assert.deepStrictEqual(B.touches('script split', { line: '철수-001' }, () => '철수'), ['all']);
});

t('workers: a job that throws rejects, and the next jobs still run', async () => {
  const W = require('../../src/core/workers');
  for (let i = 0; i < W.WORKERS + 1; i++) await assert.rejects(W.run('fs', 'readFileSync', ['x']), /not a worker/);
  const ch = [new Float32Array(48000).fill(0.25)];
  const r = await W.run('audiopack', 'pack', [ch]);
  assert(r instanceof Uint8Array && require('../../src/core/audiopack').unpack(r, 1, 48000)[0][9] === 0.25);
});
