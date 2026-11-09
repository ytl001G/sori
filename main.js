const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');

let win;
let dirty = false;
const SMOKE = process.argv.includes('--smoke');
const HIDDEN = SMOKE && !process.env.SORI_SHOW; // tests draw off screen and stay silent; SORI_SHOW=1 to watch them
const smokeData = SMOKE && require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'sori-smoke-'));
// app.exit skips the quit events: smoke exits through here so its temp userData goes too
const smokeExit = (code) => {
  try { require('fs').rmSync(smokeData, { recursive: true, force: true, maxRetries: 3 }); } catch { /* locked */ }
  app.exit(code);
};
if (SMOKE) {
  // smoke runs never touch the user's settings/autosave, and get a fake mic
  app.setPath('userData', smokeData);
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
// `sori import/export` (src/cli): a hidden window runs one job with its own temp userData, so it never touches the
// user's settings or autosave and can run next to an open app (no single-instance lock)
const CLI_JOB = (process.argv.find((a) => a.startsWith('--cli=')) || '').slice(6);
if (CLI_JOB) app.setPath('userData', path.join(CLI_JOB, 'data'));
if (SMOKE) process.env.SORI_PIPE = 'sori-smoke-' + process.pid; // own live pipe: smoke never drives the user's app
// one window per user: two instances would overwrite each other's autosave
if (!SMOKE && !CLI_JOB && !app.requestSingleInstanceLock()) app.quit();
// a double-clicked .vproj (fileAssociations in package.json) comes as an argument: at start, or to the running window
const projectArg = (argv, cwd) => {
  const f = argv.slice(1).find((a) => /\.vproj$/i.test(a));
  return f && path.resolve(cwd, f);
};
let startFile = SMOKE || CLI_JOB ? null : projectArg(process.argv, process.cwd());
// until the page asks for 'start-file' (after the recovery question) a new double-click only replaces startFile,
// so two loads never run at once
let startAsked = false;
app.on('second-instance', (_e, argv, cwd) => {
  const f = projectArg(argv, cwd);
  if (f && !startAsked) startFile = f;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  if (f && startAsked) win.webContents.send('open-path', f);
});
ipcMain.handle('start-file', () => { const f = startFile; startFile = null; startAsked = true; return f; });

// autosave files are only for crash recovery: a normal close removes them
const dropAutosave = () => {
  for (const f of ['autosave.vproj', 'autosave.json']) {
    try { require('fs').unlinkSync(path.join(app.getPath('userData'), f)); } catch { /* none */ }
  }
};

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0F172A',
    autoHideMenuBar: true,
    title: 'Sori',
    show: !HIDDEN,
    webPreferences: {
      // local-only app: renderer needs fs + npm modules; no remote content is ever loaded
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: true, // MP3 encoding workers (src/audio/mp3.js)
      // loop playback (rAF tick) and the metronome pump (25 ms timer) must keep running when the window is covered
      backgroundThrottling: false,
      additionalArguments: SMOKE ? ['--smoke'] : [],
      offscreen: HIDDEN, // a merely hidden window gets almost no frames (rAF) and DOM views stop updating
    },
  });
  win.setMenu(null);
  if (SMOKE) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
    if (HIDDEN) win.webContents.setAudioMuted(true); // the AudioContext keeps running, nothing reaches the speakers
    setTimeout(() => { console.log('smoke timeout'); smokeExit(1); }, 120000);
  }
  // a file dropped outside the timeline must never replace the app page (data loss + node access)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
  win.on('close', askBeforeClose);
}
// unsaved changes: the page asks in its own window ([저장] [저장 안 함] [취소]) and sends close-now; a normal
// close removes the crash-recovery autosave. A crashed page cannot ask: the window closes and the autosave stays
let closing = false;
let recovering = false; // the page is asking about / loading the autosave: it must survive any close
ipcMain.on('recovery', (_e, v) => { recovering = v; });
function askBeforeClose(e) {
  if (win.webContents.isCrashed() || recovering) return undefined;
  if (!dirty || SMOKE || closing) return dropAutosave();
  e.preventDefault();
  win.webContents.send('ask-close');
}
ipcMain.on('close-now', () => { closing = true; win.close(); });

app.whenReady().then(() => {
  if (CLI_JOB) return cliJob();
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  createWindow();
  serveLive();
});

// ---- sori CLI (docs/cli.md) ----
function cliJob() {
  const w = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, nodeIntegrationInWorker: true,
    additionalArguments: ['--cli=' + CLI_JOB],
  } });
  ipcMain.once('cli-done', () => app.exit(0));
  w.webContents.on('render-process-gone', () => app.exit(1));
  w.loadFile(path.join(__dirname, 'src', 'cli', 'headless.html'));
}
// sori live: local pipe -> this window; src/ui/live.js validates and runs the app's own commands
const livePending = new Map();
let liveSeq = 0;
function serveLive() {
  ipcMain.on('live-reply', (_e, id, res) => {
    const done = livePending.get(id);
    livePending.delete(id);
    if (done) done(res);
  });
  require('./src/cli/pipe').serve((req) => new Promise((resolve) => {
    const closed = { ok: false, error: 'NO_WINDOW', message: 'the Sori window is closed' };
    if (!win || win.isDestroyed()) return resolve(closed);
    livePending.set(++liveSeq, resolve);
    win.webContents.send('live', liveSeq, req);
  }));
}
app.on('window-all-closed', () => app.quit());

ipcMain.handle('open-dialog', (_e, opts) => dialog.showOpenDialog(win, opts));
ipcMain.handle('save-dialog', (_e, opts) => dialog.showSaveDialog(win, opts));
ipcMain.handle('user-data', () => app.getPath('userData'));
ipcMain.on('set-dirty', (_e, v) => { dirty = v; });
ipcMain.on('toggle-devtools', () => win.webContents.toggleDevTools());
ipcMain.handle('capture', async (_e, file) => require('fs').writeFileSync(file, (await win.capturePage()).toPNG()));
if (SMOKE) ipcMain.handle('resize', (_e, w, h) => { win.setSize(w, h); });
// hidden run: already not visible
if (SMOKE) {
  ipcMain.handle('win', (_e, op) => { if (win.isVisible() && (op === 'minimize' || op === 'restore')) win[op](); });
}
ipcMain.on('smoke-done', (_e, ok, log) => { console.log(log); smokeExit(ok ? 0 : 1); });
