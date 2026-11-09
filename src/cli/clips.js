// File commands on clips, time ranges and markers: clip move/delete/split/set/trim/merge, range delete/keep/insert,
// marker add/remove/set.
const E = require('../core/edit');
const {
  fail, frames, secs, byId, setClips, trackNo, track, clipOf, targets, span, where, name,
} = require('./project');
const R = require('./recipes');

const SEC = 'sec', IDX = 'idx', IDXS = 'idxs';
const CLIP = { track: IDX, clip: IDX };

function moveClip(c) {
  const t = track(c, c.o.track), x = clipOf(t, c.o.track, c.o.clip);
  if (c.o.to === undefined && !c.o['to-track']) fail('BAD_ARG', 'give --to SEC and/or --to-track M');
  const dest = c.o['to-track'] ? track(c, c.o['to-track']) : t;
  const moved = { ...x, start: c.o.to === undefined ? x.start : frames(c, c.o.to) };
  setClips(c.p, t.id, t.clips.filter((y) => y !== x));
  setClips(c.p, dest.id, E.sortClips([...byId(c.p, dest.id).clips, moved]));
  return { clip: where(c.p, moved.id) };
}

function setClip(c) {
  const t = track(c, c.o.track), x = clipOf(t, c.o.track, c.o.clip), o = c.o, patch = {};
  if (o.volume !== undefined) patch.gain = 10 ** (Math.max(-24, Math.min(12, o.volume)) / 20);
  if (o['fade-in'] !== undefined) patch.fadeIn = frames(c, o['fade-in']);
  if (o['fade-out'] !== undefined) patch.fadeOut = frames(c, o['fade-out']);
  if (o['fade-in-shape'] !== undefined) patch.fadeInShape = o['fade-in-shape'];
  if (o['fade-out-shape'] !== undefined) patch.fadeOutShape = o['fade-out-shape'];
  if (!Object.keys(patch).length) {
    fail('BAD_ARG', 'nothing to change: give --volume, --fade-in, --fade-out or a --fade-in-shape / --fade-out-shape');
  }
  const n = E.clampFades({ ...x, ...patch });
  setClips(c.p, t.id, t.clips.map((y) => (y === x ? n : y)));
  return { clip: where(c.p, n.id) };
}

function trimClip(c) {
  const t = track(c, c.o.track), x = clipOf(t, c.o.track, c.o.clip);
  if (c.o.start === undefined && c.o.end === undefined) fail('BAD_ARG', 'give --start SEC and/or --end SEC');
  let n = x;
  if (c.o.start !== undefined) n = E.trimClip(n, 'left', frames(c, c.o.start));
  if (c.o.end !== undefined) n = E.trimClip(n, 'right', frames(c, c.o.end));
  setClips(c.p, t.id, E.sortClips(t.clips.map((y) => (y === x ? n : y))));
  return { clip: where(c.p, n.id) };
}

// range delete / keep / insert: the same edit on each chosen track
function onRange(c, edit) {
  const ts = targets(c);
  for (const t of ts) setClips(c.p, t.id, edit(byId(c.p, t.id).clips));
  return ts;
}
const trackNos = (c, ts) => ts.map((t) => trackNo(c.p, t.id));

function markerAt(c, n) {
  const m = c.p.markers[n - 1];
  if (!m) fail('NO_MARKER', `marker ${n} does not exist; the project has ${c.p.markers.length}`);
  return m;
}
const markerInfo = (c, m) => ({ index: c.p.markers.indexOf(m) + 1, name: m.name, at: secs(c, m.frame) });
function addMarker(c) {
  const f = frames(c, c.o.at), ms = c.p.markers;
  if (ms.some((m) => m.frame === f)) fail('EXISTS', 'there is already a marker at that time');
  let n = ms.length + 1;
  const used = new Set(ms.map((m) => m.name));
  while (used.has('마커 ' + n)) n++;
  const m = { id: E.uid('m'), frame: f, name: c.o.name === undefined ? '마커 ' + n : name(c.o.name) };
  c.p.markers = [...ms, m].sort((x, y) => x.frame - y.frame);
  return { marker: markerInfo(c, m) };
}
function setMarker(c) {
  const m = markerAt(c, c.o.marker);
  if (c.o.name === undefined && c.o.at === undefined) fail('BAD_ARG', 'give --name TEXT and/or --at SEC');
  const n = {
    ...m, name: c.o.name === undefined ? m.name : name(c.o.name),
    frame: c.o.at === undefined ? m.frame : frames(c, c.o.at),
  };
  c.p.markers = c.p.markers.map((x) => (x === m ? n : x)).sort((x, y) => x.frame - y.frame);
  return { marker: markerInfo(c, n) };
}

