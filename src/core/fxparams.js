// Effect parameter specs + built-in presets (spec §5-2). Shared by effect dialogs, the effect panel,
// the live chains and .vproj validation. Pure data, no DOM.

const f = (key, label, min, max, step, value, unit) => ({ key, label, min, max, step, value, unit });

const FIELDS = {
  eq: [
    f('lowcut', '로우컷', 0, 1000, 10, 0, 'Hz'),
    f('low', '저음', -15, 15, 0.5, 0, 'dB'),
    f('lowFreq', '저음 기준', 40, 500, 5, 120, 'Hz'),
    f('mid', '중음', -15, 15, 0.5, 0, 'dB'),
    f('midFreq', '중음 주파수', 200, 5000, 10, 1000, 'Hz'),
    f('midQ', '중음 폭 (Q)', 0.3, 8, 0.1, 0.9, ''),
    f('high', '고음', -15, 15, 0.5, 0, 'dB'),
    f('highFreq', '고음 기준', 2000, 16000, 100, 8000, 'Hz'),
    f('highcut', '하이컷', 2000, 20000, 100, 20000, 'Hz'),
  ],
  comp: [
    f('threshold', '임계값', -60, 0, 0.5, -18, 'dB'),
    f('ratio', '비율', 1, 20, 0.5, 4, ': 1'),
    f('attack', '어택', 0.1, 200, 0.1, 10, 'ms'),
    f('release', '릴리즈', 10, 1000, 5, 120, 'ms'),
    f('makeup', '메이크업', 0, 24, 0.5, 0, 'dB'),
  ],
  reverb: [
    f('size', '공간 크기', 0, 100, 1, 60, '%'),
    f('decay', '잔향 길이', 0, 100, 1, 60, '%'),
    f('wet', '섞는 양', 0, 100, 1, 30, '%'),
    f('bright', '밝기', 0, 100, 1, 50, '%'),
  ],
  echo: [
    f('delayMs', '간격', 20, 2000, 10, 300, 'ms'),
    f('feedback', '반복', 0, 90, 1, 40, '%'),
    f('wet', '섞는 양', 0, 100, 1, 50, '%'),
  ],
  limiter: [
    f('ceiling', '최대 레벨', -6, 0, 0.1, -1, 'dB'),
    f('drive', '입력 게인', 0, 12, 0.5, 0, 'dB'),
  ],
  // a field with keep: true describes the recording, not the strength: presets leave it as it is
  hum: [
    { ...f('freq', '전기 주파수', 50, 60, 10, 60, 'Hz'), keep: true },
    f('count', '지우는 개수', 1, 5, 1, 3, '개'),
  ],
  deess: [
    f('amount', '줄이는 양', 0, 20, 0.5, 6, 'dB'),
    f('freq', '기준 높이', 3000, 10000, 100, 5000, 'Hz'), // 'ㅅ · ㅊ' live at 5-9 kHz (spec)
  ],
  noise: [
    f('reduction', '감소량', 3, 40, 1, 12, 'dB'),
    f('sensitivity', '민감도', 0, 24, 0.5, 6, 'dB'),
  ],
};
const MASTER_GAIN = f('gainDb', '마스터 볼륨', -24, 12, 0.5, 0, 'dB');

const LABELS = { eq: 'EQ', comp: '컴프레서', reverb: '리버브', echo: '에코 / 딜레이', limiter: '리미터', noise: '잡음 줄이기',
  hum: '전기 웅 소리', deess: '치찰음 줄이기' };
// hum before anything turns it up, de-essing after the compressor that lifts the 'ㅅ' too
const TRACK_KINDS = ['hum', 'eq', 'comp', 'deess', 'reverb', 'echo'];
const MASTER_KINDS = ['eq', 'comp', 'reverb', 'echo', 'limiter']; // master volume sits between echo and limiter

