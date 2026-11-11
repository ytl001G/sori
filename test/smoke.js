// End-to-end run inside the real renderer: `npm run smoke`. The steps live in test/smoke/<group>.js as
// [name, fn, when?] and run in this order on one app session (later steps build on earlier ones). kit.js holds the
// stubs and helpers. when: 'dev' = not in the installed app, 'shots' = only with SORI_SHOTS set.
const fs = require('fs');
const { ipcRenderer } = require('electron');
const K = require('./smoke/kit');

// SORI_PERF=<a copy of a .vproj>: only the speed steps (perf.js); SORI_FUZZ=<actions>: only random editing (fuzz.js)
const GROUPS = process.env.SORI_PERF ? ['perf'] : process.env.SORI_FUZZ ? ['fuzz']
  : ['edit', 'fx', 'voice', 'panels', 'files', 'script', 'longrec', 'cli', 'cliscript', 'view', 'find', 'shots',
    'layout'];

async function run() {
  K.install();
  for (const g of GROUPS) {
    for (const [name, fn, when] of require('./smoke/' + g)) {
      if ((when === 'dev' && K.packaged) || (when === 'shots' && !K.shots)) continue;
      await K.step(name, fn);
    }
  }
  fs.rmSync(K.dir, { recursive: true, force: true });
  K.log.push(...K.errors.map((e) => '  ! ' + e));
  ipcRenderer.send('smoke-done', K.errors.length === 0, K.log.join('\n'));
}

module.exports = { run };
