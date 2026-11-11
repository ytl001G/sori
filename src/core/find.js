// Ctrl+F 찾기 (spec §2): what matches a search, in the order Enter walks, and where a search lands. Pure: the app's
// box (ui/panels/find.js, ui/commands/find.js) and `sori live find` share it. Text matches as a part, ignoring case,
// spaces and hyphens; a line number also without its zeros (철수 2 = 철수-002).
const SCR = require('./script');

const norm = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, '');
// '철수2' / '철수 002' -> the line 철수-002: the character's name (or its start) and the number by value
function isNumber(k, l) {
  const m = /^(\D+)0*(\d+)$/.exec(k);
  return !!m && norm(l.char).startsWith(m[1]) && Number(m[2]) === l.num;
}
// p: the project (a script project's tracks = the current line's takes); lines: a script project's lines as the
// list shows them (null otherwise); o: { clips, markers, memo } (고급). A line or track hit carries `ord`, its place
// in its list
function hits(p, q, lines, o = {}) {
  const k = norm(q), out = [];
  if (!k) return out;
  const has = (...xs) => xs.some((x) => x && norm(x).includes(k));
  if (lines) {
    lines.forEach((l, ord) => {
      const name = SCR.lineName(l);
      if (has(name, l.text, o.memo && l.memo) || isNumber(k, l)) out.push({ kind: 'line', id: l.id, ord, name });
    });
  } else p.tracks.forEach((t, ord) => { if (has(t.name)) out.push({ kind: 'track', id: t.id, ord, name: t.name }); });
  if (o.clips) {
    for (const t of p.tracks) {
      for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
        if (has(c.name)) out.push({ kind: 'clip', id: c.id, trackId: t.id, frame: c.start, name: c.name });
      }
    }
  }
  if (o.markers) {
    for (const m of [...p.markers].sort((a, b) => a.frame - b.frame)) {
      if (has(m.name)) out.push({ kind: 'marker', id: m.id, frame: m.frame, name: m.name });
    }
  }
  return out;
}
// the hit to go to: `at` = the hit the selection is on (-1: none), `ord` = the current line's / track's place in
// its list; dir 0 = typing (stay on a hit that still matches, else the first line/track from here on), 1 / -1 = Enter
// / Shift+Enter (wraps). -1 when nothing matches
function pick(hs, at, ord, dir) {
  const n = hs.length;
  if (!n) return -1;
  if (at >= 0) return (at + dir + n) % n;
  const i = Math.max(0, hs.findIndex((h) => h.ord !== undefined && h.ord >= ord));
  return dir < 0 ? (i - 1 + n) % n : i;
}

module.exports = { hits, pick };
