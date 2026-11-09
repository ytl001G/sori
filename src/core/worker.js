// One worker of workers.js: runs require('./' + mod)[fn](...args) and hands the result's sample buffers back without
// copying them. A Web Worker with Node in Sori's windows, a worker_threads worker in plain Node.
const path = require('path');
const port = typeof postMessage === 'function' ? null : require('worker_threads').parentPort;
const send = (m, list) => (port ? port.postMessage(m, list) : postMessage(m, list));
const MODS = new Set(['encoders', 'voicedit', 'audiopack']);

// every typed array's buffer in x, once
function buffers(x, out = new Set()) {
  if (ArrayBuffer.isView(x)) out.add(x.buffer);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) buffers(v, out);
  return out;
}
async function handle({ mod, fn, args }) {
  try {
    if (!MODS.has(mod)) throw new Error('not a worker module: ' + mod);
    const out = await require(path.join(__dirname, mod))[fn](...args);
    send({ out }, [...buffers(out)]);
  } catch (e) { send({ error: e.message || String(e) }); }
}
if (port) port.on('message', handle); else onmessage = ({ data }) => handle(data);
