// Shortcuts on screen: the editable key list in 설정 > 화면 · 단축키 (with key capture) and the 단축키 window (F1).
const S = require('../../core/settings');
const K = require('../../core/shortcuts');
const D = require('../dialogs');
const { el } = D;
const { button } = require('../controls');
const { cmds } = require('../commands');
const { MENUS } = require('../menus');

let capture = null; // { cmd, draw } while a 바꾸기 button waits for a key

// commands in menu order, then transport/clip keys
function commandList() {
  const extra = ['playPause', 'stop', 'record', 'contRecord', 'cueNext', 'cueBack', 'toggleLoop', 'toHome', 'toEnd',
    'back1', 'fwd1', 'back01', 'fwd01', 'nudgeLeft', 'nudgeRight', 'nudgeLeftBig', 'nudgeRightBig', 'clipsUp',
    'clipsDown', 'contextMenu', 'devtools'];
  const all = [...extra, ...Object.values(MENUS).flat()].filter((n) => cmds[n]);
  return [...new Set(all)];
}
const label = (cmd) => cmds[cmd].label.replace('…', '');
const chips = (cmd) => {
  const ks = K.keysFor(cmd);
  if (!ks.length) return [el('span', { className: 'none', textContent: '없음' })];
  return ks.map((k) => el('kbd', { textContent: K.pretty(k) }));
};

function keyRow(cmd, list, draw) {
  const waiting = capture && capture.cmd === cmd;
  const change = button(waiting ? '키를 누르세요… (Esc 취소)' : '바꾸기', 'btn small');
  change.setAttribute('aria-label', label(cmd) + ' 단축키 바꾸기');
  change.onclick = () => { capture = { cmd, draw }; draw(); list.querySelector(`[data-cmd="${cmd}"] .btn`).focus(); };
  const reset = button('기본값', 'btn small');
  reset.setAttribute('aria-label', label(cmd) + ' 단축키 기본값');
  reset.disabled = !S.get().keys[cmd];
  reset.onclick = () => { const k = { ...S.get().keys }; delete k[cmd]; S.set({ keys: k }); draw(); };
  const r = el('div', { className: 'keyrow' },
    el('span', { className: 'klabel', textContent: label(cmd) }), el('div', { className: 'keys' }, ...chips(cmd)),
    change, reset);
  r.dataset.cmd = cmd;
  return r;
}
// the editable list and its 모두 기본값 button
function keyList() {
  const list = el('div', { className: 'keylist' });
  const draw = () => list.replaceChildren(...commandList().map((cmd) => keyRow(cmd, list, draw)));
  draw();
  const resetAll = button('단축키 모두 기본값으로');
  resetAll.onclick = () => { S.set({ keys: {} }); draw(); D.toast('단축키를 기본값으로 돌렸어요'); };
  return { list, resetAll };
}
const stopCapture = () => { capture = null; };

// key capture for the shortcut editor; returns true when it consumed the key
function onKey(e) {
  if (!capture) return false;
  e.preventDefault();
  if (e.key === 'Escape') { const d = capture.draw; capture = null; d(); return true; }
  if (K.MODIFIER.test(e.code)) return true; // wait for the real key
  // keyboard navigation must keep working
  if (/^(Tab|Enter|NumpadEnter)$/.test(e.code)) {
    D.toast('Tab · Enter는 버튼 이동·누르기에 써서 단축키로 쓸 수 없어요', 'error');
    return true;
  }
  const key = K.keyOf(e), { cmd, draw } = capture, r = K.rebind(S.get().keys, cmd, key);
  if (r.from) D.toast(`'${label(r.from)}'에서 ${K.pretty(key)} 키를 뺐어요`);
  capture = null;
  S.set({ keys: r.keys });
  draw();
  return true;
}

// built when opened: MENUS may still be loading when this file is
const groups = () => [
  ['재생 · 녹음', ['playPause', 'stop', 'record', 'contRecord', 'cueNext', 'cueBack', 'toggleLoop', 'toggleMetro',
    'toHome', 'toEnd', 'back1', 'fwd1', 'back01', 'fwd01']],
  ['파일', MENUS.file], ['편집', MENUS.edit], ['트랙', MENUS.track], ['마커', MENUS.marker],
  ['클립 옮기기', ['nudgeLeft', 'nudgeRight', 'nudgeLeftBig', 'nudgeRightBig', 'clipsUp', 'clipsDown']],
  ['보기', MENUS.view], ['효과', MENUS.fx],
];
function openShortcuts() {
  return D.sheet({
    title: '단축키',
    build: (body, close) => {
      const go = button('단축키 바꾸기…');
      go.onclick = () => { close(null); setTimeout(() => require('./index').open('view'), 0); };
      body.classList.add('shortcuts');
      const hint = el('span', { className: 'shint', textContent: '마우스로 하는 일은 상태 줄(맨 아래)에 안내가 나와요.' });
      body.append(el('div', { className: 'shead' }, hint, go));
      const grid = el('div', { className: 'sgroups' });
      for (const [title, list] of groups()) {
        const items = list.filter((n) => cmds[n] && K.keysFor(n).length);
        if (!items.length) continue;
        const rows = items.map((n) => el('div', { className: 'keyrow' },
          el('span', { className: 'klabel', textContent: label(n) }), el('div', { className: 'keys' }, ...chips(n))));
        grid.append(el('section', {}, el('h3', { textContent: title }), ...rows));
      }
      body.append(grid);
    },
  });
}

module.exports = { commandList, keyList, onKey, stopCapture, openShortcuts };
