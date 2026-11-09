// File formats: WAV, MP3, .vproj (src/core/fileio.js).
const { assert, E, IO, t, sine, sr } = require('./helpers');
const AP = require('../../src/core/audiopack');

const near = (a, b) => Math.abs(a - b) <= 2 ** -24; // 24-bit rounding
// a v1-v3 file as older Sori wrote it: the same JSON, float32 channels instead of packed blobs
function legacy(bytes, ver) {
  const { meta, dataStart } = IO.readHead(bytes);
  let off = 0;
  const chs = meta.sources.map((m) => AP.unpack(bytes.subarray(dataStart + m.byteOffset,
    dataStart + m.byteOffset + m.size), m.channels, m.length));
  meta.sources.forEach((m) => { m.byteOffset = off; delete m.size; off += m.channels * m.length * 4; });
  const json = new TextEncoder().encode(JSON.stringify(meta)), at = Math.ceil((12 + json.length) / 4) * 4;
  const out = new Uint8Array(at + off), v = new DataView(out.buffer);
  out.set(bytes.subarray(0, 4)); v.setUint32(4, ver, true); v.setUint32(8, json.length, true); out.set(json, 12);
  const f32 = new Float32Array(out.buffer, at, off / 4);
  meta.sources.forEach((m, i) => chs[i].forEach((c, k) => f32.set(c, m.byteOffset / 4 + k * m.length)));
  return out;
}

t('wav header and samples', () => {
  const w = IO.encodeWav([Float32Array.of(0, 1, -1)], 48000, 16);
  const v = new DataView(w.buffer);
  assert.strictEqual(String.fromCharCode(...w.subarray(0, 4)), 'RIFF');
  assert.strictEqual(v.getUint32(24, true), 48000);
  assert.deepStrictEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32767]);
  assert.strictEqual(IO.encodeWav([new Float32Array(10), new Float32Array(10)], 44100, 24).length, 44 + 60);
});
t('mp3 encodes frames', () => {
  const m = IO.encodeMp3([sine(sr, 440, sr), sine(sr, 440, sr)], sr, 128);
  assert(m.length > 10000 && m.length < 25000, 'size ' + m.length);
  assert(m[0] === 0xff && (m[1] & 0xe0) === 0xe0, 'mp3 sync');
});
t('vproj round trip + rejects garbage', () => {
  const src = E.makeSource([sine(1000, 440, sr), sine(1000, 220, sr)]);
  const tracks = [{ name: '목소리', color: '#6c8cff', gain: 0.5, pan: -0.3, mute: false, solo: true,
    clips: [E.makeClip(src, 10, 'a', 100, 200), E.makeClip(src, 500, 'b')] }];
  const back = IO.loadProject(IO.saveProject({ sampleRate: sr, tracks }));
  assert.strictEqual(back.sampleRate, sr);
  const [c0, c1] = back.tracks[0].clips;
  assert.strictEqual(c0.src, c1.src, 'shared source preserved');
  assert.deepStrictEqual([c0.start, c0.offset, c0.length, back.tracks[0].gain, back.tracks[0].name],
    [10, 100, 200, 0.5, '목소리']);
  assert(near(c0.src.ch[1][7], src.ch[1][7]), 'samples');
  assert.throws(() => IO.loadProject(new Uint8Array(20)), /Sori 프로젝트가 아니에요/);
  const bad = IO.saveProject({ sampleRate: sr, tracks });
  assert.throws(() => IO.loadProject(bad.subarray(0, bad.length - 8)), /손상/);
  // fractional positions and non-hex colors from a hand-edited file
  const edit = (fn) => {
    const b = IO.saveProject({ sampleRate: sr, tracks }), jl = new DataView(b.buffer).getUint32(8, true);
    const meta = JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + jl)));
    fn(meta);
    b.set(new TextEncoder().encode(JSON.stringify(meta).padEnd(jl)).subarray(0, jl), 12);
    return b;
  };
  assert.throws(() => IO.loadProject(edit((m) => { m.tracks[0].clips[0].start = 1.5; })), /손상/);
  assert.strictEqual(IO.loadProject(edit((m) => { m.tracks[0].color = 'red'; })).tracks[0].color, undefined);
});

