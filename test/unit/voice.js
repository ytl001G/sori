// 목소리 정리: loudness, the noise floor, de-esser, hum, gate, 긴 침묵 줄이기 and the one-click edit
// (src/core/loudness.js, voice.js, voicedit.js).
const { assert, E, FX, t, sine, rms, sr } = require('./helpers');
const LD = require('../../src/core/loudness');
const V = require('../../src/core/voice');
const VE = require('../../src/core/voicedit');
const P = require('../../src/core/fxparams');

let seed = 1;
const noise = (n, a) => Float32Array.from({ length: n }, () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return a * (seed / 1073741824 - 1);
});
// 'speech': 1 kHz bursts of `on` s with `off` s of room noise (-60 dB) between
function talk(parts, a = 0.3) {
  const out = [];
  for (const [kind, sec] of parts) {
    const n = Math.round(sec * sr), room = noise(n, 0.001);
    out.push(kind === 'on' ? room.map((v, i) => v + a * Math.sin(2 * Math.PI * 1000 * i / sr)) : room);
  }
  const x = new Float32Array(out.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of out) { x.set(p, k); k += p.length; }
  return [x];
}
const db = (x) => 20 * Math.log10(x);
const track = (id, ch) => ({ id, name: id.toUpperCase(), clips: [E.makeClip(E.makeSource(ch), 0, id)] });
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

