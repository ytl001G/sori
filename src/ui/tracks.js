// Track header column (name, M/S, delete, volume, pan). Mixer changes are live (commands.mixer).
const C = require('./commands');
const icons = require('./icons');
const { el } = require('./dialogs');
const { state, changed, trackById } = require('../core/state');

const MIN_DB = -60;
const gainToDb = (g) => (g <= 0 ? MIN_DB : Math.max(MIN_DB, 20 * Math.log10(g)));
const dbToGain = (db) => (db <= MIN_DB ? 0 : Math.pow(10, db / 20));
const dbText = (g) => (g <= 0 ? '−∞ dB' : `${gainToDb(g) >= 0 ? '+' : ''}${gainToDb(g).toFixed(1)} dB`);
const panText = (p) => (Math.abs(p) < 0.01 ? '가운데' : (p < 0 ? 'L ' : 'R ') + Math.round(Math.abs(p) * 100));

let inner, sig = '';

function nameInput(t, cur) {
  const name = el('input', { className: 'name', value: t.name, spellcheck: false });
  name.setAttribute('aria-label', '트랙 이름');
  name.onchange = () => C.mixer(t.id, { name: name.value.trim() || cur().name });
  name.onkeydown = (e) => { // Enter keeps the typed name, Escape puts the old one back
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    if (e.key === 'Escape') name.value = cur().name;
    name.blur();
  };
  return name;
}
// a small header button: a letter or an icon, a tooltip, a spoken label
function tbtn(cls, title, label, run, { text = '', icon } = {}) {
  const b = el('button', { className: 'tbtn ' + cls, type: 'button', title, textContent: text }, icon ? el('i') : null);
  if (icon) b.firstChild.dataset.icon = icon;
  b.setAttribute('aria-label', label);
  b.onclick = run;
  return b;
}
// volume and pan rows. Double click: 0 dB / center; the slider keeps focus after the click and render() skips focused
// sliders, so the thumb is moved here
function sliderRows(t) {
  const vol = el('input', { type: 'range', min: MIN_DB, max: 6, step: 0.5, value: gainToDb(t.gain), className: 'vol',
    title: '더블클릭: 0 dB' });
  vol.setAttribute('aria-label', '볼륨');
  vol.oninput = () => C.mixer(t.id, { gain: dbToGain(+vol.value) });
  vol.ondblclick = () => { vol.value = 0; C.mixer(t.id, { gain: 1 }); };
  const pan = el('input', { type: 'range', min: -1, max: 1, step: 0.01, value: t.pan, className: 'pan',
    title: '더블클릭: 가운데' });
  pan.setAttribute('aria-label', '팬');
  pan.oninput = () => C.mixer(t.id, { pan: +pan.value });
  pan.ondblclick = () => { pan.value = 0; C.mixer(t.id, { pan: 0 }); };
  return [
    el('div', { className: 'row' }, el('label', { textContent: '볼륨' }), vol,
      el('span', { className: 'val vol-v', textContent: dbText(t.gain) })),
    el('div', { className: 'row' }, el('label', { textContent: '팬' }), pan,
      el('span', { className: 'val pan-v', textContent: panText(t.pan) })),
  ];
}
function header(t) {
  const cur = () => trackById(t.id) || t; // track objects are replaced on edits; never trust the captured one
  const h = el('div', { className: 'track-h' });
  h.dataset.id = t.id;
  h.setAttribute('role', 'group'); h.setAttribute('aria-label', t.name + ' 트랙');
  h.append(el('div', { className: 'stripe' }));
  h.firstChild.style.background = t.color;
  const grip = el('div', { className: 'grip', title: '끌어서 순서 옮기기 (Ctrl+Alt+↑/↓)' }, el('i'));
  grip.firstChild.dataset.icon = 'dots-six-vertical';
  grip.addEventListener('pointerdown', (e) => dragOrder(e, h, t.id));
  const buttons = [
    tbtn('fx', '트랙 효과 (오른쪽 효과 패널)', '트랙 효과', () => C.showFx(t.id), { icon: 'sliders-horizontal' }),
    tbtn('star', '내보낼 테이크로 고르기 (★)', '내보낼 테이크로 고르기', () => C.setStar(t.id), { text: '★' }),
    tbtn('m', '음소거', '음소거', () => C.mixer(t.id, { mute: !cur().mute }), { text: 'M' }),
    tbtn('s', '솔로 (이 트랙만 듣기)', '솔로', () => C.mixer(t.id, { solo: !cur().solo }), { text: 'S' }),
    tbtn('x', '트랙 삭제', '트랙 삭제', () => C.removeTrack(t.id), { icon: 'x' }),
  ];
  h.append(el('div', { className: 'row' }, grip, nameInput(t, cur), ...buttons), ...sliderRows(t));
  const pick = () => { if (state.sel.activeTrackId !== t.id) { state.sel.activeTrackId = t.id; changed(); } };
  h.addEventListener('mousedown', (e) => { if (!e.target.closest('input, button')) pick(); });
  h.addEventListener('focusin', pick);
  return h;
}

