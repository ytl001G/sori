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
t('safewrite: names Windows sees as the same file get (2), (3)', () => {
  const p = (n) => path.join('out', n);
  assert.deepStrictEqual(W.uniquePaths([p('캐릭터A-001.wav'), p('캐릭터a-001.wav'), p('캐릭터A-001.WAV'), p('b.wav')]),
    [p('캐릭터A-001.wav'), p('캐릭터a-001 (2).wav'), p('캐릭터A-001 (3).WAV'), p('b.wav')]);
});
