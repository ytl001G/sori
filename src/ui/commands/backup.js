// 자동 백업 + 파일 > 백업에서 열기…: every 10 min, when something changed since the last one, the
// work as it is goes to <userData>/backups (core/backup.js: newest 10 per project, sound shared in its pool, groups
// idle 30 days removed). A backup opens as an unsaved project; 저장 suggests the file it came from.
const path = require('path');
const { ipcRenderer } = require('electron');
const BK = require('../../core/backup');
const IO = require('../../core/fileio');
const D = require('../dialogs');
const { cmds, def } = require('./core');
const F = require('./files');
const { state, setDirty } = require('../../core/state');

const EVERY_MS = 10 * 60000;
let root = null;
const backupRoot = async () => root || (root = path.join(await ipcRenderer.invoke('user-data'), 'backups'));
// an unsaved new project is its own group until it is saved
const unsaved = new WeakMap();
let seq = 0;
function group() {
  const p = state.filePath;
  if (p) return { key: 'file:' + path.resolve(p).toLowerCase(), path: p, name: F.baseName(p) };
  if (!unsaved.has(state.project)) unsaved.set(state.project, `new:${Date.now()}:${++seq}`);
  return { key: unsaved.get(state.project), path: null, name: '새 프로젝트' };
}
// tidies the folder (30 days, unused pool files), then writes one when due; true when one was written. backupDue is
// set by every change (setDirty) and cleared by a new / opened project. One run at a time: tidy never meets a write.
let running = null;
async function backupNow() {
  if (running) return false;
  running = (async () => {
    const root = await backupRoot();
    await BK.tidy(root, group().key).catch(() => {}); // a locked file: the next run tries again
    if (!state.backupDue || state.recording || D.isBusy()) return false;
    state.backupDue = false; // a change made while it writes makes the next one due again
    try {
      await BK.write(root, group(), IO.saveThin(state.project));
      F.writeOk('백업을 만들지 못했어요');
      return true;
    } catch (e) {
      state.backupDue = true;
      F.writeFailed('백업을 만들지 못했어요', e);
      return false;
    }
  })();
  try { return await running; } finally { running = null; }
}

const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric',
  minute: '2-digit' });
const mb = (n) => (n / 1048576 < 0.1 ? '0.1 MB 미만' : (n / 1048576).toFixed(1) + ' MB');
// every project's backups, the open project's first, then by their newest one; resolves to the picked backup
function choose(all) {
  const groups = new Map();
  for (const b of all) {
    const k = path.dirname(b.file);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const mine = (bs) => !!state.filePath && bs[0].path === state.filePath;
  const order = [...groups.values()].sort((x, y) => mine(y) - mine(x));
  return D.sheet({
    title: '백업에서 열기', wide: false,
    build: (body, close) => {
      body.classList.add('backups');
      body.append(D.el('p', { className: 'shint', textContent: '작업 중 10분마다 만들어요 (프로젝트마다 최근 10개, 30일 동안 새 백업이 없으면 지워요). '
        + '연 백업은 저장 안 한 프로젝트로 열려서 원래 파일은 그대로예요.' }));
      for (const bs of order) {
        const head = D.el('h3', { textContent: bs[0].name + (mine(bs) ? ' (지금 프로젝트)' : '') });
        if (bs[0].path) head.title = bs[0].path;
        const rows = bs.map((b) => {
          const x = D.el('button', { type: 'button', className: 'backup-row' },
            D.el('span', { textContent: when(b.time) }), D.el('small', { textContent: mb(b.size) }));
          x.onclick = () => close(b);
          return x;
        });
        body.append(D.el('section', {}, head, ...rows));
      }
    },
  });
}
def('openBackup', '백업에서 열기…', async () => {
  const root = await backupRoot(), all = await BK.list(root);
  if (!all.length) return D.toast('아직 백업이 없어요. 작업 중 10분마다 만들어져요');
  const b = await choose(all);
  if (!b || !(await F.confirmDiscard())) return;
  try {
    if (!(await F.loadProjectFile(b.file, true, { pool: BK.poolReader(root) }))) return D.toast('멈췄어요 — 바뀐 것 없어요');
  } catch (e) {
    const why = e.message.replace(/^프로젝트[^:]*:\s*/, ''); // loadProject's own prefix, not twice
    return D.toast(`백업을 열 수 없어요: ${why}. 다른 시간의 백업을 골라 보세요`, 'error');
  }
  F.clearAutosave(); // as openProject: the opened backup replaces what the autosave held
  state.filePath = null;
  state.saveHint = b.path;
  setDirty(true);
  state.backupDue = false; // it is that backup already
  cmds.zoomFit.run();
  D.toast(`백업을 열었어요 (${b.name} · ${when(b.time)}). 저장해야 파일에 반영돼요`);
});

module.exports = { backupNow, EVERY_MS };
