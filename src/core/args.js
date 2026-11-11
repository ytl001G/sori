// Argument checks for the AI command line (src/cli) and live mode (src/ui/live/): command-line flags
// against a typed spec, and effect/dialog values against their field specs. Both are trust boundaries.

const bad = (message) => Object.assign(new Error(message), { code: 'BAD_ARG' });
const idx = (k, v) => { if (!/^\d+$/.test(v) || +v < 1) throw bad(`--${k} needs a number from 1`); return +v; };
const num = (k, v) => {
  const t = String(v).trim(), x = Number(t);
  if (t === '' || !Number.isFinite(x)) throw bad(`--${k} needs a number`);
  return x;
};

const MAX_SEC = 24 * 3600; // no time value past 24 hours

// a time: seconds (83.5) or as the app shows it, m:ss (1:23.5) or h:mm:ss (1:02:03)
function sec(k, v) {
  const m = /^\s*(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d*)?)\s*$/.exec(v);
  if (m && (+m[3] >= 60 || (m[1] !== undefined && +m[2] >= 60))) {
    throw bad(`--${k}: minutes and seconds go up to 59 (1:23.5, 1:02:03)`);
  }
  const x = m ? (+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3] : Number(String(v).trim());
  if (String(v).trim() === '' || !Number.isFinite(x) || x < 0 || x > MAX_SEC) {
    throw bad(`--${k} needs a time: seconds (83.5) or m:ss (1:23.5), >= 0, at most 24 h`);
  }
  return x;
}
// --track N or NAME. A name made only of digits reads as a number; such a track is given by its number.
const trk = (k, v) => {
  const s = v.trim();
  if (/^\d+$/.test(s)) return idx(k, s);
  if (!s) throw bad(`--${k} needs a track number or name`);
  return s;
};
// a track given by its name -> its number (from 1); a number passes as it is (checked where it is used)
function trackNo(tracks, ref, k = 'track') {
  if (typeof ref === 'number') return ref;
  const hits = tracks.flatMap((t, i) => (t.name === ref ? [i + 1] : []));
  if (hits.length === 1) return hits[0];
  if (hits.length) throw bad(`${hits.length} tracks are named "${ref}" (${hits.join(', ')}): give --${k} its number`);
  const names = tracks.map((t) => t.name), close = near(ref, names), more = names.length > 20 ? ', …' : '';
  const message = `no track named "${ref}"${close ? `; did you mean "${close}"?` : ''} (tracks: `
    + `${names.slice(0, 20).join(', ') || 'none'}${more})`;
  throw Object.assign(new Error(message), { code: 'NO_TRACK' });
}
// the closest of `list` to a mistyped word (case aside, at most about a third of its letters off), or null
function near(word, list) {
  const w = String(word).toLowerCase();
  const dist = (b) => {
    let p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= w.length; i++) {
      const q = [i];
      for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + +(w[i - 1] !== b[j - 1]));
      p = q;
    }
    return p[b.length];
  };
  let best = null, bd = Math.max(1, Math.ceil(w.length / 3)) + 1;
  for (const x of list) { const d = dist(String(x).toLowerCase()); if (d < bd) { bd = d; best = x; } }
  return best;
}
const didYou = (k, keys) => { const n = near(k, keys); return n ? `; did you mean --${n}?` : ''; };

// type: 'bool' | 'str' | 'strs' (repeatable) | 'list' (a,b) | 'num' | 'sec' (0..24 h, or m:ss) | 'int'
// | 'idx' (from 1) | 'idxs' (1,3) | 'trk' (a track: number or name) | 'trks' (1,보컬) | 'pairs' (2:1,2:3) | 'onoff'
// | [choices]
function conv(k, type, v) {
  if (Array.isArray(type)) {
    const hit = type.find((x) => String(x) === v);
    if (hit === undefined) throw bad(`--${k} must be one of: ${type.join(', ')}`);
    return hit;
  }
  switch (type) {
    case 'str': return v;
    case 'num': return num(k, v);
    case 'sec': return sec(k, v);
    case 'int': { const x = num(k, v); if (!Number.isInteger(x)) throw bad(`--${k} needs a whole number`); return x; }
    case 'idx': return idx(k, v);
    case 'idxs': return v.split(',').map((x) => idx(k, x.trim()));
    case 'trk': return trk(k, v);
    // shortcut: a comma separates the tracks, so a name with a comma is given by its number here
    case 'trks': return v.split(',').map((x) => trk(k, x));
    case 'list': {
      const xs = v.split(',').map((x) => x.trim());
      if (xs.some((x) => !x)) throw bad(`--${k} needs a comma separated list`);
      return xs;
    }
    case 'pairs': return v.split(',').map((x) => {
      const m = /^\s*(\d+):(\d+)\s*$/.exec(x);
      if (!m || +m[1] < 1 || +m[2] < 1) throw bad(`--${k} needs TRACK:CLIP pairs like 2:1,2:3`);
      return [+m[1], +m[2]];
    });
    case 'onoff': if (v === 'on' || v === 'off') return v === 'on'; throw bad(`--${k} must be on or off`);
    default: throw bad(`unknown option type for --${k}`);
  }
}

