// Effect presets, settings validation, shortcut overrides.
const { assert, t } = require('./helpers');

t('every preset stays inside its field ranges and sets every field but the recording own ones (keep)', () => {
  const P = require('../../src/core/fxparams');
  for (const [kind, list] of Object.entries(P.PRESETS)) for (const pr of list) {
    for (const fl of P.FIELDS[kind]) {
      const v = pr.values[fl.key];
      if (fl.keep) { assert.strictEqual(v, undefined, `${kind}/${pr.name} sets ${fl.key}`); continue; }
      assert(v >= fl.min && v <= fl.max, `${kind}/${pr.name}/${fl.key}=${v}`);
    }
    assert.strictEqual(P.matchPreset(kind, pr.values), pr.name);
  }
  assert.deepStrictEqual(P.clampFx('echo', { on: 1, delayMs: 99999, feedback: 'x' }),
    { on: true, delayMs: 2000, feedback: 40, wet: 50 });
});
t('settings validate rejects bad values', () => {
  const S = require('../../src/core/settings');
  const s = S.validate({ zoom: 133, laneH: 128, latencyMs: 9999, theme: 'pink', keys:
    { save: ['Ctrl+KeyS', 'rm -rf'], x: 'no' }, recent: ['a', 3] });
  assert.deepStrictEqual([s.zoom, s.laneH, s.latencyMs, s.theme, s.keys, s.recent],
    [100, 128, 500, 'dark', { save: ['Ctrl+KeyS'] }, ['a']]);
});
t('shortcut overrides replace keys and steal them from other commands', () => {
  const K = require('../../src/core/shortcuts');
  K.setOverrides({ split: ['KeyX'], addMarker: ['KeyS'] });
  const b = K.bindings();
  assert.deepStrictEqual([b.KeyX, b.KeyS, b.KeyM], ['split', 'addMarker', undefined]);
  assert.strictEqual(K.labelFor('split'), 'X');
  K.setOverrides({});
  assert.strictEqual(K.bindings().KeyS, 'split');
  // the CLI's --key: typed keys, and the window's rule (the key leaves the command that had it)
  assert.deepStrictEqual(['Ctrl+S', 'shift+ctrl+5', 'Alt+ArrowLeft', 'F12', 'Ctrl+KeyS', 'Tab', 'Enter', 'Escape',
    'Ctrl+Ctrl+S', 'Hyper+S', 'Ctrl+', 'ControlLeft'].map(K.parseKey),
    ['Ctrl+KeyS', 'Ctrl+Shift+Digit5', 'Alt+ArrowLeft', 'F12', 'Ctrl+KeyS', null, null, null, null, null, null, null]);
  const rb = K.rebind({}, 'addMarker', 'KeyS');
  assert.deepStrictEqual([rb.from, rb.keys.split, rb.keys.addMarker], ['split', [], ['KeyS']]);
  assert.strictEqual(K.rebind({}, 'split', 'KeyS').from, null, 'its own key');
  assert.strictEqual(K.pretty('Ctrl+Shift+BracketLeft'), 'Ctrl+Shift+[');
});
