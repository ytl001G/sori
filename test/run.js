// Headless self-checks: node test/run.js. Each test/unit/<file>.js registers its checks with t(); they run in this
// order, one at a time (the CLI checks build on each other's files).
const H = require('./unit/helpers');

const FILES = ['edit', 'effects', 'voice', 'history', 'audiopack', 'fileio', 'settings', 'worklets', 'script', 'args',
  'live', 'cli', 'scriptcli', 'takescli', 'batch', 'measure', 'applylines', 'pipe', 'backup', 'safewrite'];

(async () => {
  let passed = 0;
  for (const f of FILES) {
    const from = H.tests.length;
    require('./unit/' + f);
    console.log(f);
    for (const [name, fn] of H.tests.slice(from)) {
      await fn();
      passed++;
      console.log('  ok  ' + name);
    }
  }
  H.cleanup();
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
