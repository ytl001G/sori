// Script mode: parsing, numbering, re-import, unscript (src/core/script.js).
const { assert, t } = require('./helpers');

const SC = require('../../src/core/script');
const names = (r) => r.lines.map((l) => SC.lineName(l));
t('script .txt: names, optional numbers, continuation, memo, comments', () => {
  const r = SC.fromTxt('1화 대본\n# 메모 줄\n\n철수: (화가 나서) 너 뭐야!\n  계속 말함\n영희-005：안녕\n'
    + '철수: 시간은 10:30이야\n10:30 회의\n철수-002: 둘\n영희: (웃음)\n');
  assert.deepStrictEqual(names(r), ['철수-001', '영희-005', '철수-003', '철수-002', '영희-006']);
  assert.deepStrictEqual([r.lines[0].text, r.lines[0].memo], ['너 뭐야! 계속 말함', '화가 나서']);
  assert.strictEqual(r.lines[2].text, '시간은 10:30이야 10:30 회의', 'a time is not a speaker');
  assert.deepStrictEqual([r.lines[4].text, r.lines[4].memo], ['', '웃음']);
});
t('script .txt: a colon right after 1-2 digits at the start or after a space is a time, not a name', () => {
  const r = SC.fromTxt('철수: 시작\n10:30 회의\n오후 10:30\n보컬 2: 30초\n캐릭터A-002: 10:30에 보자\n행인1: 12시야');
  assert.deepStrictEqual(names(r), ['철수-001', '캐릭터A-002', '행인1-001']);
  assert.deepStrictEqual(r.lines.map((l) => l.text), ['시작 10:30 회의 오후 10:30 보컬 2: 30초', '10:30에 보자', '12시야']);
});
t('script numbering: no quadratic scan past long used runs', () => {
  const k = 3000, row = (num) => ({ char: 'a', num, text: 'x' });
  const rows = [...Array(k)].flatMap((_, i) => [row(i + 1), row(null)])
    .concat([...Array(k)].map((_, i) => row(k + i + 1)));
  const t0 = Date.now(), r = SC.number(rows);
  assert(Date.now() - t0 < 500, 'fast');
  assert.deepStrictEqual([r.lines[1].num, r.lines[3].num], [2 * k + 1, 2 * k + 2]);
});
t('script addChars: a character named constructor keeps its own data and saves as JSON', () => {
  const ch = Object.create(null);
  SC.addChars(ch, [{ char: 'constructor' }, { char: '캐릭터A' }], ['#111111', '#222222']);
  assert.deepStrictEqual(Object.keys(ch), ['constructor', '캐릭터A']);
  assert.strictEqual(JSON.parse(JSON.stringify(ch)).constructor.color, '#111111');
  const plain = {};
  SC.addChars(plain, [{ char: 'constructor' }], ['#333333']);
  assert.strictEqual(plain.constructor.color, '#333333');
});
t('script numbering: counts on, skips written numbers, repeats get a new one', () => {
  const row = (char, num) => ({ char, num, text: 'x' });
  const r = SC.number([row('a', null), row('a', 5), row('a', null), row('a', 2), row('a', 5), row('b', null)]);
  assert.deepStrictEqual(names(r), ['a-001', 'a-005', 'a-006', 'a-002', 'a-003', 'b-001']);
  assert.strictEqual(r.dup, 1);
});
t('script table: header columns in any order, no header, CSV quotes, CP949', () => {
  const csv = SC.parseCsv('번호,메모,대사,캐릭터\r\n3,급하게,"안녕, ""친구""",철수\r\n,,이어서,\r\n,,,\r\n');
  const r = SC.fromTable(csv);
  assert.deepStrictEqual(names(r), ['철수-003']);
  assert.deepStrictEqual([r.lines[0].text, r.lines[0].memo], ['안녕, "친구" 이어서', '급하게']);
  assert.deepStrictEqual(names(SC.fromTable([['영희-010', '하나'], ['영희', 2]])), ['영희-010', '영희-011']);
  assert.deepStrictEqual(SC.parseCsv('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
  const cp949 = Uint8Array.from([0xC3, 0xB6, 0xBC, 0xF6, 0x3A, 0x20, 0xBE, 0xC8, 0xB3, 0xE7]); // "철수: 안녕" in CP949
  assert.strictEqual(SC.decodeText(cp949), '철수: 안녕');
  assert.strictEqual(SC.decodeText(new TextEncoder().encode('﻿철수')), '철수');
});
t('script re-import: the new script is the base, match by name, redo on new text, gone lines take their takes', () => {
  const old = SC.fromTxt('a: one\na: two\na: three\na: four').lines;
  old[0].takes = [{ id: 't1', clips: [1] }]; old[0].star = 't1';
  old[2].takes = [{ id: 't2', clips: [1] }, { id: 't3', clips: [1] }]; old[2].star = 't2';
  const { lines, counts, names } = SC.merge(old, SC.fromTxt('a: ONE\na: two\na-005: five').lines);
  assert.deepStrictEqual(counts, { added: 1, changed: 1, gone: 2, goneTakes: 2, same: 1 });
  assert.deepStrictEqual(lines.map((l) => [SC.lineName(l), l.state]),
    [['a-001', 'redo'], ['a-002', undefined], ['a-005', undefined]]);
  assert.deepStrictEqual(names.gone, ['a-003', 'a-004']);
  assert.strictEqual(lines[0].id, old[0].id, 'recordings stay with the line');
  assert.strictEqual(lines[0].star, 't1');
  const empty = SC.fromTxt('b: x').lines; empty[0].takes = [{ id: 'e', clips: [] }];
  assert.strictEqual(SC.merge(empty, SC.fromTxt('b: y').lines).lines[0].state, undefined,
    'a take without sound is no recording (same rule as 대사 고치기)');
});
t('script re-import: unnumbered lines match same character + same text first, then order', () => {
  const old = SC.fromTxt('철수: 사과\n철수: 바나나').lines;
  old[0].takes = [{ id: 't1', clips: [1] }]; old[1].takes = [{ id: 't2', clips: [1] }];
  const { lines, counts } = SC.merge(old, SC.fromTxt('철수: 포도\n철수: 사과\n철수: 바나나').lines);
  assert.deepStrictEqual(lines.map((l) => [SC.lineName(l), l.text, l.takes.length ? l.takes[0].id : null]),
    [['철수-001', '포도', null], ['철수-002', '사과', 't1'], ['철수-003', '바나나', 't2']]);
  assert.deepStrictEqual(counts, { added: 1, changed: 0, gone: 0, goneTakes: 0, same: 2 });
  const r = SC.merge(old, SC.fromTxt('철수: 사과!\n철수: 바나나').lines).lines; // no text match: by order
  assert.deepStrictEqual([r[0].id, r[0].state, r[1].id], [old[0].id, 'redo', old[1].id]);
});

t('script unscript: every take a track, script then recording order, sounding as it did, fresh ids', () => {
  const take = (id, name, more) => ({ id, name, gain: 0.5, pan: 0.2, mute: true, solo: true, color: '#000', fx: null,
    clips: [1], ...more });
  const chars = { a: { color: '#111', fx: { eq: 1 } }, b: { color: '#222', fx: { eq: 2 } } };
  const lines = SC.fromTxt('a: one\nb: two\na: three').lines;
  lines[0].takes = [take('t1', '테이크 1'), take('t2', '테이크 2')];
  lines[1].takes = [take('t3', '테이크 1'), take('t4', '테이크 2', { clips: [] })]; // no sound: not a track
  const p = { tracks: lines[2].takes, script: { lineId: lines[2].id, chars, lines } };
  p.tracks = [take('t5', '테이크 1')]; // the current line's takes live in project.tracks
  const ts = SC.unscript(p);
  assert.deepStrictEqual(ts.map((t) => t.name), ['a-001 테이크 1', 'a-001 테이크 2', 'b-001 테이크 1', 'a-002 테이크 1']);
  assert.deepStrictEqual([ts[2].color, ts[2].fx, ts[2].gain, ts[2].pan, ts[2].mute, ts[2].solo],
    ['#222', { eq: 2 }, 0.5, 0.2, false, false]);
  assert(ts.every((t) => !/^t\d$/.test(t.id)) && new Set(ts.map((t) => t.id)).size === 4, 'fresh, distinct ids');
});

t("script done = a ★ take with sound (the same test as export)", () => {
  const l = (clips, state) => ({ star: "t1", state, takes: [{ id: "t1", clips }] });
  assert.deepStrictEqual([SC.isDone(l([1])), SC.isDone(l([])), SC.isDone(l([1], "redo"))], [true, false, false]);
  assert.strictEqual(SC.exportPick([l([])]).ready.length, 0);
});
t('script numbers as text (1-01): kept as written, auto numbers count on past them, saved and read back', () => {
  const csv = SC.parseCsv('번호,화자,대사\n1-01,캐릭터C,하나\n1-02,캐릭터C,둘\n,캐릭터C,셋\nA3,캐릭터B,넷\n005,캐릭터B,다섯\n');
  const r = SC.fromTable(csv);
  assert.deepStrictEqual(names(r), ['캐릭터C-1-01', '캐릭터C-1-02', '캐릭터C-001', '캐릭터B-A3', '캐릭터B-005']);
  assert.deepStrictEqual(names(SC.fromTxt('캐릭터C-2-05: 안녕\n캐릭터C-7: 둘')), ['캐릭터C-2-05', '캐릭터C-007']);
  assert.deepStrictEqual(names(SC.fromTable([['n-1', '하나'], ['n-1', '둘']])), ['n-001', 'n-002'], 'repeat');
  assert.deepStrictEqual([SC.toNum(' 1-01 '), SC.toNum('005'), SC.toNum(''), SC.toNum(0), SC.toNum(12)],
    ['1-01', 5, null, null, 12]);
});
