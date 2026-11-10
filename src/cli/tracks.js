// File commands on the whole project and its tracks: info, new, track add/remove/move/set, import, fx, apply,
// tempo, export.
const fs = require('fs');
const path = require('path');
const E = require('../core/edit');
const P = require('../core/fxparams');
const A = require('../core/args');
const { safeName } = require('../core/fileio');
const { describe } = require('../core/summary');
const { state, makeTrack, newProjectData, sortByName } = require('../core/state');
const {
  fail, frames, secs, byId, setClips, track, span, where, trackInfo, name, hexColor,
  checkOverwrite, decodeFiles, baseName, writeAll, uniquePaths,
} = require('./project');
const R = require('./recipes');
const { applyFx, applyLines, EFFECTS } = require('./apply');

const SEC = 'sec', IDX = 'idx', IDXS = 'idxs';

function addTrack(c) {
  const type = c.o.type || 'empty', at = c.o.track && track(c, c.o.track);
  let t;
  if (type === 'duplicate') {
    if (!at) fail('BAD_ARG', 'duplicate needs --track N (the track to copy)');
    const { id, color } = makeTrack(); // fx is replaced on change, never mutated, so sharing it is safe
    t = { ...at, id, color, name: at.name + ' 복제', clips: at.clips.map((x) => ({ ...x, id: E.uid('c') })) };
  } else t = R.TRACK_TYPES[type](c.p);
  if (c.o.name !== undefined) t = { ...t, name: name(c.o.name) };
  const ts = [...c.p.tracks];
  ts.splice(at ? ts.indexOf(at) + 1 : ts.length, 0, t);
  c.p.tracks = ts;
  return { track: trackInfo(c.p, t) };
}

function setTrack(c) {
  const t = track(c, c.o.track), o = c.o, patch = R.mixPatch(o);
  if (o.color !== undefined) patch.color = hexColor(o.color);
  for (const k of ['mute', 'solo']) if (o[k] !== undefined) patch[k] = o[k];
  if (!Object.keys(patch).length) {
    fail('BAD_ARG', 'nothing to change: give --name, --volume, --pan, --mute, --solo or --color');
  }
  const n = { ...t, ...patch };
  c.p.tracks = c.p.tracks.map((x) => (x === t ? n : x));
  return { track: trackInfo(c.p, n) };
}

async function importFiles(c) {
  if (c.o.at !== undefined && !c.o.track) fail('BAD_ARG', '--at needs --track (new tracks start at 0, as in the app)');
  const target = c.o.track && track(c, c.o.track), decoded = await decodeFiles(c, c.a.files);
  const ids = decoded.map(({ f, ch }, i) => {
    const onto = i === 0 && target, base = baseName(f);
    const clip = E.makeClip(E.makeSource(ch), onto ? frames(c, c.o.at || 0) : 0, base);
    if (onto) setClips(c.p, target.id, E.sortClips([...byId(c.p, target.id).clips, clip]));
    else c.p.tracks = [...c.p.tracks, makeTrack({ name: base, clips: [clip] })];
    return clip.id;
  });
  return { imported: ids.map((id, i) => ({ file: decoded[i].f, ...where(c.p, id) })) };
}

function setFx(c) {
  const { kind } = c.a, master = !!c.o.master;
  if (master === !!c.o.track) fail('BAD_ARG', 'give either --track N or --master');
  const kinds = master ? [...P.MASTER_KINDS, 'gain'] : P.TRACK_KINDS;
  if (!kinds.includes(kind)) {
    fail('BAD_ARG', `unknown effect "${kind}"; ${master ? 'master' : 'track'} effects: ${kinds.join(', ')}`);
  }
  if (kind === 'gain') {
    if (c.o.preset !== undefined || c.o.on || c.o.off || !('gainDb' in c.f)) {
      fail('BAD_ARG', 'master gain is always on and has no presets: give --gainDb DB');
    }
    c.p.master = { ...c.p.master, gainDb: A.fill([P.MASTER_GAIN], null, c.f).gainDb };
    return { target: 'master', kind, gainDb: c.p.master.gainDb };
  }
  const t = !master && track(c, c.o.track);
  const next = R.fxNext(c, kind, master ? c.p.master.fx[kind] : t.fx[kind], [t]);
  if (master) c.p.master = { ...c.p.master, fx: { ...c.p.master.fx, [kind]: next } };
  else c.p.tracks = c.p.tracks.map((x) => (x === t ? { ...t, fx: { ...t.fx, [kind]: next } } : x));
  return { target: master ? 'master' : c.o.track, kind, fx: { ...next, preset: P.matchPreset(kind, next) } };
}

