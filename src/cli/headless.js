// Hidden-window side of `sori import` / `sori export` (main.js --cli=<job dir>): runs the same file command as
// plain Node would, with Web Audio from the app's own engine (decode, OfflineAudioContext mixdown), then hands
// result.json back and lets main.js exit.
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

const dir = process.argv.find((a) => a.startsWith('--cli=')).slice(6);

(async () => {
  let res;
  try { // requires inside: a load error must still produce a result, or main.js would wait forever
    const engine = require('../audio/engine');
    const { execute, audioFor } = require('./verbs');
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    res = await execute(job.argv, { cwd: job.cwd, audio: audioFor(engine) });
  } catch (e) { res = { ok: false, error: 'FAILED', message: e.message }; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(res));
  ipcRenderer.send('cli-done');
})();