t('loudness: a 997 Hz sine at -20 dBFS is -23 LUFS; 음량 맞추기 hits the target with peaks held at -1 dB', () => {
  near(LD.integrated([sine(5 * sr, 997, sr, 0.1)], sr), -23.01, 0.05, 'LUFS');
  near(LD.integrated([sine(5 * sr, 997, sr, 0.1), sine(5 * sr, 997, sr, 0.1)], sr), -20.0, 0.05, 'stereo');
  assert.strictEqual(LD.integrated([new Float32Array(sr)], sr), -Infinity);
  assert.strictEqual(LD.toLoudness([sine(sr / 4, 997, sr, 0.1)], sr, -16), null, 'shorter than one block');
  const spiky = sine(6 * sr, 300, sr, 0.03);
  for (let i = 0; i < spiky.length; i += sr / 2) spiky[i] = 0.9;
  const y = LD.toLoudness([spiky], sr, -16);
  assert(FX.peak(y) <= 10 ** (-1 / 20) + 1e-6, 'peak ' + FX.peak(y));
  near(LD.integrated(y, sr), -16, 0.3, 'after');
});
t('noise floor: the quietest 0.5 s with sound; digital silence only as a last resort; none in steady sound', () => {
  const x = talk([['on', 1], ['off', 1], ['on', 1]]), q = V.quietest(x, sr);
  assert(q.start >= sr && q.start + q.len <= 2 * sr, 'window ' + q.start);
  near(q.db, db(0.001 / Math.sqrt(3)), 1.5, 'floor dB');
  const lead = [new Float32Array(3 * sr + sr)]; lead[0].set(x[0], sr);
  assert(V.quietest(lead, sr).start >= 2 * sr, 'skips the empty lead-in');
  // a real take ending in zeros: a window half room noise, half zeros measured the floor 26 dB low
  const end = talk([['on', 1], ['off', 1], ['on', 1], ['off', 0.6]]), tail = [new Float32Array(5 * sr)];
  tail[0].set(end[0]);
  near(V.quietest(tail, sr).db, db(0.001 / Math.sqrt(3)), 1.5, 'no window touching digital silence');
  assert.strictEqual(V.quietest([sine(3 * sr, 1000, sr, 0.3)], sr), null, 'steady tone');
  assert.strictEqual(V.quietest([noise(sr / 4, 0.001)], sr), null, 'shorter than 0.5 s');
  const tts = [new Float32Array(3 * sr)], tone = sine(sr, 1000, sr, 0.3);
  tts[0].set(tone); tts[0].set(tone, 2 * sr);
  assert.strictEqual(V.quietest(tts, sr).db, V.SILENT, 'pauses of digital silence');
  assert.strictEqual(V.STEPS.noise(tts, sr, 'mid'), tts, 'nothing to take out: the same sound, no new clip');
  assert.strictEqual(V.quietest([new Float32Array(sr)], sr).db, V.SILENT, 'nothing but silence');
});
t('de-esser: the high band goes down when it dominates, low sound stays; live worklet = offline', () => {
  const s = [sine(sr, 8000, sr, 0.3)], v = [sine(sr, 200, sr, 0.3)], p = { amount: 10, freq: 4000 };
  const half = (y) => rms(y[0].subarray(sr / 2));
  near(db(half(V.deess(s, sr, p)) / half(s)), -9, 0.5, 'sibilant'); // LR split at 8 kHz: 0.06 + 0.32 * 0.94
  near(db(rms(V.deess(v, sr, p)[0]) / rms(v[0])), 0, 0.1, 'voice');
  const mix = [s[0].map((x, i) => x * (i % 9600 < 4800 ? 1 : 0) + v[0][i])];
  const vm = require('vm'), reg = {};
  class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } }
  vm.runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '../../src/audio/worklets.js'), 'utf8'),
    { AudioWorkletProcessor, registerProcessor: (n, c) => { reg[n] = c; }, sampleRate: sr, currentFrame: 0, Math,
      Float32Array, Float64Array });
  const w = new reg['sori-deess']({}), out = new Float32Array(mix[0].length), pv = { amount: [10], freq: [4000] };
  for (let i = 0; i < out.length; i += 128) {
    w.process([[mix[0].subarray(i, i + 128)]], [[out.subarray(i, i + 128)]], pv);
  }
  const off = V.deess(mix, sr, p)[0];
  let m = 0; for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i] - off[i]));
  assert(m < 1e-4, 'max diff ' + m);
});
t('hum: 50 or 60 Hz found, its notches take it out and leave the voice', () => {
  const hum60 = sine(3 * sr, 60, sr, 0.1), voice = sine(3 * sr, 1000, sr, 0.3), x = [hum60.map((h, i) => h + voice[i])];
  assert.strictEqual(V.humFreq(x, sr), 60);
  assert.strictEqual(V.humFreq([sine(3 * sr, 50, sr, 0.1).map((h, i) => h + voice[i])], sr), 50);
  const y = V.hum([hum60], sr, { freq: 60, count: 3 })[0].subarray(sr);
  assert(db(rms(y) / rms(hum60.subarray(sr))) < -30, 'hum left ' + db(rms(y) / rms(hum60)));
  near(db(rms(V.hum([voice], sr, { freq: 60, count: 5 })[0]) / rms(voice)), 0, 0.1, 'voice');
  assert.deepStrictEqual(V.humFreqs(8000, { freq: 60, count: 5 }), [60, 120, 180, 240, 300]);
  const late = { clips: [E.makeClip(E.makeSource([sine(2 * sr, 50, sr, 0.2)]), 40 * sr, 'a')] };
  assert.strictEqual(V.heardHum([{ clips: [] }, late], sr), 50, 'listens from the first clip');
  assert.strictEqual(V.heardHum([{ clips: [] }], sr), null);
});
t('gate: quiet parts go down by the strength, sound stays', () => {
  const x = talk([['on', 1], ['off', 1], ['on', 1]]), q = V.quietest(x, sr);
  const gap = (y) => rms(y[0].subarray(Math.round(1.3 * sr), Math.round(1.7 * sr)));
  near(db(gap(V.gate(x, sr, { sound: V.soundDb(q), depth: -10 })) / gap(x)), -10, 0.5, 'low');
  assert(gap(V.gate(x, sr, { sound: V.soundDb(q), depth: -Infinity })) < 1e-6, 'high: silent');
  const talkPart = (y) => rms(y[0].subarray(Math.round(0.2 * sr), Math.round(0.8 * sr)));
  near(talkPart(V.gate(x, sr, { sound: V.soundDb(q), depth: -20 })), talkPart(x), 1e-4, 'voice');
});
t('긴 침묵 줄이기: each track its own pauses, start and end too, breaths quiet; progress per piece', async () => {
  const a = track('a', talk([['on', 1], ['off', 2], ['on', 1]]));
  const b = track('b', talk([['off', 1.5], ['on', 0.5], ['off', 2]]));
  const one = await VE.voiceEdit([a], [{ trackId: 'a', a: 0, b: 4 * sr }], sr, { gaps: 'mid' });
  assert.deepStrictEqual(one.cuts.map((c) => c.add > 0), [true, false, true], 'end padded, middle cut, start padded');
  const later = E.makeClip(E.makeSource(talk([['on', 1]])), 5 * sr, 'later'); // after the range: pulled in
  const two = await VE.voiceEdit([{ ...a, clips: [...a.clips, later] }], [{ trackId: 'a', a: 0, b: 4 * sr }], sr,
    { gaps: 'mid' });
  assert.deepStrictEqual(two.clips.get('a').map((c) => [c.start / sr, c.length / sr]), [[0, 3.5], [4.5, 1]], 'ripple');
  near(E.projectEnd([{ clips: one.clips.get('a') }]) / sr, 3.5, 0.03, 'length');
  near(one.done[0].newB / sr, 3.5, 0.03, 'newB');
  const seen = [], ab = [{ trackId: 'a', a: 0, b: 4 * sr }, { trackId: 'b', a: 0, b: 4 * sr }];
  const both = await VE.voiceEdit([a, b], ab, sr, { gaps: 'mid' }, async (...x) => seen.push(x));
  const of = (id) => both.cuts.filter((c) => c.trackId === id).length;
  assert.deepStrictEqual([of('a'), of('b')], [3, 2], 'a: its middle pause + both ends, b: its start and end');
  assert.deepStrictEqual(seen, [[0, 2, '긴 침묵 줄이기 · A'], [1, 2, '긴 침묵 줄이기 · B']], 'progress');
  const br = talk([['on', 1], ['off', 2], ['on', 1]]); // a breath 25 dB under the speech in the middle of the pause
  for (let i = Math.round(1.9 * sr); i < 2.1 * sr; i++) br[0][i] += 0.017 * Math.sin(2 * Math.PI * 300 * i / sr);
  const breath = await VE.voiceEdit([track('br', br)], [{ trackId: 'br', a: 0, b: 4 * sr }], sr, { gaps: 'mid' });
  assert.strictEqual(breath.cuts.filter((c) => !c.add).length, 1, 'a breath counts as quiet');
  const ends = track('e', talk([['off', 2], ['on', 1], ['off', 2], ['on', 1], ['off', 2]]));
  const e = await VE.voiceEdit([ends], [{ trackId: 'e', a: 0, b: 8 * sr }], sr, { gaps: 'mid' });
  assert.strictEqual(e.cuts.length, 3, 'start, middle and end');
  assert.strictEqual(e.clips.get('e').length, 1, 'still one recording, not split at the cuts');
  near(E.projectEnd([{ clips: e.clips.get('e') }]) / sr, 3.5, 0.03, 'each pause 0.5 s');
  const sound = E.renderRegion(e.clips.get('e'), 0, Math.round(0.6 * sr));
  near(Math.max(...sound[0].subarray(Math.round(0.45 * sr))), 0.3, 0.01, 'speech starts 0.5 s in');
  const steady = track('s', [sine(2 * sr, 1000, sr, 0.3)]); // no quiet part: under -60 dBFS is silence, none here
  const st = await VE.voiceEdit([steady], [{ trackId: 's', a: 0, b: 2 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: st.clips.get('s') }]) / sr, 3, 0.02, '0.5 s padded at both ends, nothing skipped');
  assert.deepStrictEqual(st.skipped, []);
});
const join = (...xs) => { const o = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let p = 0;
  for (const x of xs) { o.set(x, p); p += x.length; } return o; };
