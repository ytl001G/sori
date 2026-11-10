// Project -> plain JSON for the AI command line (`sori info`, `sori live state`). Times in seconds
// (0.1 ms) next to exact frames; tracks, clips and markers are numbered from 1 in array order.
const P = require('./fxparams');
const { clipEnd, projectEnd } = require('./edit');
const SC = require('./script');

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const db = (g) => (g > 0 ? r4(20 * Math.log10(g)) : null); // null = silent
const fx = (kind, v) => ({ ...v, preset: P.matchPreset(kind, v) });
const chain = (kinds, c) => Object.fromEntries(kinds.map((k) => [k, fx(k, c[k])]));

// a clip as sori info shows it (s: frames -> seconds)
const clipInfo = (s) => (c, k) => ({
  index: k + 1, name: c.name, start: s(c.start), end: s(clipEnd(c)), length: s(c.length),
  startFrame: c.start, lengthFrames: c.length, volumeDb: db(c.gain ?? 1),
  fadeIn: s(c.fadeIn || 0), fadeOut: s(c.fadeOut || 0),
  fadeInShape: c.fadeInShape || 'linear', fadeOutShape: c.fadeOutShape || 'linear',
  channels: c.src.channels || c.src.ch.length,
});

function describe(p) {
  const s = (f) => r4(f / p.sampleRate);
  return {
    sampleRate: p.sampleRate, length: s(projectEnd(p.tracks)), lengthFrames: projectEnd(p.tracks),
    bpm: p.bpm, beats: p.beats, grid: p.grid,
    master: { gainDb: p.master.gainDb, fx: chain(P.MASTER_KINDS, p.master.fx) },
    markers: p.markers.map((m, i) => ({ index: i + 1, name: m.name, at: s(m.frame), frame: m.frame })),
    tracks: p.tracks.map((t, i) => ({
      index: i + 1, name: t.name, color: t.color, volumeDb: db(t.gain), gain: t.gain, pan: t.pan,
      mute: t.mute, solo: t.solo,
      length: s(projectEnd([t])), fx: chain(P.TRACK_KINDS, t.fx),
      clips: t.clips.map(clipInfo(s)),
    })),
  };
}

// a script project (대본 녹음 모드, `sori script info`, `live state`): lines in list order with their takes by name
// (clips numbered as in info, for --line NAME --take N --clip K).
// state: 'redo' = 다시 녹음 필요
function describeScript(p) {
  const s = (f) => r4(f / p.sampleRate), sc = p.script, lines = SC.linesNow(p);
  const cur = lines.find((l) => l.id === sc.lineId);
  return {
    current: cur ? SC.lineName(cur) : null,
    progress: { done: lines.filter(SC.isDone).length, lines: lines.length },
    // the characters with lines, in script order (the app's tabs; a saved file keeps only these too)
    characters: [...new Set(lines.map((l) => l.char))].map((name) => [name, sc.chars[name]]).map(([name, c]) => ({
      name, color: c.color, done: lines.filter((l) => l.char === name && SC.isDone(l)).length,
      lines: lines.filter((l) => l.char === name).length, fx: chain(P.TRACK_KINDS, c.fx),
    })),
    lines: lines.map((l) => ({ name: SC.lineName(l), char: l.char, num: l.num, text: l.text, memo: l.memo,
      state: l.state === 'redo' ? l.state : null, done: SC.isDone(l), star: (SC.starTake(l) || {}).name || null,
      takes: l.takes.map((t) => ({
        name: t.name, length: s(projectEnd([t])), star: t.id === l.star, volumeDb: db(t.gain), pan: t.pan,
        clips: t.clips.map(clipInfo(s)),
      })),
    })),
  };
}

module.exports = { describe, describeScript };
