// Smoke steps: 이어 녹음 (Shift+R, N, Shift+N) and the 긴 녹음 나누기 window, on a fresh script project.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const LR = require('../../src/ui/commands/longrec');
const SW = require('../../src/ui/split');
const SCR = require('../../src/core/script');
const { state } = require('../../src/core/state');
const { dir, wait, painted, assert, sr, invokeOrig, shots, rowsOf } = require('./kit');

const shot = async (n) => {
  if (shots) { await painted(); await wait(150); await invokeOrig('capture', path.join(shots, n + '.png')); }
};

const s = () => state.project.script, $ = (q) => document.querySelector(q);
const win = () => $('#modal-layer.open .sheet-body.spl');
const btn = (text) => [...document.querySelectorAll('#modal-layer button')].find((b) => b.textContent.startsWith(text));
const until = async (f, what) => { for (let i = 0; i < 100 && !f(); i++) await wait(30); assert(f(), what); };
const press = (code, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, ...more }));
// speech (a tone) 1 s, quiet 2 s, speech 1 s, quiet 2 s, speech 1 s
const long = () => {
  const n = 7 * sr, x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, on = t < 1 || (t >= 3 && t < 4) || (t >= 6);
    x[i] = on ? 0.3 * Math.sin(2 * Math.PI * 300 * t) : 0.0005 * Math.sin(i);
  }
  return [x];
};
const takes = () => SCR.linesNow(state.project).map((l) => l.takes.filter((t) => t.clips.length).length);

let review = null; // the open 나누기 window's promise, across the steps below