t('긴 침묵 줄이기 ends: 0.5 s after the last sound heard (a soft word end counts), -60 dB when nothing is quiet',
  async () => {
  const soft = sine(Math.round(0.3 * sr), 1000, sr, 0.05); // 15 dB under speech: quiet between words, heard at the end
  const x = track('x', [join(talk([['off', 0.8], ['on', 1]])[0], soft, talk([['off', 1]])[0])]);
  const r = await VE.voiceEdit([x], [{ trackId: 'x', a: 0, b: 3.1 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: r.clips.get('x') }]) / sr, 0.5 + 1 + 0.3 + 0.5, 0.02, 'the soft end kept, then 0.5 s');
  const short = track('y', talk([['off', 0.2], ['on', 1], ['off', 0.1]])); // no 0.5 s quiet to measure the room from
  assert.strictEqual(V.quietest(short.clips[0].src.ch, sr), null);
  const y = await VE.voiceEdit([short], [{ trackId: 'y', a: 0, b: 1.3 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: y.clips.get('y') }]) / sr, 2, 0.02, 'no floor: by the speech level, 0.5 s each end');
  const fade = sine(Math.round(0.3 * sr), 1000, sr, 0.003); // 40 dB under the speech, over the room: a tail, not sound
  const z = track('z', [join(talk([['off', 1], ['on', 1]])[0], fade, talk([['off', 1]])[0])]);
  const zr = await VE.voiceEdit([z], [{ trackId: 'z', a: 0, b: 3.3 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: zr.clips.get('z') }]) / sr, 0.5 + 1 + 0.5, 0.02, 'faint tail inside the 0.5 s');
  const rumble = sine(Math.round(1 * sr), 40, sr, 0.03); // 40 Hz, 17 dB under the speech: not heard as sound
  const w = track('w', [join(talk([['off', 0.6], ['on', 1]])[0], rumble)]);
  const wr = await VE.voiceEdit([w], [{ trackId: 'w', a: 0, b: 2.6 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: wr.clips.get('w') }]) / sr, 0.5 + 1 + 0.5, 0.02, 'rumble under 150 Hz is quiet');
  // no 0.5 s without digital silence (floor = the zeros): -80 dB noise before 1.5 s of zeros, then a short word
  const z0 = (s) => new Float32Array(Math.round(s * sr)), word = sine(Math.round(0.3 * sr), 500, sr, 0.5);
  const v = track('v', [join(sine(Math.round(0.3 * sr), 1000, sr, 0.00014), z0(1.5), word, z0(0.6))]);
  const vr = await VE.voiceEdit([v], [{ trackId: 'v', a: 0, b: 2.7 * sr }], sr, { gaps: 'mid' });
  near(E.projectEnd([{ clips: vr.clips.get('v') }]) / sr, 0.5 + 0.3 + 0.5, 0.02, 'edits never overlap');
  assert.strictEqual(wr.clips.get('w')[0].src.ch[0].length, wr.clips.get('w')[0].length, 'one clip');
});
t('긴 침묵 줄이기 run again changes nothing: zeros a run padded at an end do not hide the room noise', async () => {
  // as a run leaves a take: 0.01 s padded, room noise, a word fading in, a louder pause, a word, a faint tail, zeros
  const sec = (s) => Math.round(s * sr), room = (s) => noise(sec(s), 0.001), z0 = (s) => new Float32Array(sec(s));
  const fadeIn = talk([['on', 1]])[0].map((v, i) => v * Math.min(1, i / sec(0.5)));
  const faint = sine(sec(0.2), 1000, sr, 0.0071); // -46 dB: sound over the room noise, quiet over the pause
  let tr = track('p', [join(z0(0.01), room(0.49), fadeIn, noise(sec(0.6), 0.0137), talk([['on', 1]])[0], faint,
    room(0.1), z0(0.4))]);
  const lens = [];
  for (let k = 0; k < 3; k++) {
    const r = await VE.voiceEdit([tr], [{ trackId: 'p', a: 0, b: E.projectEnd([tr]) }], sr, { gaps: 'mid' });
    tr = { ...tr, clips: r.clips.get('p') };
    lens.push(E.projectEnd([tr]) / sr);
  }
  near(lens[1], lens[0], 0.005, 'a second run: ' + lens);
  near(lens[2], lens[1], 0.005, 'a third run: ' + lens);
});
t('긴 침묵 줄이기: start and end become exactly the kept length, padded with silence; a range edge inside a '
  + 'recording stays', async () => {
  const x = track('x', talk([['off', 0.8], ['on', 1], ['off', 0.8], ['on', 1], ['off', 0.2]]));
  const r = await VE.voiceEdit([x], [{ trackId: 'x', a: 0, b: 3.8 * sr }], sr, { gaps: 'mid' });
  const end = E.projectEnd([{ clips: r.clips.get('x') }]), out = E.renderRegion(r.clips.get('x'), 0, end);
  near(end / sr, 0.5 + 1 + 0.8 + 1 + 0.5, 0.02, '0.8 s start cut, 0.8 s middle kept');
  assert(out[0].subarray(-Math.round(0.29 * sr)).every((v) => v === 0), 'the end padded with digital silence');
  const two = track('t', talk([['off', 0.6], ['on', 1], ['off', 0.2]]));
  two.clips.push(E.makeClip(E.makeSource(talk([['off', 0.6], ['on', 1], ['off', 0.2]])), 3 * sr, 't2'));
  const pair = [{ trackId: 't', a: 0, b: 1.8 * sr }, { trackId: 't', a: 3 * sr, b: 4.8 * sr }];
  const both = await VE.voiceEdit([two], pair, sr, { gaps: 'mid' });
  const close = (got, want, what) => got.flat().forEach((v, i) => near(v, want.flat()[i], 0.025, what)); // 10 ms blocks
  const spans = both.clips.get('t').map((c) => [c.start / sr, (c.start + c.length) / sr]);
  close(spans, [[0, 2], [3.2, 5.2]], 'each 2 s, moved');
  const at = both.done.map((d) => [d.newA / sr, d.newB / sr]);
  close(at, [[3.2, 5.2], [0, 2]], 'spans');
  assert.strictEqual(at[0][0] * sr, both.clips.get('t')[1].start, 'newA = where the later clip went');
  const long = track('l', talk([['off', 2], ['on', 1], ['off', 2], ['on', 1], ['off', 2]]));
  const mid = await VE.voiceEdit([long], [{ trackId: 'l', a: 0.5 * sr, b: 7.5 * sr }], sr, { gaps: 'mid' });
  assert.strictEqual(mid.cuts.length, 1, 'only the middle pause: the range starts and ends inside the recording');
  near(E.projectEnd([{ clips: mid.clips.get('l') }]) / sr, 6.5, 0.02, 'length');
});
t('한 번에 깔끔하게: steps in order, loudness at 보통, a step that cannot measure is skipped', async () => {
  const tr = track('a', talk([['on', 2], ['off', 1], ['on', 2]]));
  const rows = { noise: 'mid', lowcut: 'mid', even: 'mid', gaps: 'off', loud: 'mid' };
  const r = await VE.voiceEdit([tr], [{ trackId: 'a', a: 0, b: 5 * sr }], sr, rows);
  assert.deepStrictEqual(r.skipped, []);
  near(LD.integrated(E.renderRegion(r.clips.get('a'), 0, 5 * sr), sr), -16, 0.5, 'loudness');
  const steady = track('s', [sine(2 * sr, 1000, sr, 0.3)]);
  assert.deepStrictEqual((await VE.voiceEdit([steady], [{ trackId: 's', a: 0, b: 2 * sr }], sr, rows)).skipped,
    ['noise']);
  assert.strictEqual(V.skipNote('noise'), '잡음 줄이기는 건너뛰었어요 — 조용한 부분이 없어서');
});
t('panel presets: hum strength keeps the mains frequency; same names as the menu', () => {
  assert(!('freq' in P.PRESETS.hum[1].values), 'preset sets freq');
  assert.strictEqual(P.matchPreset('hum', { freq: 50, count: 3 }), '보통');
  assert.deepStrictEqual(P.PRESETS.deess.map((x) => x.name), ['약하게', '보통', '강하게']);
  assert.deepStrictEqual(P.TRACK_KINDS, ['hum', 'eq', 'comp', 'deess', 'reverb', 'echo']);
});

