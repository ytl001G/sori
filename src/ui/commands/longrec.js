// 이어 녹음 and 긴 녹음 나누기 (spec §5-5): one long recording (or a long file) -> the 나누기 window -> new takes.
// While 이어 녹음 runs, N cues the next line (marking the recording) and Shift+N takes the last N back.
const { ipcRenderer } = require('electron');
const SPL = require('../../core/split');
const SCR = require('../../core/script');
const D = require('../dialogs');
const engine = require('../../audio/engine');
const { def, T, SC, curLine, setLine } = require('./core');
const { afterEdit } = require('./play');
const { visibleLines, viewTakes } = require('./script');
const { state, history, setHolding, sr, changed } = require('../../core/state');

const R = () => require('./record'); // lazy: record.js requires this file on stop
const ui = () => require('../split'); // lazy: the window requires dialogs, which load after commands
const cont = () => R().recInfo() && R().recInfo().cont;

// the lines pieces go to: the current one, then the list's lines after it in script order
function order() {
  const at = new Map(SC().lines.map((l, k) => [l.id, k])), i = at.get(SC().lineId);
  return [SC().lineId, ...visibleLines().filter((l) => at.get(l.id) > i).map((l) => l.id)];
}
// the line the prompter shows while 이어 녹음 runs (null otherwise)
const cue = () => cont() && SC().lines.find((l) => l.id === cont().order[cont().at]);
const cueNextLine = () => cont() && SC().lines.find((l) => l.id === cont().order[cont().at + 1]);

def('contRecord', '이어 녹음', async () => {
  if (R().busy()) return;
  if (state.recording) return R().stopRecording();
  engine.resetClip('input');
  return R().begin({ order: order(), at: 0, marks: [] });
}, () => !!curLine());
def('cueNext', '다음 대사 (이어 녹음 중)', () => {
  const c = cont();
  if (engine.countingIn() || !engine.recording()) return;
  if (c.at >= c.order.length - 1) return D.toast('마지막 대사예요. Shift+R로 멈추세요');
  c.marks.push(engine.recording().length);
  c.at++;
  changed();
}, () => !!cont());
def('cueBack', '다음 대사 되돌리기 (이어 녹음 중)', () => {
  const c = cont();
  if (!c.marks.length) return;
  c.marks.pop();
  c.at--;
  changed();
}, () => !!cont());

const pickAudio = async () => {
  const r = await ipcRenderer.invoke('open-dialog', { title: '긴 녹음 나누기', properties: ['openFile'],
    filters: [{ name: '오디오', extensions: ['wav', 'mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'webm'] }] });
  return !r.canceled && r.filePaths.length ? r.filePaths[0] : null;
};
def('splitFile', '긴 녹음 나누기…', async () => {
  const p = await pickAudio();
  if (!p) return;
  const got = await require('./files').decodeAll([p]);
  if (got && got.length) return review(got[0].ch, { order: order(), marks: [] }, 0, false);
}, () => !!curLine() && !state.recording);

// the recording (lead frames already cut from ch, not yet from the marks) -> the window -> takes. lost: the sound
// exists only here (이어 녹음), so closing the window without 적용 asks first
async function review(ch, c, lead, lost = true) {
  try { await reviewIn(ch, c, lead, lost); } finally { if (lost) setHolding(false); }
}
async function reviewIn(ch, c, lead, lost) {
  const rate = sr(), len = ch[0].length;
  let sound = null;
  const r = await D.busy('나눌 곳 찾는 중', async () => { sound = SPL.soundRuns(ch, rate); });
  if (r === D.STOPPED || !sound) return D.toast(lost ? '멈췄어요 — 긴 녹음은 버렸어요' : '멈췄어요 — 바뀐 것 없어요');
  const marks = c.marks.map((m) => m - lead).filter((m) => m > 0 && m < len);
  const bounds = [...new Set(marks.map((m) => SPL.snap(sound, m, rate, len)))].sort((a, b) => a - b);
  const lines = c.order.map((id) => SCR.linesNow(state.project).find((l) => l.id === id)).filter(Boolean);
  const st = await ui().open({ ch, sr: rate, sound, bounds, lines, lost });
  if (st) apply(ch, lines, st);
}
// every kept piece becomes a new take of its line; one undo step
function apply(ch, lines, st) {
  const { lines: plan } = SPL.plan(st, lines.length);
  if (!plan.length) return D.toast('넣을 조각이 없어요 — 바뀐 것 없어요');
  history.commit();
  let n = 0;
  for (const { line, ranges } of plan) {
    const id = lines[line].id, here = id === SC().lineId, l = SC().lines.find((x) => x.id === id);
    const next = SPL.addTakes(here ? { ...l, takes: T() } : l, ch, ranges, SC().chars[l.char]);
    if (here) state.project.tracks = next.takes;
    setLine(id, { takes: next.takes, star: next.star, state: next.state });
    n += ranges.length;
  }
  viewTakes(state.sel.activeTrackId);
  afterEdit();
  D.toast(`대사 ${plan.length}개에 테이크 ${n}개를 넣었어요 · Ctrl+Z로 되돌리기`);
}

module.exports = { review, cue, cueNextLine };