// tokens -> { pos: [positionals], at: [their token indexes], o: {flag: value}, fields: {name: raw string} }.
// `open` collects flags that are not in the spec into `fields` (effect parameters, checked later by fill); otherwise
// they are an error.
function parse(tokens, spec, open = false) {
  const pos = [], at = [], o = Object.create(null), fields = Object.create(null);
  for (let i = 0; i < tokens.length; i++) {
    const tk = String(tokens[i]);
    if (!tk.startsWith('--') || tk.length < 3) {
      pos.push(tk); at.push(i);
      continue;
    }
    const eq = tk.indexOf('=');
    const k = eq < 0 ? tk.slice(2) : tk.slice(2, eq);
    let v = eq < 0 ? undefined : tk.slice(eq + 1);
    const type = Object.hasOwn(spec, k) ? spec[k] : undefined;
    if (type === undefined && !open) throw bad(`unknown option --${k}${didYou(k, Object.keys(spec))}`);
    if (type === 'bool') { if (v !== undefined) throw bad(`--${k} takes no value`); o[k] = true; continue; }
    if (v === undefined) {
      v = tokens[++i];
      if (v === undefined || String(v).startsWith('--')) throw bad(`--${k} needs a value`);
      v = String(v);
    }
    if (type === undefined) fields[k] = v;
    else if (type === 'strs') (o[k] = o[k] || []).push(v);
    else o[k] = conv(k, type, v);
  }
  return { pos, at, o, fields };
}

// Values for a dialog/effect: `base` (default: the field defaults) <- preset <- args. Numbers are clamped to the
// field range like the dialog does; option fields must be one of their options; text is cut to 100 characters.
function fill(fields, presets, args, presetName, base) {
  const v = { ...Object.fromEntries(fields.map((f) => [f.key, f.value])), ...base };
  if (presetName !== undefined) {
    const p = (presets || []).find((x) => x.name === presetName);
    const names = presets && presets.map((x) => x.name).join(', ');
    if (!p) throw bad(names ? `unknown preset "${presetName}"; presets: ${names}` : 'this has no presets');
    Object.assign(v, p.values);
  }
  for (const [k, raw] of Object.entries(args || {})) {
    const f = fields.find((x) => x.key === k);
    const known = fields.length ? 'fields: ' + fields.map((x) => x.key).join(', ') : 'it takes no fields';
    if (!f) throw bad(`unknown option --${k}${didYou(k, fields.map((x) => x.key))}; ${known}`);
    if (f.options && f.multi) {
      // shortcut: a comma separates the values, so a value with a comma cannot be given here
      const vals = [...new Set(String(raw).split(',').map((x) => x.trim()).filter(Boolean))];
      const off = vals.find((x) => !f.options.some((o) => String(o.value) === x));
      if (!vals.length || off !== undefined) {
        throw bad(`--${k} takes a comma-separated list of: ${f.options.map((x) => x.value).join(', ')}`);
      }
      v[k] = vals.map((x) => f.options.find((o) => String(o.value) === x).value);
    } else if (f.options) {
      const o = f.options.find((x) => String(x.value) === String(raw));
      if (!o) throw bad(`--${k} must be one of: ${f.options.map((x) => x.value).join(', ')}`);
      v[k] = o.value;
    } else if (f.text) v[k] = String(raw).trim().slice(0, 100);
    else v[k] = Math.max(f.min, Math.min(f.max, num(k, String(raw))));
  }
  return v;
}

module.exports = { parse, fill, bad, near, trackNo, MAX_SEC };
