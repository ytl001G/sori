// `sori live settings`: everything the app remembers (the 설정 window, metronome, snap, mixer, effects
// panel, mixer height, the next fade's shape), checked like the window (choices must match, numbers clamped to their
// range), and the window's buttons: 자동 측정 (--latencyMs auto), 마이크 테스트 (--mic-test SEC), 단축키 바꾸기 /
// 기본값 (--key CMD=KEY|default, --keys default), 최근 파일 목록 지우기 (--recent clear, or one PATH).
const engine = require('../audio/engine');
const MIC = require('../audio/mic');
const C = require('./commands');
const S = require('../core/settings');
const K = require('../core/shortcuts');
const KUI = require('./keysui');
const { autoLatency } = require('./audiotab');
const { state } = require('../core/state');

const bad = (message) => ({ ok: false, error: 'BAD_ARG', message });
const RECORDING = {
  ok: false, error: 'RECORDING', message: 'the app is recording; stop it first (sori live run record)',
};
const VALUES = Object.keys(S.DEFAULTS).filter((k) => k !== 'keys' && k !== 'recent');

// the window's buttons -> act; an error message, or null
function readAction(k, s, act) {
  if (k === 'latencyMs' && s === 'auto') { act.measure = true; return null; }
  if (k === 'mic-test') {
    if (!(Number(s) >= 1 && Number(s) <= 10)) return '--mic-test needs 1 to 10 seconds';
    act.mic = Number(s); return null;
  }
  if (k === 'key') {
    const m = /^(\w+)=(.+)$/.exec(s);
    if (!m || !KUI.commandList().includes(m[1])) {
      return '--key needs COMMAND=KEY or COMMAND=default, with a command from "shortcuts" (sori live settings)';
    }
    const key = m[2] === 'default' ? m[2] : K.parseKey(m[2]);
    if (!key) {
      return `--key ${m[2]}: not a key; like Ctrl+S, Shift+F5, Alt+ArrowLeft, Space (not Tab, Enter or Esc: the app `
        + 'uses them for buttons)';
    }
    act.key = [m[1], key]; return null;
  }
  if (k === 'keys') { act.keys = true; return s === 'default' ? null : '--keys takes only default (단축키 모두 기본값으로)'; }
  if (s !== 'clear' && !S.get().recent.includes(s)) return '--recent takes clear or a path from "recent"';
  act.recent = s;
  return null;
}
const ACTIONS = ['mic-test', 'key', 'keys', 'recent'];

// one remembered value, as the window would take it; an error message, or null
function readValue(k, s, ids, patch) {
  if (!VALUES.includes(k)) return `unknown setting --${k}; settings: ${VALUES.join(', ')}; and ${ACTIONS.join(', ')}`;
  const d = S.DEFAULTS[k];
  let v = s;
  if (typeof d === 'boolean') v = s === 'on' ? true : s === 'off' ? false : undefined;
  if (typeof d === 'number') v = s.trim() === '' ? NaN : Number(s);
  if (v === undefined || (typeof d === 'number' && !Number.isFinite(v))) {
    return `--${k} needs ${typeof d === 'boolean' ? 'on or off' : 'a number'}`;
  }
  if (ids[k] && v && !ids[k].some((x) => x.deviceId === v)) {
    return `--${k}: no such device (see devices; "" = the Windows default)`;
  }
  const got = S.validate({ [k]: v })[k];
  if (S.ONE_OF[k] && got !== v) return `--${k} must be one of: ${S.ONE_OF[k].join(', ')}`;
  patch[k] = got;
  return null;
}

// --key / --keys default / --recent: what the buttons do
function applyButtons(act, out) {
  if (act.keys) S.set({ keys: {} });
  if (act.key) {
    const [cmd, key] = act.key, over = { ...S.get().keys };
    if (key === 'default') { delete over[cmd]; S.set({ keys: over }); } else {
      const r = K.rebind(over, cmd, key);
      S.set({ keys: r.keys });
      if (r.from) out.keyTakenFrom = r.from;
    }
  }
  if (act.recent === 'clear') S.set({ recent: [] });
  else if (act.recent) S.removeRecent(act.recent);
}

function report(out, devs) {
  const cur = S.get(), dev = (l) => l.map((x) => ({ id: x.deviceId, name: x.label }));
  const shortcuts = KUI.commandList().map((c) => ({
    command: c, label: C.cmds[c].label.replace('…', ''), keys: K.keysFor(c), ...(cur.keys[c] && { changed: true }),
  }));
  const settings = Object.fromEntries(VALUES.map((k) => [k, cur[k]]));
  return { ok: true, ...out, settings, devices: { inputs: dev(devs.inputs), outputs: dev(devs.outputs) },
    recent: cur.recent, shortcuts };
}

async function settings(set) {
  let devs = { inputs: [], outputs: [] };
  try { devs = await MIC.listDevices(); } catch { /* no media devices */ }
  const ids = { inputId: devs.inputs, outputId: devs.outputs }, patch = {}, act = {}, out = {};
  for (const [k, raw] of Object.entries(set && typeof set === 'object' ? set : {})) {
    const s = String(raw), button = ACTIONS.includes(k) || (k === 'latencyMs' && s === 'auto');
    const why = button ? readAction(k, s, act) : readValue(k, s, ids, patch);
    if (why) return bad(why);
  }
  if (act.key && act.keys) return bad('give --key or --keys default, not both');
  if ((act.measure || act.mic) && state.recording) return RECORDING;
  // app.js applies them (theme, zoom, speaker, panels, metronome …) like the window
  if (Object.keys(patch).length) S.set(patch);
  const applied = Object.keys(patch).length ? { applied: Object.keys(patch) } : {};
  const failed = (error, message) => ({ ok: false, error, message, ...applied });
  applyButtons(act, out);
  if (act.measure) {
    out.measuredMs = await autoLatency(); // the app's toast says what happened
    if (out.measuredMs == null) {
      return failed('NOT_HEARD', 'the mic did not hear the 4 clicks: speaker volume up, mic near the speaker, '
        + 'no headphones; then run it again');
    }
  }
  if (act.mic) {
    out.micTest = await micTest(act.mic);
    if (!out.micTest) {
      return failed('NO_MIC', 'the mic could not be opened (see devices; Windows privacy settings > microphone)');
    }
  }
  return report(out, devs);
}

// 마이크 테스트 as numbers for `sec` seconds: peakDb = the loudest meter report (every ~21 ms, so short sounds
// count), avgDb = the window's meter sampled every 50 ms; null when the mic will not open.
// shortcut: stops a test running in an open settings window (its meter then stays at 0 until pressed again); rare.
async function micTest(sec) {
  let fellBack;
  try { fellBack = await MIC.startInputTest(S.get().inputId, S.get().recChannels); } catch { return null; }
  engine.resetClip('input'); // and the held peak
  const db = [], end = Date.now() + sec * 1000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    const [l, r] = engine.level('input');
    db.push(20 * Math.log10(Math.max(l, r, 1e-6)));
  }
  const clipped = engine.isClipped('input'), peak = engine.heldPeak('input'), r1 = (x) => Math.round(x * 10) / 10;
  MIC.stopInputTest();
  const peakDb = r1(20 * Math.log10(Math.max(peak, 1e-6))), avgDb = r1(db.reduce((a, b) => a + b, 0) / db.length);
  return { seconds: sec, peakDb, avgDb, clipped, ...(fellBack && { fellBack: true }) };
}

module.exports = { settings, RECORDING };
