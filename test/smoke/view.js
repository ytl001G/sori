// Smoke steps: Theme toggle, a small window with a tall mixer, the top menus, 이름순 정렬.
const C = require('../../src/ui/commands');
const S = require('../../src/core/settings');
const menus = require('../../src/ui/menus');
const { state, makeTrack, changed } = require('../../src/core/state');
const { wait, painted, invokeOrig, assert, T } = require('./kit');

// the rows of a top menu as text ('—' = separator)
async function rowsOf(menu) {
  document.querySelector(`#menubar button[data-menu="${menu}"]`).dispatchEvent(new MouseEvent('mousedown',
    { bubbles: true }));
  await painted();
  const rows = [...document.querySelectorAll('.menu > *')].map((x) => (x.classList.contains('sep') ? '—'
    : x.children[1] ? x.children[1].textContent : x.textContent));
  menus.close();
  return rows;
}

module.exports = [
  ['theme toggle + redraw', async () => {
    await C.run('toggleTheme'); await wait(50); await C.run('toggleTheme'); await wait(50);
  }],
  ['a tall saved mixer leaves room for the timeline in a small window', async () => {
    S.set({ mixerH: 600 }); await C.run('toggleMixer'); await invokeOrig('resize', 900, 560); await wait(300);
    const h = document.getElementById('timeline').parentElement.clientHeight;
    await invokeOrig('resize', 1400, 860); await C.run('toggleMixer'); S.set({ mixerH: 220 }); await wait(200);
    assert(h > 80, 'timeline height ' + h);
  }],
  ['top menus: 편집 · 트랙 · 마커 split, 대사 rows only in a script, no stray separators', async () => {
    const tops = [...document.querySelectorAll('#menubar button')].map((b) => b.textContent);
    assert(tops.join() === '파일,편집,트랙,마커,보기,효과', 'menubar ' + tops);
    const edit = await rowsOf('edit'), track = await rowsOf('track');
    assert(edit.length === 17 && edit.at(-1) === '선택 해제' && !edit.includes('대사 고치기…'), 'edit ' + edit);
    assert(track.at(-1) === '이름순 정렬' && track.length === 11, 'track ' + track);
    assert((await rowsOf('marker')).join() === '마커 추가,이전 마커로,다음 마커로', 'marker');
  }],
  ['이름순 정렬: numbers by size, one undo step', async () => {
    const kept = T(), mk = (name) => makeTrack({ name });
    state.project.tracks = ['보컬10', '보컬2', '보컬1'].map(mk); changed();
    await C.run('sortTracks');
    const order = T().map((t) => t.name).join();
    await C.run('undo');
    const back = T().map((t) => t.name).join();
    state.project.tracks = kept; changed();
    assert(order === '보컬1,보컬2,보컬10' && back === '보컬10,보컬2,보컬1', order + ' / ' + back);
  }],
];
