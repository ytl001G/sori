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
    const n = T().length, clip = T()[0].clips[0];
    assert(clip, 'a clip on track 1 for the fade shape');
    C.setFadeShape(clip.id, 'fadeIn', clip.fadeInShape === 'smooth' ? 'fast' : 'smooth'); // the clip's right-click menu
    state.sel.playhead = Math.round(sr / 2); await C.run('addMarker');
    await C.run('addTrack');
    press('F6'); await painted();
    assert(!$('#fxpanel').hidden && !$('#hist-pane').hidden && $('#fx-pane').hidden, 'F6 opens the history tab');
    assert(rows().length === 1 + history.depth() + history.redoDepth(), 'a row per step + 처음');
    assert(names().slice(-3).join() === '페이드 모양,마커 추가,빈 트랙' && rows().at(-1).classList.contains('cur'),
      'named steps (a menu row outside a command too), the last is current: ' + names().slice(-3).join());
    rows()[start + 2].focus(); rows()[start + 2].click(); // just after 마커 추가, as Enter on a focused row
    await until(() => history.depth() === start + 2, 'the row went back');
    await painted();
    assert(T().length === n && rows()[start + 2].classList.contains('cur')
      && rows().at(-1).classList.contains('undone'), 'the track is gone, its step dimmed');
    assert(document.activeElement === rows()[start + 2], 'keyboard focus stays on the current row: '
      + document.activeElement.className);
    assert(/되돌린 단계/.test(rows().at(-1).getAttribute('aria-description')), 'a screen reader hears "dimmed"');
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
    r = ok(await cli('live', 'history', '--to', String(start + 2)), 'live history --to');
    assert(r.reached && history.depth() === start + 2 && r.steps.at(-1).undone, '--to went back ' + JSON.stringify(r));
    r = await cli('live', 'history', '--to', '999');
    assert(r.error === 'BAD_ARG' && history.depth() === start + 2, 'out of range: ' + JSON.stringify(r));
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
    $('.lines-open').focus(); $('.lines-open').click(); await painted();
    assert($('#script-panel').offsetWidth > 0 && !$('.lines-open').offsetWidth && S.get().lines, '펴기 button');
    assert(document.activeElement === $('.sp-fold'), 'focus moves to 접기, not lost: ' + document.activeElement.tagName);
    $('.sp-fold').click(); await painted();
    assert(!$('#script-panel').offsetWidth && document.activeElement === $('.lines-open'), '접기 button, focus on 펴기');
    press('F7'); await painted();
    assert(history.steps().done.at(-1).label === '대본 넣기', 'the import is one named step');
    await C.run('historyTo', start); // back to the project these steps started on
    assert(!state.project.script && history.depth() === start, 'back to the normal project');
  }],
  ['대사 목록 접기: lines moved while folded are in sight when it opens; 실행취소 기록 stops at a step a recording keeps',
    async () => {
      const long = Array.from({ length: 80 }, (_, i) => '철수: 대사 ' + i).join('\n');
      fs.writeFileSync(path.join(dir, 'long.txt'), long);
      await C.importScript(path.join(dir, 'long.txt')); await painted();
      press('F7'); await painted();
      for (let i = 0; i < 60; i++) await C.run('nextLine');
      press('F7'); await painted();
      const cur = $('#sp-list .line-row.cur').getBoundingClientRect(), box = $('#sp-list').getBoundingClientRect();
      assert(cur.top >= box.top && cur.bottom <= box.bottom, `the current line in sight: ${cur.top} in ${box.top}-`
        + box.bottom);
      await C.run('record'); await until(() => state.recording, 'recording');
      const went = await C.historyTo(start); // its first step undoes 대본 넣기: the recording keeps it
      assert(went === false && state.recording && state.project.script, 'stopped at the kept step, still recording');
      await C.run('record'); await until(() => !state.recording, 'stopped');
      await C.run('historyTo', start);
      assert(!state.project.script && history.depth() === start, 'back to the normal project');
    }],
  ['키 이름이 든 문장: the keys commands have now (설정 > 단축키), no key = the name; takes are 테이크', async () => {
    S.set({ keys: { undo: ['Ctrl+Shift+KeyU'], redo: [], record: ['F2'] } }); await painted();
    const sub = $('#empty .empty-sub').textContent;
    assert(sub === '또는 Ctrl+O 열기 · F2 바로 녹음', 'the empty timeline: ' + sub);
    press('F6'); await painted();
    assert(/누르거나 다시실행으로 돌아올/.test($('#hist-note').textContent), 'no redo key: ' + $('#hist-note').textContent);
    press('F6');
    await C.run('addTrack'); C.removeTrack(T().at(-1).id);
    assert(/· 실행취소\(Ctrl\+Shift\+U\)로 되돌리기$/.test($('#toast').textContent), 'toast: ' + $('#toast').textContent);
    assert(history.steps().done.at(-1).label === '트랙 삭제', 'a track in a normal project');
    await C.importScript(path.join(dir, 'fold.txt')); await painted();
    const hint = $('#script-bar .sb-hint').textContent;
    assert(hint === 'F2 새 테이크 · Shift+R 이어 녹음 · ↑/↓ 대사 이동', 'the line bar: ' + hint);
    assert($('#empty .empty-title').textContent === 'F2 키를 눌러 이 대사를 녹음하세요', 'the empty take lane');
    await C.run('addTrack'); await painted();
    const x = $('#headers-inner .track-h .x');
    assert(x.title === '테이크 삭제' && x.getAttribute('aria-label') === '테이크 삭제', '✕ on a take: ' + x.title);
    x.click();
    assert(history.steps().done.at(-1).label === '테이크 삭제', 'its undo step: ' + history.steps().done.at(-1).label);
    S.set({ keys: {} }); await painted();
    assert(/^R 새 테이크/.test($('#script-bar .sb-hint').textContent), 'back to the default keys');
    await C.run('historyTo', start);
    await painted();
    assert($('#empty .empty-sub').textContent === '또는 Ctrl+O 열기 · R 바로 녹음', 'normal project again');
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
