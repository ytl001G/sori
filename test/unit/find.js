// Ctrl+F 찾기: matches and where a search lands (src/core/find.js).
const { assert, t } = require('./helpers');
const F = require('../../src/core/find');

const track = (id, name, clips = []) => ({ id, name, clips });
const p = {
  tracks: [track('a', '보컬 1', [{ id: 'c2', name: '후렴', start: 50 }, { id: 'c1', name: '인트로', start: 0 }]),
    track('b', '배경음악'), track('c', '보컬10', [{ id: 'c3', name: '후렴 끝', start: 9 }])],
  markers: [{ id: 'm2', name: '후렴', frame: 70 }, { id: 'm1', name: '시작', frame: 0 }],
};
const kinds = (hs) => hs.map((h) => `${h.kind}:${h.id}`).join(' ');

t('find: track names by default (a part, no case or spaces); 고급 adds clips and markers in time order', () => {
  assert.strictEqual(kinds(F.hits(p, '보컬1', null)), 'track:a track:c');
  assert.strictEqual(kinds(F.hits(p, '  ', null)), '');
  assert.strictEqual(kinds(F.hits(p, '후렴', null)), '');
  assert.strictEqual(kinds(F.hits(p, '후렴', null, { clips: true, markers: true })), 'clip:c2 clip:c3 marker:m2');
});

t('find: a script project looks in the listed lines (number, text; memo with 고급)', () => {
  const lines = [{ id: 'l1', char: '철수', num: 1, text: '산책 가요', memo: '' },
    { id: 'l2', char: '영희', num: 1, text: '좋아요', memo: '산책 뒤' }];
  assert.strictEqual(kinds(F.hits(p, '산책', lines)), 'line:l1');
  assert.strictEqual(kinds(F.hits(p, '산책', lines, { memo: true })), 'line:l1 line:l2');
  assert.strictEqual(kinds(F.hits(p, '영희-001', lines)), 'line:l2');
  assert.strictEqual(kinds(F.hits(p, '보컬', lines)), '', 'takes are not searched in a script project');
});

t('find: typing stays on a hit that still matches, else the next line/track; Enter walks and wraps', () => {
  const hs = F.hits(p, '보컬', null, { clips: true }); // track:a track:c (no clip named 보컬)
  assert.deepStrictEqual([F.pick(hs, 1, 0, 0), F.pick(hs, -1, 1, 0), F.pick(hs, -1, 2, 0), F.pick(hs, -1, 3, 0)],
    [1, 1, 1, 0]);
  assert.deepStrictEqual([F.pick(hs, 1, 0, 1), F.pick(hs, 0, 0, -1), F.pick(hs, -1, 2, -1)], [0, 1, 0]);
  assert.strictEqual(F.pick([], -1, 0, 1), -1);
});
