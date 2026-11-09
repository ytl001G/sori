// App speed on a real-sized project (only with SORI_PERF=<a copy of a .vproj>; the copy is opened and saved): open,
// line switches (cold: first visit, warm: again), the timeline paint, save. Numbers go to the smoke log.
const { state } = require('../../src/core/state');
const C = require('../../src/ui/commands');
const SC = require('../../src/core/script');
const timeline = require('../../src/ui/timeline');
const { log, painted, assert } = require('./kit');

const ms = (t) => Math.round(performance.now() - t);
const mb = () => Math.round(process.memoryUsage().rss / 1048576) + ' MB';
const stats = (xs) => `avg ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} ms, max ${Math.max(...xs)} ms`;
async function visit(ids) {
  const go = [], paint = [];
  for (const id of ids) {
    let t = performance.now();
    await C.goLine(id); go.push(ms(t));
    t = performance.now(); timeline.draw(); paint.push(ms(t));
    await painted();
  }
  return `goLine ${stats(go)} · timeline paint ${stats(paint)}`;
}

module.exports = [
  ['perf: open, line switches, paint, save', async () => {
    let t = performance.now();
    await C.openProject(process.env.SORI_PERF); await painted();
    assert(state.project.script, 'a script project');
    log.push(`perf open: ${ms(t)} ms, ${SC.linesNow(state.project).length} lines, ${mb()}`);
    t = performance.now(); for (let i = 0; i < 20; i++) await painted();
    log.push(`perf frame: ${Math.round(ms(t) / 20)} ms`);
    const ids = SC.linesNow(state.project).filter(SC.starTake).map((l) => l.id).slice(0, 40);
    log.push(`perf cold (40 lines): ${await visit(ids)}, ${mb()}`);
    log.push(`perf warm (same 40): ${await visit(ids)}, ${mb()}`);
    t = performance.now(); await C.run('save');
    log.push(`perf save: ${ms(t)} ms`);
  }],
];
