// Local channel for `sori live`: one JSON request line per connection, one JSON reply line. A Windows named
// pipe (a unix socket elsewhere), never a network port. SORI_PIPE overrides the name (smoke runs use their own).
// The app's pipe has a random name, written to `nameFile()` in the user's own app data folder: another account on
// the computer can neither read it nor take the name first (a name made from the user name could be taken first,
// and the CLI would then talk to that account's program).
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const OPS = ['state', 'commands', 'run', 'select', 'script', 'verb', 'settings', 'find'];
const MAX = 1 << 16; // request bytes

// <app data>/Sori/live-pipe (Electron's userData folder of Sori, other accounts cannot read it)
function nameFile() {
  const home = os.homedir();
  const base = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'Sori', 'live-pipe');
}
const full = (id) => (process.platform === 'win32' ? '\\\\.\\pipe\\' + id : path.join(os.tmpdir(), id + '.sock'));
// the CLI's pipe: SORI_PIPE, else the one the running app wrote down; null: no app has served one
function name(file = nameFile()) {
  if (process.env.SORI_PIPE) return full(process.env.SORI_PIPE);
  try { return full(fs.readFileSync(file, 'utf8').trim()); } catch { return null; }
}

// main.js: handle(req) -> Promise<reply>; only known ops get through. A new random name each run, written down once
// it listens (SORI_PIPE: that name, nothing written)
function serve(handle, file = nameFile()) {
  const id = process.env.SORI_PIPE || 'sori-live-' + crypto.randomBytes(16).toString('hex');
  const srv = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', async (d) => {
      buf += d;
      if (buf.length > MAX) return sock.destroy();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      sock.removeAllListeners('data');
      let req = null, res;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { /* reported below */ }
      const known = req && typeof req === 'object' && OPS.includes(req.op);
      if (!known) res = { ok: false, error: 'BAD_REQUEST', message: 'ops: ' + OPS.join(', ') };
      else {
        try { res = await handle(req); } catch (e) { res = { ok: false, error: 'FAILED', message: e.message }; }
      }
      if (!sock.destroyed) sock.end(JSON.stringify(res) + '\n');
    });
  });
  srv.on('error', () => {}); // could not listen: no live mode in this run
  srv.listen(full(id), () => {
    if (process.env.SORI_PIPE) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, id);
    } catch { /* not written: sori live answers NO_APP */ }
  });
  return srv;
}

// CLI: send one request; rejects with code NO_APP (nothing listening), TIMEOUT or PIPE_ERROR
function request(req, ms) {
  const where = name();
  if (!where) return Promise.reject(Object.assign(new Error('Sori is not running'), { code: 'NO_APP' }));
  return new Promise((resolve, reject) => {
    const sock = net.connect(where);
    let buf = '';
    const fail = (code, message) => {
      clearTimeout(timer);
      sock.destroy();
      reject(Object.assign(new Error(message), { code }));
    };
    const timer = setTimeout(() => fail('TIMEOUT', `Sori did not answer within ${ms / 1000} s`), ms);
    sock.setEncoding('utf8');
    // the app drops a request still queued past this (live.js answers TIMEOUT): it never acts after we gave up
    sock.on('connect', () => sock.write(JSON.stringify({ ...req, deadline: Date.now() + ms }) + '\n'));
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(buf)); } catch { fail('PIPE_ERROR', 'Sori sent an unreadable reply'); }
    });
    sock.on('error', (e) => {
      const away = ['ENOENT', 'ECONNREFUSED'].includes(e.code);
      fail(away ? 'NO_APP' : 'PIPE_ERROR', e.code === 'ENOENT' ? 'Sori is not running' : e.message);
    });
  });
}

module.exports = { name, nameFile, serve, request };
