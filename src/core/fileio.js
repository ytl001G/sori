// The .vproj container (the WAV/MP3 encoders live in encoders.js). Pure (Uint8Array in/out) so npm test covers it.
const crypto = require('crypto');
const { makeSource, makeClip, srcLen, clampFades, uid } = require('./edit');
const P = require('./fxparams');
const SC = require('./script');
const AP = require('./audiopack');
const PK = require('./parked');
const { encodeWav, encodeMp3 } = require('./encoders');

// ---- .vproj: "VPRJ" | u32 version | u32 jsonLen | json | pad4 | float32 samples ----
// v2 adds master, markers, bpm/beats/grid, track fx/view, clip gain/fades; v1 files still open.
// v3 = a script project (script: lines with their takes, characters). v4: every source packed
// (audiopack.js: 16-bit exact / 24-bit, about 1/4 to 1/2 the size); `size` = its blob's bytes. A backup (pool: true)
// names each blob by its sha1 in the backup folder's pool instead of carrying it. Older Sori cannot open v4.
const MAGIC = 'VPRJ', VERSION = 4;
const int = Number.isInteger;
const num = (x, lo, hi, def) => (Number.isFinite(+x) ? Math.max(lo, Math.min(hi, +x)) : def);

const clipJson = (c) => ({
  name: c.name, start: c.start, offset: c.offset, length: c.length, src: c.src.id, gain: c.gain ?? 1,
  fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0,
  ...(c.fadeInShape ? { fadeInShape: c.fadeInShape } : {}), ...(c.fadeOutShape ? { fadeOutShape: c.fadeOutShape } : {}),
});
const trackJson = (t) => ({
  name: t.name, color: t.color, gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo, fx: t.fx,
  clips: t.clips.map(clipJson),
});
const lineJson = (l) => ({
  char: l.char, num: l.num, text: l.text, memo: l.memo, state: l.state,
  star: l.takes.findIndex((t) => t.id === l.star), takes: l.takes.map(trackJson),
});

// sources never change (architecture.md Invariants), so each is packed once and its blob reused by every save,
// autosave and backup; the hash names it in the backup pool. The app packs new sound while idle (prepack), so a save
// rarely packs: a fully recorded script took 9 s to pack at once.
const packed = new WeakMap();
let pending = null; // { s, gen }: the source prepack is in the middle of
const failed = new WeakSet(); // sources whose idle pack threw: left to a save's AP.pack
function blobOf(s) {
  if (packed.has(s)) return packed.get(s);
  let blob;
  try { blob = pending && pending.s === s ? AP.finish(pending.gen) : undefined; } catch { blob = undefined; }
  return keep(s, blob || AP.pack(s.ch)); // a generator that threw ends { done, value: undefined }
}
// s's packed blob (made here, or on another CPU: cli/project.js) is reused by saves; s decodes from it when needed
const keep = (s, blob) => (packed.set(s, { blob }), PK.park(s, blob, true), packed.get(s));
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const hashOf = (e) => e.hash || (e.hash = sha1(e.blob));
// prepack's sha1, 4 MB a step (a long recording's blob can be hundreds of MB)
let hashing = null; // { e, h, at }
function hashStep(e) {
  if (!hashing || hashing.e !== e) hashing = { e, h: crypto.createHash('sha1'), at: 0 };
  const end = Math.min(e.blob.length, hashing.at + (4 << 20));
  hashing.h.update(e.blob.subarray(hashing.at, end));
  hashing.at = end;
  if (end === e.blob.length) { e.hash = hashing.h.digest('hex'); hashing = null; }
}
// every source the project uses (all takes of every line), by id
function sourcesOf(project) {
  const lines = project.script ? SC.linesNow(project) : [], sources = new Map();
  for (const t of [...project.tracks, ...lines.flatMap((l) => l.takes)]) {
    for (const c of t.clips) sources.set(c.src.id, c.src);
  }
  return sources;
}
// idle time (app.js): packs a step at a time while more() is true, then names each blob (sha1) so a backup does not
// hash hundreds of MB at once; at least one step; false = nothing left
function prepack(project, more) {
  const all = [...sourcesOf(project).values()], todo = all.filter((s) => !packed.has(s) && !failed.has(s));
  const next = () => (todo.length ? { s: todo[0], gen: AP.packSteps(todo[0].ch) } : null);
  if (!pending || !todo.includes(pending.s)) pending = next(); // a deleted take, or a save packed it
  let go = true;
  while (pending && go) {
    let r;
    try { r = pending.gen.next(); } catch { r = { done: true }; }
    if (r.done) {
      if (r.value) keep(pending.s, r.value);
      else failed.add(pending.s); // never cache no blob
      todo.splice(todo.indexOf(pending.s), 1); pending = next();
    }
    go = more();
  }
  const unnamed = all.map((s) => packed.get(s)).filter((e) => e && !e.hash);
  while (go && unnamed.length) {
    hashStep(unnamed[unnamed.length - 1]);
    if (unnamed[unnamed.length - 1].hash) unnamed.pop();
    go = more();
  }
  return !!pending || unnamed.length > 0;
}

