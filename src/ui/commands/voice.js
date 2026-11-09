// 목소리 정리: the group at the top of the 효과 menu. Each effect opens a small window with its
// strength words + 미리듣기 (Enter = 보통); 한 번에 깔끔하게 has a row per step. Every window opens with the same values
// (no memory: a button always does the same). One undo step;
// a step that cannot measure is skipped and named in the notice. The work itself is core/voicedit.js (the CLI too).
const E = require('../../core/edit');
const V = require('../../core/voice');
const VE = require('../../core/voicedit');
const engine = require('../../audio/engine');
const D = require('../dialogs');
const { def, T, frames, setClips } = require('./core');
const { fxTargets, noPreview } = require('./effects');
const { rippleMarkers } = require('./edit');
const { pause, afterEdit } = require('./play');
const { state, history, changed, trackById, sr } = require('../../core/state');

const words = (step) => (step === 'loud' ? ['작게', '보통', '크게'] : ['약하게', '보통', '강하게']);
const LUFS = { low: '-23', mid: '-16', high: '-14' }; // loudness words carry their number underneath
const choices = (step) => V.LEVELS.map((value, i) => ({
  value, label: words(step)[i], ...(step === 'loud' && { sub: LUFS[value] + ' LUFS' }),
}));
const SINGLE = [
  ['voiceLoud', 'loud', '트랙마다 이 크기로 맞춰요. 튀는 소리는 찢어지지 않게 눌러요.'],
  ['voiceGaps', 'gaps', '말 사이의 긴 쉼은 짧게, 맨 앞 · 맨 끝 쉼은 늘 같은 길이로 맞춰요 (짧으면 무음을 덧붙여요). 트랙마다 따로 해요.'],
  ['voiceDeess', 'deess', "'ㅅ · ㅊ' 쉿 소리를 줄여요."],
  ['voiceHum', 'hum', '전기에서 나는 웅— 소리를 찾아서 지워요.'],
  ['voiceGate', 'gate', '말 안 할 때의 숨소리 · 잡음을 줄여요. 강하게는 완전히 꺼요.'],
  ['voiceEven', 'even', '크고 작은 목소리를 비슷한 크기로 맞춰요.'],
];
const OFF = { value: 'off', label: '끄기' };

// the first target's first 10 s through the same edit, played
async function preview(rows) {
  const tg = fxTargets()[0], t = tg && trackById(tg.trackId);
  const ch = t && E.renderRegion(t.clips, tg.a, Math.min(tg.b, tg.a + frames(10)));
  if (!ch || noPreview()) return;
  pause(); changed();
  try {
    const lane = { id: 'p', name: '', clips: [E.makeClip(E.makeSource(ch), 0, '')] };
    const r = await VE.voiceEdit([lane], [{ trackId: 'p', a: 0, b: ch[0].length }], sr(), rows);
    const cs = r.clips.get('p');
    engine.playPreview(E.renderRegion(cs, 0, E.projectEnd([{ clips: cs }])) || ch);
    if (r.skipped.length) D.toast(r.skipped.map(V.skipNote).join(' · '));
  } catch (e) {
    D.toast('미리듣기 실패: ' + e.message, 'error');
  }
}
// after the edit: a range ends where its sound now ends, selected clips are the new ones
function reselect(done) {
  const r = state.sel.range;
  if (r) { r.b = Math.max(...done.map((t) => t.newB)); return; }
  if (!state.sel.clipIds.size) return;
  const inside = (t) => trackById(t.trackId).clips.filter((c) => c.start >= t.newA && E.clipEnd(c) <= t.newB);
  state.sel.clipIds = new Set(done.flatMap((t) => inside(t).map((c) => c.id)));
}
async function apply(label, rows) {
  const targets = fxTargets();
  if (!targets.length) return D.toast('먼저 소리를 불러오세요');
  let r;
  try {
    r = await D.busy(label + ' 적용 중', (step) => VE.voiceEdit(T(), targets, sr(), rows, step));
  } catch (e) {
    return D.toast(label + ' 실패: ' + e.message, 'error');
  }
  if (r === D.STOPPED) return D.toast('멈췄어요 — 바뀐 것 없어요');
  const notes = r.skipped.map(V.skipNote), edits = [...r.clips].filter(([id, cs]) => trackById(id).clips !== cs);
  if (!edits.length) return D.toast(notes.join(' · ') || '바뀐 소리가 없어요');
  history.commit();
  for (const [id, cs] of edits) setClips(id, cs);
  // each cut is one track's: markers follow only when that track is every track
  for (const c of r.cuts) rippleMarkers(new Set([c.trackId]), c.a, c.b, c.add);
  reselect(r.done);
  afterEdit();
  D.toast([label + ' 적용했어요', ...notes].join(' · '));
}

for (const [name, step, note] of SINGLE) {
  const label = V.LABELS[step];
  def(name, label + '…', async () => {
    if (!fxTargets().length) return D.toast('먼저 소리를 불러오세요');
    const level = { key: 'level', label: step === 'loud' ? '크기' : '세기', options: choices(step), value: 'mid' };
    const v = await D.modal({ title: label, note, fields: [level], onPreview: (x) => preview({ [step]: x.level }),
      onClose: () => engine.stopPreview() });
    if (v) await apply(label, { [step]: v.level });
  });
}
def('voiceClean', '한 번에 깔끔하게…', async () => {
  if (!fxTargets().length) return D.toast('먼저 소리를 불러오세요');
  const row = ([k, value]) => ({ key: k, label: V.LABELS[k], options: [OFF, ...choices(k)], value });
  const fields = Object.entries(V.CLEAN).map(row);
  const v = await D.modal({ title: '한 번에 깔끔하게', note: '위에서부터 차례로 해요. 실행취소 한 번이면 모두 되돌려요.',
    fields, onPreview: preview, onClose: () => engine.stopPreview() });
  if (v) await apply('한 번에 깔끔하게', v);
});