t('cli: apply voice… = the menu (cuts move markers on every track, skipped steps listed); hum listens', async () => {
  const fs = require('fs'), { run, fails, cp } = require('./helpers'), IO = require('../../src/core/fileio');
  const { makeTrack } = require('../../src/core/state'), f = cp('voice.vproj');
  const lane = (ch) => makeTrack({ name: '목소리', clips: [E.makeClip(E.makeSource(ch), 0, '말')] });
  fs.writeFileSync(f, IO.saveProject({ sampleRate: sr, tracks: [lane(talk([['on', 1], ['off', 2], ['on', 1]]))],
    markers: [{ id: 'm1', frame: Math.round(3.5 * sr), name: '끝' }] }));
  let r = await run('apply', f, 'voiceClean', '--gaps', 'mid', '--loud', 'low');
  assert.deepStrictEqual([r.cuts, r.skipped, r.params.loud, r.params.noise], [3, [], 'low', 'mid']); // + both ends
  near(r.changed[0].newLength, 3.5, 0.03, 'newLength');
  near((await run('info', f)).markers[0].at, 2.5, 0.03, 'marker: 1.5 s cut before it, 0.5 s padded at the start');
  r = await run('apply', f, 'voiceGate', '--level', 'high', '--from', '0.2', '--to', '0.4');
  assert.deepStrictEqual([r.skipped, r.changed], [['gate'], []]);
  await fails('BAD_ARG', 'apply', f, 'voiceLoud', '--level', 'loud');
  await fails('BAD_ARG', 'apply', f, 'voiceLoud', '--preset', '보통');
  fs.writeFileSync(f, IO.saveProject({ sampleRate: sr, tracks: [lane([sine(2 * sr, 50, sr, 0.2)])] }));
  r = await run('fx', f, '--track', '1', 'hum', '--on');
  assert.deepStrictEqual([r.fx.on, r.fx.freq, r.fx.count, r.fx.preset], [true, 50, 3, '보통']);
  // a character: its takes, the current line's included (they live in project.tracks while that line is open)
  const take = lane([sine(2 * sr, 50, sr, 0.2)]), P = require('../../src/core/fxparams');
  fs.writeFileSync(f, IO.saveProject({ sampleRate: sr, tracks: [take], script: { lineId: 'l1',
    lines: [{ id: 'l1', char: '철수', num: 1, text: '안녕', memo: '', takes: [], star: null }],
    chars: { 철수: { color: '#F472B6', fx: P.defaultFx(P.TRACK_KINDS) } } } }));
  r = await run('script', 'fx', f, '--char', '철수', 'hum', '--on');
  assert.strictEqual(r.fx.freq, 50, 'character hum heard on the current line');
});
