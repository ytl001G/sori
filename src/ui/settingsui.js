// 설정 window (Ctrl+,) with 4 tabs. Every change applies at once. The audio tab: audiotab.js; the key list and the
// 단축키 window (F1): keysui.js.
const D = require('./dialogs');
const { el } = D;
const { row, seg, toggle, button } = require('./controls');
const { audioTab } = require('./audiotab');
const KUI = require('./keysui');
const S = require('../core/settings');

const TABS = [['audio', '오디오 장치'], ['rec', '녹음 · 재생'], ['file', '파일 · 프로젝트'], ['view', '화면 · 단축키']];

function recTab(p) {
  const vol = el('input', { type: 'range', min: 0, max: 100, step: 1, value: S.get().metroVol });
  const vv = el('span', { className: 'unit', textContent: S.get().metroVol + '%' });
  vol.setAttribute('aria-label', '메트로놈 볼륨');
  vol.oninput = () => { S.set({ metroVol: +vol.value }); vv.textContent = vol.value + '%'; };
  p.append(
    row('카운트인', seg('countIn', [[0, '끄기'], [1, '1마디'], [2, '2마디']]), '녹음 시작 전에 박자 소리를 먼저 들려줘요 (BPM은 위쪽 바).'),
    row('메트로놈 볼륨', el('div', { className: 'inline' }, vol, vv)),
    row('재생 중 화면 따라가기', toggle('follow', '재생 중 화면 따라가기')),
    row('정지하면 시작점으로', toggle('stopReturn', '정지하면 시작점으로'), '끄면 멈춘 자리에 재생 위치가 남아요.'),
  );
}

const FORMATS = [['wav16', 'WAV 16bit'], ['wav24', 'WAV 24bit'], ['mp3_128', 'MP3 128k'], ['mp3_192', 'MP3 192k'],
  ['mp3_320', 'MP3 320k']];
function fileTab(p) {
  const clear = button('목록 지우기');
  clear.onclick = () => { S.set({ recent: [] }); D.toast('최근 파일 목록을 지웠어요'); };
  p.append(
    row('자동 저장', seg('autosaveMin', [[0, '끄기'], [1, '1분'], [2, '2분'], [5, '5분'], [10, '10분']]),
      '갑자기 꺼지면 다음에 켤 때 복구할 수 있어요.'),
    row('기본 내보내기 형식', seg('exportFormat', FORMATS)),
    row('새 프로젝트 샘플레이트', seg('sampleRate', [[44100, '44.1 kHz'], [48000, '48 kHz']]),
      '지금 프로젝트는 그대로예요. 새 프로젝트부터 적용돼요.'),
    row('실행취소 메모리', seg('undoOnlyGB', [[0.5, '0.5 GB'], [1, '1 GB'], [1.5, '1.5 GB'], [3, '3 GB']]),
      '긴 녹음을 많이 편집하면 오래된 실행취소부터 지워져요.'),
    row('최근 파일', clear),
  );
}

function viewTab(p) {
  const { list, resetAll } = KUI.keyList();
  p.append(
    row('테마', seg('theme', [['dark', '어둡게'], ['light', '밝게']])),
    row('화면 크기', seg('zoom', [[90, '90%'], [100, '100%'], [110, '110%'], [125, '125%']])),
    row('트랙 높이', seg('laneH', [[64, '작게'], [96, '보통'], [128, '크게']])),
    row('단축키', resetAll, '[바꾸기]를 누르고 새 키를 누르세요. 다른 기능이 쓰던 키면 그 기능에서는 빠져요.'),
    list,
  );
}

async function render(root, tab) {
  const nav = root.querySelector('.snav'), panel = root.querySelector('.spanel');
  if (panel.cleanup) panel.cleanup();
  panel.cleanup = null;
  nav.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    b.tabIndex = b.dataset.tab === tab ? 0 : -1;
  });
  panel.replaceChildren();
  KUI.stopCapture();
  const tabs = { audio: audioTab, rec: recTab, file: fileTab, view: viewTab };
  await tabs[tab](panel, () => render(root, tab));
}

// the tab list: click, or ↑/↓ to the next tab
function tabButton(body, nav, id, label) {
  const b = el('button', { type: 'button', textContent: label });
  b.dataset.tab = id; b.setAttribute('role', 'tab');
  b.onclick = () => render(body, id);
  b.onkeydown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t[0] === id), step = e.key === 'ArrowDown' ? 1 : TABS.length - 1;
    const n = TABS[(i + step) % TABS.length][0];
    render(body, n).then(() => nav.querySelector(`[data-tab="${n}"]`).focus());
  };
  return b;
}

function open(tab = 'audio') { // always the first tab (no memory)
  return D.sheet({
    title: '설정',
    onKey: KUI.onKey,
    onClose: () => {
      const p = document.querySelector('.spanel');
      if (p && p.cleanup) p.cleanup();
      KUI.stopCapture();
    },
    build: (body) => {
      const nav = el('div', { className: 'snav' });
      nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-orientation', 'vertical');
      const panel = el('div', { className: 'spanel' });
      panel.setAttribute('role', 'tabpanel');
      for (const [id, label] of TABS) nav.append(tabButton(body, nav, id, label));
      body.classList.add('settings');
      body.append(nav, panel);
      render(body, tab);
      nav.querySelector(`[data-tab="${tab}"]`).focus();
    },
  });
}

module.exports = { open };
