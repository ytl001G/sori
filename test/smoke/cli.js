// Smoke steps: the AI command line: file commands and live (dev runs only: the installed app has no node). Script
// projects: cliscript.js.
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const D = require('../../src/ui/dialogs');
const E = require('../../src/core/edit');
const S = require('../../src/core/settings');
const K = require('../../src/core/shortcuts');
const P = require('../../src/core/fxparams');
const { state, history } = require('../../src/core/state');
const { dir, stubModal, assert, sr, T, end, sel, wav, cli, ok } = require('./kit');

const V = require('../../src/cli/verbs');
const copy = path.join(dir, 'live-copy.vproj'); // the file the live steps save as and open

module.exports = [
  ['CLI typed tracks and effect fields match the app', async () => {
    for (const [cmd, type] of [['addTrack', 'empty'], ['addVoiceTrack', 'voice'], ['addMusicTrack', 'music'],
      ['addSfxTrack', 'sfx']]) {
      await C.run(cmd);
      const app = T().find((t) => t.id === state.sel.activeTrackId), cli = V.TRACK_TYPES[type]();
      assert(JSON.stringify([app.gain, app.fx]) === JSON.stringify([cli.gain, cli.fx]) &&
        (type === 'empty' || app.name === cli.name), cmd + ' differs');
      await C.run('undo');
    }
    let fields = null;
    D.modal = async (o) => { fields = o.fields; return null; }; // capture the dialog, then cancel
    for (const [n, [, opt]] of Object.entries(V.APPLY)) {
      assert(C.cmds[n], 'no app command ' + n);
      if (opt.profile) continue; // needs a noise profile first
      fields = null; sel(0, 0.5); await C.run(n);
      const want = (opt.fields || P.FIELDS[opt.kind] || []).map((f) => [f.key, f.min, f.max].join());
      assert(JSON.stringify((fields || []).map((f) => [f.key, f.min, f.max].join())) === JSON.stringify(want), n
        + ' fields differ');
    }
    D.modal = stubModal; state.sel.range = null;
  }],
  // the installed app has no node/electron to run the CLI with
  ['CLI end to end: new, voice track, import, effect, export (hidden window)', async () => {
    assert(/^sori-smoke-/.test(process.env.SORI_PIPE || ''), 'smoke pipe ' + process.env.SORI_PIPE);
    ok(await cli('new', 'cli.vproj', '--rate', String(sr)), 'new');
    ok(await cli('track', 'add', 'cli.vproj', '--type', 'voice'), 'track add');
    const im = ok(await cli('import', 'cli.vproj', wav, '--track', '1'), 'import');
    assert(im.imported[0].lengthFrames === 2 * sr, 'imported ' + im.imported[0].lengthFrames);
    ok(await cli('apply', 'cli.vproj', 'fxNormalize', '--db', '-3'), 'apply');
    ok(await cli('fx', 'cli.vproj', '--master', 'limiter', '--preset', '기본'), 'fx');
    const ex = ok(await cli('export', 'cli.vproj', 'cli.wav'), 'export');
    const bytes = fs.statSync(path.join(dir, 'cli.wav')).size;
    console.log(`cli export: ${ex.files[0].frames} frames, ${bytes} bytes`);
    assert(ex.files[0].frames === 2 * sr && bytes === 44 + 2 * sr * 4, 'export frames ' + ex.files[0].frames + ' bytes '
      + bytes);
    const d = ok(await cli('info', 'cli.vproj'), 'info');
    assert(d.tracks.length === 1 && d.tracks[0].fx.eq.preset === '목소리 또렷하게' && d.master.fx.limiter.on &&
      d.tracks[0].clips.length === 1, 'info');
  }, 'dev'],
  ['CLI live: state, file commands refused on the open project, commands, select + run, refusals', async () => {
    const live = await cli('live', 'state');
    assert(live.ok && live.app.filePath === state.filePath && live.project.tracks.length === T().length, 'state '
      + JSON.stringify(live.app));
    const open = await cli('track', 'add', state.filePath);
    assert(open.error === 'OPEN_IN_APP', 'open project not refused: ' + JSON.stringify(open));
    const cs = await cli('live', 'commands');
    assert(cs.commands.some((c) => c.name === 'fxGain' && c.dialog) &&
      cs.commands.some((c) => c.name === 'split' && !c.dialog), 'commands');
    const len = end();
    let r = await cli('live', 'select', '--from', '0', '--to', '0.5', '--track', '1');
    assert(r.ok && state.sel.range && state.sel.range.b === Math.round(0.5 * sr) && state.sel.range.trackIds.size === 1,
      'select ' + JSON.stringify(r));
    const t1 = T()[0], len1 = E.projectEnd([t1]);
    r = await cli('live', 'run', 'delete');
    assert(r.ok && r.edited && E.projectEnd([T()[0]]) === len1 - Math.round(0.5 * sr), 'delete ' + JSON.stringify(r));
    await C.run('undo');
    assert(E.projectEnd([T()[0]]) === len1 && end() === len, 'undo after live delete');
    await cli('live', 'select', '--from', '0', '--to', '0.5');
    r = await cli('live', 'run', 'fxGain', '--db', '2');
    assert(r.ok && r.edited, 'fxGain ' + JSON.stringify(r));
    await C.run('undo');
    const before = T();
    for (const [args, code] of [[['nope'], 'UNKNOWN_COMMAND'], [['split', '--db', '1'], 'BAD_ARG'],
      [['fxGain', '--bogus', '1'], 'BAD_ARG']]) {
      r = await cli('live', 'run', ...args);
      assert(r.error === code, args.join(' ') + ' -> ' + JSON.stringify(r));
    }
    assert(T() === before, 'a refused live run changed the project');
    r = await cli('live', 'select', '--clip', '9:9');
    assert(r.error === 'BAD_ARG', 'bad clip select ' + JSON.stringify(r));
    await cli('live', 'select', '--none');
  }, 'dev'],
  ['CLI live: saveAs / open with --path and --yes; a view toggle is not an edit', async () => {
    let r;
    // --path answers the file window, --yes the app's question: the CLI can do everything the user can
    r = await cli('live', 'run', 'saveAs', '--path', 'live-copy.vproj');
    assert(r.ok && state.filePath === copy && fs.existsSync(copy) && !state.dirty, 'saveAs --path '
      + JSON.stringify(r));
    r = await cli('live', 'run', 'saveAs', '--path', 'live-copy.txt');
    assert(r.error === 'BAD_ARG' && /\.vproj/.test(r.message) && !fs.existsSync(path.join(dir, 'live-copy.txt')),
      'saveAs --path with another file type: ' + JSON.stringify(r));
    r = await cli('live', 'run', 'toggleSnap');
    assert(r.ok && !r.edited, 'a view toggle is not an edit: ' + JSON.stringify(r)); await C.run('toggleSnap');
    C.mixer(T()[0].id, { pan: 0.37 }); assert(state.dirty, 'dirty');
    r = await cli('live', 'run', 'open', '--path', 'live-copy.vproj', '--yes');
    assert(r.ok && state.filePath === copy && !state.dirty && T()[0].pan !== 0.37,
      'open --path --yes answers 저장하지 않은 변경 사항: ' + JSON.stringify(r));
  }, 'dev'],
  ['CLI live: file commands on the open project (tracks, clips, markers undoable; mixer live)', async () => {
    let r;
    // any file command on the open project: tracks / clips / markers are an undo step, mixer values live as
    // in the app
    const d = history.depth(), n0 = T().length;
    r = await cli('live', 'track', 'set', '--track', '1', '--volume', '-6', '--name', '라이브');
    assert(r.ok && r.undoStep === false && history.depth() === d && Math.abs(T()[0].gain - 10 ** (-6 / 20)) < 1e-9 &&
      T()[0].name === '라이브' && state.dirty, 'live track set ' + JSON.stringify(r));
    r = await cli('live', 'marker', 'add', '--at', '0.25', '--name', 'L');
    assert(r.ok && r.undoStep === true && history.depth() === d + 1 &&
      state.project.markers.some((m) => m.name === 'L'), 'live marker add ' + JSON.stringify(r));
    await C.run('undo'); assert(!state.project.markers.some((m) => m.name === 'L'), 'undo the live marker');
    r = await cli('live', 'import', wav);
    assert(r.ok && r.undoStep && T().length === n0 + 1 && T()[n0].clips.length === 1, 'live import decodes in the app '
      + JSON.stringify(r));
    await C.run('undo'); assert(T().length === n0, 'undo the live import');
    state.sel.activeTrackId = T()[n0 - 1].id; r = await cli('live', 'track', 'remove', '--track', String(n0));
    assert(r.ok && r.undoStep && T().length === n0 - 1 && state.sel.activeTrackId === (T()[0] ? T()[0].id : null),
      'live track remove: the current track moves like the app');
    await C.run('undo'); assert(T().length === n0, 'undo the live track remove');
  }, 'dev'],
  ['CLI live: settings like the 설정 window, bad values refused', async () => {
    let r;
    // the 설정 window from the CLI (smoke has its own userData: the user's settings are never touched)
    const th = S.get().theme, lat = S.get().latencyMs;
    r = await cli('live', 'settings');
    assert(r.ok && r.settings.theme === th && Array.isArray(r.devices.inputs) && !('recent' in r.settings),
      'live settings ' + JSON.stringify(r).slice(0, 300));
    r = await cli('live', 'settings', '--theme', th === 'dark' ? 'light' : 'dark', '--latencyMs', '9999', '--follow',
      'off');
    assert(r.ok && S.get().theme !== th && document.documentElement.dataset.theme === S.get().theme &&
      S.get().latencyMs === 500 && !state.view.follow, 'live settings applies like the window '
        + JSON.stringify(r.settings));
    for (const [args, re] of [[['--theme', 'blue'], /one of: dark, light/], [['--nope', '1'], /unknown setting/],
      [['--follow', 'yes'], /on or off/], [['--follow', 'constructor'], /on or off/],
        [['--latencyMs', 'Infinity'], /a number/], [['--inputId', 'x'], /no such device/]]) {
      r = await cli('live', 'settings', ...args);
      assert(r.error === 'BAD_ARG' && re.test(r.message), args.join(' ') + ' -> ' + JSON.stringify(r));
    }
    S.set({ theme: th, latencyMs: lat, follow: true });
  }, 'dev'],
  ['CLI live: menu values, shortcuts, 마이크 테스트, recent files', async () => {
    let r;
    // what the menus remember, the shortcut and recent-file buttons, 마이크 테스트 (the fake mic)
    r = ok(await cli('live', 'settings', '--mixer', 'on', '--snap', 'off', '--metronome', 'on'),
      'live settings: menu values');
    assert(state.ui.mixer && !S.get().snap && S.get().metronome &&
      C.cmds.toggleMixer.checked(), 'applied like the menus ' + JSON.stringify(r.settings));
    r = ok(await cli('live', 'settings', '--key', 'addMarker=Ctrl+Shift+M'), 'live settings --key');
    assert(r.shortcuts.find((x) => x.command === 'addMarker').keys.join() === 'Ctrl+Shift+KeyM' &&
      K.bindings()['Ctrl+Shift+KeyM'] === 'addMarker', 'rebound '
        + JSON.stringify(r.shortcuts.find((x) => x.command === 'addMarker')));
    r = ok(await cli('live', 'settings', '--key', 'split=Ctrl+Shift+M'), 'take a key');
    assert(r.keyTakenFrom === 'addMarker' && !K.keysFor('addMarker').length, 'the key left addMarker');
    for (const [args, re] of [[['--key', 'split=Tab'], /not a key/], [['--key', 'nope=KeyQ'], /COMMAND=KEY/],
      [['--keys', 'x'], /only default/], [['--recent', 'C:\\nope.vproj'], /recent/],
        [['--mic-test', '0'], /1 to 10/]]) {
      r = await cli('live', 'settings', ...args);
      assert(r.error === 'BAD_ARG' && re.test(r.message), args.join(' ') + ' -> ' + JSON.stringify(r));
    }
    ok(await cli('live', 'settings', '--keys', 'default'), 'shortcuts back');
    assert(K.bindings().KeyM === 'addMarker' && K.bindings().KeyS === 'split', 'default keys');
    r = ok(await cli('live', 'settings', '--mic-test', '1'), 'mic test');
    assert(r.micTest.seconds === 1 && Number.isFinite(r.micTest.peakDb) && r.micTest.peakDb > -120,
      'the fake mic is heard ' + JSON.stringify(r.micTest));
    const rec = S.get().recent;
    S.set({ recent: ['C:\\a.vproj', 'C:\\b.vproj'] });
    r = ok(await cli('live', 'settings', '--recent', 'C:\\a.vproj'), 'remove one recent');
    assert(r.recent.join() === 'C:\\b.vproj', 'one gone ' + JSON.stringify(r.recent));
    r = ok(await cli('live', 'settings', '--recent', 'clear'), 'clear recent');
    assert(!r.recent.length, 'list cleared');
    S.set({ recent: rec, snap: true, metronome: false, mixer: false });
  }, 'dev'],
  ['CLI live: refused file commands leave the project alone', async () => {
    let r;
    const keep = T();
    for (const [args, code] of [[['track', 'set', '--track', '99', '--volume', '0'], 'NO_TRACK'],
      [['script', 'star', '--line', 'x', '--take', '1'], 'NOT_SCRIPT'],
      [['new'], 'USE_APP_COMMAND'], [['track', 'set', copy, '--track', '1', '--volume', '0'], 'BAD_ARG'],
        [['nope'], 'UNKNOWN_COMMAND']]) {
      r = await cli('live', ...args);
      assert(r.error === code, 'live ' + args.join(' ') + ' -> ' + JSON.stringify(r));
    }
    assert(T() === keep, 'a refused live command changed the project');
  }, 'dev'],
  ['CLI live batch: the lines are one undo step; --check and a failing line leave the project alone', async () => {
    const d = history.depth(), n0 = T().length, keep = T(), f = path.join(dir, 'live-batch.txt');
    fs.writeFileSync(f, `track add --name 묶음A\nimport "${wav}"\nmarker add --at 0.5 --name 묶음\n`);
    let r = await cli('live', 'batch', f, '--check');
    assert(r.ok && r.dryRun && r.waves.length === 3 && T() === keep && history.depth() === d,
      'live batch --check ' + JSON.stringify(r));
    r = await cli('live', 'batch', f);
    assert(r.ok && r.undoStep && history.depth() === d + 1 && T().length === n0 + 2 && T()[n0].name === '묶음A'
      && T()[n0 + 1].clips.length === 1 && state.project.markers.some((m) => m.name === '묶음'),
    'live batch ' + JSON.stringify(r));
    await C.run('undo');
    assert(T().length === n0 && !state.project.markers.some((m) => m.name === '묶음'), 'one undo, the whole batch');
    fs.writeFileSync(f, 'track add\ntrack remove --track 99\n');
    const was = T();
    r = await cli('live', 'batch', f);
    assert(r.error === 'NO_TRACK' && r.line === 2 && T() === was, 'failing live batch ' + JSON.stringify(r));
  }, 'dev'],
  ['CLI measure: the open project as heard (each track alone + the mix), nothing changed', async () => {
    const keep = T(), d = history.depth(), dirty = state.dirty;
    const r = await cli('live', 'measure');
    assert(r.ok && r.tracks.length === T().length && r.mix && Number.isFinite(r.mix.seconds) && T() === keep &&
      history.depth() === d && state.dirty === dirty, 'live measure ' + JSON.stringify(r).slice(0, 300));
    const f = ok(await cli('measure', 'cli.vproj', '--track', '1'), 'file measure (hidden window)').tracks[0];
    assert(f.seconds === 2 && f.lufs < 0 && f.peakDb <= 0 && f.clipped.count === 0, 'measure ' + JSON.stringify(f));
  }, 'dev'],
];
