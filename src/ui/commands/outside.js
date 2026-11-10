// Requests from outside the page: the window's X and a .vproj opened while Sori runs (main.js).
const { ipcRenderer } = require('electron');
const D = require('../dialogs');
const { state } = require('../../core/state');
const { confirmDiscard, openProject } = require('./files');

// The window's X with unsaved changes (main.js askBeforeClose) and a .vproj double-clicked while Sori runs (main.js
// second-instance) come from the user, from outside the page: they wait for a long job to end, close an open dialog
// (Esc, one question at a time) and ask in the real window (`askUser`: a `live run --yes` answers D.ask meanwhile).
// A long recording only in memory (이어 녹음 or its 나누기 window, state.holding) makes them wait: false
const askUser = D.ask;
async function userTurn() {
  if (state.holding) {
    D.toast(state.recording ? '이어 녹음 중이에요. Shift+R로 멈추고 나눈 뒤에 해 주세요'
      : '긴 녹음 나누기 창에서 적용하거나 버린 뒤에 해 주세요');
    return false;
  }
  while (D.isBusy()) await new Promise((r) => setTimeout(r, 100));
  if (D.isModalOpen()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return true;
}
ipcRenderer.on('ask-close', async () => {
  if ((await userTurn()) && (await confirmDiscard('닫으면', askUser))) ipcRenderer.send('close-now');
});
ipcRenderer.on('open-path', async (_e, p) => (await userTurn()) && openProject(p, askUser));
