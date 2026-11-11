// sori file commands follow the app rules. The checks build one project (단편.vproj) step by step, in order.
const { assert, t, sr, cp, decoded, run, fails } = require('./helpers');

const P = '단편.vproj';
const info = () => run('info', P);

t('cli: new, import (fake decoder), typed tracks below the current one, remove', async () => {
  await run('new', P);
  await fails('EXISTS', 'new', P);
  require('fs').writeFileSync(cp('voice.wav'), 'x');
  let r = await run('import', P, 'voice.wav');
  assert.deepStrictEqual(decoded, [['voice.wav', sr]]);
  const im = r.imported[0];
  assert.deepStrictEqual([im.track, im.clip, im.name, im.lengthFrames], [1, 1, 'voice', sr]);
  await fails('NO_FILE', 'import', P, 'missing.wav');
  await fails('BAD_ARG', 'import', P, 'voice.wav', '--at', '1');
  // typed track below track 1, same recipe as 목소리 트랙
  r = await run('track', 'add', P, '--type', 'voice', '--track', '1');
  const fx = r.track.fx;
  assert.deepStrictEqual([r.track.index, r.track.name, fx.eq.on, fx.eq.preset, fx.comp.preset],
    [2, '목소리', true, '목소리 또렷하게', '목소리 고르게']);
  r = await run('track', 'add', P, '--type', 'music');
  assert.deepStrictEqual([r.track.index, r.track.volumeDb, r.track.fx.eq.mid, r.track.fx.eq.midFreq],
    [3, -12, -3, 2500]);
  r = await run('track', 'add', P, '--type', 'duplicate', '--track', '1');
  assert.deepStrictEqual([r.track.index, r.track.name, r.track.clips.length], [2, 'voice 복제', 1]);
  await run('track', 'remove', P, '--track', '2');
  await fails('NO_TRACK', 'track', 'remove', P, '--track', '9');
});

t('cli: always-on effects (presets, clamping, master) and destructive effects', async () => {
  // a preset turns it on, fields override, values clamp; master gain and limiter
  let r = await run('fx', P, '--track', '1', 'eq', '--preset', '목소리 또렷하게', '--low', '-40');
  assert.deepStrictEqual([r.fx.on, r.fx.lowcut, r.fx.low, r.fx.preset], [true, 80, -15, null]);
  r = await run('fx', P, '--track', '1', 'eq', '--off');
  assert.deepStrictEqual([r.fx.on, r.fx.low], [false, -15]);
  r = await run('fx', P, '--master', 'limiter', '--preset', '크게');
  assert.deepStrictEqual([r.fx.on, r.fx.drive], [true, 4]);
  await run('fx', P, '--master', 'gain', '--gainDb', '-30');
  await fails('BAD_ARG', 'fx', P, '--track', '1', 'limiter', '--on');
  await fails('BAD_ARG', 'fx', P, '--track', '1', 'eq', '--bass', '3');
  const d = await info();
  assert.deepStrictEqual([d.master.gainDb, d.master.fx.limiter.preset, d.tracks[0].fx.eq.on], [-24, '크게', false]);
  // destructive effect = new sound; +6.02 dB doubles the samples
  r = await run('apply', P, 'fxGain', '--db', '6.0206', '--track', '1');
  assert.deepStrictEqual(r.changed, [{ track: 1, from: 0, to: 1, newLength: 1 }]);
  await fails('BAD_ARG', 'apply', P, 'fxNoise');
  await fails('BAD_ARG', 'apply', P, 'fxWobble');
});

t('cli: split, markers, ripple delete moves markers only when every track is cut', async () => {
  // split at 0.5, marker at 0.75, delete 0.25-0.5 on every track: the marker follows to 0.5
  const r = await run('clip', 'split', P, '--at', '0.5');
  assert.deepStrictEqual(r.split, [1]);
  await run('marker', 'add', P, '--at', '0.75');
  await fails('EXISTS', 'marker', 'add', P, '--at', '0.75');
  await run('range', 'delete', P, '--from', '0.25', '--to', '0.5');
  const d = await info();
  assert.deepStrictEqual(d.tracks[0].clips.map((c) => [c.start, c.length]), [[0, 0.25], [0.25, 0.5]]);
  assert.deepStrictEqual([d.markers[0].name, d.markers[0].at, d.length], ['마커 1', 0.5, 0.75]);
  // a range on one track only leaves markers in place
  await run('range', 'insert', P, '--at', '0', '--length', '0.5', '--track', '1');
  assert.strictEqual((await info()).markers[0].at, 0.5);
  await run('range', 'delete', P, '--from', '0', '--to', '0.5', '--track', '1');
});

t('cli: clips: move to another track, volume + fades + curves, trim, merge', async () => {
  let r = await run('clip', 'move', P, '--track', '1', '--clip', '2', '--to-track', '2', '--to', '1');
  assert.deepStrictEqual([r.clip.track, r.clip.clip, r.clip.start], [2, 1, 1]);
  const clip = ['--track', '2', '--clip', '1'];
  r = await run('clip', 'set', P, ...clip, '--volume', '-6', '--fade-in', '0.1', '--fade-out', '9');
  assert.deepStrictEqual([r.clip.volumeDb, r.clip.fadeIn, r.clip.fadeOut], [-6, 0.1, 0.4]);
  r = await run('clip', 'set', P, ...clip, '--fade-in-shape', 'smooth', '--fade-out-shape', 'linear');
  assert.deepStrictEqual([r.clip.fadeInShape, r.clip.fadeOutShape, r.clip.fadeIn], ['smooth', 'linear', 0.1],
    'fade curves, the fade kept');
  await fails('BAD_ARG', 'clip', 'set', P, ...clip, '--fade-in-shape', 'wavy');
  r = await run('clip', 'trim', P, ...clip, '--start', '0', '--end', '1.25');
  // the left edge stops where the recorded sound starts
  assert.deepStrictEqual([r.clip.start, r.clip.length], [0.5, 0.75]);
  await run('clip', 'move', P, ...clip, '--to-track', '1');
  r = await run('clip', 'merge', P, '--track', '1');
  assert.deepStrictEqual([r.clip.start, r.clip.length], [0, 1.25]);
  await fails('NOTHING_TO_DO', 'clip', 'merge', P, '--track', '1');
});

