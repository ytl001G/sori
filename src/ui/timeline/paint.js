// Drawing a timeline frame: lanes, grid, clips (clips.js), selection, ruler, markers, playhead.
const E = require('../../core/edit');
const { state } = require('../../core/state');
const V = require('./view');
const { roundRect, drawClip, drawRecording } = require('./clips');

const { RULER, FONT, LH, cv, T, v, pps, frameToX, laneTop, rgba, hexOf } = V;

// ---------- ruler ticks ----------
const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800,
  3600];
// rounded before the minutes are split off: 59.9996 s reads 1:00.000, never 0:60.000
function fmtTime(s, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3, r = +s.toFixed(dec), m = Math.floor(r / 60);
  return `${m}:${(r - m * 60).toFixed(dec).padStart(dec ? dec + 3 : 2, '0')}`;
}
// beats mode: labels every `unit` (>= 90 px), grid lines on beats (bars when beats get dense)
function beatGrid() {
  const beat = 60 / state.project.bpm, bar = beat * state.project.beats;
  const units = [beat / 4, beat / 2, beat, bar, bar * 2, bar * 4, bar * 8, bar * 16, bar * 32, bar * 64, bar * 128];
  const unit = units.find((u) => u * pps() >= 90) || units[units.length - 1];
  const minor = unit > bar ? unit / 4 : unit === bar ? beat : unit / 2;
  const line = beat * pps() >= 12 ? beat : bar * pps() >= 12 ? bar : unit;
  const label = (s) => {
    const b = Math.floor(s / bar + 1e-9), k = Math.floor((s - b * bar) / beat + 1e-9);
    if (unit >= bar) return String(b + 1);
    if (unit >= beat) return `${b + 1}.${k + 1}`;
    return `${b + 1}.${k + 1}.${Math.floor((s - b * bar - k * beat) / unit + 1e-9) + 1}`;
  };
  return { beat, bar, unit, minor, line, label };
}

