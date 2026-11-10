// The 보기 menu: zoom, theme, the settings and shortcut windows, devtools, the context menu from the keyboard.
const { ipcRenderer } = require('electron');
const E = require('../../core/edit');
const S = require('../../core/settings');
const D = require('../dialogs');
const { def, tl, selClips, hasSel } = require('./core');
const { state } = require('../../core/state');

def('zoomIn', '확대', () => tl().zoomBy(1.5));
def('zoomOut', '축소', () => tl().zoomBy(1 / 1.5));
def('zoomFit', '전체 보기', () => tl().zoomFit());
def('zoomSel', '선택 구간 확대', () => {
  const r = state.sel.range, sc = selClips();
  if (r) return tl().zoomRange(r.a, r.b);
  if (sc.length) {
    return tl().zoomRange(Math.min(...sc.map(({ c }) => c.start)), Math.max(...sc.map(({ c }) => E.clipEnd(c))));
  }
  D.toast('확대할 구간이나 클립을 선택하세요');
}, hasSel);
def('toggleTheme', '테마 전환', () => S.set({ theme: S.get().theme === 'dark' ? 'light' : 'dark' }));
def('settings', '설정…', () => require('../settings').open());
def('shortcuts', '단축키 보기', () => require('../settings/keys').openShortcuts());
def('devtools', '개발자 도구', () => ipcRenderer.send('toggle-devtools'));
def('contextMenu', '메뉴 열기', () => tl().openContextAtPlayhead());
