// File commands of script projects (대본 녹음 모드, spec §5-5): script info/import/unscript, lines, takes, ★,
// character effects and colors, per-line export.
const fs = require('fs');
const path = require('path');
const E = require('../core/edit');
const P = require('../core/fxparams');
const SC = require('../core/script');
const { safeName } = require('../core/fileio');
const { describe, describeScript } = require('../core/summary');
const { state, makeTrack, newProjectData, COLORS } = require('../core/state');
const {
  fail, load, secs, linesOf, lineOf, takeOf, charOf, charsOf, putChar, putLines, putLine, lineInfo, textArg, hexColor,
  checkOverwrite, decodeFiles, baseName, scriptFile, writeAll, uniquePaths,
} = require('./project');
const R = require('./recipes');

const LINE_TAKE = { line: 'str', take: 'str' };

// 대본 넣기: a new script project, a plain project converted, or a script project updated by line name
async function importScript(c) {
  const got = await scriptFile(c.a.file), dryRun = !!c.o['dry-run'];
  const chars = Object.create(null); // as the app: a character may be named __proto__
  if (dryRun) c.noSave = true;
  const lines = got.lines.length, renumbered = got.dup, fresh = { lines: got.lines, lineId: got.lines[0].id, chars };
  if (!c.p && !fs.existsSync(c.a.project)) { // sori live: c.p is the open project
    SC.addChars(chars, got.lines, COLORS);
    const sampleRate = c.o.rate || 48000;
    if (!dryRun) c.p = state.project = newProjectData(sampleRate, { script: fresh });
    const characters = Object.keys(chars);
    return { dryRun, action: 'created', project: c.a.project, sampleRate, lines, characters, renumbered };
  }
  c.p = c.p || load(c.a.project, 'any');
  if (!c.p.script) {
    SC.addChars(chars, got.lines, COLORS);
    const deletedTracks = c.p.tracks.length;
    if (!dryRun) { c.p.script = fresh; c.p.tracks = []; }
    return { dryRun, action: 'converted', deletedTracks, lines, characters: Object.keys(chars), renumbered };
  }
  const { lines: merged, counts, names } = SC.merge(linesOf(c), got.lines);
  if (!dryRun) {
    const ch = Object.assign(Object.create(null), c.p.script.chars); // a new character may be __proto__
    SC.addChars(ch, merged, COLORS);
    c.p.script.chars = ch;
    putLines(c, merged);
  }
  return { dryRun, action: 'updated', counts, ...names, renumbered };
}

function setLine(c) {
  if (c.o.text === undefined && c.o.memo === undefined) fail('BAD_ARG', 'nothing to change: give --text and/or --memo');
  const l = lineOf(c, c.o.line);
  const text = c.o.text === undefined ? l.text : textArg(c.o.text, 1000, '--text');
  const memo = c.o.memo === undefined ? l.memo : textArg(c.o.memo, 300, '--memo');
  if (!text && !memo) fail('BAD_ARG', 'a line needs a text or a memo');
  putLine(c, SC.editLine(l, text, memo));
  return { line: lineInfo(c, l) };
}

async function addTakes(c) {
  const l = lineOf(c, c.o.line), look = charOf(c, l.char), decoded = await decodeFiles(c, c.a.files);
  let next = l;
  for (const { f, ch } of decoded) {
    const clip = E.makeClip(E.makeSource(ch), 0, baseName(f));
    const t = SC.takeView(makeTrack({ name: SC.nextTakeName(next.takes), clips: [clip] }), look);
    next = { ...next, takes: [...next.takes, t], ...(!next.star && SC.withStar(t.id)) };
  }
  putLine(c, next);
  return { line: lineInfo(c, next), added: next.takes.slice(l.takes.length).map((t) => t.name) };
}

function setTake(c) {
  const l = lineOf(c, c.o.line), t = takeOf(l, c.o.take), patch = R.mixPatch(c.o);
  if (!Object.keys(patch).length) fail('BAD_ARG', 'nothing to change: give --name, --volume or --pan');
  const n = { ...t, ...patch };
  putLine(c, { ...l, takes: l.takes.map((x) => (x === t ? n : x)) });
  const volumeDb = describe({ ...c.p, tracks: [n] }).tracks[0].volumeDb;
  return { line: lineInfo(c, l), take: { name: n.name, volumeDb, pan: n.pan } };
}

function setCharFx(c) {
  const { kind } = c.a, ch = charOf(c, c.o.char);
  if (!P.TRACK_KINDS.includes(kind)) {
    fail('BAD_ARG', `unknown effect "${kind}"; character effects: ${P.TRACK_KINDS.join(', ')}`);
  }
  const next = R.fxNext(c, kind, ch.fx[kind], linesOf(c).filter((l) => l.char === c.o.char).flatMap((l) => l.takes));
  putChar(c, c.o.char, { ...ch, fx: { ...ch.fx, [kind]: next } });
  return { char: c.o.char, kind, fx: { ...next, preset: P.matchPreset(kind, next) } };
}

