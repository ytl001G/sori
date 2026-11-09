// Drawing clips: name strip, waveform or spectrogram, fades and their handles; the take being recorded.
const E = require('../../core/edit');
const engine = require('../../audio/engine');
const { minmax } = require('../../core/peaks');
const SP = require('../../core/spectro');
const C = require('../commands');
const { state, sr } = require('../../core/state');
const {
  STRIP, PAD, HANDLE, FONT, LH, cv, T, v, pps, frameToX, laneTop, fadeHandles, rgba, shade, hexOf,
} = require('./view');

function roundRect(x, y, w, h, rad) {
  const { g } = cv;
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, rad); else g.rect(x, y, w, h);
}

function drawWave(src, offset, startFrame, x0, x1, top, h, color, scale = 1) {
  const { g } = cv, mid = top + h / 2, amp = h / 2 - 1, fpp = sr() / pps();
  g.fillStyle = color;
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(cv.W, Math.ceil(x1)); x++) {
    const fa = Math.floor((v.scrollX + x / pps()) * sr()) - startFrame + offset;
    const [mn, mx] = minmax(src, fa, fa + Math.max(1, Math.ceil(fpp)));
    const yTop = mid - Math.min(1, mx * scale) * amp, yBot = mid - Math.max(-1, mn * scale) * amp;
    g.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
  }
}

// spectrogram columns go through one reusable offscreen canvas (ROWS px high), scaled into the lane
let off = null, offg = null, img = null;
function specBuffer(w) {
  if (off && off.width >= w) return;
  off = document.createElement('canvas');
  off.width = Math.max(w, cv.W); off.height = SP.ROWS;
  offg = off.getContext('2d');
  img = offg.createImageData(off.width, SP.ROWS);
}
function drawSpec(src, offset, startFrame, x0, x1, top, h) {
  const e = SP.get(src, sr()), xa = Math.max(0, Math.floor(x0)), w = Math.min(cv.W, Math.ceil(x1)) - xa, R = SP.ROWS;
  if (w <= 0) return;
  specBuffer(w);
  const d = img.data, fpp = sr() / pps(), stride = off.width * 4;
  for (let x = 0; x < w; x++) {
    const fa = Math.floor((v.scrollX + (xa + x) / pps()) * sr()) - startFrame + offset;
    const c0 = Math.max(0, Math.floor(fa / SP.HOP));
    const c1 = Math.min(e.done, Math.max(c0 + 1, Math.ceil((fa + fpp) / SP.HOP)));
    const step = Math.max(1, Math.floor((c1 - c0) / 8));
    for (let r = 0; r < R; r++) {
      let m = -1;
      for (let c = c0; c < c1; c += step) { const q = e.data[c * R + r]; if (q > m) m = q; }
      const o = r * stride + x * 4;
      if (m < 0) { d[o + 3] = 0; continue; } // not computed yet
      d[o] = SP.LUT[m * 3]; d[o + 1] = SP.LUT[m * 3 + 1]; d[o + 2] = SP.LUT[m * 3 + 2]; d[o + 3] = 255;
    }
  }
  offg.putImageData(img, 0, 0, 0, 0, w, R);
  cv.g.drawImage(off, 0, 0, w, R, xa, top, w, h);
}

