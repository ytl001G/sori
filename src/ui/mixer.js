// Bottom mixer panel: one strip per track + master. Vertical fader, pan, stereo peak meter
// with clip latch, M/S, effect button (opens that channel in the effect panel).
const C = require('./commands');
const engine = require('../audio/engine');
const S = require('../core/settings');
const { el } = require('./dialogs');
const { gainToDb, dbToGain, dbText, panText } = require('./tracks');
const { state, trackById } = require('../core/state');
const R = require('./commands/record');
// the take being recorded shows the mic input level and clip light
const meterId = (id) => (R.recInfo() && R.recInfo().trackId === id ? 'input' : id);

let root, inner, sig = null, strips = new Map(), lastT = 0;
const MIN = -60, TOP = 6; // meter scale (dB)
// FL-style: one gradient from green to red; a bar shows the colors up to its level
const STOPS = [[MIN, '--meter-g'], [-24, '--meter-g'], [-18, '--meter-l'], [-12, '--meter-y'], [-6, '--meter-o'],
  [-2, '--meter-r'], [TOP, '--meter-r']];

// a track strip's pan slider and its value (double click: center)
function panParts(t) {
  const pan = el('input', { type: 'range', min: -1, max: 1, step: 0.01, className: 'span', title: '더블클릭: 가운데' });
  pan.setAttribute('aria-label', t.name + ' 팬');
  pan.oninput = () => C.mixer(t.id, { pan: +pan.value });
  pan.ondblclick = () => { pan.value = 0; C.mixer(t.id, { pan: 0 }); };
  return { pan, panV: el('span', { className: 'sval' }) };
}
// the fader (double click: 0 dB), the clip latch and the meter; the master's fader is its gain
function faderParts(t) {
  const master = !t, id = t ? t.id : 'master';
  const setDb = (db) => (master ? C.setFx('master', 'gain', { gainDb: db }) : C.mixer(id, { gain: dbToGain(db) }));
  const fader = el('input', { type: 'range', min: master ? -24 : MIN, max: master ? 12 : 6, step: 0.5,
    className: 'fader', title: '더블클릭: 0 dB' });
  fader.setAttribute('aria-label', master ? '마스터 볼륨' : t.name + ' 볼륨');
  fader.setAttribute('aria-orientation', 'vertical');
  fader.oninput = () => setDb(+fader.value);
  fader.ondblclick = () => { fader.value = 0; setDb(0); };
  const clip = el('button', { className: 'clipind', type: 'button', title: '클리핑 (0 dB 넘음). 클릭: 지우기' });
  clip.setAttribute('aria-label', '클리핑 표시 지우기');
  clip.onclick = () => engine.resetClip(meterId(id));
  return { fader, clip, meter: el('canvas', { className: 'meter' }), dbV: el('span', { className: 'sval db' }) };
}
function toggle(t, cls, text, title, key) {
  const b = el('button', { className: 'tbtn ' + cls, type: 'button', textContent: text, title });
  b.setAttribute('aria-label', t.name + ' ' + title);
  b.onclick = () => C.mixer(t.id, { [key]: !trackById(t.id)[key] });
  return b;
}
function strip(t) {
  const id = t ? t.id : 'master', master = !t, label = master ? '마스터' : t.name;
  const s = el('div', { className: 'strip' + (master ? ' master' : '') });
  s.setAttribute('role', 'group'); s.setAttribute('aria-label', label + ' 채널');
  const name = el('button', { className: 'sname', type: 'button', textContent: label, title: '클릭: 이 채널의 효과 보기' });
  name.style.borderTopColor = master ? 'var(--secondary)' : t.color;
  name.onclick = () => { if (!master) state.sel.activeTrackId = id; C.showFx(id); };
  const fxb = el('button', { className: 'fxb', type: 'button' });
  fxb.onclick = () => C.showFx(id);
  const { pan, panV } = master ? {} : panParts(t), f = faderParts(t);
  const m = master ? null : toggle(t, 'm', 'M', '음소거', 'mute'), so = master ? null : toggle(t, 's', 'S', '솔로', 'solo');
  s.append(name, fxb, ...(master ? [] : [el('div', { className: 'srow' }, pan), panV]),
    el('div', { className: 'fwrap' }, f.fader, el('div', { className: 'mcol' }, f.clip, f.meter)), f.dbV,
    ...(master ? [] : [el('div', { className: 'srow ms' }, m, so)]));
  return { id, s, name, fxb, pan, panV, ...f, m, so, disp: [MIN, MIN], hold: [MIN, MIN], holdT: 0 };
}

const dbOf = (v) => (v > 0 ? Math.max(MIN, 20 * Math.log10(v)) : MIN);

