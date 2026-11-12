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

// The same in sentences (messages, notes): never a typed key. A command named in a sentence: '실행취소(Ctrl+Z)', the
// particle after it follows the name; no key: the name alone
const named = (cmd, name) => { const k = labelFor(cmd); return k ? `${name}(${k})` : name; };
// '키 하는 일' hints ('R 새 테이크 · ↑/↓ 대사 이동'): "a,b" joins two commands' keys with '/'; no key: the hint drops
function hints(pairs) {
  return pairs.map(([cmds, what]) => {
    const ks = cmds.split(',').map(labelFor);
    return ks.every(Boolean) ? `${ks.join('/')} ${what}` : '';
  }).filter(Boolean).join(' · ');
}

module.exports = { tip, tips, named, hints };
