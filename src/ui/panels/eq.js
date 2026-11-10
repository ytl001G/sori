// Interactive EQ curve (effect panel + EQ dialog): drag a band point (x = frequency, y = gain),
// wheel over a point = width (Q, mid band), double-click a point = reset that band.
// The sliders next to it stay the keyboard alternative (ui-guide: dragging-alternative).
const FX = require('../../core/effects');
const P = require('../../core/fxparams');

const F0 = 20, F1 = 20000, DB = 18, SR = 48000, PADX = 8, PADY = 10;
const FIELD = Object.fromEntries(P.FIELDS.eq.map((f) => [f.key, f]));
const BANDS = [
  { id: 'lowcut', label: '로우컷', f: 'lowcut', off: 0 },
  { id: 'low', label: '저음', f: 'lowFreq', g: 'low' },
  { id: 'mid', label: '중음', f: 'midFreq', g: 'mid', q: 'midQ' },
  { id: 'high', label: '고음', f: 'highFreq', g: 'high' },
  { id: 'highcut', label: '하이컷', f: 'highcut', off: 20000 },
];
const snap = (fl, v) => Math.max(fl.min, Math.min(fl.max, Math.round(v / fl.step) * fl.step));
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz');

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// one graph: its canvas, size, what the mouse holds or is over; x / y <-> frequency / dB
function graph(cv, get, set, height) {
  const gr = { cv, g: cv.getContext('2d'), W: 0, H: height, drag: null, hover: null, get, set };
  gr.xOf = (f) => PADX + Math.log(Math.max(F0, f) / F0) / Math.log(F1 / F0) * (gr.W - 2 * PADX);
  gr.fOf = (x) => F0 * Math.pow(F1 / F0, Math.max(0, Math.min(1, (x - PADX) / (gr.W - 2 * PADX))));
  gr.yOf = (db) => gr.H / 2 - db / DB * (gr.H / 2 - PADY);
  gr.dbOf = (y) => (gr.H / 2 - y) / (gr.H / 2 - PADY) * DB;
  return gr;
}
function points(gr, v) {
  return BANDS.map((b) => {
    const off = b.off !== undefined && v[b.f] === b.off;
    const f = off ? (b.off === 0 ? F0 * 1.15 : F1 / 1.15) : v[b.f];
    return { b, x: gr.xOf(f), y: gr.yOf(b.g ? v[b.g] : 0), off };
  });
}