function drawMeter(x, dt, col) {
  const pk = engine.level(meterId(x.id)), now = performance.now();
  for (let c = 0; c < 2; c++) {
    const d = dbOf(pk[c]);
    x.disp[c] = Math.max(d, x.disp[c] - 30 * dt); // falls 30 dB/s
    if (d >= x.hold[c] || now - x.holdT > 1500) { x.hold[c] = Math.max(d, MIN); if (d >= x.hold[c]) x.holdT = now; }
  }
  const cv = x.meter, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return false;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = col.surface; g.fillRect(0, 0, w, h);
  const y = (db) => h * (1 - (db - MIN) / (TOP - MIN)), bw = (w - 3) / 2;
  const grad = g.createLinearGradient(0, h, 0, 0);
  for (const [db, c] of col.stops) grad.addColorStop((db - MIN) / (TOP - MIN), c);
  g.fillStyle = grad;
  for (let c = 0; c < 2; c++) {
    const x0 = 1 + c * (bw + 1), top = y(x.disp[c]);
    if (top < h) g.fillRect(x0, top, bw, h - top);
    if (x.hold[c] > MIN) g.fillRect(x0, Math.round(y(x.hold[c])), bw, 1); // peak line in the color of its level
  }
  g.fillStyle = col.line; g.fillRect(0, Math.round(y(0)), w, 1);
}

// the strips are rebuilt when tracks come, go, or change name or color (aria-labels are set at build)
function rebuild(tracks) {
  const s = tracks.map((t) => t.id + t.color + t.name).join('|');
  if (s === sig) return;
  sig = s;
  strips = new Map();
  for (const t of tracks) strips.set(t.id, strip(t));
  const m = strip(null);
  strips.set('master', m);
  inner.replaceChildren(...tracks.map((t) => strips.get(t.id).s));
  document.getElementById('mixer-master').replaceChildren(m.s);
}
const fxOn = (fx) => Object.values(fx).filter((f) => f.on).length;
// one strip's values; a control being dragged or typed in is left alone
function update(x, t) {
  const master = !t, gainDb = state.project.master.gainDb, n = fxOn(master ? state.project.master.fx : t.fx);
  x.fxb.textContent = n ? `효과 ${n}` : '효과';
  x.fxb.setAttribute('aria-pressed', String(state.ui.fxPanel && state.ui.fxTarget === C.fxKey(x.id)));
  x.fxb.setAttribute('aria-label', `${master ? '마스터' : t.name} 효과 (${n}개 켜짐)`);
  x.s.classList.toggle('active', !master && t.id === state.sel.activeTrackId);
  if (document.activeElement !== x.fader) x.fader.value = master ? gainDb : gainToDb(t.gain);
  x.dbV.textContent = master ? `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB` : dbText(t.gain);
  if (!master) {
    if (document.activeElement !== x.pan) x.pan.value = t.pan;
    x.panV.textContent = panText(t.pan);
    x.m.setAttribute('aria-pressed', String(t.mute));
    x.so.setAttribute('aria-pressed', String(t.solo));
  }
  x.clip.classList.toggle('on', engine.isClipped(meterId(x.id)));
}
function render() {
  root.hidden = !state.ui.mixer;
  if (root.hidden) { // reopening must not show levels from before it closed
    for (const x of strips.values()) { x.disp = [MIN, MIN]; x.hold = [MIN, MIN]; }
    return;
  }
  root.style.height = S.get().mixerH + 'px';
  rebuild(state.project.tracks);
  const now = performance.now(), dt = Math.min(0.1, (now - (lastT || now)) / 1000);
  lastT = now;
  const css = getComputedStyle(document.documentElement), cv = (n) => css.getPropertyValue(n);
  const col = { surface: cv('--surface'), line: cv('--line'), stops: STOPS.map(([db, n]) => [db, cv(n).trim()]) };
  for (const x of strips.values()) {
    const t = trackById(x.id), master = x.id === 'master';
    if (!master && !t) continue;
    update(x, master ? null : t);
    drawMeter(x, dt, col);
  }
}

function init() {
  root = document.getElementById('mixer');
  inner = document.getElementById('mixer-strips');
  const grip = document.getElementById('mixer-resize');
  const setH = (h) => {
    const v = Math.max(120, Math.min(Math.round(innerHeight * 0.6), h));
    root.style.height = v + 'px';
    return v;
  };
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = root.offsetHeight;
    let h = h0;
    const move = (ev) => { h = setH(h0 + y0 - ev.clientY); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', () => {
      window.removeEventListener('mousemove', move);
      S.set({ mixerH: h });
    }, { once: true });
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    S.set({ mixerH: setH(root.offsetHeight + (e.key === 'ArrowUp' ? 20 : -20)) });
  });
  inner.addEventListener('wheel', (e) => { // a vertical wheel scrolls the strips sideways, except over a slider
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.target.closest('input')) inner.scrollLeft += e.deltaY;
  }, { passive: true });
}

module.exports = { init, render };
