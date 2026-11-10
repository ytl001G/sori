// Smoke steps: the AI command line on script projects (sori script, live script; dev runs only).
const fs = require('fs');
const path = require('path');
const C = require('../../src/ui/commands');
const SCR = require('../../src/core/script');
const { state } = require('../../src/core/state');
const { dir, assert, sr, T, wav, cli, ok, painted } = require('./kit');

let back = null; // the project open before these steps, reopened by the last one

module.exports = [
  ['CLI script: import, take add + export (hidden window); the app opens it with every take, ★ selected', async () => {
    back = state.filePath;
    fs.writeFileSync(path.join(dir, 'cs.txt'), '철수: 하나\n영희: 둘\n');
    ok(await cli('script', 'import', 'cs.vproj', 'cs.txt', '--rate', String(sr)), 'script import');
    ok(await cli('script', 'take', 'add', 'cs.vproj', '--line', '철수-001', wav, wav), 'take add');
    const ex = ok(await cli('script', 'export', 'cs.vproj', 'cs-out'), 'script export');
    assert(ex.files.length === 1 && ex.files[0].line === '철수-001' && Math.abs(ex.files[0].seconds - 2) < 0.01 &&
      ex.skipped.join() === '영희-001', 'export ' + JSON.stringify(ex));
    await C.openProject(path.join(dir, 'cs.vproj'));
    assert(state.project.script && T().length === 2 && C.curLine().star === T()[0].id &&
      state.sel.activeTrackId === T()[0].id, 'the app opens it with every take, ★ (테이크 1) selected');
  }, 'dev'],
  ['CLI live script: ★ a take, line, list view, undo goes to the line', async () => {
    let r = ok(await cli('live', 'script', 'star', '2'), 'live star');
    assert(T().length === 2 && T()[1].name === '테이크 2' && C.curLine().star === T()[1].id &&
      r.script.lines[0].star === '테이크 2', 'live ★ on 테이크 2');
    ok(await cli('live', 'script', 'line', '영희-001'), 'live line');
    assert(SCR.lineName(C.curLine()) === '영희-001', 'live line moved');
    r = await cli('live', 'script', 'star', '1'); assert(r.error === 'NO_TAKE', 'no take: ' + JSON.stringify(r));
    const m = ok(await cli('live', 'measure'), 'live measure on a script project');
    assert(m.lines.length === 1 && m.lines[0].line === '철수-001' && m.lines[0].take === '테이크 2' &&
      m.skipped.join() === '영희-001', 'live measure: the ★ take ' + JSON.stringify(m).slice(0, 300));
    r = await cli('live', 'state');
    assert(r.script && r.script.current === '영희-001' && r.script.lines.length === 2 && r.ui.list.visible.length === 2,
        'live state has the script');
    r = ok(await cli('live', 'script', 'view', '--todo', 'on'), 'live list view');
    assert(state.ui.scriptView.todo && r.ui.list.visible.join() === '영희-001', 'live script view: 녹음 안 한 것만 '
      + JSON.stringify(r.ui));
    r = await cli('live', 'script', 'view', '--char', '캐릭터Z');
    assert(r.error === 'NO_CHAR', 'unknown tab ' + JSON.stringify(r));
    ok(await cli('live', 'script', 'view', '--todo', 'off', '--all'), 'list view back');
    await C.run('undo');
    assert(SCR.lineName(C.curLine()) === '철수-001' && C.curLine().star === T()[0].id, 'undo the live ★ on its line');
    const was = () => SCR.linesNow(state.project)[0].takes[0].clips, before = was();
    r = ok(await cli('live', 'apply', 'voiceLoud', '--all-lines'), 'live apply on every line');
    assert(r.lines.length === 1 && r.lines[0].take === '테이크 1' && r.noStar.join() === '영희-001' && was() !== before,
      'live apply --all-lines: the ★ take, worked out on Web Workers ' + JSON.stringify(r).slice(0, 300));
    await C.run('undo');
    assert(was() === before, 'live apply --all-lines: one undo step');
  }, 'dev'],
  ['CLI live script: file commands on the open project: color, take set / remove, line set', async () => {
    let r;
    // script file commands on the open project: the line on screen follows
    const panel = state.ui.fxPanel;
    C.showFx('char:철수');
    r = ok(await cli('live', 'script', 'color', '--char', '철수', '--color', '22C55E'), 'live script color');
    assert(r.undoStep === false && T()[0].color === '#22C55E', 'live character color: the take on screen follows '
      + JSON.stringify(r));
    await painted(); // the line bar and list redraw with it (their cache once looked only at the lines)
    const color = (id) => document.getElementById(id).style.getPropertyValue('--ch').toUpperCase();
    assert(color('script-bar') === '#22C55E' && color('fxpanel') === '#22C55E',
      `live character color: the line bar and the effect panel follow ${color('script-bar')} ${color('fxpanel')}`);
    if (!panel) await C.run('toggleFxPanel');
    r = ok(await cli('live', 'script', 'take', 'set', '--line', '철수-001', '--take', '1', '--volume', '-6', '--name',
      '좋은 거'), 'live take set');
    assert(r.undoStep === false && T()[0].name === '좋은 거' && Math.abs(T()[0].gain - 10 ** (-6 / 20)) < 1e-9,
      'live take set: header values, live like the app ' + JSON.stringify(r));
    r = ok(await cli('live', 'script', 'take', 'remove', '--line', '철수-001', '--take', '2'), 'live take remove');
    assert(r.undoStep && C.takeCount() === 1 && T()[0].name === '좋은 거', 'live take remove');
    await C.run('undo'); assert(C.takeCount() === 2, 'undo the live take remove');
    r = ok(await cli('live', 'script', 'line', 'set', '--line', '영희-001', '--memo', '작게'), 'live line set');
    assert(r.undoStep && SCR.lineName(C.curLine()) === '철수-001' && state.project.script.lines[1].memo === '작게',
      'live memo on another line, the screen stays');
    await C.run('undo');
    assert(SCR.lineName(C.curLine()) === '영희-001' && !C.curLine().memo, 'undo shows the line it changed');
  }, 'dev'],
  ['CLI live script: track verbs on a line\'s takes (--line, --take): an undo step, refusals name script commands',
    async () => {
      const good = () => SCR.linesNow(state.project)[0].takes.find((t) => t.name === '좋은 거');
      const r = ok(await cli('live', 'clip', 'split', '--line', '철수-001', '--take', '좋은 거', '--at', '0.5'),
        'live clip split on a take');
      assert(r.undoStep && r.split.join() === '좋은 거' && good().clips.length === 2
        && SCR.lineName(C.curLine()) === '영희-001', 'split on another line, the screen stays ' + JSON.stringify(r));
      await C.run('undo');
      assert(SCR.lineName(C.curLine()) === '철수-001' && good().clips.length === 1, 'undo shows the line it changed');
      const no = await cli('live', 'clip', 'split', '--at', '0.5');
      assert(no.error === 'BAD_ARG' && /--line/.test(no.message), 'which line? ' + JSON.stringify(no));
      const add = await cli('live', 'track', 'add');
      assert(add.error === 'SCRIPT_PROJECT' && /script take add/.test(add.message), 'track add ' + JSON.stringify(add));
      ok(await cli('live', 'script', 'line', '영희-001'), 'back to the line the next step starts on');
    }, 'dev'],
  ['CLI live script: 대본 넣기 again and 보통 프로젝트로 바꾸기 (one undo step each), 대본 넣기 on a normal project', async () => {
    let r;
    // 대본 넣기 again and 보통 프로젝트로 바꾸기 from the CLI: one undo step each, the screen as after the menu command
    fs.writeFileSync(path.join(dir, 'cs2.txt'), '철수: 하나\n캐릭터Z: 셋\n');
    r = ok(await cli('live', 'script', 'import', 'cs2.txt', '--dry-run'), 'live re-import --dry-run');
    assert(r.dryRun && r.counts && state.project.script.lines.length === 2 && !state.project.script.chars['캐릭터Z'],
      'dry run changes nothing ' + JSON.stringify(r));
    C.setScriptView({ char: '영희' }); C.showFx('char:영희'); // its tab and effects; the re-import takes its lines
    r = ok(await cli('live', 'script', 'import', 'cs2.txt'), 'live re-import');
    assert(r.undoStep && state.project.script.lines.map(SCR.lineName).join() === '철수-001,캐릭터Z-001' &&
      SCR.lineName(C.curLine()) === '철수-001' && T()[0].name === '좋은 거',
      'the current line (영희-001) left the script: the first line shows ' + JSON.stringify(r));
    await painted();
    const pressed = document.querySelector('#sp-tabs [aria-pressed=true]');
    assert(!state.ui.scriptView.char && pressed && pressed.textContent.startsWith('전체')
      && document.querySelectorAll('#sp-list .line-row').length === 2, 'a gone character\'s tab: 전체 again');
    assert(state.ui.fxTarget === 'master', 'a gone character\'s effects: the master shows ' + state.ui.fxTarget);
    await C.run('undo');
    assert(state.project.script.lines.length === 2 && SCR.lineName(C.curLine()) === '영희-001',
        'undo the live re-import');
    r = ok(await cli('live', 'script', 'unscript'), 'live unscript');
    assert(r.undoStep && !state.project.script && T().length === 2 && T()[0].name === '철수-001 좋은 거' &&
      state.sel.activeTrackId === T()[0].id && state.ui.fxTarget === 'master',
      'live 보통 프로젝트로 바꾸기 ' + JSON.stringify(r));
    await C.run('undo');
    assert(state.project.script && SCR.lineName(C.curLine()) === '영희-001' &&
      state.project.script.lines[0].takes.length === 2, 'undo the live unscript: the line it showed');
    await C.openProject(back);
    assert(!state.project.script, 'back to the normal project');
    const n = T().length;
    r = ok(await cli('live', 'script', 'import', 'cs.txt'), 'live 대본 넣기 on a normal project');
    assert(r.undoStep && r.action === 'converted' && SCR.lineName(C.curLine()) === '철수-001' &&
      !state.ui.scriptView.char && state.ui.fxTarget === 'master', 'converted ' + JSON.stringify(r));
    await C.run('undo'); assert(!state.project.script && T().length === n, 'undo the live 대본 넣기');
  }, 'dev'],
];