const p = (name, values) => ({ name, values });
const PRESETS = {
  eq: [
    p('목소리 또렷하게', { lowcut: 80, low: -2, mid: 2, midFreq: 3000, high: 3, highcut: 20000 }),
    p('웅웅거림 줄이기', { lowcut: 120, low: -4, mid: -3, midFreq: 300, high: 0, highcut: 20000 }),
    p('라디오 느낌', { lowcut: 400, low: -6, mid: 6, midFreq: 1500, high: -6, highcut: 4000 }),
    p('따뜻하게', { lowcut: 40, low: 4, mid: -1, midFreq: 2500, high: -3, highcut: 16000 }),
    p('밝게', { lowcut: 60, low: -1, mid: 1, midFreq: 4000, high: 5, highcut: 20000 }),
  ],
  comp: [
    p('목소리 고르게', { threshold: -20, ratio: 3, attack: 5, release: 100, makeup: 4 }),
    p('팟캐스트', { threshold: -24, ratio: 4, attack: 3, release: 80, makeup: 6 }),
    p('부드럽게', { threshold: -14, ratio: 2, attack: 20, release: 200, makeup: 2 }),
    p('강하게', { threshold: -30, ratio: 8, attack: 1, release: 60, makeup: 10 }),
    p('음악 전체', { threshold: -12, ratio: 2, attack: 30, release: 250, makeup: 2 }),
  ],
  reverb: [
    p('작은 방', { size: 20, decay: 20, wet: 15, bright: 60 }),
    p('은은하게', { size: 50, decay: 40, wet: 12, bright: 50 }),
    p('목욕탕', { size: 40, decay: 55, wet: 35, bright: 75 }),
    p('홀', { size: 75, decay: 70, wet: 28, bright: 45 }),
    p('성당', { size: 100, decay: 95, wet: 40, bright: 35 }),
  ],
  echo: [
    p('짧은 슬랩백', { delayMs: 90, feedback: 0, wet: 35 }),
    p('메아리', { delayMs: 350, feedback: 35, wet: 40 }),
    p('산울림', { delayMs: 700, feedback: 55, wet: 45 }),
    p('120BPM 박자', { delayMs: 500, feedback: 40, wet: 35 }),
  ],
  limiter: [
    p('기본', { ceiling: -1, drive: 0 }),
    p('크게', { ceiling: -1, drive: 4 }),
    p('유튜브 크게', { ceiling: -1, drive: 8 }),
  ],
  noise: [
    p('약하게', { reduction: 8, sensitivity: 4 }),
    p('보통', { reduction: 12, sensitivity: 6 }),
    p('강하게', { reduction: 20, sensitivity: 9 }),
  ],
  // same names, same sound as the 목소리 정리 menu
  hum: [p('약하게', { count: 1 }), p('보통', { count: 3 }), p('강하게', { count: 5 })],
  deess: [p('약하게', { amount: 3 }), p('보통', { amount: 6 }), p('강하게', { amount: 10 })],
};

// presets list only what they change; the rest is the default, so a preset always sounds the same
for (const kind of Object.keys(PRESETS)) {
  const base = Object.fromEntries(FIELDS[kind].filter((fl) => !fl.keep).map((fl) => [fl.key, fl.value]));
  for (const pr of PRESETS[kind]) pr.values = { ...base, ...pr.values };
}

const clampNum = (x, fl) => (Number.isFinite(+x) ? Math.max(fl.min, Math.min(fl.max, +x)) : fl.value);

// one effect's settings: { on, ...params } with every param present and inside its range
function clampFx(kind, o = {}) {
  const r = { on: !!(o && o.on) };
  for (const fl of FIELDS[kind]) r[fl.key] = clampNum(o && o[fl.key], fl);
  return r;
}
const defaultFx = (kinds) => Object.fromEntries(kinds.map((k) => [k, clampFx(k)]));
const clampChain = (kinds, o) => Object.fromEntries(kinds.map((k) => [k, clampFx(k, o && o[k])]));
const defaultMaster = () => ({ gainDb: 0, fx: defaultFx(MASTER_KINDS) });
const clampMaster = (m) => ({ gainDb: clampNum(m && m.gainDb, MASTER_GAIN), fx: clampChain(MASTER_KINDS, m && m.fx) });

// name of the preset whose values all match, or null
function matchPreset(kind, values) {
  const same = (pr) => Object.entries(pr.values).every(([k, v]) => Math.abs(values[k] - v) < 1e-9);
  const hit = (PRESETS[kind] || []).find(same);
  return hit ? hit.name : null;
}

module.exports = {
  FIELDS, MASTER_GAIN, LABELS, TRACK_KINDS, MASTER_KINDS, PRESETS,
  clampFx, defaultFx, clampChain, defaultMaster, clampMaster, matchPreset,
};
