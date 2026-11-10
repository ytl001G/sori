// Key (KeyboardEvent.code based, so it works in 한글 input mode) -> command name.
// DEFAULT_KEYS mirrors docs/spec.md §6 — change both together. Users override per command in
// 설정 > 화면·단축키 (settings.keys = { command: [keys] }).
const DEFAULT_KEYS = {
  'Space': 'playPause',
  'Ctrl+KeyZ': 'undo', 'Ctrl+KeyY': 'redo', 'Ctrl+Shift+KeyZ': 'redo',
  'Ctrl+KeyX': 'cut', 'Ctrl+KeyC': 'copy', 'Ctrl+KeyV': 'paste',
  'Delete': 'delete', 'Backspace': 'delete',
  'Ctrl+KeyA': 'selectAll', 'Escape': 'deselect',
  'Ctrl+KeyD': 'duplicate', 'KeyS': 'split', 'Ctrl+KeyJ': 'merge', 'Ctrl+KeyT': 'keep',
  'KeyL': 'toggleLoop', 'KeyR': 'record', 'KeyK': 'toggleMetro',
  'Shift+KeyR': 'contRecord', 'KeyN': 'cueNext', 'Shift+KeyN': 'cueBack',
  'Home': 'toHome', 'End': 'toEnd',
  'ArrowLeft': 'back1', 'ArrowRight': 'fwd1', 'Shift+ArrowLeft': 'back01', 'Shift+ArrowRight': 'fwd01',
  'Alt+ArrowLeft': 'nudgeLeft', 'Alt+ArrowRight': 'nudgeRight',
  'Shift+Alt+ArrowLeft': 'nudgeLeftBig', 'Shift+Alt+ArrowRight': 'nudgeRightBig',
  'Alt+ArrowUp': 'clipsUp', 'Alt+ArrowDown': 'clipsDown', 'ArrowUp': 'prevLine', 'ArrowDown': 'nextLine',
  'Shift+F10': 'contextMenu', 'ContextMenu': 'contextMenu',
  'KeyM': 'addMarker', 'BracketLeft': 'prevMarker', 'BracketRight': 'nextMarker',
  'Ctrl+Equal': 'zoomIn', 'Ctrl+NumpadAdd': 'zoomIn', 'Ctrl+Minus': 'zoomOut', 'Ctrl+NumpadSubtract': 'zoomOut',
  'Ctrl+Digit0': 'zoomFit', 'Ctrl+Shift+KeyF': 'zoomSel', 'KeyG': 'toggleSnap',
  'F9': 'toggleMixer', 'F8': 'toggleFxPanel',
  'Ctrl+KeyN': 'newProject', 'Ctrl+KeyO': 'open', 'Ctrl+KeyS': 'save', 'Ctrl+Shift+KeyS': 'saveAs',
  'Ctrl+KeyE': 'export',
  'Ctrl+Shift+KeyN': 'addTrack', 'Ctrl+Shift+KeyD': 'dupTrack', 'Ctrl+Alt+ArrowUp': 'trackUp',
  'Ctrl+Alt+ArrowDown': 'trackDown', 'Ctrl+Comma': 'settings', 'F1': 'shortcuts',
  'Ctrl+Shift+KeyI': 'devtools', 'F12': 'devtools',
};

let KEYS = { ...DEFAULT_KEYS };
// overrides replace a command's keys; a key taken by an override leaves its old command
function setOverrides(over = {}) {
  const k = {};
  for (const [key, cmd] of Object.entries(DEFAULT_KEYS)) if (!over[cmd]) k[key] = cmd;
  for (const [cmd, keys] of Object.entries(over)) for (const key of keys) k[key] = cmd;
  KEYS = k;
}
const bindings = () => KEYS;
const keysFor = (cmd, map = KEYS) => Object.keys(map).filter((key) => map[key] === cmd);
const defaultKeysFor = (cmd) => keysFor(cmd, DEFAULT_KEYS);

const keyOf = (e) => (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '')
  + e.code;
// 단축키 바꾸기 (설정 window and sori live settings --key): the key becomes cmd's only key and leaves the command that had it
function rebind(over, cmd, key) {
  const from = KEYS[key] && KEYS[key] !== cmd ? KEYS[key] : null, keys = { ...over };
  if (from) keys[from] = keysFor(from).filter((k) => k !== key);
  keys[cmd] = [key];
  return { keys, from };
}
// a key typed on the command line ("Ctrl+S", "Ctrl+KeyS", "Shift+F5", "Alt+ArrowLeft") -> the stored form, or null.
// Not Tab / Enter (they move between and press buttons) or Esc (cancels): the window cannot take them either.
const CODE = new RegExp('^(Key[A-Z]|Digit\\d|Numpad(\\d|Add|Subtract|Multiply|Divide|Decimal)|F([1-9]|1\\d|2[0-4])'
  + '|Arrow(Left|Right|Up|Down)|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Equal|Minus|Comma|Period|Slash'
  + '|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote|ContextMenu)$');
const MODS = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };
function parseKey(s) {
  const parts = String(s).split('+'), last = parts.pop(), mods = parts.map((m) => MODS[m.trim().toLowerCase()]);
  const code = /^[a-z]$/i.test(last) ? 'Key' + last.toUpperCase() : /^\d$/.test(last) ? 'Digit' + last : last;
  if (mods.includes(undefined) || new Set(mods).size !== mods.length || !CODE.test(code)) return null;
  return ['Ctrl', 'Shift', 'Alt'].filter((m) => mods.includes(m)).map((m) => m + '+').join('') + code;
}
const MODIFIER = /^(Control|Shift|Alt|Meta)(Left|Right)$/;

const NAMES = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Space: 'Space',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Backquote: '`', Semicolon: ';', Quote: "'", Backslash: '\\',
};
const prettyPart = (p) => NAMES[p]
  || p.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1').replace(/^Numpad(\d)$/, 'Num $1');
const pretty = (k) => k.split('+').map(prettyPart).join('+');

// first key bound to a command, for menu labels
function labelFor(cmd) {
  const k = keysFor(cmd)[0];
  return k ? pretty(k) : '';
}

module.exports = {
  DEFAULT_KEYS, bindings, setOverrides, keysFor, defaultKeysFor, keyOf, labelFor, pretty, MODIFIER, rebind, parseKey,
};
