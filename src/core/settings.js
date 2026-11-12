// App settings: validated, stored in localStorage (per-user, survives updates).
// Settings are not part of a project. Listeners get (settings, changedKeys).

const DEFAULTS = {
  inputId: '', outputId: '', recChannels: 1, latencyMs: 0,
  countIn: 0, follow: true, stopReturn: true, metroVol: 70,
  autosaveMin: 2, exportFormat: 'wav16', sampleRate: 48000, undoOnlyGB: 0.5,
  theme: 'dark', zoom: 100, laneH: 96, keys: {},
  recent: [], mixer: false, mixerH: 220, fxPanel: false, metronome: false, snap: true, lines: true,
};
const ONE_OF = {
  recChannels: [1, 2], countIn: [0, 1, 2], autosaveMin: [0, 1, 2, 5, 10],
  exportFormat: ['wav16', 'wav24', 'mp3_128', 'mp3_192', 'mp3_320'], sampleRate: [44100, 48000],
  undoOnlyGB: [0.5, 1, 1.5, 3], theme: ['dark', 'light'], zoom: [90, 100, 110, 125], laneH: [64, 96, 128],
};
// undoOnlyGB: was undoGB, which also counted the project's own sound; a new key so everyone
// starts at 0.5
const RANGE = { latencyMs: [0, 500], metroVol: [0, 100], mixerH: [120, 600] };
const KEY_RE = /^(Ctrl\+)?(Shift\+)?(Alt\+)?[A-Za-z0-9]+$/;

function validate(o) {
  const s = { ...DEFAULTS };
  if (!o || typeof o !== 'object') return s;
  for (const k of Object.keys(DEFAULTS)) {
    const v = o[k], d = DEFAULTS[k];
    if (v === undefined) continue;
    if (ONE_OF[k]) { if (ONE_OF[k].includes(v)) s[k] = v; }
    else if (RANGE[k]) { if (Number.isFinite(v)) s[k] = Math.max(RANGE[k][0], Math.min(RANGE[k][1], Math.round(v))); }
    else if (typeof d === 'boolean') s[k] = !!v;
    else if (typeof d === 'string') { if (typeof v === 'string' && v.length < 512) s[k] = v; }
    else if (k === 'recent') { if (Array.isArray(v)) s.recent = v.filter((p) => typeof p === 'string').slice(0, 8); }
    else if (k === 'keys' && v && typeof v === 'object') {
      s.keys = {};
      const ok = (x) => typeof x === 'string' && KEY_RE.test(x);
      for (const [cmd, ks] of Object.entries(v)) if (Array.isArray(ks)) s.keys[cmd] = ks.filter(ok).slice(0, 4);
    }
  }
  return s;
}

const STORE = 'sori-settings';
let cur = { ...DEFAULTS };
const listeners = new Set();

function load() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw) { const th = localStorage.getItem('sori-theme'); if (th) raw = { theme: th }; } // 0.1 kept only the theme
  } catch { /* storage unavailable or corrupt: defaults */ }
  cur = validate(raw);
  return cur;
}
function set(patch) {
  const next = validate({ ...cur, ...patch });
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
  if (!changed.length) return;
  cur = next;
  try { localStorage.setItem(STORE, JSON.stringify(cur)); } catch { /* not remembered, still applied */ }
  for (const f of listeners) f(cur, changed);
}
const get = () => cur;
const onChange = (f) => listeners.add(f);

function addRecent(p) { set({ recent: [p, ...cur.recent.filter((x) => x !== p)].slice(0, 8) }); }
function removeRecent(p) { set({ recent: cur.recent.filter((x) => x !== p) }); }

module.exports = { DEFAULTS, ONE_OF, validate, load, set, get, onChange, addRecent, removeRecent };
