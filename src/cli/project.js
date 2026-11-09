// The project a file command works on (c = { p, o, f, a, audio }): load and save the .vproj, find tracks, clips,
// lines, takes and characters by the numbers and names the CLI shows, put edited ones back, check arguments.
const fs = require('fs');
const path = require('path');
const E = require('../core/edit');
const IO = require('../core/fileio');
const SC = require('../core/script');
const { readScript } = require('../core/scriptfile');
const { describe, describeScript } = require('../core/summary');
const { state, makeTrack, newProjectData } = require('../core/state');
const { writeAtomic, writeAtomicSync, uniquePaths } = require('../core/safewrite');
const { pool, RENDERS } = require('../core/pool');
const W = require('../core/workers');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// mtime + size of each file as load read it: save refuses when someone (the app, an editor) wrote it meanwhile
const stamps = new Map();
const stampOf = (file) => {
  try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return null; }
};

function load(file, script, use) {
  let bytes;
  // stat before read: a write in between makes the stamp differ at save, never hides it
  stamps.set(path.resolve(file), stampOf(file));
  try { bytes = fs.readFileSync(file); } catch (e) { // a Buffer is a Uint8Array: no copy of the whole file
    const none = e.code === 'ENOENT';
    fail(none ? 'NO_FILE' : 'READ_FAILED', `${file}: ${none ? 'does not exist' : e.message}`);
  }
  let loaded;
  try { loaded = IO.loadProject(bytes); } catch (e) { fail('BAD_PROJECT', e.message); }
  kind(loaded, script, file, use);
  // take ids are fresh from loadProject
  if (loaded.script) return (state.project = newProjectData(loaded.sampleRate, loaded));
  // same as the app's loadProjectFile: fresh ids, colors kept; makeTrack numbers new tracks against this project
  state.project = newProjectData(loaded.sampleRate, { ...loaded, tracks: [] });
  state.project.tracks = loaded.tracks.map((t) => {
    const base = makeTrack();
    return { ...base, ...t, id: base.id, color: t.color || base.color };
  });
  return state.project;
}
// a script project keeps its takes in its lines: what takes do not have is refused, use = the script command instead
function kind(p, script, where, use) {
  if (script !== 'any' && !!p.script !== !!script) {
    const instead = use ? `"sori ${use}"` : 'the "script ..." commands';
    if (p.script) fail('SCRIPT_PROJECT', `${where} is a script project (대본 녹음 모드): use ${instead}`);
    fail('NOT_SCRIPT', `${where} is not a script project; make one with "sori script import"`);
  }
  return p;
}
// write-then-rename like the app (safewrite): a crash never leaves a half-written project or a temp file
// a save packs each new take on this CPU (210 cleaned takes: 8 s); two or more are packed on several first (workers.js,
// the same bytes)
async function packAhead(p) {
  const todo = IO.unpacked(p);
  if (todo.length < 2) return;
  const blobs = await pool(todo.length, W.WORKERS, (i) => W.run('audiopack', 'pack', [todo[i].ch]));
  todo.forEach((s, i) => IO.keep(s, blobs[i]));
}
function save(file, p) {
  const key = path.resolve(file);
  if (stamps.has(key) && stampOf(file) !== stamps.get(key)) {
    fail('CHANGED', `${file} changed on disk while the command ran; nothing was saved. Run it again`);
  }
  try { writeAtomicSync(file, IO.saveProject(p)); } catch (e) { fail('WRITE_FAILED', `${file}: ${e.message}`); }
  stamps.set(key, stampOf(file));
}

// ---- tracks and clips: numbered from 1, as sori info shows them ----
const frames = (c, sec) => Math.round(sec * c.p.sampleRate);
const secs = (c, f) => Math.round(f / c.p.sampleRate * 1e4) / 1e4;
const byId = (p, id) => p.tracks.find((t) => t.id === id);
const setClips = (p, id, clips) => { p.tracks = p.tracks.map((t) => (t.id === id ? { ...t, clips } : t)); };
const trackNo = (p, id) => p.tracks.findIndex((t) => t.id === id) + 1;
function track(c, n) {
  const t = c.p.tracks[n - 1];
  if (!t) fail('NO_TRACK', `track ${n} does not exist; the project has ${c.p.tracks.length} track(s)`);
  return t;
}
function clipOf(t, n, k) {
  const x = t.clips[k - 1];
  if (!x) fail('NO_CLIP', `track ${n} has no clip ${k}; it has ${t.clips.length}`);
  return x;
}
const targets = (c) => (c.o.track ? [...new Set(c.o.track.map((n) => track(c, n)))] : c.p.tracks);
function span(c, end = E.projectEnd(c.p.tracks)) {
  const a = frames(c, c.o.from ?? 0), b = c.o.to === undefined ? end : frames(c, c.o.to);
  if (b <= a) fail('BAD_ARG', '--to must be after --from');
  return [a, b];
}
// a clip as sori info shows it, with its track and clip number
function where(p, id) {
  const d = describe(p);
  for (const [i, t] of p.tracks.entries()) {
    const k = t.clips.findIndex((x) => x.id === id);
    if (k >= 0) { const { index, ...rest } = d.tracks[i].clips[k]; return { track: i + 1, clip: index, ...rest }; }
  }
  return null;
}
const trackInfo = (p, t) => describe(p).tracks[trackNo(p, t.id) - 1];

