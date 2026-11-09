// 목소리 정리: the noise floor from the quietest 0.5 s, the voice cleanup steps (one
// strength word each: low | mid | high = 약하게 · 보통 · 강하게, for loudness 작게 · 보통 · 크게) and the de-esser / hum
// filters the effect panel shares. Pure, no DOM.
const E = require('./edit');
const FX = require('./effects');
const P = require('./fxparams');
const LD = require('./loudness');

const LEVELS = ['low', 'mid', 'high'];
const at = (level, list) => list[LEVELS.indexOf(level)];
const preset = (kind, level) => P.PRESETS[kind].find((x) => x.name === at(level, ['약하게', '보통', '강하게'])).values;
const dbOf = (ms) => 10 * Math.log10(ms + 1e-12);

// ---- levels and the noise floor ----
// mean square of each block of B frames (channels averaged)
function blockPower(ch, B) {
  const n = Math.floor(ch[0].length / B), out = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (const c of ch) for (let i = b * B; i < (b + 1) * B; i++) s += c[i] * c[i];
    out[b] = s / (B * ch.length);
  }
  return out;
}
const SILENT = -100; // dBFS: digital silence (gaps between clips), not the room
const QUIET_GAP = 20; // dB the quietest 0.5 s must sit under the loud part (90th percentile) to count as noise
// the quietest 0.5 s with sound in all of it (50 ms steps): { start, len, db, loud } in frames (loud = the speech
// level, 90th percentile window, -Infinity when unknown). A window touching digital
// silence is left out (half room noise, half zeros measured the floor 26 dB low on a real take);
// digital silence only when nothing else is quiet; null when the piece is shorter than 0.5 s or never goes quiet
function windows(ch, sr) {
  const B = Math.round(0.01 * sr), W = 50, pw = blockPower(ch, B), wins = [];
  const zero = Uint8Array.from(pw, (z) => dbOf(z) <= SILENT);
  for (let s = 0; s + W <= pw.length; s += 5) {
    let z = 0, k = 0;
    for (let b = s; b < s + W; b++) { z += pw[b]; k += zero[b]; }
    wins.push({ start: s * B, len: W * B, db: dbOf(z / W), empty: k });
  }
  const heard = wins.filter((w) => !w.empty);
  const loud = heard.length ? heard.map((w) => w.db).sort((x, y) => x - y)[Math.floor(heard.length * 0.9)] : -Infinity;
  return { W, wins, heard, loud };
}
// the speech level alone (90th percentile 0.5 s window), also when quietest() finds no floor; -Infinity when unknown
const speechDb = (ch, sr) => windows(ch, sr).loud;
function quietest(ch, sr) {
  const { W, wins, heard, loud } = windows(ch, sr);
  if (heard.length) {
    const q = heard.reduce((m, w) => (w.db < m.db ? w : m));
    if (loud - q.db >= QUIET_GAP) return { ...q, loud };
  }
  const still = wins.find((w) => w.empty === W);
  return still ? { ...still, db: SILENT, loud } : null;
}
const OPEN_DB = 8; // a block is sound ('말') this far above the floor
const BREATH_DB = 20; // ... and at most this far under the speech level: breaths count as quiet
// the level (dB, 10 ms blocks) from which a block is sound, for a quietest() result
const soundDb = (q) => Math.max(q.db + OPEN_DB, q.loud - BREATH_DB);
// at the start and end of a recording breaths and soft word ends are sound too, but a fading tail or room sound
// EDGE_DB under the speech is quiet. No floor to measure (q null): the speech level alone; not
// even that (shorter than 0.5 s, no sound): QUIET_DB
const EDGE_DB = 35, QUIET_DB = -60;
const known = (x) => Number.isFinite(x);
const edgeDb = (q, loud) => Math.max(q ? q.db + OPEN_DB : -Infinity, known(loud) ? loud - EDGE_DB : QUIET_DB);
const talkDb = (q, loud) => (q ? soundDb(q) : known(loud) ? loud - BREATH_DB : QUIET_DB);
// per block of B frames: 1 = sound (at or over `th` dB), 0 = quiet
function openBlocks(ch, B, th) {
  const pw = blockPower(ch, B);
  return Uint8Array.from(pw, (z) => (dbOf(z) >= th ? 1 : 0));
}

