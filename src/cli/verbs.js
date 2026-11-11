// `sori` file commands: load a .vproj, apply one edit with the same rules as the app (commands.js), save it
// atomically. Pure edits run in plain Node; `audio` verbs (import = decode, export = mixdown) need Web Audio
// and run in a hidden Electron window (src/cli/headless.js), which calls `execute` with an `audio` object.
// The commands: tracks.js, clips.js, lines.js; the project they work on: project.js; the app's rules: recipes.js.
const fs = require('fs');
const path = require('path');
const A = require('../core/args');
const { fail, load, kind, packAhead, save } = require('./project');
const { TRACK_TYPES, APPLY } = require('./recipes');
const scope = require('./scope');

// a verb: { name, usage, about, args (positionals), rest, flags, need, open (takes --FIELD values), write (saves),
// audio (needs Web Audio), script (true: script projects only, 'any': both), creates, live (refused there: use),
// takes (works on a script project's takes too: scope.js), lines (runs instead on several lines: scope.many), use (the
// script command to use instead) }
// batch.js runs the other verbs (required when run: it needs this module)
const BATCH = {
  name: 'batch', usage: 'batch <project> <commands.txt|-> [--check]', args: ['project', 'file'],
  flags: { check: 'bool' }, script: 'any', write: true, run: (c) => require('./batch').run(c),
  about: 'many commands, one per line as for sori live (no <project>; # starts a note; - reads them from stdin): all '
    + 'are checked first, run in order, and saved only if every one succeeds (live: one undo step). Each reports '
    + 'what it touches; waves = the lines that could run at the same time. --check runs nothing. Not in a batch: '
    + 'new, export, script export',
};
// --track / --to-track take a number or a name (resolved in execute, once the project is loaded)
const NAMED = { idx: 'trk', idxs: 'trks' }, TRACK_KEYS = ['track', 'to-track'];
const TRACK_USE = /--(to-)?track (N|M)\b/g; // usage: --track N -> --track N|NAME
const named = (flags) => Object.fromEntries(Object.entries(flags || {})
  .map(([k, t]) => [k, TRACK_KEYS.includes(k) && NAMED[t] ? NAMED[t] : t]));
const VERBS = [...require('./tracks').VERBS, ...require('./clips').VERBS, ...require('./lines').VERBS,
  ...require('./split').VERBS, ...require('./measure').VERBS, BATCH]
  .map((v) => (v.takes ? { ...v, script: 'any', flags: scope.takeFlags(v.flags) } : v))
  .map((v) => ({ ...v, flags: named(v.flags), usage: v.usage.replace(TRACK_USE, '--$1track $2|NAME') }));
// track names -> numbers in the project's order (a script project's lanes are takes: --take there)
function trackNames(o, p) {
  if (!p || p.script) return; // a new project has no tracks yet
  for (const k of TRACK_KEYS) {
    const no = (r) => A.trackNo(p.tracks, r, k);
    if (o[k] !== undefined) o[k] = Array.isArray(o[k]) ? o[k].map(no) : no(o[k]);
  }
}
const PATHS = new Set(['project', 'out', 'files', 'file']); // positionals resolved against the caller's folder

// the command argv starts with (longest name first), or null
const verbOf = (argv) => [3, 2, 1].map((k) => VERBS.find((v) => v.name === argv.slice(0, k).join(' '))).find(Boolean)
  || null;
