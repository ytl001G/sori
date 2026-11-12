// Pure work on other CPUs: up to WORKERS workers (worker.js), each running one call of a core
// module's function at a time. Web Workers in Sori's windows (main.js nodeIntegrationInWorker), worker_threads in plain
// Node (the CLI's file commands, tests). Idle workers close after IDLE ms: each holds a Node instance.
// Users: MP3 encoding (audio/mp3.js), the app's effects and 목소리 정리 (off the screen's thread, so it keeps drawing
// and 멈추기 lands at once), 목소리 정리 on many lines (cli/apply.js).
const path = require('path');
const { pathToFileURL } = require('url');

const cpus = (globalThis.navigator && navigator.hardwareConcurrency) || require('os').cpus().length || 2;
const WORKERS = Math.max(1, Math.min(8, cpus - 2));
const IDLE = 30000, FILE = path.join(__dirname, 'worker.js');
const free = [], waiting = [];
let made = 0, idle = null;

// one worker with a single shape: post(msg), unref while free so a Node process can exit
function spawn(done) {
  if (typeof Worker !== 'undefined') {
    const w = new Worker(pathToFileURL(FILE).href);
    w.onmessage = ({ data }) => done(w, data);
    w.onerror = (e) => { e.preventDefault(); done(w, { error: e.message || 'worker failed' }); };
    return Object.assign(w, { busy: () => {}, rest: () => {} });
  }
  const w = new (require('worker_threads').Worker)(FILE);
  w.on('message', (data) => done(w, data));
  w.on('error', (e) => done(w, { error: e.message }));
  return Object.assign(w, { busy: () => w.ref(), rest: () => w.unref() });
}
function finished(w, data) {
  const j = w.job;
  if (!j) return; // stopped: terminated, its job already rejected
  w.job = null;
  if (data.error !== undefined) { made--; w.terminate(); } else { free.push(w); w.rest(); }
  if (j) { if (data.error !== undefined) j.reject(new Error(data.error)); else j.resolve(data.out); }
  pump();
}
function pump() {
  clearTimeout(idle);
  while (waiting.length && (free.length || made < WORKERS)) {
    const w = free.pop() || (made++, spawn(finished));
    w.job = waiting.shift();
    w.job.worker = w;
    w.busy();
    // a copy (the caller keeps its arrays), except the buffers it gives away (moved: no second copy of a long sound)
    w.postMessage({ mod: w.job.mod, fn: w.job.fn, args: w.job.args }, w.job.give);
  }
  if (!waiting.length && free.length === made) {
    idle = setTimeout(() => { while (free.length) { free.pop().terminate(); made--; } }, IDLE);
    if (idle.unref) idle.unref();
  }
}

// require('./' + mod)[fn](...args) on a worker (a Promise of its result); args and result must be cloneable.
// signal (AbortSignal): on abort a waiting job leaves the queue and a running one's worker is terminated (no waiting
// for it to finish); the promise rejects with signal.reason. give: buffers of args the caller no longer needs (moved)
function run(mod, fn, args, signal, give = []) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason);
    const job = { mod, fn, args, give, resolve, reject };
    waiting.push(job);
    if (signal) signal.addEventListener('abort', () => stop(job, signal.reason), { once: true });
    pump();
  });
}
function stop(job, why) {
  const i = waiting.indexOf(job), w = job.worker;
  if (i >= 0) waiting.splice(i, 1);
  else if (w && w.job === job) { w.job = null; w.terminate(); made--; }
  else return; // settled already
  job.reject(why);
  pump();
}

module.exports = { run, WORKERS };