// ---- de-esser: a Linkwitz-Riley split at `freq` (the two bands stay in phase, so turning one down never cancels);
// the high band goes down while it is nearly as loud as the whole sound ('ㅅ'), up to `amount` dB. worklets.js
// Deess runs the same rule live. ----
const DEESS = { start: -12, full: -3, floor: -50, attack: 1, release: 60 }; // dB, dB, dBFS, ms, ms
function deessGain(eh, ef, amount) {
  if (ef < 10 ** (DEESS.floor / 20)) return 1;
  const d = 20 * Math.log10((eh + 1e-9) / (ef + 1e-9));
  const t = Math.max(0, Math.min(1, (d - DEESS.start) / (DEESS.full - DEESS.start)));
  return 10 ** (-amount * t / 20);
}
const lr = (type, c, freq, sr) => {
  const s = FX.biquad(type, freq, sr, { q: Math.SQRT1_2 });
  return FX.runBiquad(FX.runBiquad(c, s), s);
};
function deess(ch, sr, { amount = 6, freq = 5000 }) {
  const hi = ch.map((c) => lr('highpass', c, freq, sr)), lo = ch.map((c) => lr('lowpass', c, freq, sr));
  const n = ch[0].length;
  const ca = Math.exp(-1 / (sr * DEESS.attack / 1000)), cr = Math.exp(-1 / (sr * DEESS.release / 1000));
  const out = ch.map(() => new Float32Array(n));
  let eh = 0, ef = 0;
  for (let i = 0; i < n; i++) {
    let h = 0, x = 0;
    for (let k = 0; k < ch.length; k++) { h = Math.max(h, Math.abs(hi[k][i])); x = Math.max(x, Math.abs(ch[k][i])); }
    eh = h > eh ? ca * eh + (1 - ca) * h : cr * eh + (1 - cr) * h;
    ef = x > ef ? ca * ef + (1 - ca) * x : cr * ef + (1 - cr) * x;
    const g = deessGain(eh, ef, amount);
    for (let k = 0; k < ch.length; k++) out[k][i] = lo[k][i] + g * hi[k][i];
  }
  return out;
}

// ---- mains hum: narrow notches on 50 or 60 Hz and its first `count` multiples (chain.js builds the same live) ----
const HUM_Q = 30;
const humFreqs = (sr, { freq, count }) => Array.from({ length: count }, (_, h) => freq * (h + 1))
  .filter((f) => f < sr * 0.45);