t('vproj v2 keeps fx, master, markers, tempo, clip fades; v1 files still open', () => {
  const P = require('../../src/core/fxparams');
  const src = E.makeSource([sine(1000, 440, sr)]);
  const fx = P.defaultFx(P.TRACK_KINDS); fx.comp = { ...fx.comp, on: true, ratio: 8 };
  const master = P.defaultMaster(); master.gainDb = -3;
  master.fx.limiter = { ...master.fx.limiter, on: true, ceiling: -2 };
  const proj = { sampleRate: sr, bpm: 90, beats: 3, grid: 'beats', master, markers:
    [{ id: 'm1', frame: 480, name: '후렴' }],
    tracks:
      [{ name: 't', gain: 1, pan: 0, mute: false, solo: false, fx, view: 'spec', clips:
        [{ ...E.makeClip(src, 0, 'a'), gain: 0.5, fadeIn: 100, fadeOut: 50, fadeInShape: 'slow', fadeOutShape:
          'bogus' }] }] };
  const back = IO.loadProject(IO.saveProject(proj));
  assert.deepStrictEqual([back.bpm, back.beats, back.grid, back.master.gainDb, back.master.fx.limiter.on,
    back.master.fx.limiter.ceiling], [90, 3, 'beats', -3, true, -2]);
  // a per-track view (before 2026-11-08) is dropped: 스펙트로그램 보기 is the whole app's, not saved
  assert.deepStrictEqual([back.markers[0].frame, back.markers[0].name, back.tracks[0].fx.comp.ratio,
    'view' in back.tracks[0]], [480, '후렴', 8, false]);
  const c = back.tracks[0].clips[0];
  assert.deepStrictEqual([c.gain, c.fadeIn, c.fadeOut, c.fadeInShape, 'fadeOutShape' in c],
    [0.5, 100, 50, 'slow', false]);
  // a v1 file: version 1 header, no new fields -> defaults
  const b = legacy(IO.saveProject({ sampleRate: sr, tracks: [{ name: 'x', clips: [E.makeClip(src, 0, 'a')] }] }), 1);
  const v1 = IO.loadProject(b);
  assert.deepStrictEqual([v1.bpm, v1.markers.length, v1.master.fx.eq.on, v1.tracks[0].fx.reverb.on,
    v1.tracks[0].clips[0].gain], [120, 0, false, false, 1]);
  new DataView(b.buffer).setUint32(4, 9, true);
  assert.throws(() => IO.loadProject(b), /새 버전/);
});

t('vproj v3 script project: lines, takes, star, character fx; current line takes come from tracks', () => {
  const P = require('../../src/core/fxparams'), SC = require('../../src/core/script');
  const src = E.makeSource([sine(800, 440, sr)]);
  const take = (id, n) => ({ id, name: '테이크 ' + n, gain: 1, pan: 0, mute: false, solo: false,
    fx: P.defaultFx(P.TRACK_KINDS), view: 'wave', clips: [E.makeClip(src, 0, 'a')] });
  const { lines } = SC.fromTxt('철수: 하나\n영희: (웃음)\n철수-007: 셋');
  lines[0].takes = [take('t1', 1), take('t2', 2)]; lines[0].star = 't2'; lines[0].state = 'redo';
  const fx = P.defaultFx(P.TRACK_KINDS); fx.eq = { ...fx.eq, on: true, low: 3 };
  const script = { lines, lineId: lines[2].id, chars:
    { 철수: { color: '#FB923C', fx }, 영희: { color: '#A78BFA', fx: P.defaultFx(P.TRACK_KINDS) } } };
  const bytes = IO.saveProject({ sampleRate: sr, tracks: [take('t9', 1)], script });
  assert.strictEqual(new DataView(bytes.buffer).getUint32(4, true), 4, 'every project is v4');
  const back = IO.loadProject(legacy(bytes, 3)), bl = back.script.lines; // a v3 file from older Sori opens
  assert.deepStrictEqual(bl.map((l) => [SC.lineName(l), l.text, l.memo, l.state, l.takes.length]),
    [['철수-001', '하나', '', 'redo', 2], ['영희-001', '', '웃음', undefined, 0], ['철수-007', '셋', '', undefined, 1]]);
  assert.strictEqual(bl[0].star, bl[0].takes[1].id, 'star follows its take');
  assert.strictEqual(back.script.lineId, bl[2].id, 'current line kept');
  assert.strictEqual(back.tracks, bl[2].takes, 'tracks = the current line takes');
  assert.deepStrictEqual([back.script.chars['철수'].color, back.script.chars['철수'].fx.eq.low], ['#FB923C', 3]);
  assert(near(bl[0].takes[0].clips[0].src.ch[0][5], src.ch[0][5]), 'samples');
});

