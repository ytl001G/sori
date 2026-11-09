// Timeline canvas: ruler, lanes, clips + waveforms, selection, playhead; mouse interaction.
// view.js = geometry, colors, zoom, scrolling; paint.js + clips.js = drawing; hit.js = what is under the mouse;
// mouse.js = press and drag. Here: double click, wheel, context menu, dropped files, wiring.
const { webUtils } = require('electron');
const E = require('../../core/edit');
const C = require('../commands');
const V = require('./view');
const { draw } = require('./paint');
const { hit, hover } = require('./hit');
const M = require('./mouse');
const { state, changed } = require('../../core/state');

const { RULER, cv, v, pps, frameToX } = V;
const menus = () => require('../menus'); // lazy: menus require the timeline's commands

function onDouble(e) {
  const h = hit(e.offsetX, e.offsetY);
  if (h.zone === 'marker') { state.sel.markerId = h.marker.id; return C.run('markerRename'); }
  if (h.zone !== 'lane' || !h.clip) return;
  state.sel.clipIds = new Set();
  state.sel.range = { a: h.clip.start, b: E.clipEnd(h.clip), trackIds: new Set([h.track.id]) };
  changed();
}
function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey) return V.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX);
  if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return V.scrollV(e.deltaY);
  v.scrollX = Math.max(0, v.scrollX + (e.shiftKey ? e.deltaY : e.deltaX) / pps());
  changed();
}

function fadeShapeMenu(h, e) { // a fade handle: pick its shape
  const c = h.clip, edge = h.part, cur = C.shapeOf(c, edge);
  const item = (s) => ({
    label: s.label, checked: () => s.value === cur, run: () => C.setFadeShape(c.id, edge, s.value),
  });
  menus().openList(C.FADE_SHAPES.map(item), e.clientX, e.clientY);
}
function onContext(e) {
  e.preventDefault();
  const h = hit(e.offsetX, e.offsetY), sel = state.sel;
  if (h.zone === 'lane' && h.clip && h.part.startsWith('fade')) return fadeShapeMenu(h, e);
  if (h.zone === 'marker') {
    sel.markerId = h.marker.id; changed();
    return menus().openContext(e.clientX, e.clientY, 'marker');
  }
  if (h.zone === 'lane' && h.clip && !sel.range && !sel.clipIds.has(h.clip.id)) {
    sel.clipIds = new Set([h.clip.id]); sel.activeTrackId = h.track.id; changed();
  }
  menus().openContext(e.clientX, e.clientY);
}
function openContextAtPlayhead() {
  const rc = cv.canvas.getBoundingClientRect();
  menus().openContext(rc.left + Math.max(8, Math.min(cv.W - 8, frameToX(state.sel.playhead))), rc.top + RULER + 12);
}

// ---------- drag & drop files ----------
function setupDrop(wrap) {
  const hintEl = document.getElementById('drop-hint');
  let depth = 0;
  wrap.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; hintEl.hidden = false; });
  wrap.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hintEl.hidden = true; } });
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    const h = hit(e.offsetX, e.offsetY);
    hintEl.textContent = h.zone === 'lane' ? `'${h.track.name}' 트랙의 이 위치에 놓아요` : '여기에 놓으면 새 트랙으로 추가돼요';
  });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; hintEl.hidden = true;
    const paths = [...e.dataTransfer.files].map((f) => webUtils.getPathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    const proj = paths.find((p) => p.toLowerCase().endsWith('.vproj'));
    if (proj) return C.openProject(proj);
    const [x, y] = M.localXY(e), h = hit(x, y);
    C.importAudio(paths, h.zone === 'lane' ? { trackId: h.track.id, at: h.frame } : null);
  });
}

function init() {
  const c = document.getElementById('timeline');
  cv.canvas = c;
  cv.g = c.getContext('2d');
  V.readColors();
  V.initScrollbar();
  new ResizeObserver(V.resize).observe(c.parentElement);
  c.addEventListener('mousedown', M.onDown);
  c.addEventListener('mousemove', (e) => { if (!M.dragging()) hover(e.offsetX, e.offsetY); });
  c.addEventListener('mouseleave', () => { document.getElementById('hint').textContent = ''; });
  c.addEventListener('dblclick', onDouble);
  c.addEventListener('wheel', onWheel, { passive: false });
  c.addEventListener('contextmenu', onContext);
  setupDrop(c.parentElement);
  V.resize();
}

module.exports = {
  init, draw, openContextAtPlayhead, syncScrollbar: V.syncScrollbar, zoomBy: V.zoomBy, zoomFit: V.zoomFit,
  zoomRange: V.zoomRange, reveal: V.reveal, scrollV: V.scrollV,
};
