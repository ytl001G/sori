// Argument checks for the AI command line (src/cli) and live mode (src/ui/live.js): command-line flags
// against a typed spec, and effect/dialog values against their field specs. Both are trust boundaries.

const bad = (message) => Object.assign(new Error(message), { code: 'BAD_ARG' });
const idx = (k, v) => { if (!/^\d+$/.test(v) || +v < 1) throw bad(`--${k} needs a number from 1`); return +v; };
const num = (k, v) => {
  const t = String(v).trim(), x = Number(t);
  if (t === '' || !Number.isFinite(x)) throw bad(`--${k} needs a number`);
  return x;
};

const MAX_SEC = 24 * 3600; // no time value past 24 hours

// type: 'bool' | 'str' | 'strs' (repeatable) | 'list' (a,b) | 'num' | 'sec' (0..24 h) | 'int' | 'idx' (from 1)
// | 'idxs' (1,3) | 'pairs' (2:1,2:3) | 'onoff' | [choices]
function conv(k, type, v) {
  if (Array.isArray(type)) {
    const hit = type.find((x) => String(x) === v);
    if (hit === undefined) throw bad(`--${k} must be one of: ${type.join(', ')}`);
    return hit;
  }
  switch (type) {
    case 'str': return v;
    case 'num': return num(k, v);
    case 'sec': {
      const x = num(k, v);
      if (x < 0 || x > MAX_SEC) throw bad(`--${k} needs seconds >= 0, at most ${MAX_SEC} (24 h)`);
      return x;
    }
    case 'int': { const x = num(k, v); if (!Number.isInteger(x)) throw bad(`--${k} needs a whole number`); return x; }
    case 'idx': return idx(k, v);
    case 'idxs': return v.split(',').map((x) => idx(k, x.trim()));
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

// tokens -> { pos: [positionals], o: {flag: value}, fields: {name: raw string} }. `open` collects flags that are
// not in the spec into `fields` (effect parameters, checked later by fill); otherwise they are an error.
function parse(tokens, spec, open = false) {
  const pos = [], o = Object.create(null), fields = Object.create(null);
  for (let i = 0; i < tokens.length; i++) {
    const tk = String(tokens[i]);
    if (!tk.startsWith('--') || tk.length < 3) { pos.push(tk); continue; }
    const eq = tk.indexOf('=');
    const k = eq < 0 ? tk.slice(2) : tk.slice(2, eq);
    let v = eq < 0 ? undefined : tk.slice(eq + 1);
    const type = Object.hasOwn(spec, k) ? spec[k] : undefined;
    if (type === undefined && !open) throw bad(`unknown option --${k}`);
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
  return { pos, o, fields };
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
    if (!f) throw bad(`unknown option --${k}; ${known}`);
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

module.exports = { parse, fill, bad, MAX_SEC };
