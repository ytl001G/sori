// Script recording mode (spec §5-5): reading scripts, line numbers, re-import merge. Pure.
// project.script = { lines, lineId, chars }; line = { id, char, num, text, memo, state?, takes: [track], star: takeId |
// null }
// state: 'redo' (text changed after recording).
// The current line's takes live in project.tracks (so the whole editor works on them); line.takes of the
// current line is stale until stashed. linesNow() gives the lines with the current takes filled in.
const { uid } = require('./edit');
const P = require('./fxparams');

// a line number: text kept as written in the script (1-01, A3, …), or an integer when it is all
// digits (shown as 005, so 5 and 005 are the same line). toNum: a cell, a name part or a saved value -> number | null
const toNum = (s) => {
  const t = String(s ?? '').trim().slice(0, 20);
  return !t ? null : /^\d{1,6}$/.test(t) ? +t || null : t;
};
const pad = (n) => (typeof n === 'string' ? n : String(n).padStart(3, '0'));
const lineName = (l) => `${l.char}-${pad(l.num)}`;
const linesNow = (p) => p.script.lines.map((l) => (l.id === p.script.lineId ? { ...l, takes: p.tracks } : l));
const starTake = (l) => l.takes.find((t) => t.id === l.star && t.clips.length);
const isDone = (l) => !!starTake(l) && l.state !== 'redo'; // the same test as export: a ★ take with sound
// the rules the app and `sori script` share (spec §5-5)
// a new take: one past the highest '테이크 n' left, so deleting one never renames the others
const takeNo = (t) => +(/^테이크 (\d+)$/.exec(t.name) || [0, 0])[1];
const nextTakeName = (takes) => '테이크 ' + (Math.max(0, ...takes.map(takeNo)) + 1);
// a take by its name number ('3' = '테이크 3') or by its exact name (a renamed take)
const takeRef = (takes, ref) => {
  const s = String(ref).trim(), n = /^\d+$/.test(s) ? '테이크 ' + Number(s) : s;
  return takes.find((t) => t.name === n);
};
// picking ★ (by hand, or a line's first take) clears '다시 녹음 필요'
const withStar = (id) => ({ star: id, state: undefined });
// recorded = a take with sound (a take being recorded or emptied with Delete has none)
const recorded = (l) => l.takes.some((t) => t.clips.length);
// 대사 고치기: text and memo; a recorded line whose text changes needs a new recording (same rule as a re-import)
const editLine = (l, text, memo) => ({ ...l, text, memo, state: text !== l.text && recorded(l) ? 'redo' : l.state });
// new characters get the next track color and their effects off. hasOwn: a character may be named 'constructor'
const addChars = (chars, lines, colors) => {
  const fresh = () => ({ color: colors[Object.keys(chars).length % colors.length], fx: P.defaultFx(P.TRACK_KINDS) });
  for (const l of lines) if (!Object.hasOwn(chars, l.char)) chars[l.char] = fresh();
};
// per-line export: one line, the chosen characters' lines or every line; files only for lines with a ★ take
function exportPick(lines, { line, chars } = {}) {
  const pick = lines.filter((l) => (line ? l.id === line : !chars || chars.includes(l.char)));
  return { ready: pick.filter(starTake), skipped: pick.filter((l) => !starTake(l)) };
}
// a take as the editor sees it: the character's color and effect set (spec: one set per character)
const takeView = (t, ch) => (ch ? { ...t, color: ch.color, fx: ch.fx } : t);
// 보통 프로젝트로 바꾸기: every take becomes a track that sounds as it did (character color and effects, its
// own volume/pan), in script order then recording order, named '철수-001 테이크 1'. Fresh ids: an undo restore keeps
// live props by id, so a take must not share its id with the track it became. fx is shared, never mutated in place.
const asTrack = (p, l) => (t) => ({
  ...takeView(t, p.script.chars[l.char]), id: uid('t'), name: `${lineName(l)} ${t.name}`, mute: false, solo: false,
});
const unscript = (p) => linesNow(p).flatMap((l) => l.takes.filter((t) => t.clips.length).map(asTrack(p, l)));