// what script export renders: [{ l, t (the take as heard), a, b }]. The ★ take of each line (every line or --char);
// --line: its ★ take, or --take N instead (as measure), and --clip K only that clip from its start to its end
function exportJobs(c) {
  const view = (l, t) => ({ ...SC.takeView(t, c.p.script.chars[l.char]), mute: false, solo: false });
  const whole = (l, t) => { const v = view(l, t); return { l, t: v, a: 0, b: E.projectEnd([v]) }; };
  if (c.o.line === undefined) {
    if (c.o.take !== undefined || c.o.clip !== undefined) fail('BAD_ARG', '--take / --clip need --line NAME');
    const { ready, skipped } = SC.exportPick(linesOf(c), c.o.char !== undefined ? { chars: charsOf(c) } : {});
    return { jobs: ready.map((l) => whole(l, SC.starTake(l))), skipped };
  }
  const l = lineOf(c, c.o.line), t = c.o.take !== undefined ? takeOf(l, c.o.take) : SC.starTake(l);
  if (!t) return { jobs: [], skipped: [l] };
  if (!t.clips.length) fail('NOTHING_TO_EXPORT', `${SC.lineName(l)} ${t.name} has no sound`);
  if (c.o.clip === undefined) return { jobs: [whole(l, t)], skipped: [] };
  const x = t.clips[c.o.clip - 1];
  if (!x) fail('NO_CLIP', `${SC.lineName(l)} ${t.name} has no clip ${c.o.clip}; it has ${t.clips.length}`);
  return { jobs: [{ l, t: { ...view(l, t), clips: [x] }, a: x.start, b: E.clipEnd(x) }], skipped: [] };
}
// 대사별 내보내기: the ★ take of each chosen line through its character's and the master effects. Every line or
// --char 철수,영희: a folder per character; --line: in <folder> itself (also one take or one clip of it)
async function exportLines(c) {
  if (c.o.char !== undefined && c.o.line !== undefined) fail('BAD_ARG', 'give --char or --line, not both');
  const { jobs, skipped } = exportJobs(c), sr = c.p.sampleRate, fmt = c.o.format || 'wav16';
  if (!jobs.length) fail('NOTHING_TO_EXPORT', `no line there has a ★ take (${skipped.length} without)`);
  const sub = (l) => (c.o.line !== undefined ? [] : [safeName(l.char)]);
  const file = ({ l }) => path.join(c.a.out, ...sub(l), safeName(SC.lineName(l)) + R.extOf(fmt));
  const paths = uniquePaths(jobs.map(file));
  checkOverwrite(c, paths);
  const files = [];
  await writeAll(paths, async (i) => {
    const { l, t, a, b } = jobs[i], ch = await c.audio.mixdown([t], c.p.master, a, b, sr);
    files[i] = { line: SC.lineName(l), take: t.name, ...(c.o.clip !== undefined && { clip: c.o.clip }),
      file: paths[i], seconds: secs(c, ch[0].length) };
    return R.encode(fmt, ch, sr);
  }, R.jobsFor(fmt));
  const redo = jobs.filter((j) => j.l.state === 'redo').map((j) => SC.lineName(j.l));
  return { format: fmt, sampleRate: sr, files, skipped: skipped.map(SC.lineName), redo };
}

