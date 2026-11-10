// `sori script split`: 긴 녹음 나누기 without the window (spec §5-5, core/split.js). Line boundaries are given
// (--cut, like N while recording) or --every-gap; the quiet only cuts pieces inside a line.
const SC = require('../core/script');
const SPL = require('../core/split');
const { fail, secs, linesOf, lineOf, charsOf, putLines, decodeFiles } = require('./project');

// the lines pieces go to: --line, then the lines after it in script order that the filters keep (the app's list)
function order(c) {
  const all = linesOf(c), id = lineOf(c, c.o.line).id, from = all.findIndex((l) => l.id === id);
  const chars = c.o.char !== undefined && charsOf(c);
  const keep = (l) => (!chars || chars.includes(l.char)) && (!c.o.todo || !SC.isDone(l));
  return [all[from], ...all.slice(from + 1).filter(keep)];
}

async function split(c) {
  const [{ ch }] = await decodeFiles(c, [c.a.file]), sr = c.p.sampleRate, len = ch[0].length;
  const sound = SPL.soundRuns(ch, sr), gap = c.o.gap ?? 1, lines = order(c);
  if (gap < 0.3 || gap > 5) fail('BAD_ARG', '--gap needs seconds from 0.3 to 5');
  const cuts = (c.o.cut || []).map((s) => Math.round(Number(s) * sr));
  const outside = cuts.some((f) => !Number.isFinite(f) || f <= 0 || f >= len);
  if (outside) fail('BAD_ARG', '--cut times must be inside the audio');
  let st = { bounds: [...new Set(cuts.map((m) => SPL.snap(sound, m, sr, len)))].sort((a, b) => a - b), picks: [] };
  st.ps = SPL.pieces(sound, sr, gap, st.bounds, len);
  if (c.o['every-gap']) { st.bounds = SPL.everyPiece(st); st.ps = SPL.pieces(sound, sr, gap, st.bounds, len); }
  if (c.o.join) st = joined(st);
  const { lines: plan, over } = SPL.plan(st, lines.length);
  if (!plan.length) fail('NOTHING_TO_SPLIT', 'no speech found in the audio');
  const pieces = plan.flatMap(({ line, ranges }) => ranges.map(([a, b]) =>
    ({ line: SC.lineName(lines[line]), from: secs(c, a), to: secs(c, b) })));
  if (c.o['dry-run']) c.noSave = true;
  else putLines(c, linesOf(c).map((l) => add(c, l, ch, plan, lines)));
  return { dryRun: !!c.o['dry-run'], gap, pieces, over, boundaries: st.bounds.map((f) => secs(c, f)) };
}
// --join: a line's pieces become one take, the quiet between them kept
function joined(st) {
  let out = st;
  for (let i = out.ps.length - 1; i > 0; i--) {
    const g = (k) => SPL.groupOf(out.bounds, out.ps[k]);
    let j = i;
    while (j > 0 && g(j - 1) === g(i)) j--;
    if (j < i) out = { ...SPL.merge(out, j, i) };
    i = j;
  }
  return out;
}
function add(c, l, ch, plan, lines) {
  const at = plan.find((p) => lines[p.line].id === l.id);
  return at ? SPL.addTakes(l, ch, at.ranges, c.p.script.chars[l.char]) : l;
}

const VERBS = [
  { name: 'script split', usage: 'script split <project> --line NAME <audio> [--cut SEC,SEC…] [--every-gap] '
      + '[--gap 0.3..5] [--join] [--char NAME[,NAME…]] [--todo] [--dry-run]',
    script: true, write: true, audio: true, args: ['project', 'file'], need: ['line'], run: split,
    flags: { line: 'str', cut: 'list', 'every-gap': 'bool', gap: 'num', join: 'bool', char: 'str', todo: 'bool',
      'dry-run': 'bool' },
    about: 'like 긴 녹음 나누기: one long recording of several lines -> new takes (테이크 n, ★ if the line had none). '
      + 'Lines: --line, then the ones after it in script order (--char / --todo keep only those, like the app\'s '
      + 'list). A new line starts only at a --cut (seconds, like N while recording: moved to the nearest quiet within '
      + '2 s) or, with --every-gap, at every piece. Pieces = speech apart by more than --gap s (default 1), 0.3 s '
      + 'of quiet kept each side; shorter than 0.3 s is no piece. Each piece of a line is its own take; --join makes '
      + 'one take per line (the quiet between kept). Pieces past the last line are left out (over). --dry-run only '
      + 'reports' },
];

module.exports = { VERBS };