const visible = (i) => laneTop(i) <= cv.H && laneTop(i) + LH() >= RULER;
function drawLanes() {
  const { g, W, col } = cv;
  T().forEach((t, i) => {
    if (!visible(i)) return;
    const y = laneTop(i);
    if (i % 2) { g.fillStyle = col['lane-alt']; g.fillRect(0, y, W, LH()); }
    if (t.id === state.sel.activeTrackId) { g.fillStyle = col['lane-active'] || col.hover; g.fillRect(0, y, W, LH()); }
    g.fillStyle = col.line; g.fillRect(0, y + LH() - 1, W, 1);
  });
}
// time mode: a line per ruler label; beats mode: per beat, bars stronger
function drawGrid(t0, t1, step, bg) {
  const { g, H, col } = cv, x = (s) => Math.round((s - t0) * pps());
  if (!bg) {
    g.fillStyle = rgba(hexOf(col.line), 0.5);
    for (let s = Math.floor(t0 / step) * step; s <= t1; s += step) g.fillRect(x(s), RULER, 1, H - RULER);
    return;
  }
  for (let s = Math.floor(t0 / bg.line) * bg.line; s <= t1; s += bg.line) {
    const bar = Math.abs(s / bg.bar - Math.round(s / bg.bar)) < 1e-6;
    g.fillStyle = rgba(hexOf(col.line), bar ? 0.9 : 0.4);
    g.fillRect(x(s), RULER, 1, H - RULER);
  }
}
function drawClips() {
  T().forEach((t, i) => {
    if (!visible(i)) return;
    const fd = E.fades(t.clips);
    for (const c of t.clips) drawClip(t, c, laneTop(i), fd.get(c));
  });
  drawRecording();
}
function drawSelection(r) {
  const { g, col } = cv, xa = frameToX(r.a), xb = frameToX(r.b);
  T().forEach((t, i) => {
    if (!r.trackIds.has(t.id)) return;
    const y = laneTop(i);
    g.fillStyle = col.sel; g.fillRect(xa, y, xb - xa, LH() - 1);
    g.fillStyle = col.secondary;
    g.fillRect(Math.round(xa), y, 1, LH() - 1); g.fillRect(Math.round(xb), y, 1, LH() - 1);
  });
}
function drawRuler(t0, t1, step, bg, r) {
  const { g, W, col } = cv;
  g.fillStyle = col.surface; g.fillRect(0, 0, W, RULER);
  g.fillStyle = col.line; g.fillRect(0, RULER - 1, W, 1);
  if (r) {
    g.fillStyle = state.loop ? rgba(hexOf(col.secondary), 0.45) : col.sel;
    g.fillRect(frameToX(r.a), 0, frameToX(r.b) - frameToX(r.a), RULER - 1);
  }
  g.font = '500 12px ' + FONT;
  g.textBaseline = 'middle';
  const unit = bg ? bg.unit : step, minor = bg ? bg.minor : step / 5;
  for (let s = Math.floor(t0 / unit) * unit; s <= t1 + unit; s += minor) {
    const x = Math.round((s - t0) * pps());
    const major = Math.abs(s / unit - Math.round(s / unit)) < 1e-6;
    g.fillStyle = major ? col.subtle : col.line;
    g.fillRect(x, major ? 14 : 21, 1, major ? 13 : 6);
    if (major) { g.fillStyle = col.subtle; g.fillText(bg ? bg.label(s) : fmtTime(Math.max(0, s), step), x + 4, 9); }
  }
}
// markers: flag in the lower ruler + a thin line through the lanes; hit boxes for the mouse
function drawMarkers() {
  const { g, W, H, col } = cv;
  cv.markerHits = [];
  g.font = '600 12px ' + FONT; g.textBaseline = 'middle';
  for (const m of state.project.markers) {
    const x = Math.round(frameToX(m.frame)), w = Math.min(140, Math.ceil(g.measureText(m.name).width) + 10);
    if (x + w < 0 || x > W) continue;
    const sel = m.id === state.sel.markerId;
    g.fillStyle = rgba(hexOf(col.accent), sel ? 0.9 : 0.5); g.fillRect(x, RULER, 1, H - RULER);
    g.fillStyle = col.accent; roundRect(x, 14, w, 13, 3); g.fill();
    if (sel) { g.strokeStyle = col.text; g.lineWidth = 1.5; g.stroke(); }
    g.save(); g.beginPath(); g.rect(x, 14, w, 13); g.clip();
    g.fillStyle = col.theme === 'light' ? '#FFFFFF' : '#0F172A'; g.fillText(m.name, x + 5, 21);
    g.restore();
    cv.markerHits.push({ m, x0: x - 3, x1: x + w });
  }
}
function drawPlayhead() {
  const { g, W, H } = cv, px = Math.round(frameToX(state.sel.playhead));
  if (px < -8 || px > W + 8) return;
  g.fillStyle = cv.col.secondary;
  g.fillRect(px, RULER - 2, 1.5, H);
  g.beginPath(); g.moveTo(px - 6, RULER - 10); g.lineTo(px + 7, RULER - 10); g.lineTo(px + 0.75, RULER - 2); g.fill();
}

function draw() {
  const { g, W, H } = cv;
  if (!g || !W) return;
  if (cv.col.theme !== document.documentElement.dataset.theme) V.readColors();
  if (state.playing) V.follow();
  v.scrollY = Math.min(v.scrollY, V.maxScrollY()); // tracks removed
  g.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
  g.fillStyle = cv.col.bg; g.fillRect(0, 0, W, H);
  const step = STEPS.find((s) => s * pps() >= 90) || 3600, bg = state.project.grid === 'beats' ? beatGrid() : null;
  const t0 = v.scrollX, t1 = v.scrollX + W / pps(), r = state.sel.range;
  drawLanes();
  drawGrid(t0, t1, step, bg);
  drawClips();
  if (r) drawSelection(r);
  drawRuler(t0, t1, step, bg, r);
  drawMarkers();
  drawPlayhead();
}

module.exports = { draw, fmtTime };
