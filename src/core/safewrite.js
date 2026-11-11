// Writing a file so a crash, power loss or failure never leaves it half written or zeroed (audit 2026-11-08): the
// data goes to a temp file of its own (two writes to one path never share it), is flushed to disk (fsync), then is
// renamed over the target; a failure removes the temp and throws. Plain Node: the app (save, autosave, backups,
// export) and the CLI use it.
const fs = require('fs');
const path = require('path');

let n = 0;
const tmpOf = (file) => { dropStale(path.dirname(file)); return `${file}.${process.pid}.${++n}.tmp`; };
// a write killed midway (a crash, power loss) leaves its temp <file>.<pid>.<n>.tmp, up to the file's full size: the
// first write into a folder in a run removes those of processes no longer running (not this one's, nor a CLI's
// still writing). Once per folder per run: the killed writes were earlier runs
const cleaned = new Set();
const STALE = /\.(\d+)\.\d+\.tmp$/;
const running = (pid) => {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } // EPERM: alive, not ours
};
function dropStale(dir) {
  if (cleaned.has(dir)) return;
  cleaned.add(dir);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; } // not there yet
  for (const f of names) {
    const m = STALE.exec(f);
    if (m && !running(+m[1])) try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* next run */ }
  }
}
// Windows refuses a rename for a moment while another write replaces the same file or a scanner holds it: retry briefly
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
async function renameRetry(a, b) {
  for (let i = 0; ; i++) {
    try { return await fs.promises.rename(a, b); } catch (e) {
      if (!BUSY.has(e.code) || i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 15 * (i + 1)));
    }
  }
}

async function writeAtomic(file, data) {
  const tmp = tmpOf(file);
  try {
    const fh = await fs.promises.open(tmp, 'w');
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally { await fh.close(); }
    await renameRetry(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
function writeAtomicSync(file, data) {
  const tmp = tmpOf(file);
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* the first error is the one to report */ }
    throw e;
  }
}
// paths for a set of files written together: one Windows sees as already taken (case ignored) gets ' (2)', ' (3)'
// before its extension (이름이 겹치면 뒤에 (2))
function uniquePaths(paths) {
  const seen = new Set();
  return paths.map((p) => {
    const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
    let out = p;
    for (let k = 2; seen.has(out.toLowerCase()); k++) out = `${base} (${k})${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}

// the folders writing these files makes, deepest first, known before any is made (two mkdir at the same moment do not
// tell which one made a shared parent): an export that fails removes them again (the app and the CLI)
function newFolders(paths) {
  const out = new Set();
  // a root that does not exist (a drive not there) is its own dirname: stop there, the write then fails
  const up = path.dirname;
  for (const f of paths) for (let d = up(f); !fs.existsSync(d) && d !== up(d); d = up(d)) out.add(d);
  return [...out].sort((x, y) => y.length - x.length);
}

module.exports = { writeAtomic, writeAtomicSync, uniquePaths, newFolders };
