// Script recording mode (spec §5-5): the current line and all its takes on screen, ★, the line list,
// 대본 넣기, 보통 프로젝트로 바꾸기, 대사 고치기.
const { ipcRenderer } = require('electron');
const SCR = require('../../core/script');
const D = require('../dialogs');
const { readScript } = require('../../core/scriptfile');
const { cmds, def, T, clearSel, SC, curLine, setLine } = require('./core');
const { afterEdit, pause } = require('./play');
const { state, history, makeTrack, changed, tidySel, COLORS } = require('../../core/state');

const R = () => require('./record'); // lazy: record.js requires this file

// a new take of the current line, named 테이크 n, with its character's color and effects
const newTake = (props) => makeTrack({
  name: SCR.nextTakeName(T()), ...SCR.takeView({}, SC().chars[curLine().char]),
  ...props,
});
// l becomes the current line: its takes go into project.tracks with the character's color and effects
function showLine(l) {
  if (!state.recording) pause(); // 보는 대사만 바뀜: what played was this line's
  SC().lineId = l.id;
  state.project.tracks = l.takes;
  state.sel.playhead = 0; state.sel.markerId = null;
  state.view.scrollX = 0; state.view.scrollY = 0;
  clearSel(); viewTakes(); // a line opens with ★ selected (none: its first take)
}
// every take of the current line on screen in recorded order (spec §5-5), re-viewed with the
// character's color and effects (a stashed line missed live changes). Selects pick, else ★, else the first take.
function viewTakes(pick) {
  const l = curLine();
  if (!l) return;
  state.project.tracks = T().map((t) => SCR.takeView(t, SC().chars[l.char]));
  const ok = (id) => id && T().some((t) => t.id === id);
  state.sel.activeTrackId = [pick, l.star, T()[0] && T()[0].id].find(ok) || null;
}
const takeCount = () => (curLine() ? T().length : 0);

// R's stop still keeping its take; settle waits for it (no await at all when nothing is stopping)
const stopping = () => state.recording && R().busy();
const settle = async () => { while (stopping()) await new Promise((r) => setTimeout(r, 20)); };
// 보는 대사만 바뀜: moving stops a recording first (its take stays; a stop already keeping it is
// waited for; a mic still opening records into the line moved to) and playback. Then stash; not an undo step
async function goLine(id) {
  const ok = () => SC() && id !== SC().lineId && SC().lines.some((l) => l.id === id);
  if (!ok()) return;
  if (stopping()) await settle();
  if (state.recording) await R().stopRecording();
  if (!ok()) return;
  const s = SC();
  setLine(s.lineId, { takes: T() });
  showLine(s.lines.find((l) => l.id === id));
  if (T().some((t) => t.clips.length)) cmds.zoomFit.run();
  changed();
}
// the list: character tab, '녹음 안 한 것만' (a line leaves it once done, the current one too); Ctrl+F looks in it
function visibleLines() {
  if (!SC()) return [];
  const now = SCR.linesNow(state.project), v = state.ui.scriptView;
  // a tab whose character has no lines any more (a re-import, Ctrl+Z) is 전체 again: no tab would show it
  if (v.char && !now.some((l) => l.char === v.char)) v.char = '';
  return now.filter((l) => (!v.char || l.char === v.char) && (!v.todo || !SCR.isDone(l)));
}
// next/previous line in the list, in script order (works when the current line is filtered out)
function lineAfter(d) {
  const all = SC().lines, at = new Map(all.map((l, k) => [l.id, k])), i = at.get(SC().lineId), vis = visibleLines();
  return d > 0 ? vis.find((l) => at.get(l.id) > i) : vis.reverse().find((l) => at.get(l.id) < i);
}
const canMove = () => !!curLine();
// the next / previous line is picked once a stop in flight is done (↓↓ right after R goes two lines)
const step = (d) => async () => { if (stopping()) await settle(); const l = lineAfter(d); return l && goLine(l.id); };
def('nextLine', '다음 대사', step(1), canMove);
def('prevLine', '이전 대사', step(-1), canMove);
function setScriptView(patch) {
  Object.assign(state.ui.scriptView, patch);
  const v = state.ui.scriptView;
  // a tab shows that character's lines
  const l = v.char && curLine().char !== v.char && visibleLines()[0];
  changed();
  return l && goLine(l.id);
}
// ★ = the take that exports; an undo step. While recording too.
function setStar(takeId) {
  const l = curLine();
  if (!l || (l.star === takeId && l.state !== 'redo')) return;
  if (!T().some((t) => t.id === takeId)) return;
  history.commit(null, '★ 고르기');
  setLine(l.id, SCR.withStar(takeId)); // picking ★ (even the same one) clears '다시 녹음 필요'
  afterEdit();
}