// the project's JSON without its source list, and its sources with their packed blobs
function packProject(project) {
  const sc = project.script, lines = sc ? SC.linesNow(project) : [], sources = sourcesOf(project);
  const line = sc ? Math.max(0, lines.findIndex((l) => l.id === sc.lineId)) : 0;
  const head = {
    sampleRate: project.sampleRate,
    master: project.master, bpm: project.bpm, beats: project.beats, grid: project.grid,
    markers: (project.markers || []).map((m) => ({ frame: m.frame, name: m.name })),
    tracks: sc ? [] : project.tracks.map(trackJson),
    ...(sc ? { script: { line, chars: sc.chars, lines: lines.map(lineJson) } } : {}),
  };
  const list = [...sources.values()].map((s) => ({
    e: blobOf(s), m: { id: s.id, channels: s.channels || s.ch.length, length: srcLen(s) } }));
  return { head, list };
}
// "VPRJ" | version | JSON length | JSON | padding to 4 | the blobs
function assemble(meta, blobs) {
  const json = new TextEncoder().encode(JSON.stringify(meta)), at0 = Math.ceil((12 + json.length) / 4) * 4;
  const out = new Uint8Array(at0 + blobs.reduce((n, b) => n + b.length, 0)), v = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
  v.setUint32(4, VERSION, true); v.setUint32(8, json.length, true);
  out.set(json, 12);
  let at = at0;
  for (const b of blobs) { out.set(b, at); at += b.length; }
  return out;
}
function saveProject(project) {
  const { head, list } = packProject(project);
  let off = 0;
  const sources = list.map(({ e, m }) => {
    const x = { ...m, byteOffset: off, size: e.blob.length, hash: hashOf(e) }; // the hash finds a damaged take on open
    off += x.size;
    return x;
  });
  return assemble({ ...head, sources }, list.map(({ e }) => e.blob));
}
// 자동 백업: the project without its sound (each source names its blob by hash) + the blobs for the pool
function saveThin(project) {
  const { head, list } = packProject(project);
  const sources = list.map(({ e, m }) => ({ ...m, size: e.blob.length, hash: hashOf(e) }));
  return { bytes: assemble({ ...head, pool: true, sources }, []),
    blobs: list.map(({ e }) => ({ hash: hashOf(e), blob: e.blob })) };
}

