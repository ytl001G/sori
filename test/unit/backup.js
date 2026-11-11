// 자동 백업 folders (src/core/backup.js): newest 10 per project, sound stored once in the pool, 30-day tidy, the list
// for 백업에서 열기.
const fs = require('fs');
const path = require('path');
const BK = require('../../src/core/backup');
const { assert, E, IO, t, cliDir, sine, sr } = require('./helpers');

const root = path.join(cliDir, 'backups'), pool = path.join(root, 'pool');
const at = (min) => new Date(2026, 10, 8, 17, min, 0);
const song = { key: 'file:c:/a/노래.vproj', path: 'C:/a/노래.vproj', name: '노래' };
const fresh = { key: 'new:1', path: null, name: '새 프로젝트' };
const take = E.makeSource([sine(4800, 220, sr)]), take2 = E.makeSource([sine(4800, 330, sr)]);
const proj = (...srcs) => ({ sampleRate: sr,
  tracks: srcs.map((s) => ({ name: 'x', clips: [E.makeClip(s, 0, 'a')] })) });
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);

t('backup: newest 10 per project, named by local time; each sound stored once in the pool', async () => {
  for (let m = 0; m < 12; m++) await BK.write(root, song, IO.saveThin(proj(take)), at(m));
  assert.strictEqual(ls(pool).length, 1, '12 backups of the same take: one pool file');
  const last = await BK.write(root, song, IO.saveThin(proj(take, take2)), at(12));
  assert.strictEqual(ls(pool).length, 2, 'a new take adds one');
  const dir = path.dirname(await BK.write(root, fresh, IO.saveThin(proj()), at(30)));
  assert.deepStrictEqual(ls(dir), ['2026-11-08 17-30-00.vproj', 'about.json']);
  const all = await BK.list(root), mine = all.filter((b) => b.path === song.path);
  assert.strictEqual(mine.length, BK.KEEP, 'kept ' + mine.length);
  const names = mine.map((b) => path.basename(b.file)).sort();
  assert.strictEqual(names[0], '2026-11-08 17-03-00.vproj', 'the oldest went: ' + names[0]);
  assert.deepStrictEqual(all.map((b) => b.time), [...all.map((b) => b.time)].sort((x, y) => y - x), 'newest first');
  const one = mine.find((b) => b.file === last);
  const back = IO.loadProject(fs.readFileSync(last), { pool: BK.poolReader(root) });
  assert(one.size > fs.statSync(last).size + 1000, 'size counts the sound: ' + one.size);
  assert(back.tracks[1].clips[0].src.ch[0].length === 4800, 'opens with its sound from the pool');
  assert(all.some((b) => b.path === null && b.name === '새 프로젝트'), 'the unsaved group');
});
t('autosave: the file without sound, each sound once in its folder; sound no longer used goes', async () => {
  const dir = path.join(cliDir, 'autosave'), file = path.join(cliDir, 'autosave.vproj'), snd = path.join(dir, 'pool');
  await BK.writeAutosave(file, dir, IO.saveThin(proj(take)));
  const [a] = ls(snd);
  fs.utimesSync(path.join(snd, a), 1000, 1000); // marks it: a rewrite would change the time
  await BK.writeAutosave(file, dir, IO.saveThin(proj(take, take2)));
  assert.strictEqual(ls(snd).length, 2, 'a new take adds one');
  assert.strictEqual(fs.statSync(path.join(snd, a)).mtimeMs, 1000000, 'the sound already there was written again');
  await BK.writeAutosave(file, dir, IO.saveThin(proj(take2)));
  assert(ls(snd).length === 1 && !ls(snd).includes(a), 'the take no longer in it stayed');
  const back = IO.loadProject(fs.readFileSync(file), { pool: BK.poolReader(dir) });
  const ch = back.tracks[0].clips[0].src.ch[0]; // 24-bit packed: within 1e-6
  assert(fs.statSync(file).size < 4800 && ch.every((x, k) => Math.abs(x - take2.ch[0][k]) < 1e-6),
    'opens with its sound from the folder');
});

