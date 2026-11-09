// `sori apply`: the 효과 menu on a project file, with the app's placement rules (commands/effects.js) and its
// 목소리 정리 group (core/voicedit.js, as commands/voice.js runs it).
const E = require('../core/edit');
const FX = require('../core/effects');
const P = require('../core/fxparams');
const A = require('../core/args');
const VE = require('../core/voicedit');
const SC = require('../core/script');
const W = require('../core/workers');
const { pool } = require('../core/pool');
const { fail, frames, secs, byId, setClips, trackNo, targets, span, linesOf, lineOf, charsOf } = require('./project');
const R = require('./recipes');
const scope = require('./scope');

// fxNoise: the noise profile from a part with only noise
function noiseProfile(c, ts) {
  const pa = c.o['profile-from'], pb = c.o['profile-to'];
  if (pa === undefined || pb === undefined) {
    fail('BAD_ARG', 'fxNoise needs --profile-from SEC --profile-to SEC (a part with only noise)');
  }
  const a = frames(c, pa), b = frames(c, pb);
  const chs = ts.map((t) => E.renderRegion(t.clips, a, Math.max(a, b))).filter(Boolean);
  if (!chs.length || b - a < frames(c, 0.1)) {
    fail('BAD_ARG', 'the noise profile range must be at least 0.1 s long and have sound');
  }
  return FX.noiseProfile(chs.flat());
}
// [from, to) of each chosen track, or each whole track with sound without a range
function applyRanges(c, ts) {
  if (c.o.from === undefined && c.o.to === undefined) {
    return ts.filter((t) => t.clips.length).map((t) => ({ t, a: 0, b: E.projectEnd([t]) }));
  }
  const [a, b] = span(c);
  return ts.map((t) => ({ t, a, b }));
}
// markers follow a stretch only when every track with sound after its start got it
function followStretch(p, results) {
  const groups = [...Map.groupBy(results, (x) => x.a).values()];
  const covered = (g) => (t) => g.some((x) => x.id === t.id) || !t.clips.some((x) => E.clipEnd(x) > g[0].a);
  if (!groups.every((g) => p.tracks.every(covered(g)))) return;
  for (const g of groups) {
    const big = g.reduce((m, x) => (x.b > m.b ? x : m));
    p.markers = p.markers.map((m) => ({ ...m, frame: E.remapFrame(m.frame, big.a, big.b, big.out[0].length) }));
  }
}
// 목소리 정리: the steps in place, then the cuts and end padding of 긴 침묵 줄이기 (a marker follows when its track is
// every track); a step that cannot measure is listed in skipped, like the app's notice
// pre: voiceEdit's result for these ranges, worked out already (applyLines)
async function applyVoice(c, def, pre) {
  const params = A.fill(def.fields, null, c.f, c.o.preset), ts = targets(c); // --preset: refused, no presets
  const ranges = applyRanges(c, ts).map(({ t, a, b }) => ({ trackId: t.id, a, b }));
  const r = pre || await VE.voiceEdit(c.p.tracks, ranges, c.p.sampleRate, def.rows(params));
  if (!r.done.length) fail('NOTHING_TO_DO', 'no sound on the chosen tracks in that range');
  const edited = new Set([...r.clips].filter(([id, cs]) => byId(c.p, id).clips !== cs).map(([id]) => id));
  for (const id of edited) setClips(c.p, id, r.clips.get(id));
  for (const cut of r.cuts) R.rippleMarkers(c.p, new Set([cut.trackId]), cut.a, cut.b, cut.add); // one track's cut
  // like the app: a range whose step was skipped did not change, so it is not listed
  const changed = r.done.filter((t) => edited.has(t.trackId)).map((t) => ({
    track: trackNo(c.p, t.trackId), from: secs(c, t.a), to: secs(c, t.b), newLength: secs(c, t.newB - t.newA),
  }));
  return { effect: c.a.effect, params, changed, cuts: r.cuts.length, skipped: r.skipped };
}
function applyFx(c) {
  if (Object.hasOwn(R.VOICE, c.a.effect)) return applyVoice(c, R.VOICE[c.a.effect]);
  const def = Object.hasOwn(R.APPLY, c.a.effect) && R.APPLY[c.a.effect];
  if (!def) fail('BAD_ARG', `unknown effect "${c.a.effect}"; effects: ${EFFECTS.join(', ')}`);
  const [fn, opt] = def, ts = targets(c);
  let params = A.fill(opt.fields || P.FIELDS[opt.kind] || [], P.PRESETS[opt.kind], c.f, c.o.preset);
  const shown = { ...params };
  if (opt.profile) params = { ...params, profile: noiseProfile(c, ts) };
  // like runFx: compute everything first, then edit right to left so ripple shifts never move pending targets
  const results = applyRanges(c, ts).map(({ t, a, b }) => {
    const ch = E.renderRegion(t.clips, a, b), first = t.clips.find((x) => x.start < b && E.clipEnd(x) > a);
    return ch && { id: t.id, a, b, name: first ? first.name : t.name, out: fn(ch, c.p.sampleRate, params) };
  }).filter(Boolean).sort((x, y) => y.a - x.a);
  if (!results.length) fail('NOTHING_TO_DO', 'no sound on the chosen tracks in that range');
  for (const r of results) {
    setClips(c.p, r.id, E.replaceRegion(byId(c.p, r.id).clips, r.a, r.b, r.out, r.name, !opt.overlay));
  }
  if (opt.ripple) followStretch(c.p, results);
  const changed = results.map((r) => ({
    track: trackNo(c.p, r.id), from: secs(c, r.a), to: secs(c, r.b), newLength: secs(c, r.out[0].length),
  }));
  return { effect: c.a.effect, params: shown, changed };
}

