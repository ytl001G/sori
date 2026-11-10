// The 효과 menu (changes the sound itself, an undo step), the noise profile, clip volume and fades.
const FX = require('../../core/effects');
const E = require('../../core/edit');
const P = require('../../core/fxparams');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { def, T, frames, selClips, rangeTracks, setClips } = require('./core');
const { pause, afterEdit } = require('./play');
const { state, history, changed, trackById, sr } = require('../../core/state');

// target resolution (architecture.md): range -> clips -> everything
function fxTargets() {
  const r = state.sel.range;
  if (r) return rangeTracks().map((t) => ({ trackId: t.id, a: r.a, b: r.b }));
  const sc = selClips();
  if (sc.length) return sc.map(({ t, c }) => ({ trackId: t.id, a: c.start, b: E.clipEnd(c) }));
  return T().filter((t) => t.clips.length).map((t) => ({ trackId: t.id, a: 0, b: E.projectEnd([t]) }));
}

const FADE_SHAPES = [{ value: 'linear', label: '직선' }, { value: 'smooth', label: '부드럽게 (S자)' },
  { value: 'fast', label: '빠르게' }, { value: 'slow', label: '천천히' }];
const FADE_FIELD = { key: 'shape', label: '모양', options: FADE_SHAPES, value: 'linear' };
const field = (key, label, min, max, step, value, unit) => ({ key, label, min, max, step, value, unit });
const FXDEFS = [
  ['fxGain', '볼륨 조절', FX.gain, { fields: [field('db', '볼륨', -24, 24, 0.5, 3, 'dB')] }],
  ['fxNormalize', '정규화', FX.normalize, { fields: [field('db', '최대 레벨', -12, 0, 0.5, -1, 'dB')],
    note: '가장 큰 소리가 이 레벨이 되도록 전체 볼륨을 맞춰요.' }],
  ['fxFadeIn', '페이드 인', FX.fadeIn, { fields: [FADE_FIELD] }],
  ['fxFadeOut', '페이드 아웃', FX.fadeOut, { fields: [FADE_FIELD] }],
  ['fxSilence', '무음 처리', FX.silence, {}],
  ['fxReverse', '역재생', FX.reverse, {}],
  ['fxTempo', '속도 바꾸기', FX.tempo, { ripple: true, fields: [field('percent', '속도', 50, 200, 1, 110, '%')],
    note: '음높이는 그대로 두고 빠르기만 바꿔요. 뒤에 있는 소리는 길이가 바뀐 만큼 당겨지거나 밀려요.' }],
  ['fxPitch', '음높이 바꾸기', FX.pitch, { fields: [field('semitones', '음높이', -12, 12, 0.5, 2, '반음')],
    note: '길이는 그대로 두고 음높이만 바꿔요.' }],
  ['fxNoise', '잡음 줄이기', FX.noiseReduce, { profile: true, fields: P.FIELDS.noise, presets: P.PRESETS.noise,
    note: '잡음 프로필보다 작은 소리를 줄여요. 말소리가 뭉개지면 감소량을 낮추거나 민감도를 낮추세요.' }],
  ['fxEq', 'EQ', FX.eq, { fields: P.FIELDS.eq, presets: P.PRESETS.eq, graph: true,
    note: '그래프의 점을 끌어서 조절해요 (휠: 중음 폭, 더블클릭: 원래대로). 로우컷 0 Hz · 하이컷 20000 Hz는 꺼진 상태예요.' }],
  ['fxComp', '컴프레서', FX.compressor, { fields: P.FIELDS.comp, presets: P.PRESETS.comp,
    note: '임계값보다 큰 소리를 비율만큼 눌러서 크고 작은 소리 차이를 줄여요.' }],
  ['fxReverb', '리버브', FX.reverb, { overlay: true, fields: P.FIELDS.reverb, presets: P.PRESETS.reverb,
    note: '잔향 꼬리는 선택 구간 뒤로 이어져서 뒤 소리와 겹쳐요.' }],
  ['fxEcho', '에코 / 딜레이', FX.echo, { overlay: true, fields: P.FIELDS.echo, presets: P.PRESETS.echo,
    note: '메아리 꼬리는 선택 구간 뒤로 이어져서 뒤 소리와 겹쳐요.' }],
];