// effective fades (incl. automatic crossfades) shaded above the gain curve; line = the curve (clip's fade shapes)
function drawFades(c, [fi, fo], x0, x1, top, bot) {
  const { g, col } = cv, k = pps() / sr(), N = 24;
  g.fillStyle = col.theme === 'light' ? 'rgba(255,255,255,.55)' : 'rgba(2,6,23,.45)';
  g.strokeStyle = col.text; g.lineWidth = 1;
  const fade = (xa, xb, gainAt) => {
    const pts = Array.from({ length: N + 1 }, (_, i) => [xa + (xb - xa) * i / N, bot - (bot - top) * gainAt(i / N)]);
    g.beginPath(); g.moveTo(xa, top); g.lineTo(xb, top);
    for (let i = N; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fill();
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  const [si, so] = E.fadeShapes(c, [fi, fo]);
  if (fi > 0) fade(x0, x0 + fi * k, (u) => E.fadeGain(si, u));
  if (fo > 0) fade(x1 - fo * k, x1, (u) => 1 - E.fadeGain(so, u));
}

const waveColor = (color) => (cv.col.waveShade ? shade(color, cv.col.waveShade) : color);
function drawClip(t, c, y, fd = [0, 0]) {
  const x0 = frameToX(c.start), x1 = frameToX(E.clipEnd(c));
  if (x1 < 0 || x0 > cv.W) return;
  const { g, col } = cv, top = y + PAD, h = LH() - PAD * 2, w = Math.max(2, x1 - x0), color = hexOf(t.color);
  const xa = Math.max(x0, 0), xb = Math.min(x1, cv.W);
  g.save();
  roundRect(x0, top, w, h, 4); g.clip();
  g.fillStyle = rgba(color, col.clipAlpha); g.fillRect(x0, top, w, h);
  g.fillStyle = rgba(color, 0.85); g.fillRect(x0, top, w, STRIP);
  g.fillStyle = 'rgba(15,23,42,.92)';
  g.font = '600 12px ' + FONT; g.textBaseline = 'middle';
  g.fillText(c.name || t.name, xa + 6, top + STRIP / 2 + 0.5);
  if (state.view.spec) drawSpec(c.src, c.offset, c.start, xa, xb, top + STRIP, h - STRIP);
  else drawWave(c.src, c.offset, c.start, xa, xb, top + STRIP + 2, h - STRIP - 4, waveColor(color), c.gain ?? 1);
  drawFades(c, fd, x0, x1, top + STRIP, top + h);
  g.restore();
  drawEdge(c, x0, x1, top, h, color);
}
// the outline (accent when selected) and the fade handles
function drawEdge(c, x0, x1, top, h, color) {
  const { g, col } = cv, w = Math.max(2, x1 - x0), selected = state.sel.clipIds.has(c.id);
  roundRect(x0 + 0.5, top + 0.5, w - 1, h - 1, 4);
  g.lineWidth = selected ? 2 : 1;
  g.strokeStyle = selected ? col.accent : rgba(color, 0.6);
  g.stroke();
  if (w <= HANDLE * 4) return;
  const hd = fadeHandles(c, x0, x1);
  for (const hx of [hd.fi, hd.fo]) {
    const left = Math.round(hx - HANDLE / 2);
    g.fillStyle = col.text; g.fillRect(left, top + STRIP, HANDLE, HANDLE);
    g.strokeStyle = col.bg; g.lineWidth = 1; g.strokeRect(left + 0.5, top + STRIP + 0.5, HANDLE - 1, HANDLE - 1);
  }
}

function drawRecording() {
  const info = C.recInfo(), r = engine.recording();
  if (!info || !r) return;
  const i = T().findIndex((t) => t.id === info.trackId);
  if (i < 0) return;
  const skip = C.recTrim(engine.recLead()), len = r.length - skip; // draw only what the take keeps on stop
  if (len <= 0) return; // still counting in
  const { g, col } = cv, top = laneTop(i) + PAD, h = LH() - PAD * 2;
  const x0 = frameToX(info.start), x1 = frameToX(info.start + len);
  g.fillStyle = rgba(hexOf(col.danger), 0.22); g.fillRect(x0, top, x1 - x0, h);
  g.fillStyle = col.danger; g.fillRect(x0, top, x1 - x0, STRIP);
  g.fillStyle = '#fff'; g.font = '600 12px ' + FONT; g.textBaseline = 'middle';
  g.fillText('녹음 중', x0 + 6, top + STRIP / 2 + 0.5);
  const mid = top + STRIP + (h - STRIP) / 2, amp = (h - STRIP) / 2 - 2, cw = r.chunk / sr() * pps();
  g.fillStyle = col.danger;
  r.peaks.forEach(([mn, mx], k) => {
    // the chunk holding the cut starts inside the box
    const xa = x0 + (k * r.chunk - skip) / sr() * pps(), x = Math.max(x0, xa);
    if (xa + cw <= x0 || x > cv.W || xa + cw < 0) return;
    g.fillRect(x, mid - mx * amp, Math.max(1, xa + cw - x), Math.max(1, (mx - mn) * amp));
  });
}

module.exports = { roundRect, drawClip, drawRecording };
