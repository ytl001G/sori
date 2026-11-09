// What is under the mouse (hit testing), the hover cursor and hint, snapping.
const E = require('../../core/edit');
const S = require('../../core/settings');
const { state, sr } = require('../../core/state');
const {
  RULER, STRIP, EDGE, PAD, HANDLE, LH, cv, T, pps, frameToX, xToFrame, laneTop, laneAt, fadeHandles,
} = require('./view');

const SNAP_PX = 8;
// the part of a clip under x, y: edges, name strip, body; fade handles win over edges
function clipPart(c, x, y, top) {
  const x0 = frameToX(c.start), x1 = frameToX(E.clipEnd(c)), wide = x1 - x0 > EDGE * 3;
  const part = wide && x - x0 <= EDGE ? 'left' : wide && x1 - x <= EDGE ? 'right' : y - top <= STRIP ? 'strip' : 'body';
  if (x1 - x0 <= HANDLE * 4 || y - top < STRIP - 1 || y - top > STRIP + HANDLE + 2) return part;
  const hd = fadeHandles(c, x0, x1);
  return Math.abs(x - hd.fi) <= HANDLE ? 'fadeIn' : Math.abs(x - hd.fo) <= HANDLE ? 'fadeOut' : part;
}
function hit(x, y) {
  if (y < RULER) {
    const mk = y >= 12 && [...cv.markerHits].reverse().find((m) => x >= m.x0 && x <= m.x1);
    return mk ? { zone: 'marker', marker: mk.m, frame: xToFrame(x) } : { zone: 'ruler', frame: xToFrame(x) };
  }
  const i = laneAt(y), t = T()[i], frame = xToFrame(x);
  if (!t) return { zone: 'none', frame, idx: i };
  const top = laneTop(i) + PAD, inLane = y >= top && y <= top + LH() - PAD * 2;
  const over = (c) => inLane && x >= frameToX(c.start) - 1 && x <= frameToX(E.clipEnd(c)) + 1;
  const c = t.clips.findLast(over); // topmost (last drawn) first
  const lane = { zone: 'lane', idx: i, track: t, frame };
  return c ? { ...lane, clip: c, part: clipPart(c, x, y, top) } : lane;
}

const HINTS = {
  ruler: '클릭: 재생 위치 이동 · 드래그: 훑어 듣기 · M: 마커 추가',
  marker: '클릭: 마커로 이동 · 드래그: 마커 옮기기 · 더블클릭: 이름 바꾸기 · 오른쪽 클릭: 삭제',
  fadeIn: '드래그: 페이드 인 길이 (클립 볼륨 · 페이드… 에서 숫자로도)',
  fadeOut: '드래그: 페이드 아웃 길이 (클립 볼륨 · 페이드… 에서 숫자로도)',
  lane: '드래그: 구간 선택 (위아래로 끌면 여러 트랙) · Shift+클릭: 구간 늘리기 · 휠: 스크롤 · Ctrl+휠: 확대',
  strip: '드래그: 클립 이동 · Ctrl+클릭: 여러 개 선택 · 더블클릭: 클립 구간 선택',
  left: '드래그: 클립 앞부분 다듬기', right: '드래그: 클립 뒷부분 다듬기',
};
const CURSORS = { ruler: 'pointer', marker: 'grab', lane: 'text', strip: 'grab', left: 'ew-resize', right: 'ew-resize',
  fadeIn: 'col-resize', fadeOut: 'col-resize' };
function hover(x, y) {
  const h = hit(x, y), key = h.zone === 'lane' && h.clip && h.part !== 'body' ? h.part : h.zone;
  cv.canvas.style.cursor = CURSORS[key] || 'default';
  document.getElementById('hint').textContent = HINTS[key] || '';
}

// snap candidate frames: other clip edges, markers, playhead, 0 (+ beats in beat-grid mode)
function snapTargets(excludeIds, excludeMarker) {
  const s = [0, state.sel.playhead];
  for (const t of T()) for (const c of t.clips) if (!excludeIds.has(c.id)) s.push(c.start, E.clipEnd(c));
  for (const m of state.project.markers) if (m.id !== excludeMarker) s.push(m.frame);
  return s;
}
function snapDelta(frames, targets) {
  if (!S.get().snap) return 0;
  let best = null;
  const tol = SNAP_PX / pps() * sr(), bf = state.project.grid === 'beats' ? 60 / state.project.bpm * sr() : 0;
  const consider = (d) => { if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d; };
  for (const f of frames) {
    for (const s of targets) consider(s - f);
    if (bf) consider(Math.round(Math.round(f / bf) * bf) - f);
  }
  return best || 0;
}

module.exports = { hit, hover, snapTargets, snapDelta };