const VERBS = [
  { name: 'script info', usage: 'script info <project>', script: true, args: ['project'],
    about: 'a script project (대본 녹음 모드): every line (name 철수-001, text, memo, state redo, takes, ★), characters '
      + 'with effects, progress',
    run: (c) => ({ sampleRate: c.p.sampleRate, master: describe(c.p).master, ...describeScript(c.p) }) },

  { name: 'script import', usage: 'script import <project> <script.txt|.csv|.tsv|.xlsx> [--rate 44100|48000] '
      + '[--dry-run]',
    creates: true, script: 'any', write: true, args: ['project', 'file'], run: importScript,
    flags: { rate: [44100, 48000], 'dry-run': 'bool' },
    about: 'like 대본 넣기. No file yet: a new script project (--rate, default 48000). A plain project: becomes a '
      + 'script project, its tracks are deleted (deletedTracks). A script project: the new script is the base, lines '
      + 'match by name and keep their takes, a recorded line with new text becomes redo, lines missing from it are '
      + 'deleted with their takes. .txt = "name: text" per line ("name-005: text" keeps that number, others count '
      + 'on), tables = 캐릭터 | 대사 (| 번호 | 메모) columns. --dry-run only reports' },

  { name: 'script unscript', usage: 'script unscript <project> [--dry-run]', script: true, write: true,
    args: ['project'], flags: { 'dry-run': 'bool' },
    about: 'like 보통 프로젝트로 바꾸기: every take becomes a track named "철수-001 테이크 1" (script order, then '
      + 'recording order), with its character color and effects; lines, memos and ★ are gone. --dry-run only reports',
    run(c) {
      const tracks = SC.unscript(c.p);
      if (c.o['dry-run']) c.noSave = true;
      else { c.p.script = null; c.p.tracks = tracks; }
      return { dryRun: !!c.o['dry-run'], tracks: tracks.map((t) => t.name) };
    } },

  { name: 'script line set', usage: 'script line set <project> --line NAME [--text TEXT] [--memo TEXT]',
    script: true, write: true, args: ['project'], flags: { line: 'str', text: 'str', memo: 'str' }, need: ['line'],
    about: 'like 대사 고치기: text (max 1000) and memo (max 300); a recorded line whose text changes becomes redo '
      + '(다시 녹음 필요)',
    run: setLine },

  { name: 'script take add', usage: 'script take add <project> --line NAME <audio...>', script: true, write: true,
    audio: true, args: ['project'], rest: 'files', flags: { line: 'str' }, need: ['line'], run: addTakes,
    about: 'each audio file becomes a new take of the line (테이크 n, from 0 s), like dropping a file in the app; '
      + '★ stays (a line without ★ gets the first new take)' },

  { name: 'script take remove', usage: 'script take remove <project> --line NAME --take N|NAME', script: true,
    write: true, args: ['project'], flags: LINE_TAKE, need: ['line', 'take'],
    about: 'delete a take; removing the ★ take leaves the line without ★ (★ never moves by itself). Other takes '
      + 'keep their names',
    run(c) {
      const l = lineOf(c, c.o.line), t = takeOf(l, c.o.take);
      putLine(c, { ...l, takes: l.takes.filter((x) => x !== t), star: l.star === t.id ? null : l.star });
      return { removed: t.name, line: lineInfo(c, l) };
    } },

  { name: 'script take move', usage: 'script take move <project> --line NAME --take N|NAME --to M', script: true,
    write: true, args: ['project'], flags: { ...LINE_TAKE, to: 'idx' }, need: ['line', 'take', 'to'],
    about: 'move a take to position M among the line\'s takes, like dragging its grip (names stay)',
    run(c) {
      const l = lineOf(c, c.o.line), t = takeOf(l, c.o.take), ts = l.takes.filter((x) => x !== t);
      ts.splice(Math.min(c.o.to, ts.length + 1) - 1, 0, t);
      putLine(c, { ...l, takes: ts });
      return { line: lineInfo(c, l) };
    } },

  { name: 'script take set', usage: 'script take set <project> --line NAME --take N|NAME [--name TEXT] '
      + '[--volume DB] [--pan -1..1]',
    script: true, write: true, args: ['project'], need: ['line', 'take'], run: setTake,
    flags: { ...LINE_TAKE, name: 'str', volume: 'num', pan: 'num' },
    about: 'a take\'s header and mixer values, like track set (takes have no M/S; color and effects come from the '
      + 'character)' },

  { name: 'script star', usage: 'script star <project> --line NAME --take N|NAME', script: true, write: true,
    args: ['project'], flags: LINE_TAKE, need: ['line', 'take'],
    about: 'the ★ take = the one exported. Picking it (even the same take again) clears redo',
    run(c) {
      const l = lineOf(c, c.o.line), t = takeOf(l, c.o.take);
      putLine(c, { ...l, ...SC.withStar(t.id) });
      return { line: lineInfo(c, l) };
    } },

  { name: 'script fx', usage: `script fx <project> --char NAME <${P.TRACK_KINDS.join('|')}> [--preset NAME] `
      + '[--on|--off] [--FIELD VALUE ...]',
    script: true, write: true, open: true, args: ['project', 'kind'], need: ['char'], run: setCharFx,
    flags: { char: 'str', preset: 'str', on: 'bool', off: 'bool' },
    about: 'a character\'s effects (one set for all its lines and takes, plus the master). Same rule as fx' },

  { name: 'script color', usage: 'script color <project> --char NAME --color RRGGBB', script: true, write: true,
    args: ['project'], flags: { char: 'str', color: 'str' }, need: ['char', 'color'],
    about: 'a character\'s color: all its lines and takes (any hex code, # optional; CLI only, like track set '
      + '--color)',
    run(c) {
      const ch = charOf(c, c.o.char), color = hexColor(c.o.color);
      putChar(c, c.o.char, { ...ch, color });
      return { char: c.o.char, color };
    } },

  { name: 'script export', usage: `script export <project> <folder> [--format ${R.FORMATS.join('|')}] `
      + '[--char NAME[,NAME…] | --line NAME [--take N|NAME] [--clip K]] [--overwrite]',
    script: true, audio: true, args: ['project', 'out'], run: exportLines,
    flags: { format: R.FORMATS, char: 'str', line: 'str', take: 'str', clip: 'idx', overwrite: 'bool' },
    about: 'like 대사별 내보내기: the ★ take of each line (character + master effects) as '
      + '<folder>/캐릭터/캐릭터-번호.wav: every line, or the characters given (--char 철수,영희); --line NAME: that one line '
      + 'as <folder>/캐릭터-번호.wav, with --take N that take instead of the ★, with --clip K only that clip of it '
      + 'from its start to its end (이 클립만 내보내기). An existing file is refused (EXISTS) unless --overwrite, as the '
      + 'app asks first. Lines without ★ are skipped (listed); redo lines with ★ are exported and listed in redo' },
];

module.exports = { VERBS };
