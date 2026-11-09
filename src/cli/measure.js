// `sori measure` (docs/cli.md): numbers for what the user would hear, for an AI that cannot
// listen. A normal project: each track alone (as 지금 트랙만 exports it) and the mix (as 내보내기); a script project:
// each line's ★ take with its character's effects (as 대사별 내보내기). The master is in all of them.
const E = require('../core/edit');
const SC = require('../core/script');
const M = require('../core/measure');
const { pool, RENDERS } = require('../core/pool');
const { fail, track, frames, linesOf, lineOf, takeOf, charsOf } = require('./project');

const alone = (t) => ({ ...t, mute: false, solo: false });

// the part --from / --to of these tracks (cut at their end), rendered and measured
async function one(c, tracks) {
  const end = E.projectEnd(tracks), a = c.o.from === undefined ? 0 : frames(c, c.o.from);
  const b = Math.min(end, c.o.to === undefined ? end : frames(c, c.o.to));
  if (b <= a) return { seconds: 0, empty: true };
  return M.measure(await c.audio.mixdown(tracks, c.p.master, a, b, c.p.sampleRate), c.p.sampleRate);
}

async function plain(c) {
  if (c.o.line !== undefined || c.o.take !== undefined || c.o.char !== undefined) {
    fail('NOT_SCRIPT', '--line / --take / --char are for script projects; this project has tracks: use --track');
  }
  const picked = c.o.track ? [track(c, c.o.track)] : c.p.tracks;
  const tracks = await pool(picked.length, RENDERS, async (i) => {
    const t = picked[i];
    return { track: c.p.tracks.indexOf(t) + 1, name: t.name, ...await one(c, [alone(t)]) };
  });
  return { tracks, ...(!c.o.track && { mix: await one(c, c.p.tracks) }) };
}

async function lines(c) {
  if (c.o.track !== undefined) fail('BAD_ARG', 'a script project has takes, not tracks: use --line NAME [--take N]');
  if (c.o.take !== undefined && c.o.line === undefined) fail('BAD_ARG', '--take needs --line NAME');
  if (c.o.line !== undefined && c.o.char !== undefined) fail('BAD_ARG', 'give --line or --char, not both');
  const one1 = c.o.line !== undefined && lineOf(c, c.o.line);
  const range = one1 ? { line: one1.id } : c.o.char !== undefined ? { chars: charsOf(c) } : {};
  const { ready, skipped } = c.o.take !== undefined ? { ready: [one1], skipped: [] } : SC.exportPick(linesOf(c), range);
  const out = await pool(ready.length, RENDERS, async (i) => {
    const l = ready[i], t = c.o.take !== undefined ? takeOf(l, c.o.take) : SC.starTake(l);
    const heard = alone(SC.takeView(t, c.p.script.chars[l.char]));
    return { line: SC.lineName(l), take: t.name, ...await one(c, [heard]) };
  });
  return { lines: out, skipped: skipped.map(SC.lineName) };
}

const VERBS = [{
  name: 'measure', usage: 'measure <project> [--track N | --line NAME [--take N|NAME] | --char NAME[,NAME…]] '
    + '[--from SEC] [--to SEC]',
  about: 'numbers of what is heard (track or character effects and the master in): lufs, peakDb, clipped (places '
    + 'over 0 dBFS: count + the first 20 times), noiseDb (quietest 0.5 s), speechDb, quiet (stretches of 0.5 s or '
    + 'more with nothing over the room noise, as 긴 침묵 줄이기 reads it). Each track alone + the mix; a script '
    + 'project: each line\'s ★ take (or --take). Changes nothing',
  script: 'any', audio: true, args: ['project'],
  flags: { track: 'idx', line: 'str', take: 'str', char: 'str', from: 'sec', to: 'sec' },
  run(c) {
    const { from, to } = c.o;
    if (from !== undefined && to !== undefined && to <= from) fail('BAD_ARG', '--to must be after --from');
    return c.p.script ? lines(c) : plain(c);
  },
}];

module.exports = { VERBS };