// the lines of --line A,B / --char / --all-lines, in script order
function pickLines(c) {
  const o = c.o, given = [o.line !== undefined, o.char !== undefined, !!o['all-lines']].filter(Boolean).length;
  if (given !== 1) fail('BAD_ARG', 'give one of --line NAME[,NAME…], --char NAME[,NAME…] or --all-lines');
  if (o.take !== undefined || o.from !== undefined || o.to !== undefined) {
    fail('BAD_ARG', "several lines: each line's ★ take, whole (--take / --from / --to are for one --line)");
  }
  if (o['all-lines']) return linesOf(c);
  if (o.char !== undefined) { const cs = charsOf(c); return linesOf(c).filter((l) => cs.includes(l.char)); }
  const ids = new Set(String(o.line).split(',').map((x) => x.trim()).filter(Boolean).map((x) => lineOf(c, x).id));
  return linesOf(c).filter((l) => ids.has(l.id));
}
// 목소리 정리 on the ★ take of many lines: each take worked out on another CPU (workers.js),
// then put in one by one as `apply EFFECT --line L --take ★` puts it. Lines without a ★ take with sound are listed
// in noStar (as 대사별 내보내기 skips them).
async function applyLines(c) {
  const def = Object.hasOwn(R.VOICE, c.a.effect) && R.VOICE[c.a.effect];
  if (!def) fail('BAD_ARG', 'several lines take only 목소리 정리 (voice…); other effects: one --line at a time');
  const params = A.fill(def.fields, null, c.f, c.o.preset), rows = def.rows(params), sr = c.p.sampleRate;
  const picked = pickLines(c), todo = picked.filter(SC.starTake), takes = todo.map(SC.starTake);
  const clean = (ch, edges) => W.run('voicedit', 'cleanTake', [ch, sr, rows, edges]);
  const pre = await pool(todo.length, W.WORKERS, (i) => VE.voiceEdit([takes[i]], [{ trackId: takes[i].id, a: 0,
    b: E.projectEnd([takes[i]]) }], sr, rows, undefined, clean));
  const base = { ...c.o, char: undefined, 'all-lines': undefined }, lines = [];
  for (const [i, l] of todo.entries()) {
    const one = { ...c, o: { ...base, line: SC.lineName(l), take: [takes[i].name] } }; // apply's --take is a list
    const { line, ...res } = await scope.inTakes(one, (cc) => applyVoice(cc, def, pre[i]));
    lines.push({ line: line.name, take: takes[i].name, ...res.changed[0] && { newLength: res.changed[0].newLength },
      cuts: res.cuts, skipped: res.skipped });
  }
  const changed = lines.filter((x) => x.newLength !== undefined).length;
  return { effect: c.a.effect, params, changed, lines, noStar: picked.filter((l) => !SC.starTake(l)).map(SC.lineName) };
}

const EFFECTS = [...Object.keys(R.VOICE), ...Object.keys(R.APPLY)];

module.exports = { applyFx, applyLines, EFFECTS };