const pickScript = async (title) => {
  const r = await ipcRenderer.invoke('open-dialog', { title, properties: ['openFile'],
    filters: [{ name: '대본 (텍스트 · CSV · 엑셀)', extensions: ['txt', 'csv', 'tsv', 'xlsx'] }] });
  return !r.canceled && r.filePaths.length ? r.filePaths[0] : null;
};
async function loadScriptFile(p) {
  let got;
  try { got = await readScript(p); } catch (e) { D.toast('대본을 읽을 수 없어요: ' + e.message, 'error'); return null; }
  if (!got.lines.length) {
    D.toast('대본에서 대사를 찾지 못했어요. 텍스트는 한 줄에 "이름: 대사", 엑셀 · CSV는 캐릭터 | 대사 열인지 확인하세요', 'error');
    return null;
  }
  return { lines: got.lines, dup: got.dup ? ` · 겹친 번호 ${got.dup}개는 새 번호를 매겼어요` : '' };
}
// 대본 넣기: a plain project becomes a script project (its tracks go, after a warning); in a script project
// the new script is the base. Both are one undo step.
def('importScript', '대본 넣기…', async () => {
  if (!(await R().stopFirst())) return;
  const p = await pickScript('대본 넣기');
  if (p) return importScript(p);
});
// what the screen shows right after a project became a script project / a plain one (menu and sori live alike)
function enterScript() {
  clearSel();
  state.ui.fxTarget = 'master';
  state.ui.scriptView = { char: '', todo: false };
  showLine(SC().lines[0]);
}
function leaveScript() {
  clearSel();
  state.sel.playhead = 0; state.sel.markerId = null;
  state.sel.activeTrackId = T().length ? T()[0].id : null;
  state.ui.fxTarget = 'master';
}
async function importScript(p) {
  const got = await loadScriptFile(p);
  if (!got) return;
  if (SC()) return reimportScript(got.lines, got.dup);
  const n = T().length;
  const note = `트랙 ${n}개가 모두 지워지고 대본 프로젝트가 돼요. Ctrl+Z로 되돌릴 수 있어요.`;
  if (n && !(await D.modal({ title: '대본 넣기', okLabel: '지우고 대본 넣기', note }))) return;
  history.commit(null, '대본 넣기');
  const script = { lines: got.lines, lineId: null, chars: Object.create(null) }; // no inherited keys as characters
  SCR.addChars(script.chars, got.lines, COLORS);
  state.project.script = script;
  enterScript();
  afterEdit();
  D.toast(`대본을 넣었어요: 대사 ${got.lines.length}개 · 캐릭터 ${Object.keys(script.chars).length}명${got.dup}`
    + (n ? ' · Ctrl+Z로 되돌리기' : ''));
}
// a changed script: match by name, show what changes first
const SAME = ['id', 'char', 'num', 'text', 'memo', 'state'];
async function reimportScript(fresh, dup) {
  const old = SCR.linesNow(state.project), { lines, counts: n } = SCR.merge(old, fresh);
  // the same script again: no question, no undo step
  if (lines.length === old.length && lines.every((l, i) => SAME.every((k) => l[k] === old[i][k]))) {
    return D.toast('대본에서 바뀐 대사가 없어요');
  }
  const takes = n.goneTakes ? ` (테이크 ${n.goneTakes}개도 지워져요)` : '';
  const note = `새 대사 ${n.added}개 · 내용 바뀜 ${n.changed}개 (녹음이 있으면 '다시 녹음 필요') · 없어짐 ${n.gone}개${takes}`
    + ` · 그대로 ${n.same}개${dup}`;
  if (!(await D.modal({ title: '대본 넣기', okLabel: '바꾸기', note }))) return;
  history.commit(null, '대본 넣기');
  const s = SC();
  SCR.addChars(s.chars, lines, COLORS);
  s.lines = lines;
  if (!lines.some((l) => l.id === s.lineId)) showLine(lines[0]); // the current line left the script
  tidySel(); // the effect panel off a character whose lines all went
  afterEdit();
  D.toast('대본을 바꿨어요 · Ctrl+Z로 되돌리기');
}
// 보통 프로젝트로 바꾸기: every take becomes a track that sounds as it did; lines, memos and ★ go. One undo
// step.
def('unscript', '보통 프로젝트로 바꾸기…', async () => {
  if (!(await R().stopFirst())) return;
  const tracks = SCR.unscript(state.project);
  const note = `테이크 ${tracks.length}개는 트랙이 되고, 대사 · 메모 · ★는 사라져요. Ctrl+Z로 되돌릴 수 있어요.`;
  if (!(await D.modal({ title: '보통 프로젝트로 바꾸기', okLabel: '바꾸기', note }))) return;
  history.commit();
  state.project.script = null;
  state.project.tracks = tracks;
  leaveScript();
  afterEdit();
  D.toast(`보통 프로젝트로 바꿨어요: 트랙 ${tracks.length}개 · Ctrl+Z로 되돌리기`);
}, () => !!SC());
def('editLine', '대사 고치기…', async () => {
  const l = curLine();
  const v = await D.modal({ title: '대사 고치기 · ' + SCR.lineName(l), okLabel: '고치기', fields: [
    { key: 'text', label: '대사', text: true, value: l.text, maxLength: 1000 },
    { key: 'memo', label: '메모', text: true, value: l.memo, maxLength: 300 }] });
  if (!v) return;
  const text = v.text.replace(/\s+/g, ' ').trim(), memo = v.memo.trim(), now = curLine();
  if (!text && !memo) return D.toast('대사나 메모 중 하나는 있어야 해요', 'error');
  if (text === now.text && memo === now.memo) return;
  history.commit();
  const next = SCR.editLine({ ...now, takes: T() }, text, memo);
  setLine(now.id, { state: next.state, text, memo });
  changed();
}, () => !!curLine());

module.exports = {
  newTake, showLine, viewTakes, takeCount, goLine, visibleLines, lineAfter, setScriptView, setStar, importScript,
  enterScript, leaveScript,
};
