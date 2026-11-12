// Smoke steps: 실행취소 기록 (the right panel's second tab, F6) and folding the line list (F7).
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const S = require('../../src/core/settings');
const { state, history } = require('../../src/core/state');
const { dir, assert, sr, T, painted, until, cli, ok, wait, invokeOrig, shots } = require('./kit');

const $ = (q) => document.querySelector(q);
const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
const rows = () => [...document.querySelectorAll('#hist-list .hist-row')];
const names = () => rows().map((r) => r.querySelector('.hl-name').textContent);
let start = 0; // the undo depth before these steps; the last one goes back there

module.exports = [
  ['실행취소 기록: F6 shows every step by name, a row goes back, Ctrl+Y returns, the tabs', async () => {
    start = history.depth();
    const n = T().length;
    state.sel.playhead = Math.round(sr / 2); await C.run('addMarker');
    await C.run('addTrack');
    press('F6'); await painted();
    assert(!$('#fxpanel').hidden && !$('#hist-pane').hidden && $('#fx-pane').hidden, 'F6 opens the history tab');
    assert(rows().length === 1 + history.depth() + history.redoDepth(), 'a row per step + 처음');
    assert(names().slice(-2).join() === '마커 추가,빈 트랙' && rows().at(-1).classList.contains('cur'),
      'named steps, the last is current: ' + names().slice(-3).join());
    rows()[start + 1].click(); // just after 마커 추가
    await until(() => history.depth() === start + 1, 'the row went back');
    await painted();
    assert(T().length === n && rows()[start + 1].classList.contains('cur')
      && rows().at(-1).classList.contains('undone'), 'the track is gone, its step dimmed');
    await C.run('redo'); await painted();
    assert(T().length === n + 1 && !rows().some((r) => r.classList.contains('undone')), 'Ctrl+Y brings it back');
    $('#tab-history').focus();
    const at = state.sel.playhead = sr;
    const left = { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true };
    $('#tab-history').dispatchEvent(new KeyboardEvent('keydown', left));
    await painted();
    assert(state.ui.fxTab === 'fx' && !$('#fx-pane').hidden && document.activeElement === $('#tab-fx'),
      'arrow keys move between the tabs');
    assert(state.sel.playhead === at, 'and not the play position too: ' + state.sel.playhead);
    press('F6'); await painted();
    assert(state.ui.fxTab === 'history' && !$('#fxpanel').hidden, 'F6 on the effect tab shows the history tab');
    press('F6'); await painted();
    assert($('#fxpanel').hidden && !S.get().fxPanel, 'F6 on its own tab closes the panel');
  }],
  ['CLI live history: the list, --to goes back, out of range refused', async () => {
    let r = ok(await cli('live', 'history'), 'live history');
    assert(r.at === history.depth() && r.steps.at(-1).label === '빈 트랙' && !r.steps.at(-1).undone, 'the list');
    r = ok(await cli('live', 'history', '--to', String(start + 1)), 'live history --to');
    assert(r.reached && history.depth() === start + 1 && r.steps.at(-1).undone, '--to went back ' + JSON.stringify(r));
    r = await cli('live', 'history', '--to', '999');
    assert(r.error === 'BAD_ARG' && history.depth() === start + 1, 'out of range: ' + JSON.stringify(r));
    await C.run('redo');
  }, 'dev'],
  ['대사 목록 접기: F7 and the two buttons, the timeline gets the room, remembered; off in normal projects', async () => {
    assert(!C.cmds.toggleLines.enabled(), 'F7 does nothing in a normal project');
    fs.writeFileSync(path.join(dir, 'fold.txt'), '철수: 하나\n영희: 둘\n');
    await C.importScript(path.join(dir, 'fold.txt'));
    await painted();
    const w = () => $('#timeline-wrap').getBoundingClientRect().width, open = w();
    assert(state.project.script && $('#script-panel').offsetWidth > 0, 'a script project with its line list');
    press('F7'); await painted();
    assert(!$('#script-panel').offsetWidth && Math.abs(w() - open - 288) < 2 && S.get().lines === false,
      `folded: the timeline is 288px wider (${open} -> ${w()}), remembered`);
    assert($('#script-bar').offsetWidth > 0 && $('.lines-open').offsetWidth > 0, 'the line bar stays, 펴기 shows');
    $('.lines-open').click(); await painted();
    assert($('#script-panel').offsetWidth > 0 && !$('.lines-open').offsetWidth && S.get().lines, '펴기 button');
    $('.sp-fold').click(); await painted();
    assert(!$('#script-panel').offsetWidth, '접기 button');
    press('F7'); await painted();
    assert(history.steps().done.at(-1).label === '대본 넣기', 'the import is one named step');
    await C.run('historyTo', start); // back to the project these steps started on
    assert(!state.project.script && history.depth() === start, 'back to the normal project');
  }],
  ['screenshots: the history tab, the folded line list', async () => {
    const shot = async (n) => { await wait(150); await invokeOrig('capture', path.join(shots, n + '.png')); };
    await C.run('addMarker'); await C.run('addTrack'); await C.run('undo');
    press('F6'); await shot('history-tab');
    press('F6');
    await C.importScript(path.join(dir, 'fold.txt'));
    press('F7'); await shot('lines-folded');
    press('F7'); await C.run('historyTo', start);
  }, 'shots'],
];
