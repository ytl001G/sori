// Several jobs at once (exports, sori measure: each OfflineAudioContext renders on its own audio thread).
// RENDERS: how many renders at once; 대사별 WAV export of 210 lines took 25 s one by one, 17 s four at once, eight
// no faster (measured 2026-11-09). shortcut: fixed, not by length: a marker export of long parts holds this many
// mixes in memory. SORI_RENDERS overrides it for measuring.
const RENDERS = +process.env.SORI_RENDERS || 4;
// job(i) for i < n, at most k running; results in index order. After the first error no new job starts, and it
// rejects only once every started job has settled, so nothing is still writing when the caller cleans up.
async function pool(n, k, job) {
  const out = new Array(n);
  let next = 0, err = null;
  const run = async () => {
    while (next < n && !err) {
      const i = next++;
      try { out[i] = await job(i); } catch (e) { err = err || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(k, n) }, run));
  if (err) throw err;
  return out;
}

module.exports = { pool, RENDERS };
