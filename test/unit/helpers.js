// Shared by the unit checks (test/run.js): the test list, test signals, a scratch folder and helpers for CLI runs.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../../src/core/edit');
const FX = require('../../src/core/effects');
const IO = require('../../src/core/fileio');

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ramp = (n, ch = 1) => Array.from({ length: ch },
  (_, k) => Float32Array.from({ length: n }, (_, i) => i + k * 1000));
const sine = (n, f, sr, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const clip = (start, n, ch) => E.makeClip(E.makeSource(ch || ramp(n)), start, 'c');
const ones = (n) => [new Float32Array(n).fill(1)];
const sr = 48000;

// CLI runs work in a scratch folder, removed at the end
const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sori-test-'));
const cp = (n) => path.join(cliDir, n);
const cleanup = () => fs.rmSync(cliDir, { recursive: true, force: true });
// what the hidden window would do: decode = 1 s of ones (mono), noted in `decoded`; mixdown = the clips summed
const decoded = [];
const audio = {
  decode: async (f, rate) => { decoded.push([path.basename(f), rate]); return ones(sr); },
  mixdown: async (tracks, master, a, b) => {
    const r = E.renderRegion(tracks.flatMap((x) => x.clips), a, b) || ones(b - a).map((c) => c.fill(0));
    return [r[0], r[0]];
  },
};
// sori file commands: run() expects ok, fails(code) expects that error
const show = (argv, r) => `${argv.join(' ')} -> ${JSON.stringify(r)}`;
const exec = (argv) => require('../../src/cli/verbs').execute(argv, { cwd: cliDir, audio });
async function run(...argv) {
  const r = await exec(argv);
  assert(r.ok, show(argv, r));
  return r;
}
async function fails(code, ...argv) {
  const r = await exec(argv);
  assert.strictEqual(r.error, code, show(argv, r));
  return r;
}

module.exports = {
  assert, E, FX, IO, tests, t, ramp, sine, rms, clip, ones, sr, cliDir, cp, cleanup, decoded, run, fails,
};