// a mistyped command -> the closest name with as many words (`more`: other names, e.g. the live ones). A name is
// compared without its "live ": sori state (live left out) -> "live state"; a file command comes first
function guess(argv, more = []) {
  const names = [...VERBS.map((v) => v.name), ...more], bare = (n) => n.replace(/^live /, '');
  return [3, 2, 1].map((k) => {
    const of = names.filter((n) => bare(n).split(' ').length === k);
    const hit = A.near(argv.slice(0, k).join(' '), of.map(bare));
    return hit && of.find((n) => bare(n) === hit);
  }).find(Boolean);
}
// argv -> { verb, pos, at (argv index of each positional), o, f } or a BAD_ARG / UNKNOWN_COMMAND error (with usage).
// live: `sori live <command>` names no <project> (it is the one open in the app), so an empty one stands in; `more`:
// the live commands, for the guess at a mistyped one.
function parse(argv, live = false, more = []) {
  const verb = verbOf(argv);
  if (!verb) {
    const g = guess(argv, more), hint = g ? `; did you mean "${g}"?` : '';
    fail('UNKNOWN_COMMAND', `unknown command "${argv.slice(0, 2).join(' ')}"${hint} Run sori --help (or sori help `
      + 'COMMAND)');
  }
  try {
    const skip = verb.name.split(' ').length;
    const { pos, at, o, fields } = A.parse(argv.slice(skip), verb.flags || {}, verb.open);
    if (live) pos.unshift('');
    const n = verb.args.length;
    if (pos.length < n || (!verb.rest && pos.length > n) || (verb.rest && pos.length === n)) {
      const why = live ? ' (no <project>: sori live works on the project open in the app)' : '';
      throw A.bad('wrong number of arguments' + why);
    }
    const given = (k) => o[k] !== undefined || (verb.takes && k === 'track' && o.take !== undefined);
    for (const k of verb.need || []) if (!given(k)) throw A.bad(`--${k} is required`
      + (verb.takes && k === 'track' ? ' (a script project: --line NAME --take N)' : ''));
    return { verb, pos, at: at.map((i) => i + skip), o, f: fields };
  } catch (e) {
    const usage = (live ? 'sori live ' + verb.usage.replace(' <project>', '') : 'sori ' + verb.usage)
      + (verb.takes ? ' (a script project: --line NAME, --take for --track)' : '');
    throw Object.assign(e, { usage });
  }
}

// One file command. Never throws: returns { ok: true, ...result } or { ok: false, error, message }.
// on: run it on this project object instead of a file (sori live, src/ui/live/; a batch's lines): nothing is
// loaded or saved; where names it in errors (default: the app's).
async function execute(argv, { cwd = process.cwd(), audio, on, where } = {}) {
  try {
    const { verb, pos, o, f } = parse(argv, !!on), a = {};
    if (on && verb.live) {
      fail('USE_APP_COMMAND', `with the project open in Sori, use "${verb.live}" (the app's own command: new makes `
        + 'a file, the app has one project open)');
    }
    const abs = (x) => path.resolve(cwd, x);
    verb.args.forEach((k, i) => { a[k] = PATHS.has(k) ? abs(pos[i]) : pos[i]; });
    if (verb.rest) a[verb.rest] = pos.slice(verb.args.length).map(abs);
    if (verb.audio && !audio) fail('FAILED', 'this command needs the hidden Sori window (run it through sori.js)');
    const fresh = verb.name === 'new' || verb.creates;
    const p = on ? kind(on, verb.script, where || 'the project open in Sori', verb.use) : fresh ? null :
      load(a.project, verb.script, verb.use);
    const c = { p, o, f, a, audio, cwd, live: !!on && !where };
    if (verb.takes) scope.check(c, !!p.script);
    trackNames(o, p);
    const res = verb.lines && p.script && scope.many(o) ? await verb.lines(c)
      : verb.takes && p.script && !o.master ? await scope.inTakes(c, verb.run) : await verb.run(c);
    if (verb.write && !c.noSave && !on) { await packAhead(c.p); save(a.project, c.p); }
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.code || 'FAILED', message: e.message, ...(e.usage && { usage: e.usage }),
      ...(e.line && { line: e.line }) };
  }
}

// Web Audio for the audio commands: the hidden window (headless.js) and the app (sori live, live.js) pass their
// engine
const audioFor = (engine) => ({
  async decode(file, sr) {
    // decodeAudioData resamples to the context rate = the project rate (the app: already)
    await engine.setSampleRate(sr);
    const b = fs.readFileSync(file);
    return engine.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  },
  async mixdown(tracks, master, a, b, sr) {
    await engine.setSampleRate(sr);
    return engine.mixdown(tracks, master, a, b);
  },
});

module.exports = { VERBS, TRACK_TYPES, APPLY, parse, execute, audioFor, guess };
