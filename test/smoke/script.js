// Smoke steps: script recording mode end to end. The steps build on each other: one script project, its takes.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const MN = require('../../src/ui/menus');
const D = require('../../src/ui/dialogs');
const SCR = require('../../src/core/script');
const { state, history } = require('../../src/core/state');
const { toasts, dir, stub, wait, painted, stubModal, realModal, invokeOrig, assert, sr, T, end, sel, wav,
  shots } = require('./kit');

const shot = async (n) => {
  if (shots) { await painted(); await wait(150); await invokeOrig('capture', path.join(shots, n + '.png')); }
};
const txt = path.join(dir, '대본.txt'), s = () => state.project.script, cur = () => C.curLine();
const names = () => s().lines.map((l) => SCR.lineName(l));
const heard = () => C.audible().filter((t) => !t.mute).map((t) => t.name).join();
const doneRow = async () => {
  await painted();
  return document.querySelector('#sp-list .line-row.cur').classList.contains('done');
};
// the dialogs' notes (대본 넣기 and 보통 프로젝트로 바꾸기 warn there); this stub stays until the last step here
let note = '';
const noting = async (o) => { note = o.note || ''; return stubModal(o); };

module.exports = [
  ['script mode: 대본 넣기 on a plain project (warned), undo / redo, the list and line bar', async () => {
    fs.writeFileSync(txt, '# 1화\n철수: (화가 나서) 너 뭐야!\n영희-005: 안녕\n철수: 둘째 대사\n');
    D.modal = noting;
    const plainTracks = T().length, plainPath = state.filePath;
    assert(plainTracks > 0, 'the step before leaves tracks');
    await C.importScript(txt);
    assert(s() && names().join() === '철수-001,영희-005,철수-002' && SCR.lineName(cur()) === '철수-001' && T().length === 0,
      'imported ' + names());
    assert(note.includes(`트랙 ${plainTracks}개가 모두 지워지고`) && state.filePath === plainPath, 'warned, same project: '
      + note);
    await C.run('undo'); await painted();
    assert(!s() && T().length === plainTracks && !document.body.classList.contains('script'),
      'Ctrl+Z: the plain project and its tracks are back');
    await C.run('redo');
    assert(s() && names().join() === '철수-001,영희-005,철수-002' && T().length === 0, 'Ctrl+Y: the script again');
    // 대사 rows show in 편집; takes keep the script's order (이름순 정렬 greyed)
    assert(MN.MENUS.edit.includes('editLine') && !C.cmds.sortTracks.enabled(), 'script menus');
    await painted();
    assert(document.body.classList.contains('script') && document.querySelectorAll('#sp-list .line-row').length === 3,
      'list rows');
    assert(document.querySelector('#script-bar .sb-text').textContent === '너 뭐야!' &&
      document.querySelector('#script-bar .sb-memo').textContent === '화가 나서', 'line bar');
    assert(!C.cmds.addVoiceTrack.enabled() && !C.cmds.dupTrack.enabled() && C.cmds.addTrack.label === '빈 테이크',
      'no plain tracks in a script project (빈 트랙 makes an empty take there)');
    assert(C.cmds.unscript.enabled(), '보통 프로젝트로 바꾸기 on in a script project');
  }],
  ['script mode: while recording ★ and 대사 고치기 work; ↓ stops it, the take stays', async () => {
    await C.run('record'); assert(state.recording, 'not recording');
    await painted();
    assert(document.getElementById('script-bar').classList.contains('rec') &&
      !document.querySelector('#script-bar .sb-next').hidden, 'prompter shows the next line');
    const recId = C.recInfo().trackId;
    assert(C.cmds.editLine.enabled(), '대사 고치기 works while recording');
    C.setStar(recId);
    assert(cur().star === recId && state.recording && T().some((t) => t.id === recId),
        '★ while recording, it goes on');
    await wait(300); await shot('script-rec'); await wait(300); await C.run('nextLine');
    assert(SCR.lineName(cur()) === '영희-005' && !state.recording, '↓ stops the recording');
    await C.run('prevLine');
    assert(T().length === 1 && T()[0].name === '테이크 1' && cur().star === T()[0].id && T()[0].clips[0].start === 0 &&
      state.sel.playhead === 0, 'take 1 is ★ at 0 s');
  }],
  ['script mode: a dropped file is a take; the selected take plays; no M/S on takes', async () => {
    await C.importAudio([wav]); // a dropped file is a take too, ★ stays
    assert(T().length === 2 && T()[1].name === '테이크 2' && cur().star === T()[0].id &&
      state.sel.activeTrackId === T()[1].id, 'take 2, selected');
    await painted();
    document.querySelectorAll('#headers-inner .track-h')[1].querySelector('.star').click();
    assert(cur().star === T()[1].id, '★ moved');
    state.sel.activeTrackId = T()[0].id; assert(heard() === '테이크 1', 'the clicked take plays, not ★: ' + heard());
    await C.run('playPause'); state.sel.activeTrackId = T()[1].id;
    assert(heard() === '테이크 1', 'clicking during playback only selects');
    await C.run('stop'); assert(heard() === '테이크 2', 'the next play uses the selection');
    const here = cur().id; await C.run('playPause'); await C.run('nextLine');
    assert(!state.playing && cur().id !== here && state.sel.playhead === 0, '↓ while playing stops it, at 0 s');
    await C.run('playPause'); await painted();
    assert(!state.playing && document.getElementById('btn-play').disabled, 'no takes: 재생 greyed out, no-op');
    await C.run('prevLine');
    assert(cur().id === here && T().length === 2 && state.sel.activeTrackId === cur().star && heard() === '테이크 2',
      'back: every take shows, ★ selected');
    // a take shorter than another, heard to its end: Space plays it again from 0 s (not silence from its end)
    const was = T()[1], half = { ...was, clips: [{ ...was.clips[0], length: Math.round(was.clips[0].length / 2) }] };
    state.project.tracks = [T()[0], half]; state.sel.playhead = half.clips[0].length;
    await C.run('playPause'); await wait(150);
    assert(state.playing && state.sel.playhead < half.clips[0].length, 'the end of the shorter take: Space from 0 s');
    await C.run('stop'); state.project.tracks = [T()[0], was];
    C.mixer(T()[0].id, { solo: true }); C.mixer(T()[1].id, { mute: true });
    assert(heard() === '테이크 2', 'takes have no M/S: stored flags are ignored'); C.mixer(T()[0].id, { solo: false });
    C.mixer(T()[1].id, { mute: false });
    await painted();
    assert(getComputedStyle(document.querySelector('#headers-inner .track-h .tbtn.s')).display === 'none',
        'no S on a take');
    C.setScriptView({ todo: true });
    assert(!C.visibleLines().some((l) => l.id === cur().id), "a done current line leaves '녹음 안 한 것만' at once");
    C.setScriptView({ todo: false });
  }],
  ['script mode: Delete / ✕ on takes, ★ never jumps, names stay, undo', async () => {
    state.sel.activeTrackId = T()[1].id; state.sel.range = null; state.sel.clipIds = new Set();
    await C.run('delete'); assert(T().length === 2, 'Delete with nothing selected removes nothing');
    document.querySelectorAll('#headers-inner .track-h')[1].querySelector('.x').click();
    assert(T().length === 1 && cur().star === null, '✕ removes the take, ★ does not jump to another');
    await C.run('nextLine'); await C.run('prevLine');
    assert(state.sel.activeTrackId === T()[0].id && C.cmds.playPause.enabled(), 'no ★: a line opens on its first take');
    await C.run('undo'); assert(T().length === 2 && cur().star === T()[1].id, 'undo take delete');
    // [+ 테이크] / Ctrl+Shift+N: an empty take at the bottom, selected, ★ stays; one undo step
    const add = document.querySelector('#headers-top .take-add'); await painted();
    assert(add.offsetParent && !add.disabled && C.cmds.addTrack.label === '빈 테이크', 'the button shows, a take');
    add.click(); await painted();
    assert(T().length === 3 && !T()[2].clips.length && T()[2].name === '테이크 3' && state.sel.activeTrackId === T()[2].id
      && cur().star === T()[1].id, 'an empty take, selected, ★ stays: ' + T().map((t) => t.name));
    await C.run('undo'); assert(T().length === 2 && cur().star === T()[1].id, 'undo the new take');
    await C.run('record'); await wait(400); await painted();
    assert(add.disabled && !C.cmds.addTrack.enabled(), 'no new take while recording'); await C.run('record');
    assert(T().length === 3 && T()[2].name === '테이크 3' && cur().star === T()[1].id &&
      state.sel.activeTrackId === T()[2].id, 'a new take leaves ★ where it is');
    document.querySelectorAll('#headers-inner .track-h')[1].querySelector('.x').click(); // takes 1 2 3, delete 2
    assert(T().map((t) => t.name).join() === '테이크 1,테이크 3' && cur().star === null, 'names stay, no ★');
    await C.run('undo'); await C.run('undo'); assert(T().length === 2 && cur().star === T()[1].id, 'undo take 3');
  }],
  ['script mode: ↓ stops a recording, a line opens with every take, ★ selected; done; undo to the line', async () => {
    await C.run('record'); await wait(400); await C.run('nextLine');
    const chul = s().lines.find((l) => SCR.lineName(l) === '철수-001');
    assert(!state.recording && SCR.lineName(cur()) === '영희-005' && T().length === 0 && chul.takes.length === 3 &&
      chul.takes[2].clips.length === 1 && chul.star === chul.takes[1].id,
      '↓ while recording stops it: the sound is in 철수-001 테이크 3, ★ stays');
    await C.run('undo');
    assert(SCR.lineName(cur()) === '철수-001' && C.takeCount() === 2, 'undo goes back to 철수-001 and removes it');
    await C.run('nextLine'); assert(SCR.lineName(cur()) === '영희-005' && T().length === 0, 'next line');
    await C.run('prevLine');
    assert(T().length === 2 && T()[1].id === cur().star && state.sel.activeTrackId === cur().star,
        'a line opens with every take, ★ selected');
    await painted();
    assert(document.querySelector('.takes-count').textContent === '테이크 2개' &&
      document.querySelector('.takes-count').tagName === 'SPAN' && !MN.MENUS.view.includes('toggleTakes'),
      'a take count, nothing to fold');
    assert(await doneRow(), 'a line with a ★ take is done');
    const star = () => T().find((t) => t.id === cur().star);
    sel(0, end() / sr + 1, [star()]); await C.run('delete');
    assert(!star().clips.length && !(await doneRow()), 'a ★ take emptied with Delete is not done (export skips it)');
    await C.run('undo'); assert(star().clips.length && (await doneRow()), 'undo the delete');
    await C.run('nextLine'); await C.run('undo'); // undo goes back to the line it changed
    assert(SCR.lineName(cur()) === '철수-001' && T().length === 2 && cur().star === T()[0].id &&
      T()[0].name === '테이크 1' && state.sel.activeTrackId === cur().star, 'undo ★ on its line, ★ selected');
    await C.run('redo'); assert(cur().star === T()[1].id && T()[1].name === '테이크 2', 'redo ★');
  }],
  ['script mode: Ctrl+Z to another line and ↓ right after R stop the recording, the take kept', async () => {
    await C.run('nextLine'); await C.run('record'); await wait(400); await C.run('undo'); // 철수-001's ★ step
    const yh = s().lines.find((l) => SCR.lineName(l) === '영희-005');
    assert(!state.recording && SCR.lineName(cur()) === '철수-001' && yh.takes.length === 1 && yh.takes[0].clips.length,
      'Ctrl+Z to another line stops the recording, its take stays');
    await C.run('undo'); await C.run('prevLine'); C.setStar(T()[1].id); // as before: no take on 영희-005, ★ take 2
    assert(SCR.lineName(cur()) === '철수-001' && cur().star === T()[1].id && !s().lines.find((l) => SCR.lineName(l)
      === '영희-005').takes.length, 'back as it was');
    const takesOf = (n) => s().lines.find((l) => SCR.lineName(l) === n).takes;
    await C.run('record'); await wait(400); // a stop still keeping the take: ↓ waits for it
    await Promise.all([C.run('record'), C.run('nextLine'), C.run('nextLine')]);
    assert(!state.recording && SCR.lineName(cur()) === '철수-002' && takesOf('철수-001').length === 3,
      '↓↓ right after R: two lines on, the take kept');
    await C.run('prevLine');
    await C.run('record'); await wait(400); // ... and Ctrl+Z to another line never stops it twice
    await Promise.all([C.run('record'), C.run('undo')]);
    assert(!state.recording && takesOf('영희-005').length === 1 && takesOf('영희-005')[0].clips.length,
      'Ctrl+Z right after R: the take kept');
    await C.run('undo'); await C.run('undo'); // the 영희-005 take, then the ★ step
    if (SCR.lineName(cur()) !== '철수-001') await C.run('prevLine');
    C.setStar(T()[1].id);
    assert(SCR.lineName(cur()) === '철수-001' && T().length === 2 && cur().star === T()[1].id
      && !takesOf('영희-005').length, 'back as it was, again');
  }],
  ['script mode: character effects, search and tabs, 대사 고치기 -> redo, save and reopen', async () => {
    C.showFx(T()[0].id); assert(state.ui.fxTarget === 'char:철수', 'take effects = character effects');
    C.setFx('char:철수', 'eq', { on: true, low: 5 });
    assert(T().length === 2 && T().every((t) => t.fx.eq.on && t.fx.eq.low === 5), 'character eq on its takes');
    await painted(); assert(document.getElementById('fx-title').textContent === '캐릭터 효과 · 철수', 'fx title');
    const left = (id) => Math.round(document.getElementById(id).getBoundingClientRect().left);
    assert(left('hscroll') === left('timeline-wrap'), 'scrollbar under the timeline: ' + left('hscroll'));
    await shot('script-dark');
    await C.run('toggleTheme'); await shot('script-light'); await C.run('toggleTheme');
    await C.run('toggleFxPanel');
    C.setScriptView({ q: '둘째' }); assert(C.visibleLines().length === 1, 'search');
    C.setScriptView({ q: '', char: '영희' });
    assert(SCR.lineName(cur()) === '영희-005', 'a character tab goes to its lines');
    C.setScriptView({ char: '', todo: true });
    assert(C.visibleLines().map((l) => SCR.lineName(l)).join() === '영희-005,철수-002', 'only unrecorded');
    C.setScriptView({ todo: false });
    await C.goLine(s().lines[0].id);
    stub.modal = { text: '너 뭐냐고!' }; await C.run('editLine'); stub.modal = {};
    assert(cur().text === '너 뭐냐고!' && cur().memo === '화가 나서' && cur().state === 'redo',
      'edit line: recorded -> 다시 녹음 필요');
    const p = path.join(dir, 's.vproj');
    assert(await C.writeProject(p), 'write');
    await C.openProject(p);
    assert(s() && names().join() === '철수-001,영희-005,철수-002' && C.takeCount() === 2 && T().length === 2 &&
      state.sel.activeTrackId === cur().star && T().every((t) => t.fx.eq.low === 5) && cur().state === 'redo',
      'reopen');
  }],
  ['script mode: re-import (new script is the base), per-line export of ★ takes', async () => {
    fs.writeFileSync(txt, '철수: 너 뭐냐고!\n영희-005: 반가워\n영희: 새 대사\n');
    await C.importScript(txt); // 대본 넣기 in a script project: the new script is the base
    assert(names().join() === '철수-001,영희-005,영희-006' && C.takeCount() === 2, 're-import ' + names());
    await C.run('undo'); assert(names().join() === '철수-001,영희-005,철수-002', 'undo re-import'); await C.run('redo');
    const step = history.top();
    await C.importScript(txt); // the same script again
    assert(history.top() === step && toasts[toasts.length - 1] === '대본에서 바뀐 대사가 없어요', 'same script: no step');
    stub.dir = path.join(dir, 'lines'); fs.mkdirSync(stub.dir);
    await C.run('export'); // 전체: a new folder (project, time), a folder per character in it
    const [top] = fs.readdirSync(stub.dir), out = fs.readdirSync(path.join(stub.dir, top, '철수'));
    assert(/ 대사 \d{4}-\d\d-\d\d \d\d-\d\d$/.test(top) && out.join() === '철수-001.wav', 'files ' + top + ' ' + out);
    assert(toasts[toasts.length - 1].includes('다시 녹음 필요 1개도 들어갔어요'), 'a redo line with ★ is exported and told: '
      + toasts[toasts.length - 1]);
    const frames = (fs.statSync(path.join(stub.dir, top, '철수', out[0])).size - 44) / 4;
    assert(Math.abs(frames - 2 * sr) < sr * 0.05, '★ take only: ' + frames / sr + ' s');
    await C.run('export'); // again: a folder of its own, nothing overwritten (same minute: '(2)')
    const now = fs.readdirSync(stub.dir), other = now.find((x) => x !== top);
    assert(now.length === 2 && (other === top + ' (2)' || !other.startsWith(top)), 'folders ' + now);
  }],
  ['script mode: 대사별 내보내기 캐릭터 고르기 (several characters, opens with the current one)', async () => {
    stub.dir = path.join(dir, 'lines2'); fs.mkdirSync(stub.dir);
    const rows = () => [...document.querySelectorAll('#modal-layer .field')];
    const row = (n) => rows().find((r) => r.firstChild.textContent === n);
    const btn = (r, t) => [...row(r).querySelectorAll('button')].find((b) => b.textContent.startsWith(t));
    const on = () => [...row('캐릭터').querySelectorAll('[aria-pressed=true]')].map((b) => b.textContent.split(' ')[0]);
    const ok = () => document.querySelector('#modal-layer .btn.primary').click();
    const was = D.modal; D.modal = realModal;
    try {
      let p = C.run('export'); await painted();
      assert(row('캐릭터').hidden, 'the characters show only for 캐릭터 고르기');
      btn('범위', '캐릭터 고르기').click();
      assert(!row('캐릭터').hidden && on().join() === cur().char, 'opens with the current character: ' + on());
      for (const n of ['철수', '영희']) if (!on().includes(n)) btn('캐릭터', n).click();
      btn('캐릭터', '영희').click(); assert(on().join() === '철수', 'a second click lets go: ' + on());
      btn('캐릭터', '영희').click(); assert(on().length === 2, 'both: ' + on());
      ok(); await p;
      const [top] = fs.readdirSync(stub.dir), got = fs.readdirSync(path.join(stub.dir, top, '철수')).join();
      assert(fs.readdirSync(path.join(stub.dir, top)).join() === '철수' && got === '철수-001.wav'
        && toasts[toasts.length - 1].includes('녹음 안 한 대사 2개는 건너뛰었어요'), 'files + ' + toasts[toasts.length - 1]);
      p = C.run('export'); await painted();
      btn('범위', '캐릭터 고르기').click(); btn('캐릭터', cur().char).click(); ok(); await p;
      assert(toasts[toasts.length - 1] === '내보낼 캐릭터를 하나 이상 고르세요', 'none picked: ' + toasts[toasts.length - 1]);
    } finally { D.modal = was; }
  }],
  ['script mode: 보통 프로젝트로 바꾸기 while recording, undo / redo, back to a normal project', async () => {
    // 보통 프로젝트로 바꾸기, pressed while recording: the recording stops first and its take becomes a track too
    const had = SCR.linesNow(state.project).flatMap((l) =>
      l.takes.filter((t) => t.clips.length).map((t) => SCR.lineName(l) + ' ' + t.name));
    const lineNames = names().join(), chulChar = s().chars['철수'];
    await C.run('record'); await wait(400);
    const recName = SCR.lineName(cur()) + ' ' + T().find((t) => t.id === C.recInfo().trackId).name;
    await C.run('unscript'); await painted();
    assert(!state.recording && !s() && !document.body.classList.contains('script') &&
      note.includes(`테이크 ${had.length + 1}개는 트랙이 되고`), 'plain project: ' + note);
    assert(JSON.stringify(T().map((t) => t.name).filter((n) => n !== recName)) === JSON.stringify(had) &&
      T().some((t) => t.name === recName), 'takes are tracks in script order: ' + T().map((t) => t.name));
    assert(T()[0].color === chulChar.color && T()[0].fx === chulChar.fx && C.cmds.addTrack.enabled(),
      'a take track keeps its character color and effects');
    await C.run('undo'); await painted();
    assert(s() && names().join() === lineNames && document.body.classList.contains('script'),
      'Ctrl+Z: the script is back');
    await C.run('redo'); assert(!s() && T().length === had.length + 1, 'Ctrl+Y: plain again');
    await C.run('undo'); await C.run('undo');
    assert(SCR.linesNow(state.project).flatMap((l) => l.takes).length === had.length, 'and the recorded take');
    D.modal = stubModal;
    await C.openProject(path.join(dir, 'p.vproj')); await painted();
    assert(!state.project.script && !document.body.classList.contains('script') &&
      document.getElementById('script-panel').hidden, 'back to a normal project');
  }],
];
