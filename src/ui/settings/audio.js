// 설정 > 오디오 장치: microphone and speaker, the input test meter, recording channels and 녹음 지연 보정 with
// 자동 측정 (also run by sori live settings --latencyMs auto).
const S = require('../../core/settings');
const engine = require('../../audio/engine');
const MIC = require('../../audio/mic');
const D = require('../dialogs');
const { el } = D;
const { row, seg, button } = require('../controls');
const { cmds } = require('../commands');

let meterRaf = 0;

function deviceSelect(list, cur, deflabel, prefix) {
  const sel = el('select', {}, el('option', { value: '', textContent: deflabel }),
    ...list.map((d, i) => el('option', { value: d.deviceId, textContent: d.label || `${prefix} ${i + 1}` })));
  sel.value = list.some((d) => d.deviceId === cur) ? cur : '';
  sel.setAttribute('aria-label', prefix);
  return sel;
}
// without mic permission the device names are hidden: asking once shows them
function revealButton(rerender) {
  const b = button('장치 이름 보기');
  b.onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((t) => t.stop());
    } catch { D.toast('마이크 권한이 없어요. Windows 설정 > 개인 정보 > 마이크를 확인하세요', 'error'); }
    rerender();
  };
  return b;
}

// the input test: a level bar fed from the mic until stopped
function inputTest() {
  const bar = el('div', { className: 'lvl' }, el('div', { className: 'lvl-fill' }));
  const btn = button('마이크 테스트'), t = { bar, btn, on: false };
  const loop = () => {
    const [l, r] = engine.level('input'), db = 20 * Math.log10(Math.max(l, r, 1e-6));
    bar.firstChild.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
    meterRaf = requestAnimationFrame(loop);
  };
  t.start = async () => {
    try {
      const fellBack = await MIC.startInputTest(S.get().inputId, S.get().recChannels);
      if (fellBack === null) return; // stopped (or started again) while the mic opened
      if (fellBack) D.toast('고른 마이크가 없어서 기본 마이크로 테스트해요');
      t.on = true; btn.textContent = '테스트 멈추기';
      cancelAnimationFrame(meterRaf); loop();
    } catch { D.toast('마이크를 열 수 없어요', 'error'); }
  };
  t.stop = () => {
    MIC.stopInputTest(); t.on = false; btn.textContent = '마이크 테스트';
    cancelAnimationFrame(meterRaf); bar.firstChild.style.width = '0%';
  };
  btn.onclick = () => (t.on ? t.stop() : t.start());
  return t;
}

function latencyRow(test) {
  const lat = el('input', { type: 'number', min: 0, max: 500, step: 1, value: S.get().latencyMs, className: 'numin' });
  lat.setAttribute('aria-label', '녹음 지연 보정 (ms)');
  lat.onchange = () => { S.set({ latencyMs: +lat.value || 0 }); lat.value = S.get().latencyMs; };
  const measure = button('자동 측정');
  measure.onclick = async () => {
    if (!engine.recording()) test.stop();
    const ms = await autoLatency();
    if (ms != null) lat.value = ms;
  };
  return row('녹음 지연 보정',
    el('div', { className: 'inline' }, lat, el('span', { className: 'unit', textContent: 'ms' }), measure),
    '다른 트랙에 맞춰 녹음했는데 늦게 붙으면 이 값만큼 앞으로 당겨요. 자동 측정은 스피커 소리를 마이크가 듣게 한 뒤 눌러요.');
}

// a device list while Windows is asked for the devices (it can take a moment): greyed, '장치 찾는 중…'
function waiting(prefix) {
  const sel = el('select', { disabled: true }, el('option', { value: '', textContent: '장치 찾는 중…' }));
  sel.setAttribute('aria-label', prefix);
  return sel;
}
// the tab shows at once; the mic and speaker lists fill in when the devices come
function audioTab(p, rerender) {
  const test = inputTest(), mic = el('div', { className: 'inline' }, waiting('마이크')), out = waiting('스피커');
  let gone = false;
  p.append(
    row('마이크', mic),
    row('입력 레벨', el('div', { className: 'inline' }, test.btn, test.bar),
      '말해 보세요. 막대가 주황색까지 자주 가면 마이크 볼륨을 낮추세요.'),
    row('스피커', out),
    row('녹음 채널', seg('recChannels', [[1, '모노'], [2, '스테레오']])),
    latencyRow(test),
  );
  p.cleanup = () => { gone = true; test.stop(); };
  MIC.listDevices().catch(() => ({ inputs: [], outputs: [] })) // no media devices
    .then((devs) => { if (!gone) fillDevices(devs, mic, out, test, rerender); });
}
function fillDevices(devs, mic, out, test, rerender) {
  const s = S.get(), named = devs.inputs.some((d) => d.label);
  const micSel = deviceSelect(devs.inputs, s.inputId, '기본 마이크 (Windows 설정)', '마이크');
  micSel.onchange = () => { S.set({ inputId: micSel.value }); if (test.on) test.start(); };
  const outSel = deviceSelect(devs.outputs, s.outputId, '기본 스피커 (Windows 설정)', '스피커');
  outSel.onchange = async () => {
    S.set({ outputId: outSel.value });
    if (!(await engine.setSink(outSel.value))) D.toast('이 장치로 바꿀 수 없어요. 기본 스피커를 써요', 'error');
  };
  mic.replaceChildren(micSel, ...(named ? [] : [revealButton(rerender)]));
  if (!named) {
    mic.after(el('div', { className: 'shint', textContent: '장치 이름이 안 보이면 [장치 이름 보기]를 눌러 마이크 권한을 주세요.' }));
  }
  out.replaceWith(outSel);
}

// 자동 측정 (the button and sori live settings --latencyMs auto): sets latencyMs and says so; null when it could not
async function autoLatency() {
  if (engine.recording()) { D.toast('녹음 중에는 측정할 수 없어요. 녹음을 멈춘 뒤 해 보세요', 'error'); return null; }
  cmds.stop.run(); // playback would mix into the mic and fool the click search
  MIC.stopInputTest();
  const measure = () => MIC.measureLatency(S.get().inputId, S.get().recChannels).catch(() => null);
  const ms = await D.busy('지연 측정 중 · 클릭 소리 4번', measure);
  if (ms == null) {
    D.toast('클릭 소리를 찾지 못했어요. 스피커 볼륨을 올리고 마이크를 스피커 가까이 둔 뒤 다시 해 보세요 (헤드폰은 안 돼요)', 'error');
    return null;
  }
  S.set({ latencyMs: ms });
  D.toast(`녹음 지연 ${ms} ms로 맞췄어요`);
  return ms;
}

module.exports = { audioTab, autoLatency };