function setTempo(c) {
  const p = c.p, o = c.o;
  if (o.bpm === undefined && o.beats === undefined && o.grid === undefined) {
    fail('BAD_ARG', 'give --bpm, --beats or --grid');
  }
  if (o.bpm !== undefined) p.bpm = Math.max(20, Math.min(300, Math.round(o.bpm)));
  if (o.beats !== undefined) p.beats = Math.max(1, Math.min(12, o.beats));
  if (o.grid !== undefined) p.grid = o.grid;
  return { bpm: p.bpm, beats: p.beats, grid: p.grid };
}

// [[from, to, file]]: one file, or one per marker segment into a folder
function exportPlan(c, end) {
  const out = c.a.out;
  if (c.o.markers) {
    if (c.o.from !== undefined || c.o.to !== undefined) {
      fail('BAD_ARG', '--markers exports every marker segment; leave out --from/--to');
    }
    if (!c.p.markers.length) fail('NOTHING_TO_EXPORT', 'the project has no markers');
    const fmt = c.o.format || 'wav16', segs = E.markerSegments(c.p.markers, end, c.p.sampleRate);
    const width = String(segs.length).length;
    const file = (i, n) => path.join(out, `${String(i + 1).padStart(width, '0')} ${safeName(n)}${R.extOf(fmt)}`);
    return { fmt, files: segs.map(([a, b, n], i) => [a, b, file(i, n)]) };
  }
  const ext = path.extname(out).toLowerCase();
  if (ext !== '.wav' && ext !== '.mp3') {
    fail('BAD_ARG', 'the output file must end in .wav or .mp3 (or use --markers with a folder)');
  }
  const fmt = c.o.format || (ext === '.mp3' ? 'mp3_192' : 'wav16');
  if (R.extOf(fmt) !== ext) fail('BAD_ARG', `--format ${fmt} does not match ${ext}`);
  // one file goes into a folder that is there (--markers makes its folder)
  if (!fs.existsSync(path.dirname(out))) fail('WRITE_FAILED', `${path.dirname(out)} does not exist`);
  return { fmt, files: [[...span(c, end), out]] };
}
async function exportMix(c) {
  const only = c.o.track && track(c, c.o.track), tracks = only ? [{ ...only, mute: false, solo: false }] : c.p.tracks;
  const end = E.projectEnd(tracks), sr = c.p.sampleRate;
  if (!end) fail('NOTHING_TO_EXPORT', only ? `track ${c.o.track} has no sound` : 'the project has no sound');
  const { fmt, files } = exportPlan(c, end);
  const paths = uniquePaths(files.map((x) => x[2]));
  checkOverwrite(c, paths);
  const written = [];
  await writeAll(paths, async (i) => {
    const [a, b] = files[i], ch = await c.audio.mixdown(tracks, c.p.master, a, b, sr);
    written[i] = { file: paths[i], from: secs(c, a), to: secs(c, b), frames: ch[0].length,
      seconds: secs(c, ch[0].length) };
    return R.encode(fmt, ch, sr);
  }, R.jobsFor(fmt));
  return { format: fmt, sampleRate: sr, channels: 2, files: written };
}