// UTF-8, else CP949 (Notepad "ANSI" / Excel CSV on Korean Windows)
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

// a script copied out of a Markdown page (e.g. a Notion export) has \[ \] \~ \, : the backslash before ASCII
// punctuation goes (CommonMark's escapes), so the line reads as written
const unescape = (s) => String(s ?? '').replace(/\\([!-/:-@[-`{-~])/g, '$1');
// (지문) in the text becomes the memo
function splitMemo(s) {
  const memo = [];
  const take = (_, m) => { if (m.trim()) memo.push(m.trim()); return ' '; };
  const text = String(s).replace(/[(（]([^()（）]*)[)）]/g, take).replace(/\s+/g, ' ').trim();
  return { text, memo: memo.join(', ') };
}
// "철수-005" / "캐릭터C-1-01" -> char + written number. In a name only digit groups count as a number (where the name
// ends must be clear); a 번호 column takes any text
function parseName(raw) {
  const m = /^(.*?)\s*-\s*(\d{1,4}(?:-\d{1,4}){0,3})$/.exec(raw.trim());
  return m && m[1] ? { char: m[1].trim(), num: toNum(m[2]) } : { char: raw.trim(), num: null };
}

// .txt: "이름: 대사" per line (: or ：). A line without a name continues the line above; blank and # lines are skipped.
const NAMED = /^([^:：]{1,20}?)\s*[:：]\s*(.*)$/;
// the first colon is a time (10:30, 오후 10:30, 보컬 2: 30초), not a name, when it directly follows 1-2 digits at the
// line start or after a space; 캐릭터A-002: / 행인1: stay names
const TIME = /^(?:[^:：]*\s)?\d{1,2}[:：]/;
function fromTxt(s) {
  const rows = [];
  for (const raw of s.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue; // a comment; an escaped \# is text
    const ln = unescape(t);
    const m = !TIME.test(ln) && NAMED.exec(ln);
    if (m) rows.push({ ...parseName(m[1]), raw: m[2] });
    else if (rows.length) rows[rows.length - 1].raw += ' ' + ln; // text before the first name (a title) is dropped
  }
  const lines = rows.map(({ char, num, raw }) => ({ char, num, ...splitMemo(raw) }));
  return number(lines.filter((r) => r.char && (r.text || r.memo)));
}

// CSV/TSV text -> rows of cells (quotes per RFC 4180)
function parseCsv(s) {
  const first = s.slice(0, s.search(/\r?\n|$/)), sep = first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows = [[]];
  let cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch !== '"') cell += ch; else if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
    else if (ch === '"') q = true;
    else if (ch === sep) { rows[rows.length - 1].push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rows[rows.length - 1].push(cell); cell = ''; rows.push([]);
    }
    else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}

// spreadsheet rows (CSV or .xlsx): columns 캐릭터 | 대사, 번호 and 메모 when a header names them; no header = 캐릭터, 대사
const HEAD = {
  char: /^(캐릭터|이름|인물|배역|역할|화자|character|name|speaker|role)$/i,
  text: /^(대사|내용|text|line|lines|dialog|dialogue|script)$/i,
  num: /^(번호|no\.?|num|number|#|id)$/i,
  memo: /^(메모|지문|감정|연기|비고|note|notes|memo|direction)$/i,
};
function fromTable(table) {
  const rows = table.map((r) => (r || []).map((c) => unescape(c).trim())).filter((r) => r.some(Boolean));
  const col = {};
  const name = (h, i) => {
    for (const [k, re] of Object.entries(HEAD)) if (col[k] === undefined && re.test(h)) col[k] = i;
  };
  if (rows.length) rows[0].forEach(name);
  const header = col.char !== undefined && col.text !== undefined;
  const at = header ? col : { char: 0, text: 1 };
  const out = [];
  for (const r of header ? rows.slice(1) : rows) {
    const who = r[at.char] || '', { text, memo } = splitMemo(r[at.text] || '');
    const m = [at.memo !== undefined ? r[at.memo] || '' : '', memo].filter(Boolean).join(', ');
    if (!who) { // a row without a name continues the line above
      const o = out[out.length - 1];
      if (o) { o.text = [o.text, text].filter(Boolean).join(' '); o.memo = [o.memo, m].filter(Boolean).join(', '); }
      continue;
    }
    if (!text && !m) continue;
    const p = parseName(who), n = at.num !== undefined ? toNum(r[at.num]) : null;
    out.push({ char: p.char, num: n ?? p.num, text, memo: m });
  }
  return number(out);
}

// Numbers are optional (spec): a written number is kept; the rest count on from the character's previous integer
// number (a text one like 1-01 does not move the count), skipping every number written anywhere for that character.
// A repeated written number gets a new one (dup). Lines numbered here are remembered in autoNum (for merge).
const autoNum = new WeakSet();
// the first unused number >= n; jump keeps how far a used run reaches, so no run is scanned twice (else quadratic)
function freeNum({ used, jump }, n) {
  const path = [];
  while (used.has(n)) { path.push(n); n = jump.get(n) ?? n + 1; }
  for (const p of path) jump.set(p, n);
  return n;
}
function number(rows) {
  const per = new Map(), of = (c) => per.get(c) || per.set(c, { used: new Set(), jump: new Map(), last: 0 }).get(c);
  let dup = 0;
  const lines = rows.map((r) => ({ ...r, auto: false }));
  for (const l of lines) {
    if (l.num == null) continue;
    const { used } = of(l.char);
    if (used.has(l.num)) { l.num = null; dup++; } else used.add(l.num);
  }
  for (const l of lines) {
    const c = of(l.char);
    if (l.num == null) { l.num = freeNum(c, c.last + 1); c.used.add(l.num); l.auto = true; }
    if (typeof l.num === 'number') c.last = l.num;
  }
  const line = ({ char, num, text, memo, auto }) => {
    const o = { id: uid('l'), char, num, text, memo: memo || '', takes: [], star: null };
    if (auto) autoNum.add(o);
    return o;
  };
  return { lines: lines.map(line), dup };
}

// 대본 넣기 into a script project: the new script is the base. Lines match by name (철수-002) and keep their
// takes; new text on a recorded line -> 'redo'; lines missing from the new script go, takes and all (goneTakes counts
// them). A line without a written number (autoNum) first matches an unclaimed old line with the same character and
// text (same character + same text first), so a line added on top does not shift every take; then by name.
function merge(old, fresh) {
  const byName = new Map(old.map((l) => [lineName(l), l])), seen = new Set(), byText = new Map(), got = new Map();
  const key = (l) => l.char + '\n' + l.text;
  for (const o of old) (byText.get(key(o)) || byText.set(key(o), []).get(key(o))).push(o);
  const claim = (f, o) => { if (o && !seen.has(o.id)) { seen.add(o.id); got.set(f, o); } };
  for (const f of fresh) if (!autoNum.has(f)) claim(f, byName.get(lineName(f))); // a written number is the name
  for (const f of fresh) if (autoNum.has(f)) claim(f, (byText.get(key(f)) || []).find((o) => !seen.has(o.id)));
  for (const f of fresh) if (!got.has(f)) claim(f, byName.get(lineName(f)));
  const n = { added: 0, changed: 0, gone: 0, goneTakes: 0, same: 0 };
  const names = { added: [], changed: [], gone: [] };
  const lines = fresh.map((f) => {
    const o = got.get(f);
    if (!o) { n.added++; names.added.push(lineName(f)); return f; }
    const changed = o.text !== f.text;
    n[changed ? 'changed' : 'same']++;
    if (changed) names.changed.push(lineName(f));
    const state = (changed && recorded(o)) || o.state === 'redo' ? 'redo' : undefined;
    return { ...o, num: f.num, text: f.text, memo: f.memo, state };
  });
  for (const o of old) if (!seen.has(o.id)) { n.gone++; n.goneTakes += o.takes.length; names.gone.push(lineName(o)); }
  return { lines, counts: n, names };
}

module.exports = {
  toNum, pad, lineName, unescape, linesNow, starTake, isDone, nextTakeName, takeRef, withStar, editLine, addChars,
  exportPick, takeView, unscript, decodeText, splitMemo, parseName, fromTxt, parseCsv, fromTable, number, merge,
};
