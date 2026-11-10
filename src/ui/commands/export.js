// 내보내기: the mix (all tracks or the current one; whole, selection or one file per marker segment) and, in a script
// project, 대사별 내보내기 (one file per line's ★ take).
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const E = require('../../core/edit');
const IO = require('../../core/fileio');
const { peak } = require('../../core/effects');
const { writeAtomic, uniquePaths, newFolders } = require('../../core/safewrite');
const { pool, RENDERS } = require('../../core/pool');
const SCR = require('../../core/script');
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const MP3 = require('../../audio/mp3');
const D = require('../dialogs');
const { def, T, hasAudio, SC, curLine } = require('./core');
const { baseName } = require('./files');
const { state, trackById, sr } = require('../../core/state');

const { safeName } = IO;
const markerSegments = (end = E.projectEnd(T())) => E.markerSegments(state.project.markers, end, sr());

let clipped = false; // a rendered sample went past 0 dBFS in this export (the export says so)
// onPart(fraction): the render's progress (engine.mixdown); encoding after it is not counted
// shortcut: MP3 encoding of a long mix runs at 100 % without steps (in a worker: the screen stays live)
async function renderFile(fmt, a, b, tracks, onPart) {
  const ch = await engine.mixdown(tracks, state.project.master, a, b, onPart);
  if (peak(ch) > 1) clipped = true;
  if (fmt.startsWith('mp3')) return MP3.encode(ch, sr(), +fmt.split('_')[1]); // on another CPU
  return IO.encodeWav(ch, sr(), fmt === 'wav24' ? 24 : 16);
}
const doneToast = (msg) => D.toast(clipped ? `${msg} · 0dB를 넘어 잘린 곳이 있어요 — 마스터 음량이나 리미터를 확인하세요` : msg);
// a folder of files; names that clash get ' (2)'; asks before replacing existing ones. Each goes to
// `<name>.part` (a progress step per file, the render's progress inside it) and all are renamed at the end, so
// 멈추기 or an error while rendering leaves no new file or folder and replaces none; a failed rename at the end can
// leave the files renamed before it in place. render(f, onPart) -> bytes (or their Promise), k files at once
// (MP3.jobsFor; a stop waits for the MP3 encodes in flight). false = not done (declined or stopped; a stop says so)
async function writeAll(list, busyText, render, k = RENDERS) {
  const files = uniquePaths(list.map((f) => f.path)).map((p, i) => ({ ...list[i], path: p }));
  clipped = false;
  const exist = files.filter((f) => fs.existsSync(f.path)).length;
  const over = () => D.ask({ title: `같은 이름의 파일 ${exist}개가 이미 있어요.`, note: '덮어쓸까요?', yes: true,
    buttons: [{ label: '취소', value: false }, { label: '덮어쓰기', value: true, primary: true }] });
  if (exist && !(await over())) return false;
  const parts = [], made = newFolders(files.map((f) => f.path)), doing = new Map(), n = files.length;
  let done = 0;
  const r = await D.busy(busyText, async (step) => {
    // RENDERS files at once: the bar = files done + the parts rendered of those in flight
    const at = (i) => (x) => {
      doing.set(i, x);
      const now = done + [...doing.values()].reduce((s, v) => s + v, 0);
      return step(now, n, `${path.basename(files[i].path)} (${Math.min(n, done + 1)}/${n})`);
    };
    try {
      await pool(n, k, async (i) => {
        const f = files[i];
        await at(i)(0);
        const data = await render(f, at(i));
        await fs.promises.mkdir(path.dirname(f.path), { recursive: true });
        parts.push(f.path + '.part');
        await fs.promises.writeFile(f.path + '.part', data);
        doing.delete(i); done++;
      });
      for (const f of files) await fs.promises.rename(f.path + '.part', f.path);
    } catch (e) {
      await Promise.all(parts.map((p) => fs.promises.rm(p, { force: true })));
      for (const d of made) await fs.promises.rmdir(d).catch(() => {}); // deepest first; only when empty
      throw e;
    }
  });
  if (r === D.STOPPED) D.toast('멈췄어요 — 바뀐 것 없어요');
  return r !== D.STOPPED;
}
const pickFolder = async (title) => {
  const r = await ipcRenderer.invoke('open-dialog', { title, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
};

const FORMATS = [{ value: 'wav16', label: 'WAV 16bit' }, { value: 'wav24', label: 'WAV 24bit' },
  { value: 'mp3_128', label: 'MP3 128k' }, { value: 'mp3_192', label: 'MP3 192k' },
  { value: 'mp3_320', label: 'MP3 320k' }];
// the 내보내기 dialog's fields: format, which tracks (when there is a choice), range (when there is a choice). It always
// opens the same: the 설정 format, 모두 섞기, 전체 (no memory)
function exportFields(cur, segs) {
  const fields = [{ key: 'format', label: '형식', value: S.get().exportFormat, options: FORMATS }];
  if (T().length > 1 && cur) {
    fields.push({ key: 'tracks', label: '트랙', value: 'all',
      options: [{ value: 'all', label: '모두 섞기' }, { value: 'cur', label: `지금 트랙만: ${cur.name}` }] });
  }
  const ranges = [{ value: 'all', label: '전체' }];
  if (state.sel.range) ranges.push({ value: 'sel', label: '선택 구간' });
  if (state.project.markers.length) ranges.push({ value: 'markers', label: `마커 구간별 (${segs.length}개 파일)` });
  if (ranges.length > 1) fields.push({ key: 'range', label: '범위', value: 'all', options: ranges });
  return fields;
}
def('export', '내보내기…', async () => {
  if (curLine()) return exportLines();
  if (!hasAudio()) return D.toast('내보낼 소리가 없어요');
  const cur = trackById(state.sel.activeTrackId), segs = markerSegments();
  const note = '모든 트랙을 볼륨 · 팬 · 음소거 · 트랙 효과 · 마스터 효과대로 섞어서 스테레오 파일로 만들어요.';
  const v = await D.modal({ title: '내보내기', note, fields: exportFields(cur, segs), okLabel: '내보내기' });
  if (!v) return;
  // 지금 트랙만 = what solo plays: its effects, volume and pan + the master chain; its own mute is ignored (spec §1)
  const only = v.tracks === 'cur' && cur, tracks = only ? [{ ...only, mute: false, solo: false }] : T();
  if (only && !only.clips.length) return D.toast(`'${only.name}' 트랙에는 내보낼 소리가 없어요`);
  const ext = v.format.startsWith('mp3') ? '.mp3' : '.wav';
  if (v.range === 'markers') {
    return exportSegments(v.format, ext, only ? markerSegments(E.projectEnd(tracks)) : segs, tracks);
  }
  return exportMix(v, ext, only, tracks);
});
async function exportMix(v, ext, only, tracks) {
  const r = state.sel.range, useSel = r && v.range === 'sel';
  const name = (state.filePath ? baseName(state.filePath) : '내보내기') + (only ? ' - ' + safeName(only.name) : '');
  const out = await ipcRenderer.invoke('save-dialog', {
    title: '내보내기', defaultPath: name + ext,
    filters: [ext === '.mp3' ? { name: 'MP3', extensions: ['mp3'] } : { name: 'WAV', extensions: ['wav'] }],
  });
  if (out.canceled || !out.filePath) return;
  const [a, b] = useSel ? [r.a, r.b] : [0, E.projectEnd(tracks)];
  try {
    clipped = false;
    const r = await D.busy('내보내는 중', async (step) => {
      const data = await renderFile(v.format, a, b, tracks, (x) => step(x, 1, '소리 섞는 중'));
      await writeAtomic(out.filePath, data);
    });
    if (r === D.STOPPED) return D.toast('멈췄어요 — 바뀐 것 없어요');
    doneToast('내보냈어요: ' + path.basename(out.filePath));
  } catch (e) {
    D.toast('내보내지 못했어요: ' + e.message, 'error');
  }
}

async function exportSegments(fmt, ext, segs, tracks) {
  const dir = await pickFolder('마커 구간 파일을 저장할 폴더');
  if (!dir) return;
  if (!segs.length) return D.toast('내보낼 구간이 없어요');
  const width = String(segs.length).length;
  const file = (i, name) => path.join(dir, `${String(i + 1).padStart(width, '0')} ${safeName(name)}${ext}`);
  const files = segs.map(([a, b, name], i) => ({ a, b, path: file(i, name) }));
  try {
    const busy = `마커 구간 ${segs.length}개 내보내는 중`;
    if (await writeAll(files, busy, (f, at) => renderFile(fmt, f.a, f.b, tracks, at), MP3.jobsFor(fmt))) {
      doneToast(`${segs.length}개 파일로 내보냈어요: ${dir}`);
    }
  } catch (e) {
    D.toast('내보내지 못했어요: ' + e.message, 'error');
  }
}

// 대사별 내보내기: format and which lines (all, the characters picked, the current line). 캐릭터 고르기 opens with
// the current line's character pressed, every time
function linesDialog(cur, all) {
  const count = (r) => { const x = SCR.exportPick(all, r); return x.ready.length + x.skipped.length; };
  const options = [{ value: 'all', label: `전체 (${count({})}개)` }, { value: 'chars', label: '캐릭터 고르기' },
    { value: 'line', label: `지금 대사: ${SCR.lineName(cur)}` }];
  const chars = [...new Set(all.map((l) => l.char))]
    .map((c) => ({ value: c, label: `${c} (${count({ chars: [c] })}개)` }));
  return D.modal({ title: '대사별 내보내기', okLabel: '폴더 고르기',
    note: '대사마다 ★ 테이크를 파일 하나로 만들어요 (파일 이름 = 캐릭터-번호). 캐릭터 효과와 마스터 효과가 들어가요. '
      + '전체 · 캐릭터 고르기는 캐릭터마다 폴더를 나눠요.',
    fields: [{ key: 'format', label: '형식', value: S.get().exportFormat, options: FORMATS },
      { key: 'lines', label: '범위', value: 'all', options },
      { key: 'chars', label: '캐릭터', multi: true, when: ['lines', 'chars'], value: [cur.char], options: chars }] });
}
// 전체 · 캐릭터 고르기 write into a new folder in the chosen one, '녹음 대사 2026-11-09 17-40' (project, time), a
// folder per character in it; a name taken already gets (2), (3)…
function linesFolder(dir) {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
  const name = safeName(`${state.filePath ? baseName(state.filePath) : '새 프로젝트'} 대사 ${when}`);
  let out = path.join(dir, name);
  for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${name} (${n})`);
  return out;
}
// one file per line: the ★ take with its character's effects + the master chain, named 캐릭터-번호
async function exportLines() {
  const cur = curLine(), all = SCR.linesNow(state.project);
  const v = await linesDialog(cur, all);
  if (!v) return;
  if (v.lines === 'chars' && !v.chars.length) return D.toast('내보낼 캐릭터를 하나 이상 고르세요');
  const range = { all: {}, chars: { chars: v.chars }, line: { line: cur.id } }[v.lines];
  const { ready, skipped } = SCR.exportPick(all, range);
  const redo = ready.filter((l) => l.state === 'redo').length;
  if (!ready.length) return D.toast('내보낼 녹음이 없어요 (★ 테이크가 있는 대사만 내보내요)');
  const dir = await pickFolder('대사 파일을 저장할 폴더');
  if (!dir) return;
  const ext = v.format.startsWith('mp3') ? '.mp3' : '.wav';
  const one = v.lines === 'line', top = one ? dir : linesFolder(dir), sub = (l) => (one ? [] : [safeName(l.char)]);
  const files = ready.map((l) => ({ l, path: path.join(top, ...sub(l), safeName(SCR.lineName(l)) + ext) }));
  const render = ({ l }, at) => {
    const t = { ...SCR.takeView(SCR.starTake(l), SC().chars[l.char]), mute: false, solo: false };
    return renderFile(v.format, 0, E.projectEnd([t]), [t], at);
  };
  try {
    if (!(await writeAll(files, `대사 ${files.length}개 내보내는 중`, render, MP3.jobsFor(v.format)))) return;
    // ★ is exported even when the text changed
    doneToast(`${files.length}개 파일로 내보냈어요: ${top}` + (redo ? ` · 다시 녹음 필요 ${redo}개도 들어갔어요` : '')
      + (skipped.length ? ` · 녹음 안 한 대사 ${skipped.length}개는 건너뛰었어요` : ''));
  } catch (e) {
    D.toast('내보내지 못했어요: ' + e.message, 'error');
  }
}

module.exports = { markerSegments };