t('vproj v4: packed sound (smaller, 16-bit exact), saved again unchanged; a backup takes its sound from the pool',
  () => {
  const s16 = E.makeSource([Float32Array.from(sine(9600, 220, sr), (v) => Math.round(v * 32768) / 32768)]);
  const p = { sampleRate: sr, tracks: [{ name: 'x', clips: [E.makeClip(s16, 0, 'a')] }] };
  const b = IO.saveProject(p), back = IO.loadProject(b);
  assert(b.length < 9600 * 4 / 2, 'packed: ' + b.length);
  assert(back.tracks[0].clips[0].src.ch[0].every((v, i) => v === s16.ch[0][i]), '16-bit exact');
  const sound = (x) => x.subarray(IO.readHead(x).dataStart); // the JSON has fresh ids
  assert.deepStrictEqual(sound(IO.saveProject(back)), sound(b), 'opened and saved again: the same packed sound');
  const thin = IO.saveThin(p), pool = new Map(thin.blobs.map((x) => [x.hash, x.blob]));
  assert(thin.bytes.length < 2000 && thin.blobs.length === 1, 'no sound in the backup file');
  const fromPool = IO.loadProject(thin.bytes, { pool: (h) => pool.get(h) });
  assert(fromPool.tracks[0].clips[0].src.ch[0].every((v, i) => v === s16.ch[0][i]), 'sound from the pool');
  assert.throws(() => IO.loadProject(thin.bytes), /백업에서 열기/);
  const bad = new Uint8Array(thin.blobs[0].blob); bad[bad.length - 1] ^= 1;
  for (const pool of [() => bad, () => { throw new Error('없음'); }]) { // damaged or missing: silence, listed
    const r = IO.loadProject(thin.bytes, { pool });
    assert(r.tracks[0].clips[0].src.ch[0].every((v) => v === 0) && r.damaged[0] === 'x', 'silent backup source');
  }
  const { meta } = IO.readHead(thin.bytes);
  meta.sources[0].hash = '../../x';
  const json = new TextEncoder().encode(JSON.stringify(meta)), forged = new Uint8Array(12 + json.length);
  forged.set(thin.bytes.subarray(0, 8)); forged.set(json, 12);
  new DataView(forged.buffer).setUint32(8, json.length, true);
  const reads = [];
  assert.throws(() => IO.loadProject(forged, { pool: (h) => reads.push(h) }), /손상/);
  assert(!reads.length, 'a forged hash never reaches the pool');
});
t('vproj v4: idle packing (prepack) step by step and a save in the middle give the same file; opening reports progress',
  () => {
  const sound = (x) => x.subarray(IO.readHead(x).dataStart);
  const track = (c) => ({ name: 'x', clips: [E.makeClip(E.makeSource([c]), 0, 'a')] });
  const proj = (...ch) => ({ sampleRate: sr, tracks: ch.map(track) });
  const a = sine(sr * 3, 220, sr), b = sine(sr * 2, 330, sr), want = sound(IO.saveProject(proj(a, b)));
  const mid = proj(a, b);
  assert.strictEqual(IO.prepack(mid, () => false), true, 'one step, more to do');
  assert.deepStrictEqual(sound(IO.saveProject(mid)), want, 'a save finishes the half-packed source');
  assert.strictEqual(IO.prepack(mid, () => true), false, 'nothing left after the save');
  const idle = proj(a, b);
  let calls = 0;
  while (IO.prepack(idle, () => false)) calls++;
  assert(calls > 4, 'small steps: ' + calls);
  assert.deepStrictEqual(sound(IO.saveProject(idle)), want, 'packed while idle');
  const thin = IO.saveThin(idle), sha = (b) => require('crypto').createHash('sha1').update(b).digest('hex');
  assert(thin.blobs.every((x) => x.hash === sha(x.blob)), 'the idle sha1 names each blob');
  const loud = proj(Float32Array.from({ length: 1.2e6 }, (_, i) => 2 * Math.sin(i))); // raw: a 4.8 MB blob
  let hashSteps = 0;
  while (IO.prepack(loud, () => false)) hashSteps++;
  const big = IO.saveThin(loud).blobs[0];
  assert(big.blob.length > 4 << 20 && big.hash === sha(big.blob) && hashSteps >= 2, 'sha1 in 4 MB steps: ' + hashSteps);
  const gone = proj(a, b), keep = { ...gone, tracks: gone.tracks.slice(1) };
  IO.prepack(gone, () => false); // in the middle of the first source...
  while (IO.prepack(keep, () => true)); // ...which is then deleted: the next one is packed
  assert.deepStrictEqual(sound(IO.saveProject(keep)), sound(IO.saveProject(proj(b))));
  const g = IO.loadSteps(IO.saveProject(idle)), seen = [];
  let r = g.next();
  for (; !r.done; r = g.next()) seen.push(r.value);
  assert.strictEqual(seen.length, 2, 'a step per source');
  assert(seen[0][0] < seen[1][0] && seen[1][0] === seen[1][1], 'done grows to total: ' + JSON.stringify(seen));
  assert(r.value.tracks[1].clips[0].src.ch[0].every((v, i) => near(v, b[i])), 'the project at the end');
});

