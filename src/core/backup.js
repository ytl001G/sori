// 자동 백업: the work as it is (unsaved changes too) goes to <root>/<group>/<time>.vproj, the
// newest KEEP per group. A group is one project file, or one unsaved new project; its about.json names it for
// 파일 > 백업에서 열기. A backup file holds no sound: each packed source (fileio saveThin) is stored once in
// <root>/pool/<sha1>.snd and shared by every backup that has it, so 10 backups cost about one project's sound.
// A group whose newest backup is over DAYS old goes (not the open project's); pool files no backup names go too.
// Plain Node: the app passes the project and when to make one (src/ui/commands/backup.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const IO = require('./fileio');
const { writeAtomic } = require('./safewrite');

const KEEP = 10, DAYS = 30, POOL = 'pool';
const groupName = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
const two = (n) => String(n).padStart(2, '0');
// local time, sortable as text: 2026-11-08 17-12-05
const stamp = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} `
  + `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
// a group's backups, newest first
const backups = async (dir) => (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.vproj')).sort().reverse();
const groups = async (root) => {
  try { return (await fs.promises.readdir(root)).filter((g) => g !== POOL); } catch { return []; }
};
// a backup's JSON only (an old full backup can be big)
async function headOf(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const h = Buffer.alloc(12);
    await fh.read(h, 0, 12, 0);
    const all = Buffer.alloc(12 + Math.min(h.readUInt32LE(8), 64 << 20));
    await fh.read(all, 0, all.length, 0);
    return IO.readHead(new Uint8Array(all)).meta;
  } finally { await fh.close(); }
}

// group = { key, path (the project file or null), name }, thin = fileio.saveThin(project); returns the new file.
// Order for a crash at any point: about.json (list() can name the group), the pool files, then the backup itself.
async function write(root, group, thin, now = new Date()) {
  const dir = path.join(root, groupName(group.key)), pool = path.join(root, POOL);
  const name = stamp(now) + '.vproj', file = path.join(dir, name);
  await fs.promises.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, 'about.json'), JSON.stringify({ path: group.path, name: group.name }));
  await fillPool(pool, thin.blobs);
  await writeAtomic(file, thin.bytes);
  try {
    // never the one just written: with the clock moved back its name sorts oldest
    const old = (await backups(dir)).filter((f) => f !== name).slice(KEEP - 1);
    for (const f of old) await fs.promises.rm(path.join(dir, f), { force: true });
  } catch { /* the backup is made; an extra old one stays until the next backup prunes */ }
  return file;
}
// each blob once in <pool>/<sha1>.snd; one already there is not written again
async function fillPool(pool, blobs) {
  await fs.promises.mkdir(pool, { recursive: true });
  for (const b of blobs) {
    const f = path.join(pool, b.hash + '.snd');
    // a pool file of the wrong size is a broken one (a crash, a disk error): write it again
    const st = await fs.promises.stat(f).catch(() => null);
    if (!st || st.size !== b.blob.byteLength) await writeAtomic(f, b.blob);
  }
}
// pool files whose hash is not in `used` go
async function prunePool(pool, used) {
  for (const f of await fs.promises.readdir(pool).catch(() => [])) {
    if (!used.has(f.replace(/\.snd$/, ''))) await fs.promises.rm(path.join(pool, f), { force: true });
  }
}
// 자동 저장 (crash recovery, ui/commands/files.js): `file` = the project without its sound, <dir>/pool = the sound of
// the project now, each written once (a 188 MB project: 0.65 MB a time, not 188). Sound the project no longer has
// goes only after the file names the new set: a crash at any point leaves a file whose sound is all there
async function writeAutosave(file, dir, thin) {
  const pool = path.join(dir, POOL);
  await fillPool(pool, thin.blobs);
  await writeAtomic(file, thin.bytes);
  await prunePool(pool, new Set(thin.blobs.map((b) => b.hash)));
}
// groups whose newest backup is over DAYS old go (but `keepKey`'s: the open project), then pool files no backup names.
// Only when every backup was read: a file-system error (a locked or unreadable file, e.code) skips the pool sweep this
// run, as that backup's sound would go; a damaged backup (a parse error, no e.code) names nothing.
async function tidy(root, keepKey, now = Date.now()) {
  const keep = keepKey && groupName(keepKey), used = new Set();
  let sure = true;
  const failed = (e) => { if (e.code && e.code !== 'ENOTDIR') sure = false; }; // ENOTDIR: a stray file, not a group
  for (const g of await groups(root)) {
    const dir = path.join(root, g);
    try {
      const all = await backups(dir);
      const newest = all.length ? (await fs.promises.stat(path.join(dir, all[0]))).mtimeMs : 0;
      if (g !== keep && now - newest > DAYS * 864e5) {
        await fs.promises.rm(dir, { recursive: true, force: true });
        continue;
      }
      for (const f of all) {
        const meta = await headOf(path.join(dir, f)).catch((e) => { failed(e); return null; });
        if (meta && meta.pool) for (const s of meta.sources) used.add(s.hash);
      }
    } catch (e) { failed(e); }
  }
  if (sure) await prunePool(path.join(root, POOL), used);
}
// for fileio.loadProject(bytes, { pool }): a blob by hash (a backup root, or the autosave's folder)
const poolReader = (root) => (hash) => {
  try { return fs.readFileSync(path.join(root, POOL, hash + '.snd')); } catch {
    throw new Error('백업의 소리 파일이 없어요');
  }
};

// every backup: [{ file, path, name, time (ms), size }], newest first; size = the project with its sound
async function list(root) {
  const out = [];
  for (const g of await groups(root)) {
    const dir = path.join(root, g);
    try {
      const text = await fs.promises.readFile(path.join(dir, 'about.json'), 'utf8');
      let about = {};
      try { about = JSON.parse(text) || {}; } catch { /* damaged: the group still lists, as 새 프로젝트 */ }
      for (const f of await backups(dir)) {
        const file = path.join(dir, f), st = await fs.promises.stat(file);
        const meta = await headOf(file).catch(() => null), sound = meta && meta.pool
          ? meta.sources.reduce((n, s) => n + (Number(s.size) || 0), 0) : 0;
        out.push({ file, path: about.path || null, name: String(about.name || '새 프로젝트'), time: st.mtimeMs,
          size: st.size + sound });
      }
    } catch { /* not a backup folder */ }
  }
  return out.sort((a, b) => b.time - a.time);
}

module.exports = { KEEP, DAYS, write, writeAutosave, tidy, list, poolReader };
