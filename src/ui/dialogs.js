// Modal builder (fields + presets), sheet (larger panel dialog), toast, busy overlay.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
};

let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = kind; }, 3500);
}

// Runs fn(step) behind the busy overlay. The overlay fades in after 150 ms on the compositor, so it still appears
// while synchronous DSP blocks the main thread, but never flashes for quick work. A long job awaits step(done, total,
// text) between pieces of work: the bar, '42% · text' and 멈추기 (button or Esc) show; at most every 50 ms it yields a
// frame so the screen draws and a stop lands, which throws out of step and makes busy return STOPPED. So fn changes
// nothing before its last step (멈추면 아무것도 안 바뀜). Keys reach nothing else meanwhile; the overlay takes
// the mouse. shortcut: one DSP step on a long file still blocks between updates; a worker would fix that
const STOPPED = Symbol('stopped');
let busyNow = false;
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function busy(label, fn) {
  const b = $('busy'), prog = $('busy-progress'), bar = $('busy-bar');
  let stop = false, last = 0;
  const keys = (e) => { e.stopImmediatePropagation(); e.preventDefault(); if (e.key === 'Escape') stop = true; };
  const step = async (done, total, text = '') => {
    if (stop) throw STOPPED;
    const pct = Math.min(100, Math.round((100 * done) / Math.max(1, total)));
    prog.hidden = false; $('busy-fill').style.width = pct + '%'; bar.setAttribute('aria-valuenow', pct);
    $('busy-step').textContent = text ? `${pct}% · ${text}` : `${pct}%`;
    if (performance.now() - last < 50) return;
    await frame(); last = performance.now();
    if (stop) throw STOPPED;
  };
  $('busy-label').textContent = label; prog.hidden = true; $('busy-stop').onclick = () => { stop = true; };
  busyNow = true; b.hidden = false; window.addEventListener('keydown', keys, true);
  b.animate([{ opacity: 0 }, { opacity: 0, offset: 0.99 }, { opacity: 1 }], { duration: 150, fill: 'forwards' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { return await fn(step); } catch (e) { if (e === STOPPED) return STOPPED; throw e; } finally {
    busyNow = false; window.removeEventListener('keydown', keys, true);
    b.hidden = true; b.getAnimations().forEach((a) => a.cancel());
  }
}
const isBusy = () => busyNow;

const fmt = (v, step) => (step < 1 ? (+v).toFixed(String(step).split('.')[1].length) : String(Math.round(v)));

// Tab keeps focus inside the dialog
function trapTab(dlg, e) {
  const f = [...dlg.querySelectorAll('button, input, select')].filter((x) => !x.disabled && x.offsetParent !== null);
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
}
// Shows `dlg` in the modal layer with focus trap, Esc, and focus return. onKey(e) may handle a key first
// (return true). Returns close(value).
function openLayer(dlg, resolve, { onKey, onClose, onEnter } = {}) {
  const layer = $('modal-layer'), prevFocus = document.activeElement;
  const close = (v) => {
    layer.classList.remove('open'); layer.innerHTML = ''; document.removeEventListener('keydown', key, true);
    onClose && onClose();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    resolve(v);
  };
  const enter = (e) => e.key === 'Enter' && onEnter && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT';
  const key = (e) => {
    if (onKey && onKey(e)) { e.stopPropagation(); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
    else if (enter(e)) { e.preventDefault(); onEnter(e); }
    else if (e.key === 'Tab') trapTab(dlg, e);
    e.stopPropagation(); // app shortcuts stay off while a dialog is open
  };
  document.addEventListener('keydown', key, true);
  layer.innerHTML = ''; layer.append(dlg); layer.classList.add('open');
  return close;
}
function dialogBox(className, titleId) {
  const dlg = el('div', { className });
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', titleId);
  return dlg;
}

// a modal's state: values by key, setters for preset / graph changes, listeners told about every change
function form() {
  const f = { values: {}, setters: {}, listeners: [] };
  f.notify = () => f.listeners.forEach((fn) => fn());
  f.setAll = (patch) => { for (const [k, v] of Object.entries(patch)) if (f.setters[k]) f.setters[k](v); };
  return f;
}
function presetRow(presets, fm) {
  const row = el('div', { className: 'field' });
  const sel = el('select', { id: 'dlg-preset', className: 'preset' }, el('option', { value: '', textContent: '직접 조절' }),
    ...presets.map((p, i) => el('option', { value: String(i), textContent: p.name })));
  sel.onchange = () => { const p = presets[+sel.value]; if (p) fm.setAll(p.values); };
  row.append(el('label', { htmlFor: 'dlg-preset', textContent: '프리셋' }), sel);
  return row;
}
// one of the options, or (multi) any of them: the value is the list of pressed ones
function choiceInput(f, id, fm) {
  const box = el('div', { className: 'choices', id });
  const on = (v) => (f.multi ? fm.values[f.key].includes(v) : fm.values[f.key] === v);
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', f.label);
  const sync = () => f.options.forEach((o, i) => box.children[i].setAttribute('aria-pressed', String(on(o.value))));
  for (const o of f.options) {
    const b = el('button', { type: 'button' }, o.label, o.sub ? el('small', { textContent: o.sub }) : null);
    b.onclick = () => {
      const v = fm.values[f.key];
      fm.values[f.key] = !f.multi ? o.value : on(o.value) ? v.filter((x) => x !== o.value) : [...v, o.value];
      sync(); fm.notify();
    };
    box.append(b);
  }
  sync();
  return box;
}
function textInput(f, id, fm) {
  const inp = el('input', { type: 'text', id, value: f.value || '', className: 'text', maxLength: f.maxLength || 100,
    spellcheck: false });
  inp.oninput = () => { fm.values[f.key] = inp.value; };
  return inp;
}
// slider + number box, kept in step; double click on the slider: the value the dialog opened with
function rangeInput(f, id, fm) {
  const range = el('input', { type: 'range', id, min: f.min, max: f.max, step: f.step, value: f.value });
  const num = el('input', { type: 'number', min: f.min, max: f.max, step: f.step, value: fmt(f.value, f.step) });
  num.setAttribute('aria-label', f.label + (f.unit ? ` (${f.unit})` : ''));
  const set = (v) => { fm.values[f.key] = v; range.value = v; num.value = fmt(v, f.step); fm.notify(); };
  fm.setters[f.key] = set;
  range.oninput = () => { fm.values[f.key] = +range.value; num.value = fmt(range.value, f.step); fm.notify(); };
  num.onchange = () => set(Math.max(f.min, Math.min(f.max, +num.value || 0)));
  range.ondblclick = () => set(f.value);
  return [range, el('div', { className: 'num' }, num, el('span', { textContent: f.unit || '' }))];
}
function fieldRow(f, i, fm) {
  const id = 'dlg-f' + i, row = el('div', { className: 'field' });
  fm.values[f.key] = f.multi ? [...f.value] : f.value;
  row.append(el('label', { htmlFor: id, textContent: f.label }));
  if (f.options) row.append(choiceInput(f, id, fm));
  else if (f.text) row.append(textInput(f, id, fm));
  else row.append(...rangeInput(f, id, fm));
  if (f.when) { // shown only while another field has that value
    const show = () => { row.hidden = fm.values[f.when[0]] !== f.when[1]; };
    fm.listeners.push(show); show();
  }
  return row;
}
function footer(onPreview, okLabel, fm) {
  const foot = el('div', { className: 'foot' });
  if (onPreview) {
    const p = el('button', { className: 'btn', type: 'button', textContent: '미리듣기' });
    p.onclick = () => onPreview({ ...fm.values });
    foot.append(p);
  }
  const cancel = el('button', { className: 'btn', type: 'button', textContent: '취소' });
  const ok = el('button', { className: 'btn primary', type: 'button', textContent: okLabel });
  foot.append(el('div', { className: 'spacer' }), cancel, ok);
  return { foot, cancel, ok };
}

// fields: [{ key, label, min, max, step, value, unit }] | { key, label, options:[{value,label}], value } | { key,
// label, text: true, value }. Options with multi: true take a list (any pressed); when: [key, value] shows a field
// only while that field has that value
// presets: [{ name, values }] fills the fields. Resolves to values or null (cancel). onPreview(values) optional.
// extra(box, { get, set, onChange }) adds a custom editor (EQ graph) kept in sync with the fields.
function modal({ title, note, fields = [], presets, okLabel = '적용', onPreview, onClose, extra }) {
  return new Promise((resolve) => {
    const fm = form(), dlg = dialogBox('dialog', 'dlg-title');
    dlg.append(el('h2', { id: 'dlg-title', textContent: title }));
    if (note) dlg.append(el('div', { className: 'note', textContent: note }));
    if (presets && presets.length) dlg.append(presetRow(presets, fm));
    const extraBox = extra ? el('div', { className: 'extra' }) : null;
    if (extraBox) dlg.append(extraBox);
    fields.forEach((f, i) => dlg.append(fieldRow(f, i, fm)));
    const { foot, cancel, ok } = footer(onPreview, okLabel, fm);
    dlg.append(foot);
    const close = openLayer(dlg, resolve, {
      onClose,
      // commit the typed value first
      onEnter: (e) => { if (e.target.type === 'number') e.target.onchange(); close({ ...fm.values }); },
    });
    cancel.onclick = () => close(null);
    ok.onclick = () => close({ ...fm.values });
    if (extraBox) extra(extraBox, { get: () => fm.values, set: fm.setAll, onChange: (fn) => fm.listeners.push(fn) });
    (dlg.querySelector('input:not([type=range]), input') || ok).focus();
  });
}

// The app's own question window (instead of the Windows one): buttons = [{ label, value, primary }] in
// reading order. Resolves to the clicked value; Esc = null (the caller treats it as its safe choice). `yes` = the
// go-on answer that `sori live run --yes` and the smoke run give without showing it
function ask({ title, note, buttons }) {
  return new Promise((resolve) => {
    const dlg = dialogBox('dialog ask', 'ask-title');
    const foot = el('div', { className: 'foot' }, el('div', { className: 'spacer' }));
    dlg.setAttribute('role', 'alertdialog');
    dlg.append(el('h2', { id: 'ask-title', textContent: title }));
    if (note) {
      dlg.append(el('div', { className: 'note', id: 'ask-note', textContent: note }));
      dlg.setAttribute('aria-describedby', 'ask-note');
    }
    dlg.append(foot);
    const close = openLayer(dlg, resolve);
    for (const b of buttons) {
      const x = el('button', { className: b.primary ? 'btn primary' : 'btn', type: 'button', textContent: b.label });
      x.onclick = () => close(b.value);
      foot.append(x);
    }
    (foot.querySelector('.primary') || foot.lastChild).focus();
  });
}

// Larger dialog with a title bar + close button; build(body, close) fills it. Resolves on close.
function sheet({ title, build, wide = true, onKey, onClose }) {
  return new Promise((resolve) => {
    const dlg = dialogBox('dialog sheet' + (wide ? ' wide' : ''), 'sheet-title');
    const x = el('button', { className: 'icon', type: 'button', title: '닫기 (Esc)' }, el('i'));
    x.firstChild.dataset.icon = 'x'; x.setAttribute('aria-label', '닫기');
    const body = el('div', { className: 'sheet-body' });
    dlg.append(el('div', { className: 'sheet-head' }, el('h2', { id: 'sheet-title', textContent: title }), x), body);
    const close = openLayer(dlg, resolve, { onKey, onClose });
    x.onclick = () => close(null);
    build(body, close);
    require('./icons').hydrate(dlg);
    if (!body.contains(document.activeElement)) (body.querySelector('button, input, select') || x).focus();
  });
}

const isModalOpen = () => $('modal-layer').classList.contains('open');

module.exports = { toast, busy, STOPPED, isBusy, modal, ask, sheet, isModalOpen, el, fmt };
