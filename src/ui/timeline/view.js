// The timeline's canvas, geometry (frames <-> pixels, lanes), theme colors, zoom and scrolling.
const E = require('../../core/edit');
const { state, changed, sr } = require('../../core/state');

const RULER = 28, STRIP = 18, EDGE = 6, PAD = 4, HANDLE = 8;
const LH = () => state.view.laneH; // lane height (설정 > 트랙 높이)
const MIN_PPS = 2, MAX_PPS = 20000;
const FONT = '"Pretendard Variable", "Malgun Gothic", sans-serif';
// the canvas and what was drawn last: markerHits = marker flags for the mouse
const cv = { canvas: null, g: null, W: 0, H: 0, dpr: 1, col: {}, markerHits: [] };

const T = () => state.project.tracks;
const v = state.view;
const pps = () => v.pxPerSec;
const frameToX = (f) => (f / sr() - v.scrollX) * pps();
const xToFrame = (x) => Math.max(0, Math.round((v.scrollX + x / pps()) * sr()));
const laneTop = (i) => RULER + i * LH() - v.scrollY;
const laneAt = (y) => Math.floor((y - RULER + v.scrollY) / LH());
// fade handle centers (the clip's own fades, kept inside the clip)
function fadeHandles(c, x0, x1) {
  const k = pps() / sr(), lo = x0 + HANDLE / 2, hi = x1 - HANDLE / 2;
  const at = (x) => Math.max(lo, Math.min(hi, x));
  return { fi: at(x0 + (c.fadeIn || 0) * k), fo: at(x1 - (c.fadeOut || 0) * k) };
}

const COLORS = ['bg', 'lane-alt', 'panel', 'surface', 'line', 'text', 'muted', 'subtle', 'secondary', 'accent',
  'danger', 'sel', 'hover', 'lane-active'];
function readColors() {
  const cs = getComputedStyle(document.documentElement), get = (n) => cs.getPropertyValue(n).trim();
  const col = {};
  for (const k of COLORS) col[k] = get('--' + k);
  col.clipAlpha = parseFloat(get('--clip-alpha')) || 0.26;
  col.waveShade = parseFloat(get('--wave-shade')) || 0;
  col.theme = document.documentElement.dataset.theme;
  cv.col = col;
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
// s < 0 mixes toward white
const shade = (h, s) => `rgb(${hexRgb(h).map((c) => Math.round(s >= 0 ? c * (1 - s) : c + (255 - c) * -s)).join(',')})`;
const hexOf = (c) => (c.startsWith('#') ? c : '#000000');

// keep the playhead in view while playing (page flip)
function follow() {
  if (!state.view.follow) return; // 설정 > 재생 중 화면 따라가기
  const x = frameToX(state.sel.playhead);
  if (x > cv.W - 24 || x < 0) v.scrollX = Math.max(0, state.sel.playhead / sr() - (cv.W * 0.1) / pps());
}
function reveal(f) {
  const x = frameToX(f);
  if (x < 0 || x > cv.W - 24) v.scrollX = Math.max(0, f / sr() - (cv.W * 0.2) / pps());
}
function zoomAt(factor, x) {
  const sec = v.scrollX + x / pps();
  v.pxPerSec = Math.max(MIN_PPS, Math.min(MAX_PPS, v.pxPerSec * factor));
  v.scrollX = Math.max(0, sec - x / pps());
  changed();
}
function zoomBy(factor) {
  const px = frameToX(state.sel.playhead);
  zoomAt(factor, px >= 0 && px <= cv.W ? px : cv.W / 2);
}
function zoomRange(a, b) {
  const sec = Math.max(1 / sr(), (b - a) / sr());
  v.pxPerSec = Math.max(MIN_PPS, Math.min(MAX_PPS, (cv.W - 48) / sec));
  v.scrollX = Math.max(0, a / sr() - 24 / pps());
  changed();
}
function zoomFit() {
  const end = E.projectEnd(T()) / sr();
  v.pxPerSec = end > 0 ? Math.max(MIN_PPS, Math.min(MAX_PPS, (cv.W - 48) / end)) : 80;
  v.scrollX = 0;
  changed();
}
// vertical scroll shared by the lanes and the track header column
// 이어 녹음 has its own lane under the takes (lazy: commands load after the timeline)
const lanes = () => { const r = require('../commands').recInfo(); return T().length + (r && r.cont ? 1 : 0); };
const maxScrollY = () => Math.max(0, lanes() * LH() - (cv.H - RULER) + 48);
// lane i fully in view (Ctrl+F going to a track)
function revealLane(i) {
  const top = i * LH();
  if (i < 0 || (top >= v.scrollY && top + LH() <= v.scrollY + cv.H - RULER)) return;
  v.scrollY = Math.max(0, Math.min(maxScrollY(), top - LH()));
}
function scrollV(dy) {
  v.scrollY = Math.max(0, Math.min(maxScrollY(), v.scrollY + dy));
  changed();
}

// ---------- horizontal scrollbar ----------
let hs, hsInner, hsSyncing = false;
const MAX_SCROLL_PX = 1e7; // Chromium caps element widths; map proportionally beyond this
function syncScrollbar() {
  const content = Math.max(E.projectEnd(T()) / sr() + 30, v.scrollX + cv.W / pps());
  const full = content * pps(), scale = Math.min(1, MAX_SCROLL_PX / full);
  const w = full * scale + 'px', left = v.scrollX * pps() * scale;
  if (hsInner.style.width === w && hs.dataset.left === String(left)) return; // every frame while playing
  hsInner.style.width = w;
  hsSyncing = true;
  hs.scrollLeft = left;
  hsSyncing = false;
  hs.dataset.scale = scale; hs.dataset.left = left;
}
function initScrollbar() {
  hs = document.getElementById('hscroll'); hsInner = document.getElementById('hscroll-inner');
  hs.addEventListener('scroll', () => {
    if (hsSyncing) return;
    v.scrollX = hs.scrollLeft / (pps() * (+hs.dataset.scale || 1));
    changed();
  });
}
function resize() {
  const wrap = cv.canvas.parentElement;
  cv.dpr = window.devicePixelRatio || 1;
  cv.W = wrap.clientWidth; cv.H = wrap.clientHeight;
  cv.canvas.width = Math.round(cv.W * cv.dpr); cv.canvas.height = Math.round(cv.H * cv.dpr);
  changed();
}

module.exports = {
  RULER, STRIP, EDGE, PAD, HANDLE, FONT, LH, cv, T, v, pps, frameToX, xToFrame, laneTop, laneAt, fadeHandles,
  readColors, rgba, shade, hexOf, follow, reveal, zoomAt, zoomBy, zoomRange, zoomFit, maxScrollY, scrollV, revealLane,
  syncScrollbar, initScrollbar, resize,
};