t('backup: tidy drops groups idle over 30 days (not the open one) and pool files nobody uses', async () => {
  const old = (Date.now() - 40 * 864e5) / 1000, gone = { key: 'file:c:/a/옛날.vproj', path: 'C:/a/옛날.vproj', name: '옛날' };
  const solo = E.makeSource([sine(4800, 550, sr)]);
  const f = await BK.write(root, gone, IO.saveThin(proj(solo, take)), at(0));
  fs.utimesSync(f, old, old);
  for (const b of await BK.list(root)) if (b.path === song.path) fs.utimesSync(b.file, old, old);
  fs.writeFileSync(path.join(pool, 'f'.repeat(40) + '.snd'), 'orphan');
  await BK.tidy(root, song.key);
  const left = await BK.list(root);
  assert(!left.some((b) => b.path === gone.path), 'the idle group went');
  assert(left.some((b) => b.path === song.path), 'the open project kept, even idle');
  assert.strictEqual(ls(pool).length, 2, 'its own sound and the orphan went, shared sound stayed: ' + ls(pool));
  await BK.tidy(root, null);
  assert(!(await BK.list(root)).some((b) => b.path === song.path), 'not open: it goes too');
});
t('backup: a folder without about.json is not listed; no backups folder = none; missing sound is told', async () => {
  fs.mkdirSync(path.join(root, 'stray'), { recursive: true });
  fs.writeFileSync(path.join(root, 'stray', 'x.vproj'), 'x');
  assert(!(await BK.list(root)).some((b) => b.file.includes('stray')), 'stray listed');
  assert.deepStrictEqual(await BK.list(path.join(cliDir, 'no-such')), []);
  assert.throws(() => BK.poolReader(root)('0'.repeat(40)), /소리 파일이 없어요/);
});
const busy = () => Object.assign(new Error('locked'), { code: 'EBUSY' });
t('backup: tidy keeps the pool when a backup cannot be read (locked); a damaged backup names nothing', async () => {
  const g = { key: 'file:c:/a/잠김.vproj', path: 'C:/a/잠김.vproj', name: '잠김' };
  const file = await BK.write(root, g, IO.saveThin(proj(E.makeSource([sine(4800, 660, sr)]))), at(40));
  fs.writeFileSync(path.join(path.dirname(file), '2026-01-01 00-00-00.vproj'), 'damaged');
  const before = ls(pool), orphan = path.join(pool, 'e'.repeat(40) + '.snd'), open = fs.promises.open;
  fs.writeFileSync(orphan, 'orphan');
  fs.promises.open = async (f, ...r) => { if (String(f).endsWith('.vproj')) throw busy(); return open(f, ...r); };
  try { await BK.tidy(root, g.key); } finally { fs.promises.open = open; }
  assert(fs.existsSync(orphan) && ls(pool).length === before.length + 1, 'a locked backup: no pool sweep');
  await BK.tidy(root, g.key);
  assert.deepStrictEqual(ls(pool), before, 'readable again: the orphan goes, the used sound stays');
});
t('backup: the backup just written stays when the clock moved back; a failed prune still makes it', async () => {
  const g = { key: 'file:c:/a/시계.vproj', path: 'C:/a/시계.vproj', name: '시계' };
  for (let m = 0; m < BK.KEEP; m++) await BK.write(root, g, IO.saveThin(proj()), at(10 + m));
  const back = await BK.write(root, g, IO.saveThin(proj()), at(1)), dir = path.dirname(back);
  assert(fs.existsSync(back), 'the new backup went');
  assert.strictEqual(ls(dir).filter((f) => f.endsWith('.vproj')).length, BK.KEEP);
  assert(!fs.existsSync(path.join(dir, '2026-11-08 17-10-00.vproj')), 'the oldest other one goes');
  const rm = fs.promises.rm;
  fs.promises.rm = async () => { throw busy(); };
  let made;
  try { made = await BK.write(root, g, IO.saveThin(proj()), at(50)); } finally { fs.promises.rm = rm; }
  assert(fs.existsSync(made), 'a failed prune: the backup is still made');
});
t('backup: a pool file of the wrong size is written again; a damaged about.json still lists', async () => {
  const g = { key: 'file:c:/a/조각.vproj', path: 'C:/a/조각.vproj', name: '조각' };
  const thin = IO.saveThin(proj(E.makeSource([sine(4800, 770, sr)])));
  const f = path.join(pool, thin.blobs[0].hash + '.snd');
  fs.writeFileSync(f, 'short');
  const file = await BK.write(root, g, thin, at(20));
  assert.strictEqual(fs.statSync(f).size, thin.blobs[0].blob.byteLength, 'rewritten');
  fs.writeFileSync(path.join(path.dirname(file), 'about.json'), '{bad');
  const one = (await BK.list(root)).find((b) => b.file === file);
  assert(one && one.name === '새 프로젝트' && one.path === null, 'listed: ' + JSON.stringify(one));
});
