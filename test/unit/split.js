// 긴 녹음 나누기: pieces, N cuts, boundaries, window edits and the plan (src/core/split.js).
const fs = require('fs');
const { assert, t, sr, cp, run, fails, audio } = require('./helpers');
const S = require('../../src/core/split');

let seed = 3;
const room = (s) => Float32Array.from({ length: Math.round(s * sr) }, () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return 0.001 * (seed / 1073741824 - 1);
});
const tone = (s) => Float32Array.from({ length: Math.round(s * sr) },
  (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / sr));
const join = (...xs) => { const o = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0;
  for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const near = (a, b, what) => assert(Math.abs(a - b) <= 0.02 * sr, `${what}: ${a / sr} vs ${b / sr}`);

// 1 s room, speech 1 s, 0.5 s pause, speech 1 s, 2 s pause, click 0.1 s, 2 s pause, speech 1 s, 1 s room
const x = join(room(1), tone(1), room(0.5), tone(1), room(2), tone(0.1), room(2), tone(1), room(1));
const len = x.length, sound = S.soundRuns([x], sr);

t('split: pieces join sound closer than the gap, skip short sound, keep 0.3 s each side', () => {
  const ps = S.pieces(sound, sr, 1, [], len);
  assert.strictEqual(ps.length, 2, JSON.stringify(ps.map((p) => [p.a / sr, p.b / sr])));
  near(ps[0].a, 0.7 * sr, 'first a'); near(ps[0].b, 3.8 * sr, 'first b');
  near(ps[1].a, 7.3 * sr, 'second a'); near(ps[1].b, 8.9 * sr, 'second b (to the end)');
  assert.strictEqual(S.pieces(sound, sr, 0.3, [], len).length, 3, 'a smaller gap splits the 0.5 s pause');
});

t('split: an N press snaps to the nearest quiet within 2 s, a boundary cuts and groups pieces', () => {
  near(S.snap(sound, 4.2 * sr, sr, len), 4.5 * sr, 'N after the line: middle of the quiet 3.5..5.5');
  near(S.snap(sound, 2.1 * sr, sr, len), 2.25 * sr, 'N while speaking: the 0.5 s pause');
  const mid = Math.round(2.5 * sr), lone = [[0, 10 * sr]];
  assert.strictEqual(S.snap(lone, mid, sr, 10 * sr), mid, 'no quiet near: where it was pressed');
  const bounds = [Math.round(2.25 * sr)], ps = S.pieces(sound, sr, 1, bounds, len);
  assert.deepStrictEqual(ps.map((p) => S.groupOf(bounds, p)), [0, 1, 1]);
  near(ps[0].b, 2.25 * sr, 'margin stops at the boundary'); near(ps[1].a, 2.25 * sr, 'next starts there');
  const far = [Math.round(4.5 * sr)], wide = S.pieces(sound, sr, 5, far, len); // a long gap never joins over a line
  assert.strictEqual(wide.length, 2, 'one piece per line');
  near(wide[0].b, 3.8 * sr, 'ends 0.3 s after its speech, not at the boundary');
  near(wide[1].a, 5.2 * sr, 'starts 0.3 s before its sound (the click joins: 2 s < the 5 s gap)');
});

t('split: merge keeps the quiet and drops inner boundaries; split, edges, picks, plan', () => {
  const bounds = S.everyPiece({ ps: S.pieces(sound, sr, 0.3, [], len), bounds: [] });
  let st = { ps: S.pieces(sound, sr, 0.3, bounds, len), bounds, picks: [] };
  assert.deepStrictEqual(st.ps.map((p) => S.groupOf(st.bounds, p)), [0, 1, 2]);
  st = S.merge(st, 0, 1);
  assert.deepStrictEqual([st.ps.length, st.bounds.length], [2, 1]);
  near(st.ps[0].a, 0.7 * sr, 'merged a'); near(st.ps[0].b, 3.8 * sr, 'merged b, the pause inside kept');
  const half = Math.round(1.5 * sr);
  st = { ...st, ps: S.splitAt(st.ps, 0, half) };
  assert.strictEqual(st.ps.length, 3);
  st = { ...st, ps: S.setEdge(st, 2, 'a', 0, len) };
  assert(st.ps[2].a >= st.bounds[0] && st.ps[2].a > st.ps[1].b - 1, 'an edge never passes a boundary');
  assert.strictEqual(S.setEdge(st, 2, 'a', 0, len), st.ps, 'at its limit: the same pieces (no empty undo step)');
  st = { ...st, ps: st.ps.map((p, i) => (i === 1 ? { ...p, drop: true } : p)) };
  assert.deepStrictEqual(S.plan(st, 5).lines.map((l) => [l.line, l.ranges.length]), [[0, 1], [1, 1]]);
  st = { ...st, picks: S.pickLine(st, 1, 3) };
  assert.deepStrictEqual(S.plan(st, 5).lines.map((l) => l.line), [0, 3], 'a picked line, later groups count on');
  assert.deepStrictEqual(S.plan(st, 3), { lines: [{ line: 0, ranges: [[st.ps[0].a, st.ps[0].b]] }], over: 1 });
  const gone = S.dropBound(st, 2);
  assert.deepStrictEqual([gone.bounds, gone.picks], [[], []], 'the boundary and its pick go');
});

t('cli script split: --cut like N, --every-gap, --join, --dry-run; takes with ★ on the lines in order', async () => {
  fs.writeFileSync(cp('sp.txt'), '철수: 하나\n영희: 둘\n철수: 셋\n');
  fs.writeFileSync(cp('long.wav'), 'x');
  const P = 'sp.vproj', was = audio.decode;
  await run('script', 'import', P, 'sp.txt');
  audio.decode = async () => [x];
  try {
    const go = (...a) => run('script', 'split', P, '--line', '철수-001', 'long.wav', ...a);
    let r = await go('--gap', '0.3', '--cut', '2.1', '--dry-run');
    assert.deepStrictEqual(r.pieces.map((p) => p.line), ['철수-001', '영희-001', '영희-001'], 'N at 2.1: the 0.5 s pause');
    assert(Math.abs(r.boundaries[0] - 2.25) < 0.02, 'boundary ' + r.boundaries);
    r = await go('--char', '철수', '--every-gap', '--dry-run');
    assert.deepStrictEqual([r.pieces.map((p) => p.line), r.over], [['철수-001', '철수-002'], 0], '--char: 철수 only');
    r = await go('--gap', '0.3', '--cut', '2.1', '--join');
    assert.deepStrictEqual(r.pieces.map((p) => p.line), ['철수-001', '영희-001'], '--join: one take per line');
    const info = (await run('script', 'info', P)).lines;
    assert.deepStrictEqual(info.map((l) => [l.takes.length, l.star]), [[1, '테이크 1'], [1, '테이크 1'], [0, null]]);
    await fails('BAD_ARG', 'script', 'split', P, '--line', '철수-001', 'long.wav', '--cut', '99');
  } finally { audio.decode = was; }
});
