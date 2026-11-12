// 목소리 정리 on tracks, shared by the app's menu and `sori apply voice…`: each target range goes through the chosen
// steps, then 긴 침묵 줄이기 evens out its own pauses, and it goes back as one clip. Pure:
// takes [{ id, name, clips }], returns new clips; markers and selection stay with the caller. `step(done, total, text)`
// is awaited before each piece of work (the app's progress bar; it may throw to stop, before anything is returned).
const E = require('./edit');
const V = require('./voice');
const FX = require('./effects');
const { pool } = require('./pool');

const ORDER = ['hum', 'noise', 'gate', 'lowcut', 'even', 'deess', 'loud']; // spec order; gaps last, per track
const isOn = (rows, k) => !!rows[k] && rows[k] !== 'off';
const noStep = async () => {};

// one target through the steps; null when nothing ran (every step skipped). at(label) is awaited before each step
async function runSteps(ch, sr, rows, skipped, at) {
  let out = ch;
  for (const k of ORDER.filter((x) => isOn(rows, x))) {
    await at(V.LABELS[k]);
    const y = V.STEPS[k](out, sr, rows[k]);
    if (y) out = y; else skipped.add(k);
  }
  return out === ch ? null : out;
}

// 긴 침묵 줄이기 on ch: edits [a, b, add] (frames of ch, right to left: a..b goes, `add` frames of digital silence
// go in its place). Between speech a quiet stretch (breaths count as quiet) longer than GAPS[level].over keeps
// `keep` s, half each side; the quiet before the first and after the last sound heard (breaths and soft word ends
// are sound there; a fading tail 35 dB under the speech is not) at a real start or end (`edges`) becomes exactly
// `keep` s whatever its length, cut or padded. No floor to measure: by the speech level alone. Levels are read on
// a copy without the rumble under DETECT_HZ, which the ear and the master EQ do not hear
const DETECT_HZ = 150;
// det without the digital silence at its ends, where the floor is read: zeros an earlier run padded there left no
// 0.5 s of pure room noise, the floor jumped to a louder pause and a second run undid the first
function sound(det, ch) {
  const zero = (i) => ch.every((c) => c[i] === 0);
  let a = 0, b = ch[0].length;
  while (a < b && zero(a)) a++;
  while (b > a && zero(b - 1)) b--;
  return det.map((c) => c.subarray(a, b));
}
// what 긴 침묵 줄이기 reads (sori measure's quiet stretches too): det = the copy levels are read on, the floor q,
// the speech level, the ends' threshold and the between-words one (talk inside heard, so a cut between words never
// overlaps an end's edit: a floor of digital silence gave -92 vs -60)
function quietLevels(ch, sr) {
  const det = FX.eq(ch, sr, { lowcut: DETECT_HZ }), m = sound(det, ch);
  const q = V.quietest(m, sr), loud = q ? q.loud : V.speechDb(m, sr), edge = V.edgeDb(q, loud);
  return { det, q, loud, edge, talk: Math.max(V.talkDb(q, loud), edge) };
}
function gapEdits(ch, sr, level, edges) {
  const B = Math.round(0.01 * sr), len = ch[0].length, { det, edge, talk: th } = quietLevels(ch, sr);
  const talk = V.openBlocks(det, B, th), heard = V.openBlocks(det, B, edge);
  const first = heard.indexOf(1), last = heard.lastIndexOf(1);
  if (first < 0) return [];
  const { over, keep } = V.GAPS[level], k = Math.round(keep * sr), pad = Math.round(k / 2), out = [];
  const head = first * B, tail = len - Math.min(len, (last + 1) * B);
  if (edges.start && head !== k) out.push(head > k ? [0, head - k, 0] : [0, 0, k - head]);
  for (let i = talk.indexOf(1), end = talk.lastIndexOf(1); i >= 0 && i <= end; i++) {
    if (talk[i]) continue;
    let j = i;
    while (!talk[j]) j++; // talk[end] stops it
    if ((j - i) * B > over * sr) out.push([i * B + pad, j * B - pad, 0]);
    i = j;
  }
  if (edges.end && tail !== k) out.push(tail > k ? [len - tail + k, len, 0] : [len, len, k - tail]);
  return out.reverse();
}
// ch with the edits (right to left) done: one piece, so the recording stays one clip
function edited(ch, edits) {
  const parts = [];
  let at = 0;
  for (const [a, b, add] of [...edits].reverse()) { parts.push([at, a, add]); at = b; }
  parts.push([at, ch[0].length, 0]);
  const len = parts.reduce((n, [a, b, add]) => n + b - a + add, 0);
  return ch.map((c) => {
    const out = new Float32Array(len);
    let p = 0;
    for (const [a, b, add] of parts) { out.set(c.subarray(a, b), p); p += b - a + add; }
    return out;
  });
}
// a target edge is real unless a clip goes on across it (a range that starts or ends inside a recording)
const across = (cs, f) => cs.some((c) => c.start < f && E.clipEnd(c) > f);