const fail = (why) => { throw new Error('프로젝트 파일을 읽을 수 없어요: ' + why); };
// "VPRJ" | version | json: the parsed meta and where the samples start
function readHead(bytes) {
  if (bytes.length < 12) fail('파일이 너무 짧아요');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) fail('Sori 프로젝트가 아니에요');
  const ver = v.getUint32(4, true);
  if (ver > VERSION) fail('더 새 버전의 Sori에서 만든 파일이에요. Sori를 업데이트하세요');
  if (ver < 1) fail('지원하지 않는 버전이에요');
  const jlen = v.getUint32(8, true);
  if (12 + jlen > bytes.length) fail('손상된 파일이에요');
  let meta;
  try { meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jlen))); } catch { fail('손상된 파일이에요'); }
  const rate = !!meta && meta.sampleRate >= 3000 && meta.sampleRate <= 768000;
  if (!rate || !Array.isArray(meta.tracks) || !Array.isArray(meta.sources)) fail('손상된 파일이에요');
  return { ver, meta, dataStart: Math.ceil((12 + jlen) / 4) * 4 };
}
// each source's samples, copied out so the project does not pin the whole file buffer; yields [done, total] in
// stored bytes after each one (the open progress bar)
// damaged: a Set that collects the sources opened as silence
function* readSources(bytes, meta, dataStart, ver, pool, damaged) {
  const dataLen = bytes.length - dataStart, sources = new Map();
  if (meta.pool && !pool) fail('백업 조각이라 Sori의 파일 > 백업에서 열기로만 열 수 있어요');
  const ok = (m) => m && int(m.length) && m.length >= 1 && (m.channels === 1 || m.channels === 2);
  if (!meta.sources.every(ok)) fail('소리 데이터가 손상됐어요');
  const cost = (m) => (ver >= 4 && int(m.size) ? m.size : m.channels * m.length * 4);
  const total = meta.sources.reduce((n, m) => n + cost(m), 0);
  let done = 0, off = 0;
  for (const m of meta.sources) {
    if (ver >= 4 && !meta.pool && m.byteOffset !== off) fail('소리 데이터가 손상됐어요'); // blobs one after another
    off += m.size;
    sources.set(m.id, ver >= 4 ? packedSource(bytes, m, dataStart, dataLen, meta.pool && pool, damaged)
      : rawSource(bytes, m, dataStart, dataLen));
    yield [(done += cost(m)), total];
  }
  return sources;
}
// v1-v3: float32 channels one after another
function rawSource(bytes, m, dataStart, dataLen) {
  const size = m.channels * m.length * 4, n = m.length * 4, at = bytes.byteOffset + dataStart + m.byteOffset;
  const fits = int(m.byteOffset) && m.byteOffset >= 0 && m.byteOffset % 4 === 0 && m.byteOffset + size <= dataLen;
  if (!fits) fail('소리 데이터가 손상됐어요');
  const part = (_, k) => new Float32Array(bytes.buffer.slice(at + k * n, at + (k + 1) * n));
  return makeSource(Array.from({ length: m.channels }, part));
}
// v4: a packed blob in the file, or in the backup pool (pool(hash) -> its bytes); null = missing or not its hash
// (old files have no hash in the file)
function blobFrom(bytes, m, dataStart, dataLen, pool) {
  if (pool) {
    if (!/^[0-9a-f]{40}$/.test(m.hash)) fail('소리 데이터가 손상됐어요');
    let blob = null;
    try { blob = pool(m.hash); } catch { return null; } // its pool file is gone
    return blob && sha1(blob) === m.hash ? blob : null;
  }
  const ok = int(m.byteOffset) && int(m.size) && m.byteOffset >= 0 && m.size >= 1;
  if (!ok || m.byteOffset + m.size > dataLen) fail('소리 데이터가 손상됐어요');
  const blob = bytes.subarray(dataStart + m.byteOffset, dataStart + m.byteOffset + m.size);
  return m.hash === undefined || sha1(blob) === m.hash ? blob : null;
}
// 손상된 테이크만 무음: a damaged blob opens as silence, added to `damaged`; the rest opens as saved
// a blob whose hash checked out is decoded only when used (open 5.1 s -> about 1 s); without a
// hash (old files) it is decoded now to check it
function packedSource(bytes, m, dataStart, dataLen, pool, damaged) {
  const blob = blobFrom(bytes, m, dataStart, dataLen, pool);
  let ch = null;
  if (!blob || m.hash === undefined) {
    try { ch = blob && AP.unpack(blob, m.channels, m.length); } catch { ch = null; }
    if (!ch) { // not cached: the next save packs the silence, never the damaged bytes
      const s = makeSource(Array.from({ length: m.channels }, () => new Float32Array(m.length)));
      damaged.add(s);
      return s;
    }
  }
  const s = makeSource(ch), copy = new Uint8Array(blob);
  packed.set(s, { blob: copy, hash: m.hash }); // a copy: never pins the file
  PK.park(s, copy, false, { channels: m.channels, frames: m.length });
  return s;
}
const isObj = (x) => !!x && typeof x === 'object';
function readClip(sources, c) {
  const s = isObj(c) && sources.get(c.src);
  const ok = s && int(c.offset) && int(c.length) && int(c.start) && c.offset >= 0 && c.length >= 1
    && c.offset + c.length <= srcLen(s) && c.start >= 0;
  if (!ok) fail('클립 정보가 손상됐어요');
  const clip = makeClip(s, c.start, String(c.name ?? ''), c.offset, c.length);
  return clampFades({ // clampFades drops unknown shapes
    ...clip, gain: num(c.gain, 0, 4, 1), fadeIn: int(c.fadeIn) ? c.fadeIn : 0, fadeOut: int(c.fadeOut) ? c.fadeOut : 0,
    fadeInShape: c.fadeInShape, fadeOutShape: c.fadeOutShape,
  });
}
// a saved track or take; its clips are checked against their sources
const trackReader = (sources) => (t) => (!isObj(t) || (t.clips != null && !Array.isArray(t.clips))
  ? fail('트랙 정보가 손상됐어요') : {
  name: String(t.name ?? '트랙'), color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : undefined,
  gain: num(t.gain, 0, 2, 1), pan: num(t.pan, -1, 1, 0), mute: !!t.mute, solo: !!t.solo,
  fx: P.clampChain(P.TRACK_KINDS, t.fx), // a 'view' from before 2026-11-08 is dropped: the view is the whole app's
  clips: (t.clips || []).map((c) => readClip(sources, c)),
});
// 손상된 테이크 알림: the tracks (their names) and takes (line name + take name) that play a damaged source
function damagedLabels(tracks, script, damaged) {
  const bad = (t) => t.clips.some((c) => damaged.has(c.src));
  if (!damaged.size) return [];
  if (!script) return tracks.filter(bad).map((t) => t.name);
  return script.lines.flatMap((l) => l.takes.filter(bad).map((t) => SC.lineName(l) + ' ' + t.name));
}
// v3: the lines with their takes, numbered like a fresh script, and each character's color and effects
function readScript(ms, readTrack) {
  const str = (x, n) => String(x ?? '').slice(0, n);
  const row = (l) => {
    const takes = (Array.isArray(l.takes) ? l.takes : []).map((t) => ({ ...readTrack(t), id: uid('t') }));
    return {
      // older files kept a Markdown script's \[ \] escapes (script.js unescape)
      char: SC.unescape(str(l.char, 40)).trim() || '?', num: SC.toNum(l.num),
      text: SC.unescape(str(l.text, 2000)), memo: SC.unescape(str(l.memo, 500)),
      state: l.state === 'redo' ? l.state : undefined,
      takes, star: int(l.star) && takes[l.star] ? takes[l.star].id : null,
    };
  };
  const rows = ms.lines.filter((l) => l && typeof l === 'object').map(row);
  const numbered = SC.number(rows).lines; // fills a missing or repeated number; same order as rows
  const lines = rows.map((r, i) => ({ ...r, id: numbered[i].id, num: numbered[i].num }));
  const at = int(ms.line) && lines[ms.line] ? ms.line : 0;
  return { lines, chars: readChars(ms.chars, lines), lineId: lines.length ? lines[at].id : null };
}
function readChars(saved, lines) {
  // no prototype: a character named `constructor` is its own entry. Names were unescaped on load (readScript), the
  // saved looks may sit under the old escaped name: an exact key first, else the one that unescapes to it
  const chars = Object.create(null), looks = new Map(), keys = isObj(saved) ? Object.keys(saved) : [];
  for (const k of keys) { const n = SC.unescape(k).trim(); if (n === k || !looks.has(n)) looks.set(n, saved[k]); }
  for (const l of lines) {
    if (chars[l.char]) continue;
    const c = looks.get(l.char) || {}, color = /^#[0-9a-f]{6}$/i.test(c && c.color) ? c.color : '#38BDF8';
    chars[l.char] = { color, fx: P.clampChain(P.TRACK_KINDS, c && c.fx) };
  }
  return chars;
}
const readMarkers = (ms) => (Array.isArray(ms) ? ms : [])
  .filter((m) => m && int(m.frame) && m.frame >= 0)
  .map((m) => ({ id: uid('m'), frame: m.frame, name: String(m.name ?? '').slice(0, 100) }))
  .sort((a, b) => a.frame - b.frame);