module.exports = [
  ['이어 녹음: Shift+R, N cues the next line, Shift+N takes it back; stopping opens the window, 닫기 asks', async () => {
    const txt = path.join(dir, '긴대본.txt');
    fs.writeFileSync(txt, '철수: 하나\n철수: 둘\n철수: 셋\n');
    await C.importScript(txt);
    assert(s() && s().lines.length === 3, 'script');
    const rows = (await rowsOf('record')).join();
    assert(rows === '녹음,이어 녹음,—,긴 녹음 나누기…,—,메트로놈', 'record menu in a script ' + rows);
    await C.run('contRecord');
    assert(state.recording && C.recInfo().cont && !C.recInfo().trackId, '이어 녹음 runs without a take');
    assert(state.holding, 'closing the app asks while the sound lives only in memory');
    await wait(300); await C.run('cueNext'); await painted();
    assert($('#empty').hidden, 'the timeline shows the 이어 녹음 lane, not the empty text');
    assert($('#script-bar .sb-text').textContent === '둘' && !$('.sb-live').hidden, 'prompter cues 둘');
    assert($('#sp-list .line-row.cue') && C.recInfo().cont.marks.length === 1, 'list cue + one mark');
    assert(!$('#sp-list .line-row.cur') && $('.cont-rec').textContent === '이어 녹음 멈춤', 'only the cue stands out');
    await shot('cont-record');
    await C.run('cueBack'); await painted();
    assert($('#script-bar .sb-text').textContent === '하나' && !C.recInfo().cont.marks.length, 'Shift+N back');
    await C.run('cueNext'); await wait(200);
    assert(!(await C.confirmDiscard()), 'nothing else runs over a 이어 녹음 (it would lose the sound)');
    await C.run('contRecord'); await C.run('contRecord'); // a quick second Shift+R must not start another
    assert(!state.recording, 'no new recording before the window');
    await until(win, 'the 나누기 window opens');
    assert(state.holding && document.activeElement === $('.spl-list'), 'still held; the keys start in the list');
    press('Escape'); await painted();
    assert(win() && btn('버리고 닫기'), 'closing asks first (the sound lives only there)');
    btn('돌아가기').click(); await painted();
    assert(win() && btn('적용'), 'back to the window');
    btn('취소').click(); await painted(); btn('버리고 닫기').click(); await painted();
    assert(!win() && takes().join() === '0,0,0' && !state.holding, 'closed, nothing added, no longer held');
  }],
  ['긴 녹음 나누기: pieces grouped by line; greyed tools, arrow keys and Ctrl+Z inside the window', async () => {
    review = LR.review(long(), { order: s().lines.map((l) => l.id), marks: [] }, 0, false);
    await until(win, 'window');
    await painted(); await painted();
    assert(document.querySelectorAll('.spl-row').length === 3 && document.querySelectorAll('.spl-line').length === 1,
      'three pieces, all on the first line (no boundary yet)');
    assert(btn('합치기').disabled && btn('나누기').disabled && btn('대사 경계 지우기').disabled, 'tools greyed out');
    press('ArrowDown', { shiftKey: true }); await painted();
    assert(!btn('합치기').disabled, 'two chosen: 합치기 on');
    press('KeyJ', { ctrlKey: true }); await painted();
    assert(document.querySelectorAll('.spl-row').length === 2, 'Ctrl+J merged');
    press('KeyZ', { ctrlKey: true }); await painted();
    assert(document.querySelectorAll('.spl-row').length === 3, 'Ctrl+Z in the window');
    press('KeyY', { ctrlKey: true }); press('KeyZ', { ctrlKey: true }); await painted();
    assert(document.querySelectorAll('.spl-row').length === 3, 'Ctrl+Y, Ctrl+Z');
    press('ArrowRight'); await painted();
    assert(!btn('나누기').disabled, '→ puts the 나누기 point in the piece');
    const a0 = SW.shown().st.ps[0].a;
    press('ArrowRight', { altKey: true }); press('KeyZ', { ctrlKey: true }); await painted();
    assert(SW.shown().st.ps[0].a === a0, 'Alt+→ moved the start, Ctrl+Z put it back');
    const w = SW.shown(), n = w.undo.length;
    for (let i = 0; i < 3; i++) press('ArrowRight', { altKey: true }); // the first piece starts at 0: move it first
    for (let i = 0; i < 80; i++) press('ArrowLeft', { altKey: true }); // back to the recording's start, and past it
    const k = w.undo.length;
    assert(k - n === 6, 'six real moves, ' + (k - n));
    press('ArrowLeft', { altKey: true });
    assert(w.st.ps[0].a === 0 && w.undo.length === k, `at the start: no empty undo step (${w.st.ps[0].a}, ${k})`);
    for (let i = n; i < k; i++) press('KeyZ', { ctrlKey: true });
    await painted();
    assert(w.st.ps[0].a === a0, 'undone back');
  }],
  ['긴 녹음 나누기: N adds a boundary, 적용 = takes with ★, one undo step', async () => {
    press('ArrowDown'); press('KeyN'); press('ArrowDown'); press('KeyN'); await painted();
    assert(document.querySelectorAll('.spl-line').length === 3, 'N: a line per piece');
    btn('대사 경계 지우기').click(); await painted();
    assert(document.querySelectorAll('.spl-line').length === 2, 'boundary gone');
    btn('쉬는 곳마다').click(); await painted();
    await shot('split-window');
    if (shots) { // the window redraws on the next key
      await C.run('toggleTheme'); press('ArrowUp'); press('ArrowDown'); await shot('split-window-light');
      await C.run('toggleTheme');
      await invokeOrig('resize', 900, 560); await wait(300); press('ArrowUp'); press('ArrowDown');
      await shot('split-window-small'); await invokeOrig('resize', 1400, 860); await wait(300);
    }
    const w = SW.shown();
    press('Space'); await painted();
    assert(w.playing && btn('멈추기'), 'listening: 멈추기');
    btn('적용').click(); await review;
    assert(!w.playing, 'closing while listening ends the playhead loop');
    assert(takes().join() === '1,1,1' && s().lines.every((l) => SCR.linesNow(state.project)
      .find((x) => x.id === l.id).star), 'a take with ★ on each line: ' + takes());
    await C.run('undo');
    assert(takes().join() === '0,0,0', 'Ctrl+Z: one step');
    await C.run('redo');
    assert(takes().join() === '1,1,1', 'Ctrl+Y');
    await C.openProject(path.join(dir, 'p.vproj')); await painted(); // the next groups start on the plain project
    assert(!s() && !document.body.classList.contains('script'), 'back to a normal project');
  }],
];