// targets: [{ trackId, a, b }]; rows: { step: 'off' | 'low' | 'mid' | 'high' } ->
// { clips: Map(id -> clips), cuts: [{ trackId, a, b, add }] right to left per track (already applied; the target is
//   one clip, shorter or longer: a..b went, `add` frames of silence came in), skipped: [step],
//   done: [{ trackId, a, b, newA, newB }] }
// one range's sound through the rows: { out (null: unchanged), got (긴 침묵 줄이기's edits [a, b, add] in ch), skipped
// (steps that could not measure) }. Pure, so it can run on another CPU (core/workers.js)
async function cleanTake(ch, sr, rows, edges, at = noStep) {
  const skipped = new Set();
  let out = (await runSteps(ch, sr, rows, skipped, at)) || ch, got = [];
  if (isOn(rows, 'gaps')) {
    await at(V.LABELS.gaps);
    got = gapEdits(out, sr, rows.gaps, edges);
    if (got.length) out = edited(out, got);
  }
  return { out: out === ch ? null : out, got, skipped: [...skipped] };
}
// clean(ch, edges): cleanTake done elsewhere (on workers: the app, cli/apply.js), k ranges at once, a step report
// per range done; without it every step of every range reports
async function voiceEdit(tracks, targets, sr, rows, step = noStep, clean = null, k = 1) {
  const clips = new Map(tracks.map((t) => [t.id, t.clips])), names = new Map(tracks.map((t) => [t.id, t.name]));
  const skipped = new Set(), done = [], cuts = [], gaps = isOn(rows, 'gaps');
  const per = ORDER.filter((x) => isOn(rows, x)).length + (gaps ? 1 : 0), total = targets.length * per;
  const order = [...targets].sort((x, y) => y.a - x.a); // right to left: a shorter result pulls in only what is done
  let n = 0, fin = 0;
  // every range read from the clips as they were: ranges never overlap and an edit moves only what is right of it
  const work = async (tg) => {
    const cs = clips.get(tg.trackId), ch = E.renderRegion(cs, tg.a, tg.b), name = names.get(tg.trackId);
    if (!ch) { n += per; return null; }
    const edges = { start: !across(cs, tg.a), end: !across(cs, tg.b) };
    const at = (label) => step(n++, total, `${label} · ${name}`);
    if (!clean) return { len: ch[0].length, r: await cleanTake(ch, sr, rows, edges, at) };
    const len = ch[0].length, r = await clean(ch, edges); // clean may take ch over (moved to a worker)
    n += per;
    await step(n, total, `${name} (${++fin}/${order.length})`);
    return { len, r };
  };
  if (clean) await step(0, total, '계산 중');
  const res = await pool(order.length, clean ? k : 1, (i) => work(order[i]));
  for (const [i, tg] of order.entries()) {
    if (!res[i]) continue;
    const { len, r } = res[i], cs = clips.get(tg.trackId);
    r.skipped.forEach((x) => skipped.add(x));
    for (const [a, b, add] of r.got) cuts.push({ trackId: tg.trackId, a: tg.a + a, b: tg.a + b, add });
    done.push({ ...tg, grew: (r.out ? r.out[0].length : len) - len });
    if (!r.out) continue;
    const first = cs.find((c) => c.start < tg.b && E.clipEnd(c) > tg.a);
    clips.set(tg.trackId, E.replaceRegion(cs, tg.a, tg.b, r.out, first ? first.name : names.get(tg.trackId), true));
  }
  // each target moves by what its track's targets to the left grew (targets never overlap)
  const moved = done.map(({ trackId, a, b, grew }) => {
    const by = done.filter((u) => u.trackId === trackId && u.a < a).reduce((n, u) => n + u.grew, 0);
    return { trackId, a, b, newA: a + by, newB: b + by + grew };
  });
  return { clips, cuts, skipped: [...skipped], done: moved };
}

module.exports = { voiceEdit, cleanTake, quietLevels, ORDER };