// a v4 file with its JSON replaced by fn(meta) (sound bytes kept)
function rewrite(b, fn) {
  const { meta, dataStart } = IO.readHead(b), json = new TextEncoder().encode(JSON.stringify(fn(meta)));
  const at = Math.ceil((12 + json.length) / 4) * 4, out = new Uint8Array(at + b.length - dataStart);
  out.set(b.subarray(0, 8)); new DataView(out.buffer).setUint32(8, json.length, true); out.set(json, 12);
  out.set(b.subarray(dataStart), at);
  return out;
}
const s16 = (n, f) => E.makeSource([Float32Array.from(sine(n, f, sr), (v) => Math.round(v * 32768) / 32768)]);
const SCR = require('../../src/core/script');
function scriptProject(txt) {
  const { lines } = SCR.fromTxt(txt), take = (n, s) => ({ name: '테이크 ' + n, clips: [E.makeClip(s, 0, 'a')] });
  lines[0].takes = [take(1, s16(3000, 220)), take(2, s16(4000, 330))];
  return { sampleRate: sr, tracks: lines[0].takes, script: { lines, lineId: lines[0].id, chars: {} } };
}

t('vproj: an idle pack that throws is never cached; the save packs that source itself', () => {
  const orig = AP.packSteps, x = sine(3000, 220, sr);
  AP.packSteps = function* () { yield; throw new Error('boom'); };
  try {
    const p = () => ({ sampleRate: sr, tracks: [{ name: 'x', clips: [E.makeClip(E.makeSource([x]), 0, 'a')] }] });
    const a = p(), b = p();
    IO.prepack(a, () => false); // a step...
    assert.strictEqual(IO.prepack(a, () => false), false, '...then it throws: left unpacked, nothing to do');
    IO.prepack(b, () => false); // a save in the middle of the pack that will throw
    for (const proj of [a, b, a]) {
      const back = IO.loadProject(IO.saveProject(proj));
      assert(back.tracks[0].clips[0].src.ch[0].every((v, i) => near(v, x[i])) && !back.damaged.length);
    }
  } finally { AP.packSteps = orig; }
});
t('vproj: bad JSON shapes and blob offsets fail with the Korean damaged-file error', () => {
  const two = { sampleRate: sr, tracks: [{ name: 'x', clips: [E.makeClip(s16(900, 220), 0, 'a')] },
    { name: 'y', clips: [E.makeClip(s16(700, 330), 0, 'b')] }] };
  const b = IO.saveProject(two), sb = IO.saveProject(scriptProject('캐릭터A: 하나'));
  const cases = [[b, () => null], [b, (m) => ({ ...m, tracks: [null] })],
    [b, (m) => { m.tracks[0].clips = 5; return m; }], [b, (m) => { m.tracks[0].clips = [null]; return m; }],
    [sb, (m) => { m.script.lines[0].takes = [null]; return m; }],
    [b, (m) => { m.sources[1].byteOffset = 0; return m; }]];
  for (const [bytes, fn] of cases) {
    assert.throws(() => IO.loadProject(rewrite(bytes, fn)), /^Error: 프로젝트 파일을 읽을 수 없어요/, fn.toString());
  }
  const old = IO.loadProject(rewrite(b, (m) => { m.sources.forEach((s) => delete s.hash); return m; }));
  assert(!old.damaged.length && old.tracks[1].clips[0].src.ch[0][5] === two.tracks[1].clips[0].src.ch[0][5], 'no hash');
});
t('vproj: one damaged take opens as silence and is listed; the other take is exact', () => {
  const p = scriptProject('캐릭터A: 하나'), b = IO.saveProject(p), { meta, dataStart } = IO.readHead(b);
  assert(meta.sources.every((m) => /^[0-9a-f]{40}$/.test(m.hash)), 'each source saved with its sha1');
  b[dataStart + meta.sources[1].byteOffset + 9] ^= 4;
  const back = IO.loadProject(b), [t1, t2] = back.script.lines[0].takes;
  assert(t1.clips[0].src.ch[0].every((v, i) => v === p.tracks[0].clips[0].src.ch[0][i]), 'the good take exact');
  assert(t2.clips[0].src.ch[0].length === 4000 && t2.clips[0].src.ch[0].every((v) => v === 0), 'silence');
  assert.deepStrictEqual(back.damaged, ['캐릭터A-001 테이크 2']);
  const again = IO.loadProject(IO.saveProject(back)); // saved again: silence, no longer damaged
  assert.deepStrictEqual(again.damaged, []);
});
t('vproj: a character named constructor keeps its own color', () => {
  const p = scriptProject('constructor: 하나');
  p.script.chars = { constructor: { color: '#FB923C' } };
  const back = IO.loadProject(IO.saveProject(p));
  assert.strictEqual(back.script.chars.constructor.color, '#FB923C');
});
t('vproj open: nothing decoded until used, the same sound, a damaged take still silent', () => {
  const PK = require('../../src/core/parked');
  const p = scriptProject('캐릭터A: 하나'), b = IO.saveProject(p), was = PK.awakeCount();
  const lazy = IO.loadProject(b), [t1] = lazy.script.lines[0].takes, s = t1.clips[0].src;
  assert(PK.awakeCount() === was && E.srcLen(s) === 3000 && s.channels === 1, 'parked undecoded, length known');
  const sound = (x) => x.subarray(IO.readHead(x).dataStart);
  assert.deepStrictEqual(sound(IO.saveProject(lazy)), sound(b), 'saved again without decoding: the same sound');
  assert.strictEqual(PK.awakeCount(), was, 'the save decoded nothing');
  assert(s.ch[0].every((v, i) => v === p.tracks[0].clips[0].src.ch[0][i]) && PK.awakeCount() === was + 1, 'exact');
  const { meta, dataStart } = IO.readHead(b);
  b[dataStart + meta.sources[1].byteOffset + 9] ^= 4;
  const bad = IO.loadProject(b);
  assert(bad.script.lines[0].takes[1].clips[0].src.ch[0].every((v) => v === 0), 'damaged: silence');
  assert.deepStrictEqual(bad.damaged, ['캐릭터A-001 테이크 2']);
});
