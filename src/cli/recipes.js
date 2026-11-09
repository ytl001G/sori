// The app's own rules, repeated for the file commands so both give the same result: typed tracks, the effect panel
// rule, the effect menu (destructive effects), mixer values, markers that follow edits, export segments and formats.
const E = require('../core/edit');
const FX = require('../core/effects');
const IO = require('../core/fileio');
const P = require('../core/fxparams');
const A = require('../core/args');
const V = require('../core/voice');
const { makeTrack } = require('../core/state');
const MP3 = require('../audio/mp3');
const { fail, name } = require('./project');

// ---- typed tracks: same recipes as commands.js addVoiceTrack / addMusicTrack / addSfxTrack (smoke checks they
// match) ----
const fxOn = (kind, values) => P.clampFx(kind, { ...values, on: true });
const preset = (kind, n) => P.PRESETS[kind].find((x) => x.name === n).values;
const typed = (n, db, fx = {}) => makeTrack({
  name: n, gain: 10 ** (db / 20), fx: { ...P.defaultFx(P.TRACK_KINDS), ...fx },
});
const TRACK_TYPES = {
  empty: (p) => makeTrack({}, p),
  voice: () => typed('목소리', 0, {
    eq: fxOn('eq', preset('eq', '목소리 또렷하게')), comp: fxOn('comp', preset('comp', '목소리 고르게')),
  }),
  music: () => typed('배경음악', -12, { eq: fxOn('eq', { mid: -3, midFreq: 2500 }) }),
  sfx: () => typed('효과음', -6),
};

// the effect panel's rule (fx, script fx): a preset or a field change turns the effect on unless --off; 전기 웅
// 소리 turned on without --freq listens to `lanes` for 50 or 60 Hz, as the panel does
function fxNext(c, kind, cur, lanes = []) {
  if (c.o.on && c.o.off) fail('BAD_ARG', 'give --on or --off, not both');
  const changes = c.o.preset !== undefined || Object.keys(c.f).length > 0;
  if (!changes && !c.o.on && !c.o.off) fail('BAD_ARG', 'nothing to change: give --preset, --on, --off or a field');
  const on = c.o.off ? false : (c.o.on || changes) ? true : cur.on;
  const next = P.clampFx(kind, { ...A.fill(P.FIELDS[kind], P.PRESETS[kind], c.f, c.o.preset, cur), on });
  const listen = kind === 'hum' && on && !cur.on && c.f.freq === undefined;
  if (listen) next.freq = V.heardHum(lanes, c.p.sampleRate) || next.freq;
  return next;
}

// the track header and mixer: name, volume (-60 dB = silent, max +6 like the slider), pan, view (track set, script
// take set)
function mixPatch(o) {
  const patch = {};
  if (o.name !== undefined) patch.name = name(o.name);
  if (o.volume !== undefined) patch.gain = o.volume <= -60 ? 0 : 10 ** (Math.min(6, o.volume) / 20);
  if (o.pan !== undefined) patch.pan = Math.max(-1, Math.min(1, o.pan));
  return patch;
}

// ---- destructive effects: same names, fields, defaults and placement as commands.js FXDEFS ----
const fld = (key, min, max, value) => ({ key, min, max, value });
const SHAPES = ['linear', 'smooth', 'fast', 'slow']; // fade curves, E.FADE_SHAPES
const SHAPE = { key: 'shape', value: 'linear', options: SHAPES.map((value) => ({ value })) };
const APPLY = {
  fxGain: [FX.gain, { fields: [fld('db', -24, 24, 3)] }],
  fxNormalize: [FX.normalize, { fields: [fld('db', -12, 0, -1)] }],
  fxFadeIn: [FX.fadeIn, { fields: [SHAPE] }],
  fxFadeOut: [FX.fadeOut, { fields: [SHAPE] }],
  fxSilence: [FX.silence, {}],
  fxReverse: [FX.reverse, {}],
  fxTempo: [FX.tempo, { ripple: true, fields: [fld('percent', 50, 200, 110)] }],
  fxPitch: [FX.pitch, { fields: [fld('semitones', -12, 12, 2)] }],
  fxNoise: [FX.noiseReduce, { profile: true, kind: 'noise' }],
  fxEq: [FX.eq, { kind: 'eq' }],
  fxComp: [FX.compressor, { kind: 'comp' }],
  fxReverb: [FX.reverb, { overlay: true, kind: 'reverb' }],
  fxEcho: [FX.echo, { overlay: true, kind: 'echo' }],
};
// 목소리 정리 (commands/voice.js): a strength word per step (low | mid | high = 약하게 · 보통 · 강하게, loudness 작게 ·
// 보통 · 크게); voiceClean has a row per step with 'off', its defaults = the app's first ones
const level = (key, value = 'mid', off = false) => ({ key, value,
  options: [...(off ? ['off'] : []), ...V.LEVELS].map((v) => ({ value: v })) });
const one = (step) => ({ fields: [level('level')], rows: (v) => ({ [step]: v.level }) });
const VOICE = {
  voiceClean: { fields: Object.entries(V.CLEAN).map(([k, v]) => level(k, v, true)), rows: (v) => v },
  voiceLoud: one('loud'), voiceGaps: one('gaps'), voiceDeess: one('deess'), voiceHum: one('hum'),
  voiceGate: one('gate'), voiceEven: one('even'),
};

// markers follow ripple edits only when the edit covers every track
function rippleMarkers(p, ids, a, b, newLen) {
  if (!p.tracks.length || !p.tracks.every((t) => ids.has(t.id))) return;
  p.markers = p.markers.map((m) => ({ ...m, frame: E.remapFrame(m.frame, a, b, newLen) }));
}
// [start, end, name] between markers, like 내보내기 > 마커 구간별 (pieces under 10 ms skipped)
function markerSegments(p, end) {
  const cuts = [{ frame: 0, name: '시작' }, ...p.markers.filter((m) => m.frame < end)], out = [];
  cuts.forEach((m, i) => {
    const a = m.frame, b = i + 1 < cuts.length ? cuts[i + 1].frame : end;
    if (b - a >= Math.round(0.01 * p.sampleRate)) out.push([a, b, m.name]);
  });
  return out;
}

// the export dialog's formats
const FORMATS = ['wav16', 'wav24', 'mp3_128', 'mp3_192', 'mp3_320'];
const extOf = (fmt) => (fmt.startsWith('mp3') ? '.mp3' : '.wav');
const encode = (fmt, ch, sr) => (fmt.startsWith('mp3')
  ? MP3.encode(ch, sr, +fmt.split('_')[1])
  : IO.encodeWav(ch, sr, fmt === 'wav24' ? 24 : 16));

module.exports = {
  TRACK_TYPES, fxNext, mixPatch, SHAPES, APPLY, VOICE, rippleMarkers, markerSegments, FORMATS, extOf, encode,
  jobsFor: MP3.jobsFor,
};
