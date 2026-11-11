// Screenshots for docs/ui-guide.md (only with SORI_SHOTS): the app's layout with each area outlined and labeled
// with its size as measured in this run, so the picture follows the app. Copy layout*.png to docs/images/.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const E = require('../../src/core/edit');
const V = require('../../src/ui/timeline/view');
const { state, history, makeTrack, changed } = require('../../src/core/state');
const { dir, wait, painted, invokeOrig, sr, T, shots } = require('./kit');

const $ = (q) => document.querySelector(q);
// a voice-like and a music-like sound, made up
const sound = (sec, f, beat) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => {
  const s = i / sr;
  const env = beat ? 0.3 + 0.5 * Math.exp(-((s * 4) % 1) * 4) : Math.max(0, Math.sin(Math.PI * s * 2.5)) ** 2;
  return env * (0.5 * Math.sin(2 * Math.PI * f * s) + 0.2 * Math.sin(2 * Math.PI * f * 2.01 * s));
});
const clip = (sec, f, beat, at, name) => {
  const x = sound(sec, f, beat);
  return E.makeClip(E.makeSource([x, x]), at, name);
};

// boxes over the real app: [label, rect, where the label sits: 'tl' | 'tr' | 'bl' | 'br']
function overlay(items) {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  for (const [label, r, at = 'tl'] of items) {
    const b = document.createElement('div'), l = document.createElement('span');
    b.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`
      + 'border:2px solid #ffc400;box-sizing:border-box';
    l.textContent = label;
    l.style.cssText = `position:absolute;${at[0] === 't' ? 'top' : 'bottom'}:2px;`
      + `${at[1] === 'l' ? 'left' : 'right'}:2px;`
      + 'background:#ffc400;color:#111;font:600 12px "Pretendard Variable",sans-serif;padding:1px 6px;'
      + 'border-radius:3px;white-space:nowrap';
    b.append(l); layer.append(b);
  }
  document.body.append(layer);
  return layer;
}
const box = (q) => $(q).getBoundingClientRect();
const px = (n) => `${Math.round(n)}px`;
// the timeline canvas: the ruler on top, then one lane per track
function timelineBoxes() {
  const w = box('#timeline-wrap'), lane = state.view.laneH;
  return [
    [`눈금자 · 높이 ${px(V.RULER)}`, { left: w.left, top: w.top, width: w.width, height: V.RULER }, 'tr'],
    [`레인 · 높이 ${px(lane)} (설정)`, { left: w.left, top: w.top + V.RULER, width: w.width, height: lane }, 'br'],
  ];
}
// measure once the app has drawn the last change (a panel opened shows on the next frame); no toast in the picture
async function shoot(name, items) {
  await painted(); await wait(200);
  const toast = $('#toast'), layer = overlay(items());
  toast.style.visibility = 'hidden';
  await painted(); await wait(100);
  await invokeOrig('capture', path.join(shots, name + '.png'));
  layer.remove(); toast.style.visibility = '';
}

module.exports = [
  ['layout picture: the editor with mixer and effect panel, areas measured', async () => {
    if (document.documentElement.dataset.theme !== 'dark') await C.run('toggleTheme');
    await invokeOrig('resize', 1400, 860); await wait(300);
    history.commit();
    state.project.tracks = [makeTrack({ name: '보컬1' }), makeTrack({ name: '배경음악' })];
    state.project.tracks = [{ ...T()[0], clips: [clip(1.6, 180, false, Math.round(sr * 0.3), '보컬1')] },
      { ...T()[1], clips: [clip(2.4, 110, true, 0, '배경음악')] }];
    Object.assign(state.view, { pxPerSec: 300, scrollX: 0, scrollY: 0 });
    state.sel.range = null; state.sel.playhead = Math.round(sr * 0.9); changed();
    await C.run('addMarker');
    if ($('#mixer').hidden) await C.run('toggleMixer');
    if ($('#fxpanel').hidden) await C.run('toggleFxPanel');
    C.showFx('master');
    await shoot('layout', () => {
      const tb = box('#topbar'), hc = box('#headers-col'), fx = box('#fxpanel'), hs = box('#hscroll');
      const mx = box('#mixer'), st = box('#status');
      return [
        [`위 바 · 높이 ${px(tb.height)}`, tb, 'br'],
        [`트랙 머리 · 너비 ${px(hc.width)}`, hc, 'bl'], ...timelineBoxes(),
        [`효과 패널 (F8) · 너비 ${px(fx.width)}`, fx, 'bl'],
        [`가로 스크롤 · 높이 ${px(hs.height)}`, hs, 'tl'],
        [`믹서 (F9) · 높이 ${px(mx.height)} (끌어서 바꿈)`, mx, 'tr'],
        [`상태 줄 · 높이 ${px(st.height)}`, st, 'tl'],
      ];
    });
    await C.run('toggleMixer'); await C.run('toggleFxPanel');
  }, 'shots'],
  ['layout picture: a script project, areas measured', async () => {
    const txt = path.join(dir, '배치대본.txt');
    fs.writeFileSync(txt, '철수: 오늘은 날씨가 맑아요\n영희: 산책하기 좋겠네요\n철수: 같이 갈래요?\n');
    await C.importScript(txt);
    await C.run('addTrack'); await C.run('addTrack');
    state.project.tracks = T().map((t, i) => ({ ...t, clips: [clip(1.4 + i * 0.3, 170 + i * 20, false, 0, t.name)] }));
    state.sel.activeTrackId = T()[0].id; changed();
    await shoot('layout-script', () => {
      const sp = box('#script-panel'), sb = box('#script-bar'), hc = box('#headers-col');
      return [
        [`대사 목록 · 너비 ${px(sp.width)}`, sp, 'bl'],
        [`대사 띠 · 높이 ${px(sb.height)}`, sb, 'br'],
        [`테이크 머리 · 너비 ${px(hc.width)}`, hc, 'bl'], ...timelineBoxes(),
      ];
    });
  }, 'shots'],
];
