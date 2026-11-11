// Smoke steps: Autosave + recovery, save and reopen, the unsaved-changes question.
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const C = require('../../src/ui/commands');
const D = require('../../src/ui/dialogs');
const S = require('../../src/core/settings');
const engine = require('../../src/audio/engine');
const BF = require('../../src/audio/buffers');
const PK = require('../../src/core/parked');
const { state, history, changed } = require('../../src/core/state');
const { dir, stub, wait, invokeOrig, assert, sr, T, end, sel, painted, realAsk, stubAsk } = require('./kit');

// answers the app's own question window with one of its buttons, after checking them
async function answer(label) {
  for (let i = 0; i < 50 && !document.querySelector('.dialog.ask'); i++) await wait(20);
  await painted();
  const btns = [...document.querySelectorAll('.dialog.ask .foot button')], names = btns.map((b) => b.textContent);
  assert(names.join() === '저장,저장 안 함,취소' && document.activeElement === btns[0], 'buttons ' + names);
  btns[names.indexOf(label)].click();
}

module.exports = [
  ['autosave + crash recovery', async () => {
    sel(0, 0.1); await C.run('delete');
    const len = end();
    assert(state.dirty && await C.autosave(), 'autosave wrote');
    const ud = await invokeOrig('user-data');
    assert(fs.existsSync(path.join(ud, 'autosave.vproj')), 'no file');
    // the file holds no sound; each take's sound is in the autosave folder once, not written again next time
    const pool = path.join(ud, 'autosave', 'pool'), snd = fs.readdirSync(pool), before = T()[0].clips[0].src.ch[0];
    const sound = snd.reduce((n, f) => n + fs.statSync(path.join(pool, f)).size, 0);
    assert(snd.length > 0 && fs.statSync(path.join(ud, 'autosave.vproj')).size < sound / 10, 'sound in the file');
    const when = snd.map((f) => fs.statSync(path.join(pool, f)).mtimeMs);
    await C.autosave();
    assert(snd.every((f, k) => fs.statSync(path.join(pool, f)).mtimeMs === when[k]), 'sound written again');
    assert(await C.recoverAutosave(), 'not recovered');
    const back = T()[0].clips[0].src.ch[0];
    const same = back.length === before.length && back.every((x, k) => Math.abs(x - before[k]) < 1e-6);
    assert(end() === len && state.dirty && same,
      'recovered project');
    await C.clearAutosave(); assert(!fs.existsSync(path.join(ud, 'autosave.vproj')), 'not cleared');
  }],
  ['save + reopen (a double-clicked .vproj) keeps tempo, markers, effects; adds to recent', async () => {
    const p = path.join(dir, 'p.vproj');
    C.setTempo(100, 3); state.sel.range = null; state.sel.playhead = sr; await C.run('addMarker');
    C.setFx(T()[0].id, 'eq', { on: true, low: 4 }); C.setFx('master', 'gain', { gainDb: -2 });
    const len = end(), n = T().length;
    assert(await C.writeProject(p), 'write');
    assert(S.get().recent[0] === p, 'recent');
    await C.run('newProject'); assert(T().length === 0 && state.project.markers.length === 0, 'new');
    await C.run('insertSilence'); assert(!history.canUndo() && !state.dirty, 'silence with no track: no step');
    ipcRenderer.emit('open-path', {}, p); // a .vproj double-clicked while Sori runs (main.js second-instance)
    for (let i = 0; i < 100 && state.filePath !== p; i++) await wait(20);
    assert(state.filePath === p && T().length === n && end() === len, 'reopen');
    const q = state.project;
    assert(q.bpm === 100 && q.beats === 3 && q.markers.length === 1 && T()[0].fx.eq.low === 4 && q.master.gainDb === -2,
      'v2 fields');
    C.setTempo(120, 4); C.setFx(T()[0].id, 'eq', { on: false }); C.setFx('master', 'gain', { gainDb: 0 });
  }],
  ['a save leaves the project saved after a click during the write, unsaved after an edit during it', async () => {
    const p = path.join(dir, 'p.vproj');
    const mark = (sec) => {
      state.sel.range = null; state.sel.playhead = Math.round(sec * sr);
      return C.run('addMarker');
    };
    await mark(0.3); assert(state.dirty, 'an edit');
    let w = C.writeProject(p);
    sel(0, 0.2); changed(); // a click while the file is written: not an edit
    assert(await w && !state.dirty, 'a selection during the save kept the project unsaved');
    w = C.writeProject(p);
    await mark(0.7); // an edit while the file is written: not in the file
    assert(await w && state.dirty, 'an edit made during the save was taken as saved');
    await C.run('undo'); await C.run('undo');
  }],
  ['one copy of a take: playback uses its own arrays, also after its samples were let go and an undo', async () => {
    const s = T()[0].clips[0].src, ctx = engine.context(), id = T()[0].id;
    assert(BF.bufferFor(ctx, s).getChannelData(0) === s.ch[0], 'a reopened take is held twice');
    await C.removeTrack(id);
    engine.sweep(T(), Date.now() + PK.IDLE_MS + 1); // out of the project long enough: its samples go
    await C.run('undo');
    assert(T()[0].id === id && BF.bufferFor(ctx, s).getChannelData(0) === s.ch[0],
      'after an undo, playback kept the old buffer beside the newly decoded samples');
  }],
  ['unsaved changes: the app asks in its own window — 취소 keeps all, 저장 saves then goes on', async () => {
    D.ask = realAsk;
    try {
      sel(0, 0.1); await C.run('delete');
      const kept = state.project, n = T().length;
      let p = C.run('newProject'); await answer('취소'); await p;
      assert(state.project === kept && state.dirty && !document.querySelector('.dialog.ask'), '취소 keeps it');
      state.filePath = null; stub.save = path.join(dir, 'asked.vproj');
      p = C.run('newProject'); await answer('저장'); await p;
      assert(fs.existsSync(stub.save) && T().length === 0 && !state.dirty, '저장, then a new project');
      await C.openProject(stub.save); // the next steps go on with these tracks
      assert(T().length === n, 'back');
    } finally { D.ask = stubAsk; }
  }],
  ['a double-clicked .vproj waits for a long job, then asks in the real window even when D.ask answers', async () => {
    const p = path.join(dir, 'p.vproj'), kept = state.project; // D.ask is the stub here, like during live run --yes
    sel(0, 0.1); await C.run('delete');
    let release;
    const job = D.busy('test', () => new Promise((r) => { release = r; }));
    ipcRenderer.emit('open-path', {}, p);
    await wait(250);
    assert(state.project === kept && !document.querySelector('.dialog.ask'), 'waits for the job');
    release(); await job;
    await answer('취소');
    assert(state.project === kept && state.dirty, '취소 keeps the project');
    await C.run('undo');
  }],
  ['a recording stops before the unsaved-changes question: its take is kept', async () => {
    const n = T().length;
    await C.run('record'); await wait(400);
    assert(state.recording, 'recording');
    stub.ask = null; // 취소
    try { await C.run('newProject'); } finally { stub.ask = undefined; }
    assert(!state.recording && T().length === n + 1 && T()[n].clips.length && state.dirty, 'take kept, project kept');
    await C.run('undo'); assert(T().length === n, 'undo the take');
  }],
  ['자동 백업: only after a change; 백업에서 열기 opens one as an unsaved project, 저장 suggests its file', async () => {
    const p = state.filePath, n = T().length;
    sel(0, 0.1); await C.run('delete');
    const cut = end();
    assert(await C.backupNow(), 'made after a change');
    assert(!(await C.backupNow()), 'nothing changed since: skipped');
    C.mixer(T()[0].id, { gain: 0.5 }); assert(state.backupDue, 'a volume change while already unsaved is due too');
    await C.run('undo');
    const opening = C.run('openBackup');
    for (let i = 0; i < 50 && !document.querySelector('.backup-row'); i++) await wait(20);
    const first = document.querySelector('.backups section');
    assert(first && first.querySelector('h3').textContent.includes('(지금 프로젝트)'), 'the open project first');
    first.querySelector('.backup-row').click(); await opening;
    assert(state.filePath === null && state.saveHint === p && state.dirty && T().length === n && end() === cut,
      'opened unsaved: ' + [state.filePath, state.saveHint, end(), cut]);
    assert(!state.backupDue, 'not due: it is that backup');
    await C.openProject(p); assert(state.filePath === p && !state.saveHint, 'back to the file');
  }],
];
