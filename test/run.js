// Headless self-checks: node test/run.js. Each test/unit/<file>.js registers its checks with t(); they run in this
// order, one at a time (the CLI checks build on each other's files).
const H = require('./unit/helpers');

const FILES = ['edit', 'effects', 'voice', 'history', 'audiopack', 'fileio', 'settings', 'worklets', 'script', 'args',
  'split', 'live', 'cli', 'scriptcli', 'takescli', 'batch', 'measure', 'applylines', 'pipe', 'backup', 'safewrite',
  'playback'];

(async () => {
  let passed = 0;
  for (const f of FILES) {
    const from = H.tests.length;
    require('./unit/' + f);
    console.log(f);
    for (const [name, fn] of H.tests.slice(from)) {
      console.log('  ..  ' + name); // a failure below belongs to this one
      await fn();
      passed++;
    }
  }
  console.log(`\n${passed} passed`);
  H.cleanup();
})().catch((e) => { console.error(e); H.cleanup(); process.exit(1); }); // the scratch folder goes on a failure too
