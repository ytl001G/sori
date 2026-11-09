// Writing a file so a crash, power loss or failure never leaves it half written or zeroed (audit 2026-11-08): the
// data goes to a temp file of its own (two writes to one path never share it), is flushed to disk (fsync), then is
// renamed over the target; a failure removes the temp and throws. Plain Node: the app (save, autosave, backups,
// export) and the CLI use it.
const fs = require('fs');
const path = require('path');

let n = 0;
const tmpOf = (file) => `${file}.${process.pid}.${++n}.tmp`;
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

module.exports = { writeAtomic, writeAtomicSync, uniquePaths };