const VERBS = [
  { name: 'info', usage: 'info <project>', about: 'tracks, clips, markers, effects and tempo as JSON',
    use: 'script info', args: ['project'], run: (c) => describe(c.p) },

  { name: 'new', usage: 'new <project> [--rate 44100|48000]',
    about: 'create an empty project (refuses an existing file)', write: true, live: 'sori live run newProject',
    args: ['project'], flags: { rate: [44100, 48000] },
    run(c) {
      if (fs.existsSync(c.a.project)) fail('EXISTS', `${c.a.project} already exists`);
      c.p = state.project = newProjectData(c.o.rate || 48000);
      return { project: c.a.project, sampleRate: c.p.sampleRate };
    } },

  { name: 'track add', usage: 'track add <project> [--type empty|voice|music|sfx|duplicate] [--track N] '
      + '[--name TEXT]',
    about: 'new track right below track N (at the end without --track); duplicate copies track N with its sound '
      + 'and effects',
    write: true, use: 'script take add', args: ['project'],
    flags: { type: ['empty', 'voice', 'music', 'sfx', 'duplicate'], track: IDX, name: 'str' },
    run: addTrack },

  { name: 'track remove', usage: 'track remove <project> --track N', about: 'delete a track and its clips',
    write: true, use: 'script take remove', args: ['project'], flags: { track: IDX }, need: ['track'],
    run(c) {
      const t = track(c, c.o.track);
      c.p.tracks = c.p.tracks.filter((x) => x !== t);
      return { removed: { index: c.o.track, name: t.name } };
    } },

  { name: 'track move', usage: 'track move <project> --track N --to M', about: 'move track N to position M',
    write: true, use: 'script take move', args: ['project'], flags: { track: IDX, to: IDX }, need: ['track', 'to'],
    run(c) {
      const t = track(c, c.o.track), ts = c.p.tracks.filter((x) => x !== t);
      ts.splice(Math.min(c.o.to, ts.length + 1) - 1, 0, t);
      c.p.tracks = ts;
      return { track: trackInfo(c.p, t) };
    } },

  { name: 'track sort', usage: 'track sort <project>',
    about: 'sort tracks by name like 트랙 > 이름순 정렬 (가나다, A-Z, numbers by size: 2 before 10); not in a script '
      + 'project (its takes keep their order)',
    write: true, args: ['project'],
    run(c) {
      c.p.tracks = sortByName(c.p.tracks);
      return { tracks: c.p.tracks.map((t) => trackInfo(c.p, t)) };
    } },

  { name: 'track set', usage: 'track set <project> --track N [--name TEXT] [--volume DB] [--pan -1..1] '
      + '[--mute on|off] [--solo on|off] [--color RRGGBB]',
    about: 'mixer values of a track (volume -60 dB = silent, max +6 dB, like the slider) and its color (any hex '
      + 'code, # optional; CLI only, the app has no color picker)',
    write: true, use: 'script take set', args: ['project'], need: ['track'], run: setTrack,
    flags: { track: IDX, name: 'str', volume: 'num', pan: 'num', mute: 'onoff', solo: 'onoff', color: 'str' } },

  { name: 'import', usage: 'import <project> <audio...> [--track N] [--at SEC]',
    about: 'add audio files (WAV/MP3/FLAC/OGG/M4A) like 열기: each file becomes a new track at the end, or the '
      + 'first file goes onto track N at SEC',
    write: true, audio: true, takes: true, args: ['project'], rest: 'files', flags: { track: IDX, at: SEC },
    run: importFiles },

  { name: 'fx', usage: `fx <project> (--track N | --master) <${[...new Set([...P.TRACK_KINDS, ...P.MASTER_KINDS])]
    .join('|')}|gain> [--preset NAME] [--on|--off] [--FIELD VALUE ...]`,
    about: 'always-on effects of a track or the master (effect panel). A preset or a field change turns the effect '
      + 'on unless --off; hum turned on without --freq listens to the track for 50 or 60 Hz. Master volume: '
      + '--master gain --gainDb DB',
    write: true, open: true, takes: true, args: ['project', 'kind'], run: setFx,
    flags: { track: IDX, master: 'bool', preset: 'str', on: 'bool', off: 'bool' } },

  { name: 'apply', usage: `apply <project> <${EFFECTS.join('|')}> [--track N,M] [--from SEC] `
      + '[--to SEC] [--preset NAME] [--FIELD VALUE ...] [--profile-from SEC --profile-to SEC] '
      + '[a script project, voice…: --line A,B | --char NAME[,NAME…] | --all-lines]',
    about: 'effect menu (changes the sound itself): on [from, to) of the tracks, or each whole track without a '
      + 'range. fxTempo moves later audio and markers like the app; reverb/echo tails overlay what follows. fxNoise '
      + 'needs a noise-only range. 목소리 정리: voiceX --level low|mid|high (voiceClean: --noise --lowcut --even '
      + '--gaps --loud off|low|mid|high); voiceGaps, per track: long pauses between speech cut, the start and end '
      + 'pauses set to exactly the kept length (digital silence added when short); a step that cannot measure its '
      + 'noise floor is listed in "skipped". In a script project 목소리 정리 also takes several lines (--line A,B, '
      + '--char, --all-lines): the ★ take of each, worked out on several CPUs; lines without ★ or sound are listed',
    write: true, open: true, takes: true, args: ['project', 'effect'], run: applyFx, lines: applyLines,
    flags: { track: IDXS, from: SEC, to: SEC, preset: 'str', 'profile-from': SEC, 'profile-to': SEC, char: 'str',
      'all-lines': 'bool' } },

  { name: 'tempo', usage: 'tempo <project> [--bpm 20..300] [--beats 1..12] [--grid time|beats]',
    about: 'speed (BPM), beats per bar and the beat grid', write: true, script: 'any', args: ['project'], run: setTempo,
    flags: { bpm: 'num', beats: 'int', grid: ['time', 'beats'] } },

  { name: 'export', usage: `export <project> <out.wav|out.mp3|folder> [--format ${R.FORMATS.join('|')}] `
      + '[--from SEC] [--to SEC] [--track N] [--markers] [--overwrite]',
    about: 'render like 내보내기: all tracks mixed (or only track N, as solo plays it), whole / range / one file per '
      + 'marker segment into a folder. An existing file is refused (EXISTS) unless --overwrite, as the app asks first',
    audio: true, use: 'script export', args: ['project', 'out'], run: exportMix,
    flags: { format: R.FORMATS, from: SEC, to: SEC, track: IDX, markers: 'bool', overwrite: 'bool' } },
];

module.exports = { VERBS };