t('cli: mixer values, track color, order, tempo', async () => {
  const one = ['--track', '1'];
  let r = await run('track', 'set', P, ...one, '--volume', '-6.0206', '--pan', '-2', '--mute', 'on', '--name', '내레이션');
  assert.deepStrictEqual([r.track.gain.toFixed(3), r.track.pan, r.track.mute, r.track.name],
    ['0.500', -1, true, '내레이션']);
  assert.strictEqual((await run('track', 'set', P, ...one, '--color', 'f472b6')).track.color, '#F472B6');
  assert.strictEqual((await run('track', 'set', P, ...one, '--color', '#123ABC')).track.color, '#123ABC');
  for (const bad of ['red', '#12345', '1234567', '']) await fails('BAD_ARG', 'track', 'set', P, ...one, '--color', bad);
  r = await run('track', 'move', P, ...one, '--to', '9');
  assert.strictEqual(r.track.index, 3);
  r = await run('tempo', P, '--bpm', '999', '--beats', '3', '--grid', 'beats');
  assert.deepStrictEqual([r.bpm, r.beats, r.grid], [300, 3, 'beats']);
  await run('marker', 'set', P, '--marker', '1', '--name', '둘째', '--at', '0.5');
});

t('cli: export (by markers, one track, overwrite), errors, a no-op round trip', async () => {
  // export by markers: "N name.wav" per segment, like the app
  let r = await run('export', P, 'parts', '--markers');
  assert.deepStrictEqual(r.files.map((f) => require('path').basename(f.file)), ['1 시작.wav', '2 둘째.wav']);
  assert.deepStrictEqual(r.files.map((f) => f.frames), [sr / 2, sr * 3 / 4]);
  r = await run('export', P, 'only.wav', '--track', '3', '--from', '0.25');
  assert.strictEqual(r.files[0].frames, sr);
  await fails('EXISTS', 'export', P, 'only.wav'); // the app asks before overwriting
  await run('export', P, 'only.wav', '--overwrite');
  await fails('BAD_ARG', 'export', P, 'x.mp3', '--format', 'wav16');
  // --clip: that clip alone, from its start to its end
  const c3 = (await info()).tracks[2].clips[0];
  r = await run('export', P, 'clip.wav', '--track', '3', '--clip', '1');
  assert.deepStrictEqual([r.files[0].frames, r.files[0].from], [c3.lengthFrames, c3.start], 'one clip');
  await fails('BAD_ARG', 'export', P, 'clip.wav', '--clip', '1');
  await fails('BAD_ARG', 'export', P, 'clip2.wav', '--track', '3', '--clip', '1', '--from', '0');
  await fails('NO_CLIP', 'export', P, 'clip2.wav', '--track', '3', '--clip', '9');
  await run('marker', 'remove', P, '--marker', '1');
  const d = await info();
  assert.deepStrictEqual([d.markers.length, d.tracks.map((x) => x.name), d.bpm], [0, ['목소리', '배경음악', '내레이션'], 300]);
  r = await fails('BAD_ARG', 'clip', 'move', P, '--track', '1');
  assert.match(r.usage, /^sori clip move <project> --track N --clip K/);
  await fails('UNKNOWN_COMMAND', 'track', 'paint', P);
  await fails('BAD_PROJECT', 'info', 'voice.wav');
  // load -> save keeps everything: a no-op round trip gives the same summary
  const before = JSON.stringify(await info());
  await run('tempo', P, '--bpm', '300');
  assert.strictEqual(JSON.stringify(await info()), before);
});

t('cli: track sort like 트랙 > 이름순 정렬 (numbers by size), not in a script project', async () => {
  const S = '정렬.vproj';
  await run('new', S);
  for (const n of ['보컬10', '하늘', '보컬2', 'B', '보컬1']) await run('track', 'add', S, '--name', n);
  const r = await run('track', 'sort', S);
  assert.deepStrictEqual(r.tracks.map((x) => x.name), ['보컬1', '보컬2', '보컬10', '하늘', 'B'], 'Korean first');
  assert.deepStrictEqual((await run('info', S)).tracks.map((x) => x.index), [1, 2, 3, 4, 5]);
});
t('cli: save refuses a project changed on disk since load, and leaves no temp file', async () => {
  const fs = require('fs'), path = require('path'), PR = require('../../src/cli/project');
  await run('new', '변경.vproj');
  const f = cp('변경.vproj'), p = PR.load(f, 'any');
  fs.appendFileSync(f, ' ');
  assert.throws(() => PR.save(f, p), (e) => e.code === 'CHANGED');
  PR.load(f, 'any');
  PR.save(f, p);
  assert.ok(!fs.readdirSync(path.dirname(f)).some((n) => n.endsWith('.tmp')), 'no tmp left');
});