const hum = (ch, sr, p) => {
  const st = humFreqs(sr, p).map((f) => FX.biquad('notch', f, sr, { q: HUM_Q }));
  return ch.map((c) => st.reduce((x, s) => FX.runBiquad(x, s), c.slice()));
};
function goertzel(x, from, to, sr, f) {
  const c = 2 * Math.cos(2 * Math.PI * f / sr);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
// 50 or 60 Hz, whichever carries more (fundamental + 2 multiples, 1 s blocks over the first 30 s)
function humFreq(ch, sr) {
  const n = Math.min(ch[0].length, Math.round(30 * sr)), B = Math.round(sr);
  const power = (f) => {
    let s = 0;
    for (let a = 0; a < n; a += B) for (const h of [1, 2, 3]) s += goertzel(ch[0], a, Math.min(n, a + B), sr, f * h);
    return s;
  };
  return power(50) > power(60) ? 50 : 60;
}

// 전기 웅 소리 turned on in the effect panel: listen once to the first lane with sound (30 s from its first clip);
// null = none
function heardHum(lanes, sr) {
  const t = lanes.find((x) => x && x.clips.length);
  if (!t) return null;
  const from = Math.min(...t.clips.map((c) => c.start));
  return humFreq(E.renderRegion(t.clips, from, Math.min(E.projectEnd([t]), from + Math.round(30 * sr))), sr);
}

// ---- 작은 잡음 끄기: quiet blocks (5 ms) go down by `depth` dB (-Infinity = silent); opens 5 ms early, holds 100 ms,
// opens over 2 ms and closes over 80 ms (straight ramps, so 완전히 really reaches silence) ----
function gateTarget(open, closed) {
  const t = new Float32Array(open.length);
  let last = -Infinity;
  for (let b = 0; b < open.length; b++) {
    if (open[b] || open[b + 1]) last = b;
    t[b] = b - last <= 20 ? 1 : closed;
  }
  return t;
}
function gate(ch, sr, { sound, depth }) {
  const B = Math.round(0.005 * sr), n = ch[0].length, closed = 10 ** (depth / 20); // -Infinity dB -> 0
  const target = gateTarget(openBlocks(ch, B, sound), closed), tail = target.length ? target[target.length - 1] : 1;
  const up = 1 / (sr * 0.002), down = 1 / (sr * 0.08), g = new Float32Array(n);
  let v = target.length ? target[0] : 1;
  for (let i = 0; i < n; i++) {
    const want = i < target.length * B ? target[Math.floor(i / B)] : tail;
    v = want > v ? Math.min(want, v + up) : Math.max(want, v - down);
    g[i] = v;
  }
  return ch.map((c) => c.map((x, i) => x * g[i]));
}

// ---- the steps: (ch, sr, level) -> new audio of the same length, or null when it cannot measure ----
const STEPS = {
  hum: (ch, sr, lv) => hum(ch, sr, { freq: humFreq(ch, sr), count: preset('hum', lv).count }),
  noise(ch, sr, lv) {
    const q = quietest(ch, sr);
    if (!q) return null;
    if (q.db <= SILENT) return ch.map((c) => c.slice()); // pauses of digital silence: no noise to take out
    const profile = FX.noiseProfile(ch.map((c) => c.subarray(q.start, q.start + q.len)));
    return FX.noiseReduce(ch, sr, { ...preset('noise', lv), profile });
  },
  gate(ch, sr, lv) {
    const q = quietest(ch, sr);
    return q && gate(ch, sr, { sound: soundDb(q), depth: at(lv, [-10, -20, -Infinity]) });
  },
  lowcut: (ch, sr, lv) => FX.eq(ch, sr, { lowcut: at(lv, [60, 80, 100]) }),
  even: (ch, sr, lv) => FX.compressor(ch, sr,
    P.PRESETS.comp.find((x) => x.name === at(lv, ['부드럽게', '목소리 고르게', '팟캐스트'])).values),
  deess: (ch, sr, lv) => deess(ch, sr, preset('deess', lv)),
  loud: (ch, sr, lv) => LD.toLoudness(ch, sr, at(lv, [-23, -16, -14])),
};
// 한 번에 깔끔하게: its rows in processing order and the values it always opens with (no memory: a button always does
// the same); the CLI's defaults too
const CLEAN = { noise: 'mid', lowcut: 'mid', even: 'mid', gaps: 'mid', loud: 'mid' };
// 긴 침묵 줄이기: a pause between speech longer than `over` s keeps `keep` s; the start and end pauses become exactly
// `keep` s, measured to the last sound heard, breaths too (voicedit.js, each track on its own)
const GAPS = { low: { over: 1.5, keep: 1 }, mid: { over: 1, keep: 0.5 }, high: { over: 0.7, keep: 0.3 } };
const LABELS = {
  noise: '잡음 줄이기', lowcut: '저음 정리', even: '목소리 고르게', gaps: '긴 침묵 줄이기', loud: '음량 맞추기',
  deess: '치찰음 줄이기', hum: '전기 웅 소리 지우기', gate: '작은 잡음 끄기',
};
const WHY = { loud: '소리가 너무 짧거나 작아서' }; // the others: '조용한 부분이 없어서'
const skipNote = (k) => `${LABELS[k]}는 건너뛰었어요 — ${WHY[k] || '조용한 부분이 없어서'}`;

module.exports = {
  LEVELS, STEPS, CLEAN, GAPS, LABELS, DEESS, HUM_Q, skipNote, quietest, speechDb, soundDb, edgeDb, talkDb, openBlocks,
  deess, deessGain, hum, humFreqs, humFreq, heardHum, gate, SILENT,
};