const VERBS = [
  { name: 'clip move', usage: 'clip move <project> --track N --clip K [--to SEC] [--to-track M]',
    about: 'move a clip in time and/or to another track', write: true, takes: true, args: ['project'],
    flags: { ...CLIP, to: SEC, 'to-track': IDX }, need: ['track', 'clip'], run: moveClip },

  { name: 'clip delete', usage: 'clip delete <project> --track N --clip K', about: 'remove one clip (nothing moves)',
    write: true, takes: true, args: ['project'], flags: CLIP, need: ['track', 'clip'],
    run(c) {
      const t = track(c, c.o.track), x = clipOf(t, c.o.track, c.o.clip);
      setClips(c.p, t.id, t.clips.filter((y) => y !== x));
      return { removed: { track: c.o.track, clip: c.o.clip, name: x.name } };
    } },

  { name: 'clip split', usage: 'clip split <project> --at SEC [--track N,M]',
    about: 'split every clip under SEC on the tracks (all tracks without --track)',
    write: true, takes: true, args: ['project'], flags: { at: SEC, track: IDXS }, need: ['at'],
    run(c) {
      const f = frames(c, c.o.at), hit = targets(c).filter((t) => t.clips.some((x) => x.start < f && E.clipEnd(x) > f));
      if (!hit.length) fail('NOTHING_TO_DO', 'no clip at that time on the chosen tracks');
      for (const t of hit) setClips(c.p, t.id, E.splitAt(t.clips, f));
      return { split: hit.map((t) => trackNo(c.p, t.id)), at: secs(c, f) };
    } },

  { name: 'clip set', usage: 'clip set <project> --track N --clip K [--volume DB] [--fade-in SEC] [--fade-out SEC] '
      + '[--fade-in-shape S] [--fade-out-shape S]',
    about: 'clip volume (-24..12 dB), fades and their curves (linear | smooth | fast | slow), like 클립 볼륨 · 페이드 '
      + 'and the fade handle menu',
    write: true, takes: true, args: ['project'], need: ['track', 'clip'], run: setClip,
    flags: { ...CLIP, volume: 'num', 'fade-in': SEC, 'fade-out': SEC, 'fade-in-shape': R.SHAPES,
      'fade-out-shape': R.SHAPES } },

  { name: 'clip trim', usage: 'clip trim <project> --track N --clip K [--start SEC] [--end SEC]',
    about: 'move the clip edges to these timeline times (within the recorded sound, like dragging the edges)',
    write: true, takes: true, args: ['project'], flags: { ...CLIP, start: SEC, end: SEC }, need: ['track', 'clip'],
    run: trimClip },

  { name: 'clip merge', usage: 'clip merge <project> --track N [--clip K,L,...]',
    about: 'join clips of one track into one (gaps become silence); all clips without --clip',
    write: true, takes: true, args: ['project'], flags: { track: IDX, clip: IDXS }, need: ['track'],
    run(c) {
      const t = track(c, c.o.track), ks = c.o.clip || t.clips.map((_, i) => i + 1);
      const res = E.merge(t.clips, new Set(ks.map((k) => clipOf(t, c.o.track, k).id)));
      if (!res) fail('NOTHING_TO_DO', 'merge needs 2 or more clips');
      setClips(c.p, t.id, res.clips);
      return { clip: where(c.p, res.clip.id) };
    } },

  { name: 'range delete', usage: 'range delete <project> --from SEC --to SEC [--track N,M]',
    about: 'cut [from, to) out and pull later audio left (all tracks without --track; markers follow only then)',
    write: true, takes: true, args: ['project'], flags: { from: SEC, to: SEC, track: IDXS }, need: ['from', 'to'],
    run(c) {
      const [a, b] = span(c), ts = onRange(c, (clips) => E.rippleDelete(clips, a, b));
      R.rippleMarkers(c.p, new Set(ts.map((t) => t.id)), a, b, 0);
      return { deleted: { from: secs(c, a), to: secs(c, b), tracks: trackNos(c, ts) } };
    } },

  { name: 'range keep', usage: 'range keep <project> --from SEC --to SEC [--track N,M]',
    about: 'remove everything outside [from, to) (선택만 남기기)',
    write: true, takes: true, args: ['project'], flags: { from: SEC, to: SEC, track: IDXS }, need: ['from', 'to'],
    run(c) {
      const [a, b] = span(c), ts = onRange(c, (clips) => E.keepRange(clips, a, b));
      return { kept: { from: secs(c, a), to: secs(c, b), tracks: trackNos(c, ts) } };
    } },

  { name: 'range insert', usage: 'range insert <project> --at SEC --length SEC [--track N,M]',
    about: 'insert silence and push later audio right (무음 넣기)',
    write: true, takes: true, args: ['project'], flags: { at: SEC, length: SEC, track: IDXS }, need: ['at', 'length'],
    run(c) {
      const at = frames(c, c.o.at), len = frames(c, c.o.length);
      if (len < 1) fail('BAD_ARG', '--length must be more than 0');
      const ts = onRange(c, (clips) => E.insertGap(clips, at, len));
      R.rippleMarkers(c.p, new Set(ts.map((t) => t.id)), at, at, len);
      return { inserted: { at: secs(c, at), length: secs(c, len), tracks: trackNos(c, ts) } };
    } },

  { name: 'marker add', usage: 'marker add <project> --at SEC [--name TEXT]',
    about: 'add a marker (default name 마커 N)', write: true,
    script: 'any', args: ['project'], flags: { at: SEC, name: 'str' }, need: ['at'], run: addMarker },

  { name: 'marker remove', usage: 'marker remove <project> --marker N', about: 'delete marker N', write: true,
    script: 'any', args: ['project'], flags: { marker: IDX }, need: ['marker'],
    run(c) {
      const m = markerAt(c, c.o.marker);
      c.p.markers = c.p.markers.filter((x) => x !== m);
      return { removed: { index: c.o.marker, name: m.name } };
    } },

  { name: 'marker set', usage: 'marker set <project> --marker N [--name TEXT] [--at SEC]',
    about: 'rename or move marker N', write: true,
    script: 'any', args: ['project'], flags: { marker: IDX, name: 'str', at: SEC }, need: ['marker'], run: setMarker },
];

module.exports = { VERBS };
