// `sori batch` / `sori live batch` (docs/cli.md): many commands on one project, one per line of
// a text file, written as for `sori live` (no project). Every line is checked before any runs; they run in the
// order written on one copy of the project, and it is saved (the app: one undo step) only when all succeed.
// --check runs nothing: it shows what each command touches and which could run at the same time (waves).
const fs = require('fs');
const V = require('./verbs');
const SC = require('../core/script');
const { fail } = require('./project');
const { trackNo } = require('../core/args');

const ALL = 'all';
// shortcut: no export in a batch (files written cannot be taken back when a later line fails); run it after
const REFUSED = /^(new|batch|export|script export)$/;
// commands that read or reorder everything (script split fills the lines after --line too): they wait for all before
// them, all after wait for them
const WHOLE = /^(info|script info|script import|script unscript|script split|track (add|remove|move|sort))$/;

// one line -> words: spaces split, "..." or '...' keep spaces, backslashes stay (Windows paths)
function words(text) {
  const out = [];
  let w = null, q = null;
  for (const ch of text) {
    if (q) { if (ch === q) q = null; else w += ch; continue; }
    if (ch === '"' || ch === '\'') { q = ch; w = w || ''; continue; }
    if (/\s/.test(ch)) { if (w !== null) out.push(w); w = null; continue; }
    w = (w || '') + ch;
  }
  if (q) throw Object.assign(new Error(`a quote (${q}) is not closed`), { code: 'BAD_ARG' });
  if (w !== null) out.push(w);
  // written as a whole command line: `sori live track add ...`
  if (out[0] === 'sori') out.shift();
  if (out[0] === 'live') out.shift();
  return out;
}

const at = (k, e) => Object.assign(e, { message: `line ${k.line} (${k.text}): ${e.message}`, line: k.line });

function read(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    const none = e.code === 'ENOENT';
    fail(none ? 'NO_FILE' : 'READ_FAILED', `${file}: ${none ? 'does not exist' : e.message}`);
  }
  const cmds = [];
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((s, i) => {
    const k = { line: i + 1, text: s.trim() };
    if (!k.text || k.text.startsWith('#')) return;
    try { cmds.push({ ...k, argv: words(k.text) }); } catch (e) { throw at(k, e); }
  });
  if (!cmds.length) fail('BAD_ARG', `${file} has no commands (one per line; a line starting with # is a note)`);
  return cmds;
}

// what one command changes or reads, as keys: 'line 철수-001', 'character 철수', 'track 2', 'master', 'markers',
// 'tempo', or 'all' (also when unknown: safe, it only means waiting). effect: apply's effect
function touches(name, o, charOf, effect, tracks) {
  const keys = targets(name, o, charOf, tracks);
  // a length change (fxTempo, 긴 침묵 줄이기) moves the markers when it covers every track
  return name === 'apply' && MOVES.test(effect) && !keys.includes(ALL) ? [...keys, 'markers'] : keys;
}
const MOVES = /^(fxTempo|voiceGaps|voiceClean)$/;
function targets(name, o, charOf, tracks) {
  if (WHOLE.test(name) || o['all-lines']) return [ALL];
  const list = (x) => String(x).split(',').map((y) => y.trim()).filter(Boolean);
  if (o.line !== undefined) {
    // an effect set on a take is its character's (scope.js); apply takes several lines
    return name === 'fx' ? [`line ${o.line}`, `character ${charOf(o.line)}`] : list(o.line).map((l) => `line ${l}`);
  }
  if (name === 'apply' && o.char !== undefined) return list(o.char).map((x) => `character ${x}`);
  if (name === 'tempo') return ['tempo'];
  if (name.startsWith('marker ')) return ['markers'];
  if (name === 'script fx' || name === 'script color') return [`character ${o.char}`];
  if (o.master) return ['master'];
  if (name.startsWith('range ')) return [ALL]; // moves markers and later clips
  const ts = [o.track, o['to-track']].flat().filter((x) => x !== undefined);
  // a name -> its number in the project as it was before the batch; one an earlier line makes: all (safe)
  const no = (t) => { try { return trackNo(tracks, t); } catch { return ALL; } };
  const keys = ts.map(no);
  return !keys.length || keys.includes(ALL) ? [ALL] : [...new Set(keys)].map((t) => `track ${t}`);
}

// two commands clash when they touch the same thing, a line of a character the other touches, or anything at all
function clash(a, b, charOf) {
  const of = (x, y) => x.startsWith('line ') && y.startsWith('character ')
    && [null, y.slice(10)].includes(charOf(x.slice(5)));
  return a.touches.some((x) => b.touches.some((y) => x === ALL || y === ALL || x === y || of(x, y) || of(y, x)));
}

// each command lands one wave after the last earlier command it clashes with: a wave's commands could run together
function waves(cmds, charOf) {
  const level = [];
  cmds.forEach((k, i) => {
    level[i] = Math.max(0, ...cmds.slice(0, i).map((j, n) => (clash(k, j, charOf) ? level[n] + 1 : 0)));
  });
  const out = [];
  cmds.forEach((k, i) => { (out[level[i]] = out[level[i]] || []).push(k.line); });
  return out;
}

// every line parsed and its targets read before anything runs
function plan(file, p) {
  const cmds = read(file);
  const charOf = (n) => {
    const l = p.script && p.script.lines.find((x) => SC.lineName(x) === n);
    return l ? l.char : null;
  };
  for (const k of cmds) {
    let job;
    try { job = V.parse(k.argv, true); } catch (e) { throw at(k, e); }
    if (REFUSED.test(job.verb.name)) {
      const why = job.verb.name === 'batch' ? 'a batch cannot hold a batch'
        : `${job.verb.name} cannot be in a batch (files written cannot be taken back if a later line fails): `
          + 'run it after the batch';
      throw at(k, Object.assign(new Error(why), { code: 'BAD_ARG' }));
    }
    Object.assign(k, { verb: job.verb, touches: touches(job.verb.name, job.o, charOf, job.pos[1], p.tracks) });
  }
  return { cmds, waves: waves(cmds, charOf) };
}

// true when a line needs Web Audio (import): the file batch then runs in the hidden window
function needsAudio(file) {
  try { return read(file).some((k) => V.parse(k.argv, true).verb.audio); } catch { return false; }
}

async function run(c) {
  const { cmds, waves: w } = plan(c.a.file, c.p);
  const row = (k) => ({ line: k.line, command: k.text, touches: k.touches });
  if (c.o.check) {
    c.noSave = true;
    return { dryRun: true, commands: cmds.map(row), waves: w };
  }
  const done = [];
  for (const k of cmds) {
    const res = await V.execute(k.argv, { cwd: c.cwd, audio: c.audio, on: c.p, where: c.live ? null : c.a.project });
    if (!res.ok) {
      const none = c.live ? 'nothing was applied' : 'nothing was saved';
      const e = Object.assign(new Error(`${res.message}; ${none}`), { code: res.error, usage: res.usage });
      throw at(k, e);
    }
    delete res.ok;
    done.push({ ...row(k), result: res });
  }
  return { commands: done, waves: w };
}

module.exports = { run, needsAudio, words, touches };
