// Smoke steps: the line list keeps the line in sight across tabs, theme toggle, a small window with a tall mixer,
// dragging the mixer edge, fonts, the top menus, 이름순 정렬.
const C = require('../../src/ui/commands');
const S = require('../../src/core/settings');
const { state, makeTrack, changed } = require('../../src/core/state');
const { wait, painted, invokeOrig, assert, T, rowsOf, dir } = require('./kit');

module.exports = [
  ['line list: from a character tab to 전체, the line being looked at stays in sight', async () => {
    const txt = require('path').join(dir, '긴대본.txt');
    require('fs').writeFileSync(txt, Array.from({ length: 60 }, (_, i) => `${i % 2 ? '영희' : '철수'}: 대사 ${i}
`).join(''));
    await C.importScript(txt);
    C.setScriptView({ char: '영희' }); await painted();
    const SCR = require('../../src/core/script'), deep = C.visibleLines()[25];
    await C.goLine(deep.id); await painted();
    C.setScriptView({ char: '' }); await painted();
    const list = document.getElementById('sp-list').getBoundingClientRect();
    const row = document.querySelector('#sp-list .line-row.cur').getBoundingClientRect();
    assert(row.top >= list.top && row.bottom <= list.bottom, `${SCR.lineName(deep)} out of sight: ${row.top} `
      + `(list ${list.top}..${list.bottom})`);
    await C.run('undo'); assert(!state.project.script, 'undo the 대본 넣기');
  }],
  ['times round before the minutes split off (1:00, never 0:60)', async () => {
    const sr = state.project.sampleRate, f = Math.round(59.9996 * sr), ph = state.sel.playhead;
    state.sel.playhead = f; changed(); await painted();
    const top = document.getElementById('time').textContent;
    state.sel.playhead = ph; changed();
    const ruler = require('../../src/ui/timeline/paint').fmtTime(60 - 1e-12, 0.001);
    const split = require('../../src/ui/split/edit').t1(Math.round(59.96 * sr), sr);
    assert(top === '01:00.000' && ruler === '1:00.000' && split === '1:00.0', `${top} | ${ruler} | ${split}`);
  }],
  ['theme toggle + redraw', async () => {
    await C.run('toggleTheme'); await wait(50); await C.run('toggleTheme'); await wait(50);
  }],
  ['a tall saved mixer leaves room for the timeline in a small window', async () => {
    S.set({ mixerH: 600 }); await C.run('toggleMixer'); await invokeOrig('resize', 900, 560); await wait(300);
    const h = document.getElementById('timeline').parentElement.clientHeight;
    await invokeOrig('resize', 1400, 860); await C.run('toggleMixer'); S.set({ mixerH: 220 }); await wait(200);
    assert(h > 80, 'timeline height ' + h);
  }],
  ['dragging the mixer edge resizes it while the mouse moves, saved on release', async () => {
    await C.run('toggleMixer'); await painted();
    const root = document.getElementById('mixer'), grip = document.getElementById('mixer-resize');
    const h0 = root.offsetHeight, y = grip.getBoundingClientRect().top + 3;
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: y }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: y - 60 }));
    await painted(); await painted(); // the redraw loop ran meanwhile
    const during = root.offsetHeight;
    window.dispatchEvent(new MouseEvent('mouseup', { clientY: y - 60 }));
    const saved = S.get().mixerH;
    S.set({ mixerH: 220 }); await C.run('toggleMixer');
    assert(during === h0 + 60 && saved === h0 + 60, `mixer drag: ${h0} -> ${during} while dragging, saved ${saved}`);
  }],
  ['track names, M/S letters and key caps get their set weight and size (a font shorthand with inherit is dropped)',
    async () => {
      const kept = T();
      state.project.tracks = [makeTrack({ name: '보컬1' })]; changed(); await painted();
      const font = (sel) => {
        const s = getComputedStyle(document.querySelector(sel));
        return s.fontWeight + ' ' + s.fontSize;
      };
      const got = [font('.track-h .name'), font('.track-h .tbtn.m'), font('#empty kbd')].join(', ');
      state.project.tracks = kept; changed();
      assert(got === '600 13px, 700 12px, 500 12px', 'fonts ' + got);
    }],
  ['top menus: 편집 · 녹음 · 트랙 · 마커 split, 대사 rows only in a script, no stray separators', async () => {
    const tops = [...document.querySelectorAll('#menubar button')].map((b) => b.textContent);
    assert(tops.join() === '파일,편집,녹음,트랙,마커,보기,효과', 'menubar ' + tops);
    assert((await rowsOf('record')).join() === '녹음,—,메트로놈', 'record (no script) ' + await rowsOf('record'));
    const edit = await rowsOf('edit'), track = await rowsOf('track');
    assert(edit.length === 19 && edit.at(-1) === '찾기' && !edit.includes('대사 고치기…'), 'edit ' + edit);
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