function drawGrid(gr) {
  const { g, W, H } = gr;
  g.fillStyle = css('--surface'); g.fillRect(0, 0, W, H);
  g.font = '500 12px "Pretendard Variable", "Malgun Gothic", sans-serif'; g.textBaseline = 'top';
  g.fillStyle = css('--line');
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillRect(Math.round(gr.xOf(f)), 0, 1, H);
  for (const d of [-12, -6, 6, 12]) g.fillRect(0, Math.round(gr.yOf(d)), W, 1);
  g.fillStyle = css('--subtle'); g.fillRect(0, Math.round(gr.yOf(0)), W, 1);
  for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) g.fillText(t, gr.xOf(f) + 3, H - 15);
  g.fillText('+12', 3, gr.yOf(12) + 2); g.fillText('−12', 3, gr.yOf(-12) - 15);
}
// the response curve, filled toward 0 dB
function drawCurve(gr, v) {
  const { g, W, H } = gr, st = FX.eqStages(SR, v);
  g.beginPath();
  for (let x = PADX; x <= W - PADX; x += 2) {
    const w = 2 * Math.PI * gr.fOf(x) / SR;
    let m = 1;
    for (const s of st) m *= FX.biquadMag(s, w);
    const y = Math.max(1, Math.min(H - 1, gr.yOf(20 * Math.log10(m + 1e-9))));
    x === PADX ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.strokeStyle = css('--secondary'); g.lineWidth = 2; g.stroke();
  g.lineTo(W - PADX, gr.yOf(0)); g.lineTo(PADX, gr.yOf(0)); g.closePath();
  g.fillStyle = css('--sel'); g.fill();
}
function drawPoints(gr, v) {
  const { g, drag, hover } = gr;
  for (const p of points(gr, v)) {
    const active = (drag && drag.b === p.b) || (hover && hover.b === p.b);
    g.beginPath(); g.arc(p.x, p.y, active ? 7 : 6, 0, Math.PI * 2);
    g.fillStyle = p.off ? css('--surface') : active ? css('--accent') : css('--text');
    g.fill(); g.lineWidth = 2; g.strokeStyle = p.off ? css('--subtle') : css('--bg'); g.stroke();
  }
}
function bandText(b, v) {
  if (b.off !== undefined && v[b.f] === b.off) return `${b.label} 꺼짐`;
  const gain = b.g ? ` · ${v[b.g] > 0 ? '+' : ''}${v[b.g].toFixed(1)} dB` : '';
  return `${b.label} ${fmtHz(v[b.f])}${gain}${b.q ? ` · Q ${v[b.q].toFixed(1)}` : ''}`;
}
// the dragged or hovered band's values in a small box, on the other half from its point
function drawTip(gr, v) {
  const { g, W, H } = gr, show = gr.drag || gr.hover;
  if (!show) return;
  const text = bandText(show.b, v), tw = g.measureText(text).width + 12;
  const p = points(gr, v).find((q) => q.b === show.b);
  const tx = Math.max(2, Math.min(W - tw - 2, p.x - tw / 2)), ty = p.y > H / 2 ? 4 : H - 22;
  g.fillStyle = css('--panel'); g.fillRect(tx, ty, tw, 18);
  g.fillStyle = css('--text'); g.fillText(text, tx + 6, ty + 3);
}
function draw(gr) {
  const dpr = window.devicePixelRatio || 1, { cv, g } = gr;
  gr.W = cv.clientWidth;
  if (!gr.W) return;
  const w = Math.round(gr.W * dpr), h = Math.round(gr.H * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const v = gr.get();
  drawGrid(gr); drawCurve(gr, v); drawPoints(gr, v); drawTip(gr, v);
}

function near(gr, x, y) {
  let best = null, bd = 14 * 14;
  for (const p of points(gr, gr.get())) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}
// a band point moved to x, y: its frequency (the cuts switch off at the ends) and gain
function apply(gr, b, x, y) {
  const patch = {}, f = gr.fOf(x);
  if (b.off === 0) patch.lowcut = f < 25 ? 0 : snap(FIELD.lowcut, f);
  else if (b.off === 20000) patch.highcut = f > 19000 ? 20000 : snap(FIELD.highcut, f);
  else patch[b.f] = snap(FIELD[b.f], f);
  if (b.g) patch[b.g] = snap(FIELD[b.g], gr.dbOf(y));
  gr.set(patch);
}
function onDown(gr, e) {
  if (e.button !== 0) return;
  const p = near(gr, e.offsetX, e.offsetY);
  if (!p) return;
  e.preventDefault();
  gr.drag = { b: p.b };
  const move = (ev) => {
    const r = gr.cv.getBoundingClientRect();
    apply(gr, gr.drag.b, ev.clientX - r.left, ev.clientY - r.top);
    draw(gr);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', () => {
    window.removeEventListener('mousemove', move); gr.drag = null; draw(gr);
  }, { once: true });
}
function onHover(gr, e) {
  if (gr.drag) return;
  const p = near(gr, e.offsetX, e.offsetY), nb = p ? p.b : null;
  gr.cv.style.cursor = p ? 'grab' : 'default';
  if ((gr.hover && gr.hover.b) !== nb) { gr.hover = p; draw(gr); }
}
function onWheel(gr, e) { // the mid band's width
  const p = near(gr, e.offsetX, e.offsetY);
  if (!p || !p.b.q) return;
  e.preventDefault();
  gr.set({ [p.b.q]: snap(FIELD[p.b.q], gr.get()[p.b.q] * (e.deltaY < 0 ? 1.15 : 1 / 1.15)) });
  draw(gr);
}
function onDouble(gr, e) { // that band back to its default
  const p = near(gr, e.offsetX, e.offsetY);
  if (!p) return;
  const keys = [p.b.f, p.b.g, p.b.q].filter(Boolean);
  gr.set(Object.fromEntries(keys.map((k) => [k, FIELD[k].value])));
  draw(gr);
}

// get() -> current values, set(patch) applies (caller updates and later calls update())
function mount(box, { get, set, height = 150 }) {
  const cv = document.createElement('canvas');
  cv.className = 'eqgraph';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'EQ 곡선. 점을 끌어서 주파수와 세기를 바꾸고, 휠로 폭을 바꿔요. 아래 슬라이더로도 조절할 수 있어요');
  cv.style.height = height + 'px';
  box.append(cv);
  const gr = graph(cv, get, set, height), redraw = () => draw(gr);
  cv.addEventListener('mousedown', (e) => onDown(gr, e));
  cv.addEventListener('mousemove', (e) => onHover(gr, e));
  cv.addEventListener('mouseleave', () => { if (gr.hover) { gr.hover = null; redraw(); } });
  cv.addEventListener('wheel', (e) => onWheel(gr, e), { passive: false });
  cv.addEventListener('dblclick', (e) => onDouble(gr, e));
  new ResizeObserver(redraw).observe(cv);
  redraw();
  return { update: redraw, el: cv };
}

module.exports = { mount };
