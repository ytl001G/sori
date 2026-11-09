// MP3 encoding on other CPUs: encoders.encodeMp3 on core/workers.js, one file per worker.
const W = require('../core/workers');
const { RENDERS } = require('../core/pool');

// channels -> MP3 bytes (a Promise); only the channels encoded are copied over
const encode = (ch, sr, kbps) => W.run('encoders', 'encodeMp3', [ch.slice(0, 2), sr, kbps]);

// files rendered at once for an export in this format: MP3 keeps WORKERS encoders busy (대사별 MP3 192 of 210 lines:
// 116 s on one CPU, 34 s four at once, 26 s eight at once, measured 2026-11-09); WAV is render-bound (pool.js)
const jobsFor = (fmt) => (fmt.startsWith('mp3') ? Math.max(RENDERS, W.WORKERS) : RENDERS);

module.exports = { encode, jobsFor };
