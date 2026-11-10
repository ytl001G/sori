// Script projects (대본 녹음 모드): a line's takes are its lanes, as on the app's timeline. The verbs that
// work on tracks (clip, range, apply, import, fx; `takes: true`) run on them with --line NAME; --take / --to-take
// stand where --track / --to-track do (take names or name numbers, not positions) and the reply names takes.
// What takes do not have (track add / remove / move, M/S) stays refused; their own commands are `script take ...`.
const SC = require('../core/script');
const { fail, linesOf, lineOf, takeOf, charOf, putChar, putLines, lineInfo } = require('./project');

// --line, and --take / --to-take in the shape of --track / --to-track.
// shortcut: lists split at commas, so a take renamed with a comma in it cannot be named in a --take list (clip split,
// range, apply); single --take flags take it whole. Quote-aware lists if such names show up.
const takeFlags = (flags) => ({
  ...flags, line: 'str', take: flags.track === 'idxs' ? 'list' : 'str', ...(flags['to-track'] && { 'to-take': 'str' }),
});

// apply on several lines' ★ takes (apply.js applyLines): --line A,B, --char or --all-lines
// shortcut: a line name with a comma in it reads as a list; add quoting if a script ever needs such a name
const many = (o) => o.char !== undefined || !!o['all-lines'] || String(o.line ?? '').includes(',');

function check(c, script) {
  const has = (k) => c.o[k] !== undefined;
  if (!script) {
    if (has('line') || has('take') || has('to-take') || many(c.o)) {
      fail('NOT_SCRIPT', '--line / --take are for script projects; this project has tracks: use --track');
    }
    return;
  }
  if (has('track') || has('to-track')) {
    fail('BAD_ARG', 'a script project has takes, not tracks: use --line NAME --take N (--to-take M)');
  }
  const line = has('line') || many(c.o);
  if (c.o.master && (line || has('take'))) fail('BAD_ARG', 'give either --line NAME --take N or --master');
  if (!line && !c.o.master) fail('BAD_ARG', 'in a script project give --line NAME: its takes are the lanes');
}

// the reply as for tracks, with takes named; fx on a take is its character's (the app's effect panel)
function named(v, takes, l) {
  const nm = (n) => (takes[n - 1] || {}).name;
  if (Array.isArray(v)) return v.map((x) => named(x, takes, l));
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => {
    if (k === 'track' && typeof x === 'number') return ['take', nm(x)];
    if (k === 'tracks' && Array.isArray(x)) return ['takes', x.map(nm)];
    if (k === 'split' && Array.isArray(x)) return [k, x.map(nm)];
    if (k === 'target' && typeof x === 'number') return ['char', l.char];
    return [k, named(x, takes, l)];
  }));
}
function renamed(e, takes) {
  e.message = e.message.replace(/--to-track\b/g, '--to-take').replace(/--track\b/g, '--take')
    .replace(/\btrack (\d+)/g, (_, n) => (takes[n - 1] ? takes[n - 1].name : 'take ' + n))
    .replace(/\btracks\b/g, 'takes');
  return e;
}

// run a track verb on the takes of --line, then put them back: new lanes (import) are new takes (테이크 n; a line
// without ★ gets the first, like script take add), an effect changed on a take is the character's
async function inTakes(c, run) {
  const lines = linesOf(c), l = lineOf(c, c.o.line), ch = charOf(c, l.char), o = c.o;
  const view = l.takes.map((t) => SC.takeView(t, ch));
  const pos = (ref) => view.indexOf(takeOf({ ...l, takes: view }, ref)) + 1;
  if (o.take !== undefined) o.track = Array.isArray(o.take) ? o.take.map(pos) : pos(o.take);
  if (o['to-take'] !== undefined) o['to-track'] = pos(o['to-take']);
  c.p.tracks = view;
  let res;
  try { res = await run(c); } catch (e) { throw renamed(e, view); }
  const had = new Set(l.takes.map((t) => t.id)), fx = c.p.tracks.find((t) => had.has(t.id) && t.fx !== ch.fx);
  const look = fx ? { ...ch, fx: fx.fx } : ch;
  if (fx) putChar(c, l.char, look);
  const takes = [];
  for (const t of c.p.tracks) takes.push(SC.takeView(had.has(t.id) ? t : { ...t, name: SC.nextTakeName(takes) }, look));
  const first = takes.find((t) => !had.has(t.id));
  const next = { ...l, takes, ...(!l.star && first && SC.withStar(first.id)) };
  putLines(c, lines.map((x) => (x.id === l.id ? next : x)));
  return { line: lineInfo(c, next), ...named(res, takes, l) };
}

module.exports = { takeFlags, check, inTakes, many };
