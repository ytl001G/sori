// Files: new project, 열기 (projects and audio), 저장, autosave + crash recovery (userData/autosave.vproj + .json).
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const E = require('../../core/edit');
const IO = require('../../core/fileio');
const SCR = require('../../core/script');
const { writeAtomic } = require('../../core/safewrite');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { cmds, def, T, setClips, clearSel, curLine, setLine } = require('./core');
const { afterEdit } = require('./play');
const { dropRecording, stopFirst } = require('./record');
const { newTake, showLine } = require('./script');
const { state, history, makeTrack, newProjectData, setDirty, trackById } = require('../../core/state');

// shortcut: counts every redraw request while dirty (selection too), so a save may stay dirty needlessly; upgrade
// to a real edit counter in state.js if that annoys
let changes = 0;
state.listeners.add(() => { if (state.dirty) changes++; });
// autosave/backup failures: one Korean toast per failure streak
const failing = new Set();
function writeCause(e) {
  if (e && e.code === 'ENOSPC') return '디스크 공간이 부족해요. 필요 없는 파일을 지워 공간을 비워 주세요';
  if (e && ['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) {
    return '다른 프로그램이 파일을 쓰는 중이거나 권한이 없어요. 잠시 뒤 다시 되는지 보고, 안 되면 Ctrl+S로 저장해 두세요';
  }
  return '알 수 없는 문제예요. Ctrl+S로 저장해 두세요';
}
function writeFailed(what, e) {
  if (failing.has(what)) return;
  failing.add(what);
  D.toast(`${what}: ${writeCause(e)}`, 'error');
}
const writeOk = (what) => failing.delete(what);

const AUDIO_EXT = ['wav', 'mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'webm'];
const baseName = (p) => path.basename(p).replace(/\.[^.]+$/, '');
const gone = (p) => D.toast('파일이 없어요 (옮겨졌거나 지워졌어요): ' + path.basename(p), 'error');

// unsaved changes before 새로 만들기 / 열기 / 대본 넣기 / closing the window: [저장] [저장 안 함] [취소] in the app's own
// window. true = go on (saved, or the user let the changes go); a 저장 that is cancelled or fails = stay.
// A recording stops first, so its take is in what 저장 writes
async function confirmDiscard(what = '계속하면', ask = D.ask) {
  if (!(await stopFirst())) return false;
  if (!state.dirty) return true;
  const v = await ask({ title: '저장하지 않은 변경 사항이 있어요.', note: `저장하지 않고 ${what} 변경 내용이 사라져요.`,
    yes: 'discard', buttons: [{ label: '저장', value: 'save', primary: true }, { label: '저장 안 함', value: 'discard' },
      { label: '취소', value: null }] });
  if (v === 'save') return !!(await cmds.save.run()) && !state.dirty;
  return v === 'discard';
}
function resetProject(project) {
  engine.stop(); engine.stopPreview();
  dropRecording();
  state.playing = false;
  state.project = project;
  clearSel();
  state.sel.playhead = 0;
  state.sel.markerId = null;
  state.sel.activeTrackId = project.tracks[0] ? project.tracks[0].id : null;
  state.ui.fxTarget = 'master';
  state.ui.scriptView = { char: '', todo: false };
  state.noiseProfile = null;
  state.backupDue = false; state.saveHint = null;
  history.clear();
}

def('newProject', '새 프로젝트', async () => {
  if (!(await confirmDiscard())) return;
  const rate = S.get().sampleRate;
  await engine.setSampleRate(rate);
  resetProject(newProjectData(rate));
  state.filePath = null;
  setDirty(false);
  clearAutosave();
});
def('open', '열기…', async () => {
  const r = await ipcRenderer.invoke('open-dialog', {
    title: '열기', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '오디오 · Sori 프로젝트', extensions: [...AUDIO_EXT, 'vproj'] },
      { name: '모든 파일', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return;
  const proj = r.filePaths.find((p) => p.toLowerCase().endsWith('.vproj'));
  if (proj) return openProject(proj);
  return importAudio(r.filePaths);
});

// the file in 4 MB pieces with a progress step each (the bar; 멈추기 throws out of step)
async function readInSteps(p, step) {
  const size = (await fs.promises.stat(p)).size, parts = [], mb = (n) => (n / 1048576).toFixed(0);
  let got = 0;
  for await (const part of fs.createReadStream(p, { highWaterMark: 4 << 20 })) {
    parts.push(part); got += part.length;
    await step(got, size, `${mb(got)} / ${mb(size)} MB`);
  }
  return Buffer.concat(parts);
}
// false when stopped (nothing changed). Recovery passes stoppable = false: stopping there and then editing would let
// the autosave timer overwrite the crashed work. opts: fileio.loadProject's (a backup's pool). One bar: reading the
// file is the first half, unpacking its sound the second (the longer part of a packed project)
async function loadProjectFile(p, stoppable = true, opts) {
  const read = async (step) => {
    const half = (d, t, text) => step(d, 2 * t, text);
    const g = IO.loadSteps(stoppable ? await readInSteps(p, half) : await fs.promises.readFile(p), opts); // a Buffer
    for (let r = g.next(); ; r = g.next()) {
      if (r.done) return r.value;
      if (stoppable) await step(r.value[1] + r.value[0], 2 * r.value[1], '소리 푸는 중');
    }
  };
  const loaded = await D.busy('프로젝트 여는 중', read);
  if (loaded === D.STOPPED) return false;
  await engine.setSampleRate(loaded.sampleRate);
  const fresh = (t) => {
    const base = makeTrack();
    return { ...base, ...t, id: base.id, color: t.color || base.color };
  };
  const tracks = loaded.script ? loaded.tracks : loaded.tracks.map(fresh);
  resetProject(newProjectData(loaded.sampleRate, { ...loaded, tracks }));
  if (curLine()) showLine(curLine());
  const bad = loaded.damaged || [];
  if (bad.length) {
    const more = bad.length > 3 ? ` 외 ${bad.length - 3}개` : '';
    D.toast(`소리가 손상된 테이크 ${bad.length}개는 무음으로 열었어요: ${bad.slice(0, 3).join(', ')}${more}. `
      + '파일 > 백업에서 열기에서 이전 백업을 확인하세요', 'error');
  }
  return true;
}
async function openProject(p, ask) {
  if (!(await confirmDiscard(undefined, ask))) return;
  try {
    if (!(await loadProjectFile(p))) return D.toast('멈췄어요 — 바뀐 것 없어요');
    state.filePath = p;
    setDirty(false);
    clearAutosave();
    S.addRecent(p);
    cmds.zoomFit.run();
  } catch (e) {
    if (e.code === 'ENOENT') { S.removeRecent(p); return gone(p); }
    D.toast(e.message.startsWith('프로젝트') ? e.message : '프로젝트를 열 수 없어요: ' + e.message, 'error');
  }
}
function openRecent(p) {
  if (p.toLowerCase().endsWith('.vproj')) return openProject(p);
  if (!fs.existsSync(p)) { S.removeRecent(p); return gone(p); }
  return importAudio([p]);
}

// each file decoded at the project rate (a progress step each); a file that will not open says so and is skipped.
// null when stopped
async function decodeAll(paths) {
  const decoded = [];
  const r = await D.busy('소리 불러오는 중', async (step) => {
    for (const [i, p] of paths.entries()) {
      await step(i, paths.length, `${path.basename(p)} (${i + 1}/${paths.length})`);
      try {
        const buf = await fs.promises.readFile(p);
        decoded.push({ p, ch: await engine.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) });
      } catch {
        D.toast(`${path.basename(p)}: 열 수 없는 파일이에요 (WAV · MP3 · FLAC · OGG · M4A 지원)`, 'error');
      }
    }
  });
  return r === D.STOPPED ? null : decoded;
}
// a new track, or in a script project a new take of the current line (like a recording: selected)
function addAsTrack(p, clip) {
  const l = curLine(), nt = l ? newTake({ clips: [clip] }) : makeTrack({ name: baseName(p), clips: [clip] });
  state.project.tracks = [...T(), nt];
  state.sel.activeTrackId = nt.id;
  if (l && !l.star) setLine(l.id, SCR.withStar(nt.id));
}
// paths -> new tracks, or the first file onto `target` ({ trackId, at }) when dropped on a lane
async function importAudio(paths, target) {
  const decoded = await decodeAll(paths);
  if (!decoded) return D.toast('멈췄어요 — 바뀐 것 없어요');
  if (!decoded.length) return;
  history.commit();
  decoded.forEach(({ p, ch }, i) => {
    const clip = E.makeClip(E.makeSource(ch), i === 0 && target ? Math.max(0, target.at) : 0, baseName(p));
    const t = i === 0 && target && trackById(target.trackId);
    if (t) setClips(t.id, E.sortClips([...t.clips, clip]));
    else addAsTrack(p, clip);
    S.addRecent(p);
  });
  if (decoded.length && T().length === decoded.length) cmds.zoomFit.run();
  afterEdit();
}

// Ctrl+S while recording: the recording goes on and the rest is saved; the take being recorded (history.hide) is left
// out and the project stays dirty; so does a change made while the file was written
const savable = () => (state.recording
  ? { ...state.project, tracks: state.project.tracks.filter((t) => t.id !== history.hide) } : state.project);
async function writeProject(p) {
  try {
    const n = changes;
    await writeAtomic(p, IO.saveProject(savable()));
    state.filePath = p;
    if (changes === n && !state.recording) {
      setDirty(false);
      clearAutosave();
    }
    S.addRecent(p);
    D.toast(state.recording ? '저장했어요 (지금 녹음 중인 테이크는 빼고)' : '저장했어요');
    return true;
  } catch (e) {
    D.toast('저장하지 못했어요: ' + e.message + ' (다른 위치에 저장해 보세요)', 'error');
    return false;
  }
}
def('save', '저장', () => (state.filePath ? writeProject(state.filePath) : cmds.saveAs.run()));
def('saveAs', '다른 이름으로 저장…', async () => {
  const r = await ipcRenderer.invoke('save-dialog', {
    title: '프로젝트 저장',
    defaultPath: state.filePath ? baseName(state.filePath) + '.vproj' : state.saveHint || '새 프로젝트.vproj',
    filters: [{ name: 'Sori 프로젝트', extensions: ['vproj'] }],
  });
  if (!r.canceled && r.filePath) return writeProject(r.filePath);
});

let userData = null;
async function autosavePaths() {
  if (!userData) userData = await ipcRenderer.invoke('user-data');
  return { data: path.join(userData, 'autosave.vproj'), meta: path.join(userData, 'autosave.json') };
}
// shortcut: rewrites all the (packed) audio every time; for projects over ~1 GB write sources once, then the JSON.
// One at a time; a save that cleaned the project during the write removes the files again
let autosaving = null;
async function autosave() {
  if (autosaving || !state.dirty || state.recording) return false;
  autosaving = (async () => {
    const f = await autosavePaths();
    try {
      await writeAtomic(f.data, IO.saveProject(state.project));
      await writeAtomic(f.meta, JSON.stringify({ filePath: state.filePath, time: Date.now() }));
      writeOk('자동 저장하지 못했어요');
    } catch (e) { writeFailed('자동 저장하지 못했어요', e); return false; } // the next interval tries again
    if (!state.dirty) await clearAutosave();
    return true;
  })();
  try { return await autosaving; } finally { autosaving = null; }
}
async function clearAutosave() {
  const f = await autosavePaths();
  for (const p of [f.data, f.meta]) await fs.promises.unlink(p).catch(() => {});
}
async function recoverAutosave() {
  const f = await autosavePaths();
  if (!fs.existsSync(f.data)) return false;
  let meta = {};
  // data without meta: still recoverable
  try { meta = JSON.parse(await fs.promises.readFile(f.meta, 'utf8')); } catch { /* no meta */ }
  ipcRenderer.send('recovery', true); // main.js keeps the autosave on a close meanwhile
  try { return await askRecover(f, meta); } finally { ipcRenderer.send('recovery', false); }
}
async function askRecover(f, meta) {
  const when = meta.time ? new Date(meta.time).toLocaleString('ko-KR') : '알 수 없음';
  // Esc keeps the work (= 복구): only the 지우기 button throws it away
  const v = await D.ask({ title: '저장하지 않고 꺼진 작업이 있어요.', yes: 'keep',
    note: `마지막 자동 저장: ${when}. 복구하지 않으면 자동 저장 파일은 지워져요.`,
    buttons: [{ label: '지우기', value: 'drop' }, { label: '복구', value: 'keep', primary: true }] });
  if (v === 'drop') { await clearAutosave(); return false; }
  try {
    await loadProjectFile(f.data, false);
    state.filePath = typeof meta.filePath === 'string' ? meta.filePath : null;
    setDirty(true); // still unsaved: Ctrl+S writes it back to the original file
    D.toast('복구했어요. 저장(Ctrl+S)해야 원래 파일에 반영돼요');
    cmds.zoomFit.run();
    return true;
  } catch (e) {
    // kept aside, so the next autosave does not overwrite what might still be rescued
    const aside = path.join(path.dirname(f.data), `autosave-broken-${Date.now()}.vproj`);
    const moved = await fs.promises.rename(f.data, aside).then(() => true, () => false);
    await clearAutosave();
    D.toast('자동 저장 파일을 열 수 없어요: ' + e.message
      + (moved ? `. 그 파일은 ${path.basename(aside)}(으)로 옮겨 두었어요` : ''), 'error');
    return false;
  }
}

module.exports = {
  baseName, decodeAll, confirmDiscard, openProject, openRecent, loadProjectFile, importAudio, writeProject, autosave,
  clearAutosave, recoverAutosave, writeFailed, writeOk,
};
