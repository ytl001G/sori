// Tooltips that name a key: <x data-tip="믹서" data-cmd="toggleMixer"> gets title "믹서 (F9)" from the keys the
// command has now (설정 > 단축키 can change them; no key: the name alone). data-key names the command(s) when the
// element runs none itself ("trackUp,trackDown" -> "Ctrl+Alt+↑ / Ctrl+Alt+↓").
const { labelFor } = require('../core/shortcuts');

function tip(x) {
  const keys = (x.dataset.key || x.dataset.cmd || '').split(',').map(labelFor).filter(Boolean);
  const title = keys.length ? `${x.dataset.tip} (${keys.join(' / ')})` : x.dataset.tip;
  if (x.title !== title) x.title = title;
}
const tips = (root = document) => root.querySelectorAll('[data-tip]').forEach(tip);

module.exports = { tip, tips };