// opts.pool(hash) -> a blob's bytes, for a backup (자동 백업). loadSteps yields [done, total] while the sound
// unpacks (the app's progress bar); loadProject runs it through.
function* loadSteps(bytes, opts = {}) {
  const { ver, meta, dataStart } = readHead(bytes), damaged = new Set();
  const readTrack = trackReader(yield* readSources(bytes, meta, dataStart, ver, opts.pool, damaged));
  const tracks = meta.tracks.map(readTrack), ms = meta.script;
  const script = ver >= 3 && ms && Array.isArray(ms.lines) ? readScript(ms, readTrack) : null;
  // a script project: tracks = the current line's takes (the in-memory rule, core/script.js)
  const shown = script && (script.lines.find((l) => l.id === script.lineId) || { takes: [] }).takes;
  return {
    sampleRate: meta.sampleRate, tracks: script ? shown : tracks, markers: readMarkers(meta.markers),
    master: P.clampMaster(meta.master), script, bpm: num(meta.bpm, 20, 300, 120),
    beats: int(meta.beats) && meta.beats >= 1 && meta.beats <= 12 ? meta.beats : 4,
    grid: meta.grid === 'beats' ? 'beats' : 'time', damaged: damagedLabels(tracks, script, damaged),
  };
}
const loadProject = (bytes, opts) => AP.finish(loadSteps(bytes, opts));

// a marker or line name as a file name (export); \ too: "a\b" must not become a subfolder
const safeName = (s) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 80) || '구간';

module.exports = { encodeWav, encodeMp3, saveProject, saveThin, prepack, loadProject, loadSteps, readHead, safeName,
  keep, unpacked: (p) => [...sourcesOf(p).values()].filter((s) => !packed.has(s)) }; // unpacked: what a save packs