// a preview would stop the recording's playback: it is blocked while recording
const noPreview = () => state.recording && (D.toast('녹음 중에는 미리 들을 수 없어요'), true);
function previewFx(fn, opt, targets, vals) {
  const tg = targets[0], t = trackById(tg.trackId);
  const ch = t && E.renderRegion(t.clips, tg.a, Math.min(tg.b, tg.a + frames(10)));
  if (!ch || noPreview()) return;
  pause(); changed();
  try { engine.playPreview(fn(ch, sr(), opt.profile ? { ...vals, profile: state.noiseProfile } : vals)); } catch (e) {
    D.toast('미리듣기 실패: ' + e.message, 'error');
  }
}
// the effect's dialog (the EQ graph); null = 취소. It always opens with the same values (no memory)
function askParams(label, fn, opt, targets) {
  const extra = opt.graph ? (box, api) => {
    const gr = require('../panels/eq').mount(box, { get: api.get, set: api.set, height: 170 });
    api.onChange(gr.update);
  } : null;
  return D.modal({ title: label, note: opt.note, fields: opt.fields, presets: opt.presets, extra,
    onPreview: (v) => previewFx(fn, opt, targets, v), onClose: () => engine.stopPreview() });
}
// markers follow a stretch only when every track with sound after its start got it; checked before the
// edit, applied right to left like the edits
function stretchMarkers(results) {
  const groups = [...Map.groupBy(results, (x) => x.tg.a).values()];
  const covered = (g) => (t) => g.some((x) => x.tg.trackId === t.id) || !t.clips.some((c) => E.clipEnd(c) > g[0].tg.a);
  if (!groups.every((g) => T().every(covered(g)))) return () => {};
  return () => {
    for (const g of groups) {
      const big = g.reduce((m, x) => (x.tg.b > m.tg.b ? x : m)); // longest track: shorter ones end inside it
      const move = (m) => ({ ...m, frame: E.remapFrame(m.frame, big.tg.a, big.tg.b, big.out[0].length) });
      state.project.markers = state.project.markers.map(move);
    }
  };
}
// compute everything first (a progress step per target, where 멈추기 lands), then commit + assign: an exception or a
// stop leaves the project untouched. false: no sound in the targets (nothing done)
async function applyFx(targets, fn, opt, params, step) {
  const results = [];
  for (const [i, tg] of targets.entries()) {
    const t = trackById(tg.trackId), ch = E.renderRegion(t.clips, tg.a, tg.b);
    await step(i, targets.length, `${t.name} (${i + 1}/${targets.length})`);
    const first = t.clips.find((c) => c.start < tg.b && E.clipEnd(c) > tg.a);
    if (ch) results.push({ tg, name: first ? first.name : t.name, out: fn(ch, sr(), params) });
  }
  results.sort((x, y) => y.tg.a - x.tg.a); // right to left so ripple shifts never move pending targets
  if (!results.length) return false;
  const markers = opt.ripple ? stretchMarkers(results) : () => {};
  history.commit();
  const newIds = new Set();
  for (const { tg, name: n, out } of results) {
    const clips = E.replaceRegion(trackById(tg.trackId).clips, tg.a, tg.b, out, n, !opt.overlay);
    setClips(tg.trackId, clips);
    newIds.add(clips.find((c) => c.src.ch === out).id);
  }
  markers();
  const r = state.sel.range;
  if (r && opt.ripple) r.b = r.a + results[0].out[0].length;
  if (!r && state.sel.clipIds.size) state.sel.clipIds = newIds;
  return true;
}
async function runFx(name, label, fn, opt) {
  const targets = fxTargets();
  if (!targets.length) return D.toast('먼저 소리를 불러오세요');
  if (opt.profile && !state.noiseProfile) {
    return D.toast('먼저 잡음만 있는 구간을 선택하고 [효과 > 잡음 프로필 잡기]를 하세요', 'error');
  }
  let params = {};
  if (opt.fields && !(params = await askParams(label, fn, opt, targets))) return;
  if (opt.profile) params = { ...params, profile: state.noiseProfile };
  try {
    const r = await D.busy(label + ' 적용 중', (step) => applyFx(targets, fn, opt, params, step));
    if (r === D.STOPPED) return D.toast('멈췄어요 — 바뀐 것 없어요');
    if (!r) return D.toast('선택한 구간에 소리가 없어요 — 바뀐 것 없어요');
    D.toast(label + ' 적용했어요');
    afterEdit();
  } catch (e) {
    D.toast(label + ' 실패: ' + e.message, 'error');
  }
}
// a dialog first: the menu label ends in …
for (const [name, label, fn, opt] of FXDEFS) {
  def(name, opt.fields ? label + '…' : label, () => runFx(name, label, fn, opt));
}

