// Smoke steps: Ctrl+F 찾기 — the box on a normal project (tracks, 고급 clips / markers) and on a script project (the
// listed lines only), and sori live find.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const SCR = require('../../src/core/script');
const { state, history, makeTrack, changed } = require('../../src/core/state');
const { dir, assert, sr, T, wait, painted, cli, ok } = require('./kit');

const $ = (q) => document.querySelector(q);
const box = () => $('#find'), input = () => $('#find input[type=text]'), count = () => $('#find .find-count');
const key = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
const ctrlF = () => key(document.activeElement || document.body, { code: 'KeyF', key: 'f', ctrlKey: true });
const settle = async () => { await wait(30); await painted(); };
async function type(text) {
  input().value = text; input().dispatchEvent(new Event('input')); await settle();
}
async function enter(shiftKey = false) { key(input(), { key: 'Enter', code: 'Enter', shiftKey }); await settle(); }
const tick = (k) => {
  const c = $(`#find input[data-k=${k}]`);
  c.checked = true; c.dispatchEvent(new Event('change'));
};
const active = () => T().find((t) => t.id === state.sel.activeTrackId).name;

module.exports = [
  ['Ctrl+F: track names from the current track on, Enter / Shift+Enter walk and wrap, 고급 clips and markers, Esc',
    async () => {
      history.commit();
      const clip = (name, at) => E.makeClip(E.makeSource([new Float32Array(sr)]), at * sr, name);
      state.project.tracks = [makeTrack({ name: '보컬1' }), makeTrack({ name: '배경음악' }), makeTrack({ name: '보컬 2' })]
        .map((t, i) => ({ ...t, clips: i === 1 ? [clip('후렴', 3)] : [] }));
      state.project.markers = [{ id: 'mk-find', name: '후렴 시작', frame: 5 * sr }];
      state.sel.activeTrackId = T()[1].id; changed();
      ctrlF(); await settle();
      assert(!box().hidden && document.activeElement === input(), 'Ctrl+F opens the box with the caret in it');
      await type('보컬');
      assert(active() === '보컬 2' && count().textContent === '2/2', `from the current track on: ${active()} `
        + count().textContent);
      await enter(); assert(active() === '보컬1' && count().textContent === '1/2', 'Enter wraps to the first');
      await enter(true); assert(active() === '보컬 2', 'Shift+Enter goes back');
      state.project.tracks = T().map((t) => (t.name === '배경음악' ? { ...t, name: '보컬 배경' } : t)); changed();
      await settle();
      assert(count().textContent === '3/3' && active() === '보컬 2', 'a rename counts again, nothing moves '
        + count().textContent);
      await type('후렴'); assert(count().textContent === '0개' && count().classList.contains('none'), 'no track 후렴');
      $('#find .find-more').click(); tick('clips'); tick('markers'); await settle();
      const onClip = state.sel.clipIds.has(T()[1].clips[0].id) && state.sel.playhead === 3 * sr;
      assert(onClip && count().textContent === '1/2', '고급: the clip, the play position on it ' + count().textContent);
      await enter(); assert(state.sel.markerId === 'mk-find' && state.sel.playhead === 5 * sr, 'then the marker');
      ctrlF(); await settle();
      assert(input().value === '후렴' && input().selectionEnd === 2, 'Ctrl+F again in the box selects its text');
      key(input(), { key: 'Escape', code: 'Escape' }); await settle();
      assert(box().hidden && T().length === 3, 'Esc closes it; the box took the keys (no shortcut ran)');
      ctrlF(); await settle();
      assert(input().value === '' && $('.find-adv').hidden && !$('#find input[data-k=clips]').checked,
        'it opens fresh: empty, 고급 folded and off');
      key(input(), { key: 'Escape', code: 'Escape' });
      await C.run('undo');
    }],
  ['Ctrl+F on a script project: the listed lines only (number, text; memo with 고급); live find', async () => {
    const txt = path.join(dir, '찾기대본.txt');
    fs.writeFileSync(txt, '철수: 오늘은 날씨가 맑아요\n영희: 산책하기 좋겠네요\n철수: 같이 갈래요?\n');
    await C.importScript(txt);
    const name = () => SCR.lineName(C.curLine());
    C.setScriptView({ char: '철수' });
    ctrlF(); await settle(); await type('산책');
    assert(count().textContent === '0개' && name() === '철수-001', '철수 tab: 영희-001 is not listed, not found');
    C.setScriptView({ char: '' }); await settle();
    assert(count().textContent === '1개' && name() === '철수-001', 'tab 전체: counted again, nothing moves');
    C.setScriptView({ char: '철수' });
    await type('철수 2'); assert(name() === '철수-002' && count().textContent === '1/1', 'a line number, loosely');
    C.setScriptView({ char: '' });
    await type('산책'); assert(name() === '영희-001', 'all tabs: found');
    key(input(), { key: 'Escape', code: 'Escape' });
  }],
  ['sori live find: goes like Ctrl+F and says where; text is required', async () => {
    const r = ok(await cli('live', 'find', '갈래', '--next'), 'live find');
    assert(r.count === 1 && r.at === 1 && r.hit.kind === 'line' && r.line === '철수-002', 'live find '
      + JSON.stringify(r));
    assert((await cli('live', 'find', ' ')).error === 'BAD_ARG', 'live find needs text');
  }, 'dev'],
  ['Ctrl+F while recording: typing and live find only count; the recording goes on', async () => {
    const name = () => SCR.lineName(C.curLine());
    await C.goLine(SCR.linesNow(state.project).find((l) => SCR.lineName(l) === '철수-002').id);
    await C.run('record'); await wait(300);
    ctrlF(); await settle(); await type('산책');
    assert(state.recording && name() === '철수-002' && count().textContent === '1개', 'typing: count only');
    key(input(), { key: 'Escape', code: 'Escape' });
    if (!require('./kit').packaged) {
      const r = ok(await cli('live', 'find', '산책'), 'live find while recording');
      assert(state.recording && r.line === '철수-002' && r.count === 1 && r.at === null, 'live find: count only '
        + JSON.stringify(r));
    }
    await C.run('record'); assert(!state.recording, 'stopped');
  }],
  ['Ctrl+F steps end: undo back to before the 대본 넣기', async () => {
    for (let i = 0; i < 4 && state.project.script; i++) await C.run('undo');
    assert(!state.project.script, 'undo the 대본 넣기');
  }],
];
