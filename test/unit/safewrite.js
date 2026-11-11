// Atomic file writes and export names (src/core/safewrite.js).
const fs = require('fs');
const path = require('path');
const W = require('../../src/core/safewrite');
const { assert, t, cliDir } = require('./helpers');

const dir = path.join(cliDir, 'safewrite');
const left = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

t('safewrite: writes and replaces whole files; a failure leaves the old file and no temp', async () => {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'a.vproj');
  await W.writeAtomic(f, 'one');
  W.writeAtomicSync(f, 'two');
  await Promise.all([W.writeAtomic(f, 'x'.repeat(1e6)), W.writeAtomic(f, 'y'.repeat(1e6))]);
  const got = fs.readFileSync(f, 'utf8');
  assert(got === 'x'.repeat(1e6) || got === 'y'.repeat(1e6), 'two writes at once: one whole file, not a mix');
  fs.mkdirSync(path.join(dir, 'busy.vproj'));
  await assert.rejects(W.writeAtomic(path.join(dir, 'busy.vproj'), 'z'));
  assert.throws(() => W.writeAtomicSync(path.join(dir, 'busy.vproj'), 'z'));
  assert.deepStrictEqual(left(), [], 'no temp file left');
  assert.strictEqual(fs.readFileSync(f, 'utf8').length, 1e6, 'the target untouched');
});
t('cli export: a failure removes the parts and the folders the export made, not one that was there', async () => {
  const { writeAll } = require('../../src/cli/project');
  const out = path.join(dir, 'export'), f = (...p) => path.join(out, ...p);
  fs.mkdirSync(f('old'), { recursive: true });
  const files = [f('new', 'A', 'a-001.wav'), f('new', 'B', 'b-001.wav'), f('old', 'c.wav')];
  const make = (i) => (i === 1 ? Promise.reject(new Error('render failed')) : 'x');
  await assert.rejects(writeAll(files, make, 1), /render failed/);
  assert.deepStrictEqual(fs.readdirSync(out), ['old'], 'new/A, new/B and new are gone');
  assert.deepStrictEqual(fs.readdirSync(f('old')), [], 'no part left');
  await writeAll(files, () => 'x');
  assert(files.every((x) => fs.readFileSync(x, 'utf8') === 'x'), 'written when all succeed');
});
t('safewrite: names Windows sees as the same file get (2), (3)', () => {
  const p = (n) => path.join('out', n);
  assert.deepStrictEqual(W.uniquePaths([p('캐릭터A-001.wav'), p('캐릭터a-001.wav'), p('캐릭터A-001.WAV'), p('b.wav')]),
    [p('캐릭터A-001.wav'), p('캐릭터a-001 (2).wav'), p('캐릭터A-001 (3).WAV'), p('b.wav')]);
});
t('safewrite: newFolders ends at a drive that is not there (no endless loop)', () => {
  const drive = [...'ZYXWVUTSRQPONMLKJIHG'].map((c) => c + ':/').find((d) => !fs.existsSync(d));
  if (process.platform !== 'win32' || !drive) return; // every letter taken: nothing to check here
  assert.deepStrictEqual(W.newFolders([path.join(drive, 'a', 'b', 'x.wav')]),
    [path.join(drive, 'a', 'b'), path.join(drive, 'a')]);
});

t('safewrite: the first write into a folder removes temps that killed writes left, not a running one\'s', async () => {
  const d = path.join(cliDir, 'stale'), dead = require('child_process').spawnSync(process.execPath, ['-e', '']).pid;
  fs.mkdirSync(d, { recursive: true });
  const names = [`a.vproj.${dead}.3.tmp`, `b.snd.${dead}.12.tmp`, `a.vproj.${process.pid}.999.tmp`, 'notes.tmp'];
  for (const f of names) fs.writeFileSync(path.join(d, f), 'x');
  await W.writeAtomic(path.join(d, 'c.vproj'), 'new');
  assert.deepStrictEqual(fs.readdirSync(d).sort(), [`a.vproj.${process.pid}.999.tmp`, 'c.vproj', 'notes.tmp']);
});