// ---- script projects (대본 녹음 모드, spec §5-5): lines by name (철수-001), takes by name or number ('3' = 테이크 3)
// The CLI edits lines with their full take lists; project.tracks follows the current line for saving.
const linesOf = (c) => SC.linesNow(c.p);
function lineOf(c, ref) {
  const l = linesOf(c).find((x) => SC.lineName(x) === String(ref).trim());
  if (!l) fail('NO_LINE', `no line "${ref}"; names look like 철수-001 (see sori script info)`);
  return l;
}
// a take named exactly `ref` first, else '2' / '테이크 2' (core takeRef)
const takeByRef = (takes, ref) => takes.find((x) => x.name === String(ref).trim()) || SC.takeRef(takes, ref);
function takeOf(l, ref) {
  const t = takeByRef(l.takes, ref);
  const has = l.takes.length ? l.takes.map((x) => x.name).join(', ') : 'none';
  if (!t) fail('NO_TAKE', `${SC.lineName(l)} has no take "${ref}"; it has ${has}`);
  return t;
}
// --char 철수,영희 -> the names, each checked
// shortcut: a comma separates the names, so a character named with a comma cannot be given here
function charsOf(c) {
  const chars = [...new Set(String(c.o.char).split(',').map((x) => x.trim()).filter(Boolean))];
  if (!chars.length) fail('BAD_ARG', '--char needs a character name (several: 철수,영희)');
  chars.forEach((x) => charOf(c, x));
  return chars;
}
function charOf(c, name) {
  const all = c.p.script.chars;
  if (!Object.hasOwn(all, name)) fail('NO_CHAR', `no character "${name}"; characters: ${Object.keys(all).join(', ')}`);
  return all[name];
}
function putLines(c, lines) {
  const s = c.p.script;
  s.lines = lines;
  if (!lines.some((l) => l.id === s.lineId)) s.lineId = lines.length ? lines[0].id : null;
  c.p.tracks = (lines.find((l) => l.id === s.lineId) || { takes: [] }).takes;
}
const putLine = (c, l) => putLines(c, linesOf(c).map((x) => (x.id === l.id ? l : x)));
const lineInfo = (c, l) => describeScript(c.p).lines.find((x) => x.name === SC.lineName(l));

// ---- arguments ----
function name(s) {
  const n = String(s).trim().slice(0, 100);
  if (!n) fail('BAD_ARG', 'the name is empty');
  return n;
}
const textArg = (v, max, what) => {
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (s.length > max) fail('BAD_ARG', `${what} is longer than ${max} characters`);
  return s;
};
// '#' optional: unquoted, a shell reads #F472B6 as a comment; 6 digits, stored upper case
function hexColor(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim());
  if (!m) fail('BAD_ARG', '--color needs a hex color like F472B6 or "#F472B6"');
  return '#' + m[1].toUpperCase();
}
// the app asks "같은 이름의 파일 n개가 이미 있어요. 덮어쓸까요?"; the CLI cannot ask, so it refuses unless --overwrite
function checkOverwrite(c, files) {
  const there = files.filter((f) => fs.existsSync(f));
  if (!there.length || c.o.overwrite) return;
  const some = there.slice(0, 3).map((f) => path.basename(f)).join(', ') + (there.length > 3 ? ', …' : '');
  fail('EXISTS', `${there.length} file(s) already exist (${some}); add --overwrite to replace them`);
}
// an export of several files: names that clash get ' (2)', each is written as
// `<name>.part` and all are renamed only when every one is done; a failure removes the parts. make(i) -> bytes
async function writeAll(files, make, k = RENDERS) {
  const done = [];
  const write = async (f, act) => { try { await act(); } catch (e) { fail('WRITE_FAILED', `${f}: ${e.message}`); } };
  try {
    await pool(files.length, k, async (i) => {
      const data = await make(i);
      await write(files[i], () => writeAtomic(files[i] + '.part', data));
      done.push(files[i]);
    });
    for (const f of done) await write(f, () => fs.promises.rename(f + '.part', f));
  } catch (e) {
    for (const f of done) fs.rmSync(f + '.part', { force: true });
    throw e;
  }
}
// each audio file decoded at the project rate: [{ f, ch }]
async function decodeFiles(c, files) {
  const decoded = [];
  for (const f of files) {
    if (!fs.existsSync(f)) fail('NO_FILE', `${f} does not exist`);
    try { decoded.push({ f, ch: await c.audio.decode(f, c.p.sampleRate) }); } catch {
      fail('DECODE_FAILED', `${f}: cannot read this audio file (WAV, MP3, FLAC, OGG, M4A work)`);
    }
  }
  return decoded;
}
const baseName = (f) => path.basename(f).replace(/\.[^.]+$/, '');
async function scriptFile(file) {
  if (!fs.existsSync(file)) fail('NO_FILE', `${file} does not exist`);
  let got;
  try { got = await readScript(file); } catch (e) { fail('READ_FAILED', `${file}: ${e.message}`); }
  if (!got.lines.length) {
    fail('BAD_SCRIPT', `${file}: no lines found. A .txt needs "name: text" per line (or "name-005: text"); `
      + 'a table needs 캐릭터 | 대사 columns');
  }
  return got;
}

module.exports = {
  fail, load, kind, packAhead, save, takeByRef, writeAll, uniquePaths,
  frames, secs, byId, setClips, trackNo, track, clipOf, targets, span, where, trackInfo,
  linesOf, lineOf, takeOf, charOf, charsOf, putLines, putLine, lineInfo,
  name, textArg, hexColor, checkOverwrite, decodeFiles, baseName, scriptFile,
};