def('fxProfile', '잡음 프로필 잡기', () => {
  const r = state.sel.range;
  if (!r) return D.toast('잡음만 들리는 구간(말 안 하는 부분)을 선택하세요', 'error');
  const chs = rangeTracks().map((t) => E.renderRegion(t.clips, r.a, r.b)).filter(Boolean);
  if (!chs.length || r.b - r.a < frames(0.1)) return D.toast('0.1초 이상, 소리가 있는 구간을 선택하세요', 'error');
  state.noiseProfile = FX.noiseProfile(chs.flat());
  const sec = ((r.b - r.a) / sr()).toFixed(1);
  D.toast(`잡음 프로필을 잡았어요 (${sec}초). 이제 처리할 구간을 선택하고 잡음 줄이기를 하세요`);
});

// shape of a fade edge ('fadeIn' | 'fadeOut'); a new fade is always 직선
const shapeOf = (c, edge) => c[edge + 'Shape'] || 'linear';
function setFadeShape(clipId, edge, shape) {
  const t = T().find((x) => x.clips.some((c) => c.id === clipId));
  if (!t || shapeOf(t.clips.find((c) => c.id === clipId), edge) === shape) return; // the shape it has: no undo step
  history.commit();
  setClips(t.id, t.clips.map((c) => (c.id === clipId ? E.clampFades({ ...c, [edge + 'Shape']: shape }) : c)));
  afterEdit();
}
// the same volume, fades and fade shapes (no shape = 직선)
const sameLook = (c, n) => (c.gain ?? 1) === n.gain && (c.fadeIn || 0) === n.fadeIn && (c.fadeOut || 0) === n.fadeOut
  && shapeOf(c, 'fadeIn') === shapeOf(n, 'fadeIn') && shapeOf(c, 'fadeOut') === shapeOf(n, 'fadeOut');
function clipFields(sc) {
  const c0 = sc[0].c, maxLen = +(Math.min(...sc.map(({ c }) => c.length)) / sr()).toFixed(2);
  const db = (c0.gain ?? 1) > 0 ? 20 * Math.log10(c0.gain ?? 1) : -24;
  const sec = (fr) => +Math.min(maxLen, fr / sr()).toFixed(2);
  return [
    field('db', '클립 볼륨', -24, 12, 0.5, Math.max(-24, Math.min(12, Math.round(db * 2) / 2)), 'dB'),
    field('fi', '페이드 인', 0, maxLen, 0.01, sec(c0.fadeIn || 0), '초'),
    { key: 'fis', label: '페이드 인 모양', options: FADE_SHAPES, value: shapeOf(c0, 'fadeIn') },
    field('fo', '페이드 아웃', 0, maxLen, 0.01, sec(c0.fadeOut || 0), '초'),
    { key: 'fos', label: '페이드 아웃 모양', options: FADE_SHAPES, value: shapeOf(c0, 'fadeOut') },
  ];
}
def('clipProps', '클립 볼륨 · 페이드…', async () => {
  const sc = selClips();
  if (!sc.length) return D.toast('클립을 먼저 선택하세요 (이름 띠 클릭)');
  const note = sc.length > 1 ? `선택한 클립 ${sc.length}개에 똑같이 적용해요.`
    : '페이드는 클립 위쪽 모서리의 작은 네모를 끌어서도 바꿀 수 있어요.';
  const fields = clipFields(sc), v = await D.modal({ title: '클립 볼륨 · 페이드', note, fields });
  if (!v) return;
  // a value left as it opened is the first clip's exact one: the dialog shows it rounded (0.5 dB, 0.01 s)
  const c0 = sc[0].c, kept = (k, exact, typed) => (v[k] === fields.find((f) => f.key === k).value ? exact : typed);
  const patch = { gain: kept('db', c0.gain ?? 1, Math.pow(10, v.db / 20)), fadeIn: kept('fi', c0.fadeIn || 0,
    frames(v.fi)), fadeOut: kept('fo', c0.fadeOut || 0, frames(v.fo)), fadeInShape: v.fis, fadeOutShape: v.fos };
  const ids = state.sel.clipIds, next = (c) => E.clampFades({ ...c, ...patch });
  // 확인 with nothing changed: no undo step
  if (!T().some((t) => t.clips.some((c) => ids.has(c.id) && !sameLook(c, next(c))))) return;
  history.commit();
  for (const t of T()) {
    if (!t.clips.some((c) => ids.has(c.id))) continue;
    setClips(t.id, t.clips.map((c) => (ids.has(c.id) ? next(c) : c)));
  }
  afterEdit();
}, () => state.sel.clipIds.size > 0);

module.exports = { FADE_SHAPES, shapeOf, setFadeShape, fxTargets, noPreview };
