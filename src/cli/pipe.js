// Local channel for `sori live`: one JSON request line per connection, one JSON reply line. A Windows named
// pipe (a unix socket elsewhere), never a network port. SORI_PIPE overrides the name (smoke runs use their own).
const net = require('net');
const os = require('os');
const path = require('path');

const OPS = ['state', 'commands', 'run', 'select', 'script', 'verb', 'settings'];
const MAX = 1 << 16; // request bytes

function name() {
  // keep non-ASCII (Korean) user names: folding them to '_' would let two users share one pipe name
  const user = String(process.env.USERNAME || process.env.USER || 'user').replace(/[\\/:]/g, '_');
  const id = process.env.SORI_PIPE || 'sori-live-' + user;
  return process.platform === 'win32' ? '\\\\.\\pipe\\' + id : path.join(os.tmpdir(), id + '.sock');
}

// main.js: handle(req) -> Promise<reply>; only known ops get through
function serve(handle) {
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
  srv.on('error', () => {}); // another Sori already serves this pipe: live mode stays with that one
  srv.listen(name());
  return srv;
}

// CLI: send one request; rejects with code NO_APP (nothing listening), TIMEOUT or PIPE_ERROR
function request(req, ms) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(name());
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

module.exports = { name, serve, request };