// drag the grip: a line shows the gap the track lands in; Esc cancels. Window listeners, so a fast drag never escapes.
function dragOrder(e, h, id) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (state.sel.activeTrackId !== id) { state.sel.activeTrackId = id; changed(); }
  const n = state.project.tracks.length, from = [...inner.children].indexOf(h), lane = h.offsetHeight;
  const line = el('div', { className: 'drop-line' });
  let to = from;
  h.classList.add('dragging');
  inner.append(line); // after the headers, so render() still finds header i at children[i]
  const move = (ev) => {
    const gap = Math.max(0, Math.min(n, Math.round((ev.clientY - inner.getBoundingClientRect().top) / lane)));
    to = gap > from ? gap - 1 : gap;
    line.style.top = gap * lane + 'px';
    line.hidden = to === from;
  };
  const end = (ok) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    removeEventListener('keydown', key, true);
    line.remove(); h.classList.remove('dragging');
    if (ok && to !== from) C.moveTrack(id, to);
  };
  const up = () => end(true);
  const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); end(false); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('keydown', key, true);
  move(e);
}

function render() {
  const tracks = state.project.tracks;
  const s = tracks.map((t) => t.id + t.color).join('|');
  if (s !== sig) {
    sig = s;
    inner.replaceChildren(...tracks.map(header));
    icons.hydrate(inner);
  }
  // update live values without rebuilding (keeps focus / slider drags intact)
  const line = C.curLine();
  tracks.forEach((t, i) => {
    const h = inner.children[i];
    h.classList.toggle('active', t.id === state.sel.activeTrackId);
    h.querySelector('.m').setAttribute('aria-pressed', String(t.mute));
    h.querySelector('.s').setAttribute('aria-pressed', String(t.solo));
    h.querySelector('.star').setAttribute('aria-pressed', String(!!line && line.star === t.id));
    const fxb = h.querySelector('.fx'), n = Object.values(t.fx).filter((f) => f.on).length;
    fxb.setAttribute('aria-pressed', String(state.ui.fxPanel && state.ui.fxTarget === C.fxKey(t.id)));
    fxb.classList.toggle('has', n > 0);
    fxb.setAttribute('aria-label', `트랙 효과 (${n}개 켜짐)`);
    const name = h.querySelector('.name');
    if (document.activeElement !== name && name.value !== t.name) name.value = t.name;
    h.setAttribute('aria-label', t.name + ' 트랙');
    const vol = h.querySelector('.vol'), pan = h.querySelector('.pan');
    if (document.activeElement !== vol) vol.value = gainToDb(t.gain);
    if (document.activeElement !== pan) pan.value = t.pan;
    h.querySelector('.vol-v').textContent = dbText(t.gain);
    h.querySelector('.pan-v').textContent = panText(t.pan);
  });
  inner.style.transform = `translateY(${-state.view.scrollY}px)`;
}

function init() {
  inner = document.getElementById('headers-inner');
  const scroll = (e) => require('./timeline').scrollV(e.deltaY);
  document.getElementById('headers').addEventListener('wheel', scroll, { passive: true });
}

module.exports = { init, render, gainToDb, dbToGain, dbText, panText };
