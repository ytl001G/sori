// 긴 녹음 나누기 window, the two waveforms (spec §5-5): the whole recording (pieces, line boundaries; click picks a
// piece) and the current piece with 1 s around it (drag its edges, click places the 나누기 point).
// w = the window state (edit.js): { ch, sr, len, st: { ps, bounds }, cur, sel, cursor }.
const CONTEXT = 1; // s shown around the current piece
const HANDLE = 6; // px: an edge grabs this close
const { FONT } = require('../timeline/view');

const css = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
function size(cv) {
  const dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: cv.clientWidth, H: cv.clientHeight };
}
// min/max of channel 0 per pixel column over frames [a, b)
function peaks(x, a, b, cols) {
  const out = new Float32Array(cols * 2), step = (b - a) / cols;
  for (let c = 0; c < cols; c++) {
    let mn = 0, mx = 0;
    const s = Math.floor(a + c * step), e = Math.max(s + 1, Math.floor(a + (c + 1) * step));
    for (let i = Math.max(0, s); i < Math.min(x.length, e); i++) {
      const v = x[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[c * 2] = mn; out[c * 2 + 1] = mx;
  }
  return out;
}
function wave(g, pk, H, color) {
  g.fillStyle = color;
  for (let c = 0; c < pk.length / 2; c++) {
    const mn = pk[c * 2], mx = pk[c * 2 + 1];
    g.fillRect(c, H / 2 - mx * H / 2, 1, Math.max(1, (mx - mn) * H / 2));
  }
}
// the pieces as boxes under the waveform (dropped ones faint, chosen ones stronger)
function boxes(g, w, X, H) {
  w.st.ps.forEach((p, i) => {
    g.globalAlpha = p.drop ? 0.1 : w.sel.has(i) ? 0.32 : 0.16;
    g.fillStyle = p.drop ? css('--subtle') : css('--secondary');
    g.fillRect(X(p.a), 0, Math.max(1, X(p.b) - X(p.a)), H);
  });
  g.globalAlpha = 1;
}
// over the waveform: the current piece's outline, the line boundaries (accent) and the playhead
function marks(g, w, X, H) {
  const p = w.st.ps[w.cur];
  if (p) {
    g.strokeStyle = css('--text'); g.lineWidth = 1;
    g.strokeRect(X(p.a) + 0.5, 0.5, X(p.b) - X(p.a) - 1, H - 1);
  }
  g.fillStyle = css('--accent');
  for (const b of w.st.bounds) g.fillRect(Math.round(X(b)) - 1, 0, 2, H);
  const at = playAt(w);
  if (at != null) { g.fillStyle = css('--text'); g.fillRect(Math.round(X(at)), 0, 2, H); }
}
// where the piece being heard is now (frames), or null
const playAt = (w) => (w.playing ? Math.min(w.playing.b, w.playing.a + (performance.now() - w.playing.t0) / 1000 * w.sr)
  : null);
// each line's name where its pieces start (w.heads = [{ f, text }]), when there is room
function names(g, w, X, W) {
  g.font = '600 12px ' + FONT; g.textBaseline = 'top';
  let free = 0;
  for (const { f, text } of w.heads) {
    const x = Math.max(2, Math.round(X(f)) + 4), tw = g.measureText(text).width;
    if (x < free || x + tw > W) continue;
    g.fillStyle = css('--panel'); g.fillRect(x - 2, 2, tw + 4, 16);
    g.fillStyle = css('--text'); g.fillText(text, x, 3);
    free = x + tw + 8;
  }
}
// seconds under the detail view: a tick every 0.5 s, the time every 1 s
function ruler(g, a, b, sr, X, H) {
  g.fillStyle = css('--subtle'); g.font = '12px ' + FONT; g.textBaseline = 'bottom';
  for (let s = Math.ceil(a / sr * 2) / 2; s * sr <= b; s += 0.5) {
    const x = Math.round(X(s * sr)), whole = Number.isInteger(s);
    g.fillRect(x, H - (whole ? 8 : 4), 1, whole ? 8 : 4);
    if (whole) g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, x + 3, H - 1);
  }
}

// peaks kept on the window state (so they go with it): redrawn only when the span or the width changes, not on
// every playhead frame
function cachedPeaks(w, which, a, b, W) {
  const c = (w.peaks ||= {})[which];
  if (c && c.a === a && c.b === b && c.W === W) return c.pk;
  return (w.peaks[which] = { a, b, W, pk: peaks(w.ch[0], a, b, W) }).pk;
}
function drawOverview(cv, w) {
  const { g, W, H } = size(cv);
  g.clearRect(0, 0, W, H);
  const X = (f) => f / w.len * W;
  boxes(g, w, X, H);
  wave(g, cachedPeaks(w, 'over', 0, w.len, W), H, css('--muted'));
  marks(g, w, X, H);
  names(g, w, X, W);
}
// the frames the detail view shows
function detailSpan(w) {
  const p = w.st.ps[w.cur], c = CONTEXT * w.sr;
  return p ? [Math.max(0, p.a - c), Math.min(w.len, p.b + c)] : [0, Math.min(w.len, 2 * c)];
}
function drawDetail(cv, w) {
  const { g, W, H } = size(cv), [a, b] = detailSpan(w), X = (f) => (f - a) / (b - a) * W;
  g.clearRect(0, 0, W, H);
  boxes(g, w, X, H);
  wave(g, cachedPeaks(w, 'detail', a, b, W), H, css('--muted'));
  marks(g, w, X, H);
  ruler(g, a, b, w.sr, X, H);
  const p = w.st.ps[w.cur];
  if (p) { // the edges to drag: a full-height line and a grip, kept inside the view
    g.fillStyle = css('--text');
    for (const f of [p.a, p.b]) {
      const x = Math.min(W - 3, Math.max(1, Math.round(X(f))));
      g.fillRect(x - 1, 0, 2, H);
      g.fillRect(f === p.a ? x : x - 6, H / 2 - 14, 6, 28);
    }
  }
  if (w.cursor != null) { g.fillStyle = css('--danger'); g.fillRect(Math.round(X(w.cursor)), 0, 1, H); }
}

// mouse on the overview: the piece under x (else the nearest one)
function pieceAt(cv, w, clientX) {
  const r = cv.getBoundingClientRect(), f = (clientX - r.left) / r.width * w.len;
  let best = -1, d = Infinity;
  w.st.ps.forEach((p, i) => {
    const e = f < p.a ? p.a - f : f > p.b ? f - p.b : 0;
    if (e < d) { d = e; best = i; }
  });
  return best;
}
// mouse on the detail view: { edge: 'a' | 'b' } near an edge of the current piece, else { at: frame }
function detailHit(cv, w, clientX) {
  const r = cv.getBoundingClientRect(), [a, b] = detailSpan(w), x = clientX - r.left;
  const toF = (px) => Math.round(a + px / r.width * (b - a)), X = (f) => (f - a) / (b - a) * r.width;
  const p = w.st.ps[w.cur];
  const near = (f) => Math.abs(Math.min(r.width - 3, Math.max(1, X(f))) - x) <= HANDLE;
  if (p) for (const edge of ['a', 'b']) if (near(p[edge])) return { edge, toF };
  return { at: toF(x), toF };
}

module.exports = { drawOverview, drawDetail, pieceAt, detailHit, playAt };
