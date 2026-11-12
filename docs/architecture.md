# Architecture

## Stack
- Electron 45 (Chromium + Node 22). Renderer has `nodeIntegration: true`, `contextIsolation: false`
  because it only ever loads local files and needs `fs` + npm modules directly. Never load remote URLs.
  `backgroundThrottling: false`: loop playback (redraw-loop tick) and the metronome pump (25 ms timer) must keep
  running when the window is covered or minimized; Chromium would otherwise pause rAF and slow timers to 1/s.
- Plain JS, CommonJS modules, no bundler, no framework. Rendering: one `<canvas>` for the timeline,
  small canvases for meters / EQ curve, DOM for everything else.
- Audio: Web Audio API (decode, live graph, OfflineAudioContext for export) + AudioWorklet processors
  (compressor, limiter, meters, recorder) that run the same code live and offline.

## Dependencies (why each exists)
| Package | Why |
|---|---|
| `electron`, `electron-builder` (dev) | app runtime, Windows installer |
| `acorn` (dev) | parses JS for the size-limit check (`test/standards.js`): function lengths need real parsing (regex counting breaks on strings, regexes and template literals); no dependencies of its own |
| `@breezystack/lamejs` | MP3 encoding (Chromium cannot encode MP3). Required by file path `dist/lamejs.js` (ESM via require(esm)); the CJS entry exports nothing and "exports" blocks the subpath |
| `soundtouchjs` | tempo change without pitch change and vice versa (WSOLA + rate transposer) |
| `fft.js` | FFT for noise reduction and the spectrogram view |
| `read-excel-file` | reads the first sheet of an .xlsx script (대본 녹음 모드, app and `sori script`, via core/scriptfile.js) as rows; MIT, small (fflate + saxen). `readSheet()` from `read-excel-file/node`. The npm `xlsx` package was skipped: its npm release has open advisories (prototype pollution, ReDoS) |
| `@phosphor-icons/core` | icon SVGs (UI UX Pro Max icon pick), inlined at startup |
| `pretendard` | bundled UI font (Inter-based with Hangul), offline |

The AI command line (`src/cli`) adds no package: argument parsing, the pipe (`net`) and the hidden window
(`child_process` + the Electron binary already installed) are all built in.

## Files
```
main.js                 Electron main: window, single instance, dialogs + user-data path (IPC), close guard,
                        removes the autosave and its sound folder on a normal close; --smoke: temp userData + fake
                        mic + own live pipe;
                        sori live pipe -> window; --cli=<dir>: hidden window for one CLI job (no lock, temp userData);
                        a .vproj argument (double-click): `start-file` (asked once after crash recovery) or
                        `open-path` to the running window (second-instance) -> openProject
src/core/  (plain Node, no DOM / AudioContext)
  state.js              project, selection, view, ui panels, history (undo/redo), dirty flag
  edit.js               pure edit ops on clips (split, ripple delete, insert, trim, merge, regions, fades, remapFrame)
  effects.js            pure DSP effects: (channels, sampleRate, params) -> channels; EQ stage math for the graph
  fxparams.js           effect fields, ranges, labels, presets, clamp/validate for track + master chains
  loudness.js           BS.1770 integrated loudness (LUFS) and an offline lookahead limiter (음량 맞추기)
  voice.js              목소리 정리 steps (one strength word each), the noise floor (quietest 0.5 s), de-esser and hum
                        filters shared with the effect panel, 50/60 Hz listening
  audiopack.js          packs a source for .vproj v4: 16-bit exact / 24-bit, fixed predictors + Rice, verified
  backup.js             자동 백업 folders: write (newest 10 per group, sound in a shared pool), 30-day tidy, list
  passes.js             playback as passes: pass 0 from the start point, then a loop's [a, b) back to back (passAt), the
                        frame heard at a context time (frameAt); engine.js schedules them, metro.js clicks on them
  downmix.js            more than 2 channels -> stereo on import: WAV channel order per count (3-8), centre/surrounds
                        -3 dB, LFE left out (Web Audio's quad/5.1 rules); other counts evenly to both sides
  pool.js               several jobs at once (RENDERS = 4 renders in flight: exports, sori measure), results in order
  workers.js / worker.js pure work on other CPUs: run(mod, fn, args, signal) calls require('./' + mod)[fn] on one
                        of up to 8 workers (CPUs - 2): Web Workers with Node in Sori's windows (main.js nodeIntegrationInWorker),
                        worker_threads in plain Node (unref'd while idle so a command exits); closed after 30 s idle.
                        worker.js runs only encoders / voicedit / audiopack / effects and hands result buffers back
                        uncopied. signal (AbortSignal): on abort a queued job leaves, a running one's worker is
                        terminated, the promise rejects with signal.reason (멈추기 lands at once). give: buffers
                        of args moved instead of copied (effects and 목소리 정리 hand over their fresh render).
                        Users: MP3 encoding, the app's effects and 목소리 정리 (and their previews, so the screen's
                        thread never runs DSP), apply on several lines (voicedit.cleanTake), the CLI's packAhead
  measure.js            sori measure: one rendered piece -> LUFS, peak, places over 0 dBFS, room noise, speech level,
                        quiet stretches (voicedit.quietLevels: the same reading as 긴 침묵 줄이기)
  voicedit.js           목소리 정리 on tracks for the app and the CLI: steps in place, then 긴 침묵 줄이기 cuts/pads;
                        cleanTake = one range's pure work (voiceEdit's clean option runs it elsewhere)
  safewrite.js          every file write: own temp name + fsync + rename (retries a busy Windows rename), uniquePaths
                        The first write into a folder in a run removes temps <file>.<pid>.<n>.tmp of processes no
                        longer running (a write killed midway leaves one, up to the file's size; 40 kills: 24 -> 0);
                        only for the files Sori writes (.vproj .snd .json .wav .mp3 .part), never a user's own .tmp
  encoders.js           WAV / MP3 encoding (moved out of fileio.js, which re-exports it)
  fileio.js             .vproj v4 save (+ thin backups, idle prepack) / load (v1-v4, in steps), WAV/MP3 encode
  parked.js             필요할 때만 풀기: a Source with an exact packed blob decodes `ch` on use and lets it go off screen
  script.js             대본 녹음 모드: script readers (.txt / CSV rows), line numbers, re-import merge, take helpers, and the rules
                        the app and sori script share (nextTakeName, takeRef, withStar, editLine, addChars, exportPick, takesNow;
                        unit = '테이크' in a script project, else '트랙': button and undo step names)
  split.js              긴 녹음 나누기 for the app's window and sori script split: sound runs (voicedit.quietLevels'
                        between-words threshold), N snapped to quiet, pieces per gap, line boundaries, window edits,
                        plan (pieces -> line index), addTakes
  find.js               찾기 (Ctrl+F, sori live find): hits(project, text, listed lines, {clips, markers, memo}) = what
                        matches (a part, case and spaces ignored) in the order Enter walks — lines or tracks in list
                        order, then clips and markers by time; pick() = where typing / Enter / Shift+Enter lands
  peaks.js              waveform peak cache (min/max pyramid per Source)
  spectro.js            spectrogram columns per Source, computed a slice per frame
  settings.js           app settings (localStorage), validated, change listeners
  shortcuts.js          default key map (mirror of spec.md §6) + user overrides
  args.js               CLI flag parsing against a typed spec; dialog/effect values checked against field specs
  summary.js            project -> plain JSON (sori info, sori live state; describeScript = sori script info)
  scriptfile.js         reads a script file (.txt/.csv/.tsv via script.js, .xlsx via read-excel-file) for the app and sori script
src/cli/   (the AI command line, docs/cli.md; plain Node except headless.*)
  sori.js               entry: help, dispatch, JSON output, open-in-app check, live client, starts the hidden window
  verbs.js              file commands: load .vproj -> one edit with the app's rules -> atomic save; export/import via `audio`;
                        `on`: the same edit on the app's open project (sori live), nothing loaded or saved.
                        The verbs themselves: tracks.js (project, tracks, import, fx, apply, tempo, export),
                        clips.js (clips, ranges, markers), lines.js (script projects: lines, takes, ★, characters),
                        split.js (script split = 긴 녹음 나누기 without the window)
  project.js            the project a verb works on: load/save, find tracks/clips/lines/takes by the CLI's names, check args
  scope.js              track verbs on a script project's takes: --line / --take in place of --track
  measure.js            sori measure: what to render (tracks alone + mix, or ★ takes) through audio.mixdown, then
                        core/measure.js; an `audio` verb (hidden window / the app's engine), never saves
  batch.js              sori batch: a file of commands checked, then run in order on one project (saved / one undo
                        step only if all succeed); what each touches and the waves that could run together
  apply.js              sori apply: the 효과 menu on a file (placement rules of commands/effects.js) and 목소리 정리;
                        applyLines: 목소리 정리 on several lines' ★ takes (--line A,B / --char / --all-lines; verb.lines,
                        scope.many): each take's cleanTake on workers.js, then put in one line at a time through
                        scope.inTakes + applyVoice with that result, exactly as `--line L --take ★` would
  recipes.js            the app's rules repeated for the verbs (typed tracks, effect rules, mixer values, export segments)
  pipe.js               local named pipe for sori live (name, serve for main.js, request for the CLI)
  headless.html/.js     hidden window: runs verbs.execute with engine.js decode + mixdown, writes result.json
src/audio/
  engine.js             AudioContext, decode, live graph, loop passes (next one queued 0.5 s ahead), mixdown,
                        recording, devices
  buffers.js            Source -> AudioBuffer cache, decoding; samples shared with the buffers (one copy)
  metro.js              metronome + count-in clicks on the beat grid of each pass (straight to the speakers)
  meters.js             level meters: latest peak per track / master / input, held peak (>= 1 = clipped light)
  mic.js                설정 window audio tools: device list, mic input test, 자동 측정 (latency)
  chain.js              effect chains as Web Audio nodes (track: hum/eq/comp/deess/reverb/echo; master: eq/comp/
                        reverb/echo + gain/limiter)
  worklets.js           AudioWorklet processors: sori-comp, sori-limiter, sori-deess, sori-meter, sori-rec
  mp3.js                MP3 encoding on other CPUs (encoders.encodeMp3 on core/workers.js). jobsFor(fmt): files an
                        export renders at once (MP3 8, WAV 4)
src/ui/
  index.html            shell markup
  styles/               design tokens (both themes, base.css :root) + components — see ui-guide.md; one file per area:
                        base, layout, dialogs (menus, modal, toast), panels (mixer, effect panel), sheets, script
  app.js                entry: applies settings, wires views + keys, autosave timer, redraw loop (see Redraw below)
  commands/             every user action as a named command; menus/shortcuts/buttons call these. index.js re-exports
                        the API; core.js = registry + shared selection helpers; one file per group: play, record,
                        script, files, export, edit, nudge (clips moved by keys), tracks, effects, markers, view,
                        voice (목소리 정리), backup
                        (자동 백업 + 백업에서 열기), longrec (이어 녹음, N / Shift+N, 긴 녹음 나누기…, apply);
                        outside.js = requests from main (the window's X, a .vproj opened while running);
                        take.js = sori live file commands; find.js = 찾기: core/find.js on the open project, going
                        to a hit (a line via goLine, a track / clip made current and scrolled into view, a clip or
                        marker sets the play position); the box and sori live find both call find()
  timeline/             the canvas: index.js (events, context menu, drop), view.js (geometry, colors, zoom, scroll),
                        paint.js + clips.js (drawing), hit.js (hit test, cursor, snap), mouse.js (press and drag)
  panels/               tracks.js = track header DOM (name, FX, ★ for takes, M/S, volume, pan, delete); mixer.js =
                        bottom mixer (strips, faders, meters); fx.js = right effect panel (always-on effects of master,
                        one track, or one character); eq.js = draggable EQ curve (effect panel + EQ dialog); script.js =
                        script mode views: line list (tabs, filter, progress) + line bar / prompter; find.js =
                        the Ctrl+F box over the timeline (built on first use, opens fresh each time); history.js =
                        실행취소 기록, the effect panel's second tab (rows from `history.steps()`)
  split/                긴 녹음 나누기 window (sheet): index.js = tools, keys, mouse, foot; edit.js = its state, edits,
                        line list; draw.js = its two waveforms and their hit tests
  settings/             설정 window: index.js = the 4 tabs; audio.js = 오디오 장치 tab; keys.js = the editable shortcut
                        list (key capture) + the 단축키 window (F1)
  live/                 sori live requests from main.js: index.js = state, command list, selection, run a command
                        (undoable), any file command on the open project (verb -> commands.takeProject); run.js = sori
                        live run, a menu command like the user (values fill its dialog, --path, --yes); settings.js =
                        sori live settings, everything the app remembers, checked like the 설정 window
  menus.js              top-bar dropdown menus + context menus
  dialogs.js            modal (fields + presets + extra editor), sheet (settings, shortcuts), toast, busy
  controls.js           row / choice / switch controls (설정 window, 나누기 window)
  icons.js              replaces <i data-icon> with Phosphor SVGs
  tips.js               tooltips (data-tip) and sentences (named(), hints()) that name a key, from the command's
                        current keys: a key changed in 설정 > 단축키 shows everywhere
test/standards.js       size limits (300 / 40 / 120), the stylesheets' design rules (tokens, 12px, spacing and radius
                        steps: ui-guide), the same for canvas text and colors set in JS, no app key typed in Korean
                        text, spec.md's shortcut table = DEFAULT_KEYS; run first by npm test
test/run.js             Node self-checks: runs test/unit/*.js in order (helpers.js = assert, fakes, CLI runner) — core,
                        worklet math (vm sandbox), CLI commands and pipe
test/smoke.js           scripted end-to-end run inside Electron (npm run smoke); shipped in the installer. Runs the steps
                        in test/smoke/<group>.js in order on one app session; kit.js = stubs + helpers
```
Requires point down only: `ui -> audio -> core`, `cli -> audio -> core` (cli is a top layer like ui; main.js requires
`cli/pipe`). Views (`timeline`, `panels/`, `menus`) read state and call commands.

## Data model
All time positions and lengths are **integer sample frames at the project sample rate**
(`project.sampleRate`, = AudioContext rate). The AudioContext starts at the 새 프로젝트 rate from settings
(48000 default; 44100 optional); a loaded project with another rate recreates the context at that rate.
Seconds exist only in the UI.

```js
project = {
  sampleRate, tracks: [Track],
  master: { gainDb /* -24..12 */, fx: { eq, comp, reverb, echo, limiter } },
  markers: [{ id, frame, name }],          // sorted by frame
  bpm /* 20..300 */, beats /* 1..12 per bar */, grid: 'time' | 'beats',
  script: null | Script,                   // 대본 녹음 모드 (below); null = a normal project
}
Script = { lines: [Line], lineId /* current line */, chars: { [name]: { color, fx: { hum, eq, comp, deess, reverb, echo } } } }
Line   = { id, char, num /* 1.. per character, or text as written (1-01; SC.toNum) */, text, memo, state?: 'redo', takes: [Track], star: takeId | null }
Track = { id, name, color, gain /* linear 0..2 */, pan /* -1..1 */, mute, solo,
          fx: { hum, eq, comp, deess, reverb, echo }, clips: [Clip] }
          // no per-track view: 스펙트로그램 보기 is state.view.spec for the whole timeline, never saved (a 'view'
          // in an older file is dropped on load)
Fx    = { on: bool, ...fields }            // fields + ranges in fxparams.js FIELDS
Clip  = {
  id, name,
  start,        // frame on the timeline where the visible part begins
  src,          // Source: { id, ch: [Float32Array, ...] }  (1 or 2 channels, immutable, shared)
  offset,       // first visible frame inside src
  length,       // visible frames (offset + length <= src length)
  gain,         // linear clip volume (default 1)
  fadeIn, fadeOut, // frames, fadeIn + fadeOut <= length
  fadeInShape?, fadeOutShape?, // 'smooth' | 'fast' | 'slow'; absent = linear (clampFades drops linear/unknown)
}
selection = {
  range: null | { a, b, trackIds: Set },   // time range across tracks, a < b
  clipIds: Set,                            // clip selection (exclusive with range)
  markerId,                                // selected marker or null
  activeTrackId,                           // target for paste/record/split when nothing else says
  playhead,                                // frame
}
state.view = { pxPerSec, scrollX, scrollY, follow, laneH }   // from settings + zoom/scroll
state.ui   = { mixer, fxPanel, fxTarget: 'master' | trackId | 'char:<name>', // panels (remembered in settings)
               scriptView: { char, todo, q } }                // line list filter, not saved
```
Script mode (`core/script.js`, `ui/panels/script.js`, spec §5-5): **`project.tracks` is the current line's takes**, so the
timeline, headers, mixer, clip edits, effects and recording work on takes unchanged. `line.takes` of the current line
is stale until stashed; `linesNow(project)` gives every line with the current takes filled in (save, export, counts,
undo snapshots use it). Every take of the current line is on screen (no folding).
`viewTakes(pick)` re-applies `takeView` to them (a stashed line missed live character fx) and selects `pick`, else
the ★, else the first take; `showLine` (after `clearSel`), undo/redo and live file commands call it. Moving to another
line (`goLine`) stashes `project.tracks` into its line and loads the new
line's takes through `takeView` (the character's color + effect object). Lines are replaced, never mutated
(`setLine`), so a lines array is a cheap snapshot. A take is a normal Track named `테이크 n`, its clips start at 0 s.
Playback and mixer updates go through `audible()`: in a script project exactly one take sounds — the selected one —
fixed when playback starts (`playTake`, set in `startPlay` from stopped). While playing it is
looked up in every line (`linesNow` + `takeView`), so ★ or another take never switch what is heard; moving to another
line (`goLine`, or undo/redo landing on one) stops playback and a recording first;
`tick` ends at that take's end and `landAt` puts the playhead at 0 when the take is no longer on screen. Line export renders `[★ take with the character fx]`
through the same graph + master chain, one file per line named `캐릭터-번호`.
이어 녹음 (`commands/longrec.js`, spec §5-5) is a recording with `rec.cont = { order, at, marks }` and no take: nothing
goes into `project.tracks` or history while it runs, so undo, edits and line moves never touch it. N pushes the raw
recorded length into `marks` (the count-in / latency lead is cut from them on stop, like from the sound). Stopping
hands the sound to the 나누기 window on a timer (a ↑/↓ that stopped it finishes first). `stopFirst` refuses while it
runs (new / open / 대본 넣기 / close would lose a sound that exists nowhere else). From the start of 이어 녹음 until its
window closes `state.holding` is true (`setHolding`): main is told the page is dirty, so the window's X asks, and
`outside.js` refuses the X and a .vproj opened from outside with a toast instead of closing the window. 적용 is one
`history.commit()`: new takes on each planned line (`split.addTakes`; the current line through `project.tracks`).
Pieces: sound is cut at every boundary first, then joined by the gap within a line only, so a piece next to a boundary
keeps its 0.3 s margin, not the quiet up to the boundary. The window keeps its peaks on its own state (gone with it).
A clip is a window (`offset`, `length`) into an immutable `Source`. Split/trim/move create new Clip
objects pointing at the same Source — no sample copying. Destructive effects and merge create a new Source.

Settings (`settings.js`, localStorage `sori-settings`) are per user, not per project: devices, latency,
count-in, follow, stop-return, metronome volume, autosave interval, export format, new-project rate,
undo memory, theme, zoom, lane height, key overrides, recent files, panel state, metronome on, snap.
Every value is validated on load (`validate`); bad values fall back to defaults.

## Invariants
1. Clip and Source objects are never mutated after creation. Edits replace them. (fileio packs each Source once and
   reuses the blob; mutating samples in place would save stale sound.) Once it has a blob, a Source is parked
   (`parked.js`): `ch` becomes a getter that decodes the blob when needed, `frames` / `channels` stay without
   decoding (`srcLen`), and the app's 5 s sweep (`buffers.sweep`) lets go of decoded samples out of the project
   (undo history, other script lines) and unused for 30 s. Opening a file parks every take whose sha1 checks out
   without decoding it (a copy of its blob; old blobs without a hash are decoded once to check them): 255 MB, 454
   takes opened in 5.1 s, now about 1 s. Never keep `src.ch` around in a long-lived cache; read it when used.
2. `track.clips` is replaced (new array) on every edit, never pushed into in place.
3. Every structural edit: `history.commit()` before mutating. Snapshot = tracks with shallow
   copied props, the clip arrays (clips shared) and `markers`, so undo is cheap. History is capped at
   100 steps **and** at `history.budget` (설정 > 실행취소 메모리, 0.5 GB default) of unique sample data
   only history keeps alive (not the project's own; the newest step counts from the next commit); oldest steps are
   dropped first. A drag that ends where it started
   calls `history.drop()`. In a script project the snapshot also holds every line (with takes) and the line it
   shows; undo/redo show the line the step changed (the opposite stack gets the present state viewed at that line),
   so Ctrl+Z on another line jumps back to the edited one (stopping playback / a recording first, its take kept).
   Moving between lines is not an undo step.
   Every step carries `label` and `time` (실행취소 기록): `commit(lineId, label)` names it, else `history.label` =
   the command running (commands/core.js `run` sets it from the command's label, without '…'; several in flight:
   the newest), else '편집'. Edits made outside a command (mouse drags, the end of a recording, a sori live file
   command, 대본 넣기, ★) pass their own name. Undo/redo move the name and time with the step. `history.steps()` =
   { done (oldest first), undone (redo order) }; `historyTo(n)` (commands/edit.js) undoes / redoes one step at a
   time to just after step n, so each does exactly what Ctrl+Z / Ctrl+Y does, and stops where a step is refused.
4. Clips may overlap within a track; playback and region render sum them, with the automatic crossfade below.
5. Live, not in history: mixer props (gain, pan, mute, solo, name), track/master effects,
   track view, tempo/grid. Undo restores clips + markers and keeps the current live values.
6. Effective fades (`edit.fades`): each clip's own fadeIn/fadeOut, raised to the overlap length where a
   clip partly overlaps a neighbour (linear crossfade, equal-gain). A clip fully inside another gets none.
   The clip envelope (gain × min(fade-in, fade-out)) is applied in `renderRegion` sample by sample (`envAt`) and
   scheduled on a per-clip GainNode as linear ramps between `envBreaks`; a curved fade (`fadeGain`: smooth = raised
   cosine, fast = 1−(1−x)³, slow = x³; fade-out = 1 − shape(progress)) gets 32 breakpoints, max error < 0.3% (test).
   A fade widened into an automatic crossfade ignores the shape and stays linear (`fadeShapes`).
7. Clip edges as they sound (`edit.played(clips, silence)`, copies, never stored; playback, export and every
   `renderRegion`): a cut joins two waves at any value, so the sound would jump there in one sample (a 220 Hz sine cut
   at random: a step 49x its largest normal one, a click). Where a clip's end meets another's start on the track,
   each plays on into the sound it has past the edge (its handle, up to `EDGE` = 120 frames a side: 2.5 ms at 48 kHz)
   and the overlap crossfades them (rule 6), as Pro Tools / Reaper / Audition do; one handle is enough. None (two new
   sources an effect made, recordings): each side fades over EDGE in its own sound only if the sound jumps there
   (`jumps`: b's first sample off the one foreseen from a's last two by more than twice their own steps, with clip
   volume); pieces of one sound processed one by one meet themselves and are left as they are (fading them made a
   dip: up to 0.3 on a 0.5 sine, audit 2026-11-12).
   Only clips within 3 EDGE of the range played or rendered count (`played(clips, silence, from, to)`): a join
   further away changes nothing there, and reading it would decode sources parked far away.
   A plain split crossfades the same samples (sounds as before, < 1e-6).
   An edge with its own fade keeps it (the other side of that join fades over EDGE). `silence` (engine: playback and
   export): an edge against silence fades over 2 * EDGE; edits leave it out, or every effect would bake it in again.

## Edit semantics (edit.js)
- `splitAt(track, f)`: every clip strictly containing `f` becomes two clips. The left piece keeps the
  fade-in, the right piece keeps the fade-out (each clamped to its length).
- `rippleDelete(track, a, b)`: split at a and b, drop clips inside, shift clips with `start >= b` by `-(b-a)`.
- `insertGap(track, f, len)`: split at f, shift clips with `start >= f` by `+len`.
- `clearRange(track, a, b)`: split at a and b, drop clips inside (no shift) — "무음 처리".
- `keepRange(track, a, b)`: drop everything outside [a, b).
- `renderRegion(track, a, b)`: sum of clip envelopes × samples over [a, b) into new channels (gaps = 0).
- `replaceRegion(clips, a, b, ch, name, ripple)`: clearRange then add one clip at a. `ripple=true`
  (tempo): clips after b shift by the length change. `ripple=false` (reverb/echo tail): the longer
  result overlays what follows (summed in playback), nothing shifts.
- `merge(track, clipIds)`: renderRegion over the clips' span -> one clip (fades baked in).
- `trimClip(clip, edge, f)`: move left/right edge within [0, src length]; fades are clamped.
- `remapFrame(f, a, b, newLen)`: where frame f lands after [a, b) becomes newLen long (delete = 0,
  insert = a == b). Markers use it, but only when the edit covers **every** track;
  a marker inside a deleted range moves to its start. Tempo (속도 바꾸기) counts as covering every track
  when each track with sound after the stretch start got a stretch from that same start; tracks may end at
  different points (no selection), so markers are remapped with the longest one.
- Clipboard: `{ kind: 'range', len, tracks: [ch|null ...] }` or `{ kind: 'clips', items: [{trackOffset, startOffset, clip}] }`.
  Both paste the same way: a selected range is deleted first, then every target track gets
  `insertGap(at, len)` and the content is placed at `at` (ripple). For clips `len` = span of the copied group.

Tracks (commands/tracks.js): every new track (빈 · 복제 · 목소리 · 배경음악 · 효과음) goes through `insertTrack`, right after the
active track (end if none) and becomes active. 복제 copies the track with a new id and color, `name + ' 복제'`, clips
with new ids sharing their sources, and the same `fx` object (setFx replaces fx, never mutates it). Typed tracks are
`makeTrack` + gain + effects switched on from fxparams presets. `moveTrack(id, to)` reorders (grip drag, Ctrl+Alt+↑/↓);
lanes, headers and mixer strips all follow `project.tracks` order. All of these are one history step each.

Effect target resolution (commands/effects.js): range -> per selected track `[a,b)`; else selected clips ->
each clip's span on its track; else everything (all tracks, 0..project end). With selected clips the new clips
are selected afterwards, read after every target (one on overlapping clips splits the clip made for the one before
it). Delete / cut, paste and 무음 넣기 that change nothing (past every clip and marker) drop their undo step
(`dropIfSame` in commands/edit.js). Every edit ends in `afterEdit` (commands/play.js), which keeps only selected
clips that still exist (`tidySel`: 무음 넣기 inside a selected clip splits it).

## Effects contract (effects.js)
`fx(ch: Float32Array[], sr: number, params) -> Float32Array[]` — synchronous, never mutates input,
all plain JS so `npm test` runs them in Node. Callers run them inside `D.busy` (below) with a step per target.

## Long jobs: progress and 멈추기 (dialogs.js busy)
`D.busy(label, fn)` runs `fn(step)` behind the overlay. `await step(done, total, text)` shows the bar and
'42% · text' and 멈추기 (button, Esc); every 50 ms at most it yields a frame (paint, the stop click / key). After a stop
the next step throws and busy returns `D.STOPPED`, so every job computes first and changes the project only after its
last step (effects: applyFx; 목소리 정리: voiceEdit; import: decodeAll; open: readInSteps 4 MB pieces = the first half
of the bar, then `IO.loadSteps` a step per source unpacked = the second, '소리 푸는 중'). While busy a
capture-phase keydown listener swallows every key (Esc = stop), the overlay takes the mouse and `sori live` editing
requests get `BUSY` (`D.isBusy`), so nothing changes the project between steps. Export: `engine.mixdown(..., onPart)`
suspends the OfflineAudioContext about every 2 % (at whole 128-frame quanta, at least 1 s apart, a quantum
before the end: suspend() rounds a time up and refuses one at the end, which summed time steps hit on about half of
all lengths over 50 s) and awaits onPart (a throw leaves it suspended and rejects);
`writeAll` writes `<name>.part` files and renames them all at the end (a stop or error removes them). Autosave
recovery loads without steps (no 멈추기: stopping, then editing, would let autosave overwrite the crashed work).
Effects and 목소리 정리 compute on workers (measured 2026-11-12 on 5 min of stereo, each blocked the screen whole:
잡음 줄이기 16.5 s, 목소리 정리 › 잡음 12.2 s, reverb 7.1 s, 음량 맞추기 5.9 s, comp 4.6 s): `applyFx` and
`voiceEdit(…, clean, k)` read every range from the clips as they are, run them k at once (`atOnce`: up to
WORKERS, fewer for long ranges, at most 30 min of frames in flight: each is held twice while it runs), report a step
per range done ('0% · 계산 중' first), then apply right to left. `step.signal` aborts them on 멈추기. Between steps
the bar's stripes move (CSS; they stand still under reduced motion). A preview plays only while it is the latest and its window is
open (`previewTicket`, `stopPreview`).
- EQ: RBJ biquads (highpass lowcut, lowshelf lowFreq, peaking midFreq/midQ, highshelf highFreq, lowpass highcut).
  `eqStages(sr, params)` returns the active stages (lowcut 0 Hz / highcut 20000 Hz = off); `biquadMag`
  gives the response for the EQ graph, so the curve is the exact filter.
- Compressor: hand-written, stereo-linked, soft knee (Chromium's DynamicsCompressorNode adds ~6 ms
  lookahead delay that would shift audio). The `sori-comp` worklet runs the same algorithm (tested equal).
- Reverb: Freeverb (8 combs + 4 allpasses, stereo spread); always returns stereo; tail kept (overlay, see replaceRegion).
- Echo: feedback delay line; tail kept likewise.
- Noise reduction: STFT 2048/hop 512 Hann, profile = mean magnitude per bin; gate on time-smoothed
  magnitude vs `profile * sensitivity`, gain smoothed across frequency and with fast-open/slow-close in time.
- Tempo/pitch: soundtouchjs; the source is padded with silence so the pipe flushes, then output is
  cut to the expected length.

## 목소리 정리 (voice.js, voicedit.js, loudness.js)
- Strength words `low | mid | high` pick the values of the same-named presets (잡음 · 전기 웅 소리 · 치찰음), comp presets
  부드럽게 · 목소리 고르게 · 팟캐스트, lowcut 60 · 80 · 100 Hz, gate -10 · -20 dB · silent, LUFS -23 · -16 · -14.
- Noise floor = the quietest 0.5 s (10 ms blocks, 50 ms steps) among windows with no block at or under -100 dBFS
  (digital silence between clips is not the room; a window half room, half zeros measured 26 dB low on a real take); it counts only when it sits ≥ 20 dB under the 90th percentile window, else the step is
  skipped (`skipped`, notice text `skipNote`). Digital silence is the floor only when nothing else is quiet (TTS).
  'Sound' (`soundDb`) = a block ≥ floor + 8 dB and ≥ speech level (90th percentile window) − 20 dB, so breaths are
  quiet (gate 5 ms blocks, gaps 10 ms blocks).
- Loudness: K-weighting (shelf + highpass, any rate), 400 ms blocks every 100 ms, gates -70 LUFS absolute and -10
  relative; mono counts once (a centred mono track leaves the panner at -3 dB per side, so its export measures the
  same). Gain, then the offline limiter at -1 dBTP (trailing 5 ms min-hold averaged over 5 ms + 50 ms release on the
  true peak below: every output sample and the wave between them is under the ceiling); limiting lowers loudness, so
  gain is corrected up to 4 passes (within 0.1 LU). The true peaks are read once (they scale with the gain).
- True peak (`loudness.peaks`, both limiters): the wave a player draws between samples rises above them (a 12 kHz
  sine at 45 deg: +3 dB; bright noise held to -1 dB by its samples alone: +4.1 dBTP, measured 2026-11-12). Read 4x as
  BS.1770 Annex 2 does, with a longer filter: `tpTaps()` = 3 rows (points 1/4, 2/4, 3/4 to the next sample) of a
  Blackman-windowed sinc, `2 * TP_HALF` = 64 taps each, unit gain. After a -1 dB limit (8x / 128-tap reference):
  sines and voice -1.00, bright noise -0.67 dBTP (48 taps: -0.38). A point is at most REACH (2.81) x the largest
  sample it reads, so frames whose neighbourhood stays under the ceiling skip the filter (exact above it). Read 65536
  frames at a time (the whole take at once briefly held 7x its size: 806 MB for 10 min mono, now 145). Cost:
  offline about +1 s per minute of stereo when every frame is near the ceiling; live 1.6% of one core.
- De-esser: Linkwitz-Riley split (2 × Butterworth each side) at `freq`; the high band × g while its envelope is
  within 12 dB of the whole (full amount at 3 dB), only above -50 dBFS. An LR split keeps both bands in phase:
  `x - highpass(x)` would cancel instead of turning down. `sori-deess` = the same per sample (tested equal).
- Hum: RBJ notches (Q 30) on freq × 1..count below 0.45·sr; `humFreq` = Goertzel power at 50/60 Hz + 2 multiples
  over 1 s blocks of the first 30 s. Panel: turning hum on without a freq listens once (`heardHum`); the freq field
  has `keep: true` so presets never set it (fxparams fills presets from defaults except keep fields).
- Gate: straight ramps (opens over 2 ms, 5 ms lookahead; holds 100 ms; closes over 80 ms) so 완전히 reaches 0.
- `await voiceEdit(tracks, targets, sr, rows, step?)`: right to left, each target rendered, run through ORDER
  (hum, noise, gate, lowcut, even, deess, loud); then for gaps, on that result: 10 ms blocks under `soundDb` are
  quiet; quiet runs between sound longer than `over` keep `keep`, half each side; the quiet before the first and
  after the last sound heard (`edgeDb` = max(floor + 8, speech - 35) dB: breaths and soft word ends are sound there,
  unlike between words, a fading tail is not) becomes exactly `keep` at any length: cut, or digital zeros added.
  Levels are read on a 150 Hz high-passed copy (`DETECT_HZ`; rumble the master EQ and the ear
  drop); the edits apply to the sound itself. No quiet 0.5 s to measure (quietest null): `speechDb` alone (talk:
  speech - 20, edge: speech - 35; -60 dBFS when even that is unknown), so gaps is never skipped; but
  only at a real edge: a target edge a clip goes on across (a range starting or ending inside a recording) is left
  as it is; no sound at all: left alone. Edits are [a, b, add] (a..b goes, `add` zero frames in its place) and the
  result goes back as ONE clip with replaceRegion (ripple: later audio on that track moves in or out; one
  recording stays one clip).
  Gain is linear and the floor is relative, so cutting after loudness equals the spec order (gaps before
  loudness). `step(done, total, text)` is awaited before each step of each target (progress; a throw stops before
  anything is returned). Returns new clips, cuts `[{ trackId, a, b, add }]` (project frames before the edit, right
  to left; add = silence put in), skipped, and each target's span after its track's edits (newA/newB: moved by what
  the track's targets to its left grew or shrank); the caller applies markers (`rippleMarkers(a, b, add)` per cut
  with that one track: they follow only in a one-track project; a pad at the start moves a marker there) and selection.

## Sound graph (engine.js + chain.js) — same graph live and in export
```
clip BufferSource -> clip envelope Gain -> track chain (hum -> eq -> comp -> deess -> reverb -> echo)
  -> fader Gain (gain × mute/solo) -> StereoPanner -> [track meter] -> master chain
master chain: eq -> comp -> reverb -> echo -> gain (gainDb) -> limiter -> [master meter] -> destination
```
- Chains (`chain.js makeChain`) create nodes only for effects that are on, and rewire when the on-set
  changes; parameter changes are set live (`updateMix`) without restarting playback.
- EQ: BiquadFilterNodes (highpass/lowpass Q in dB: −3.0103 = Q 0.7071, matching effects.js).
- Compressor: `sori-comp` worklet. Limiter: `sori-limiter` lookahead brickwall worklet (5 ms lookahead,
  min-hold + moving average gain on the true peak, taps from `processorOptions`; output delayed L−1+TP_HALF
  frames, `chain.latency`; release 50 ms).
- Reverb: `sori-reverb` worklet, the wet part of `FX.reverb` computed directly (same combs/allpasses on (L+R)/2,
  unit test: equal within 1e-5); dry through a StereoPannerNode. Measured 2026-11-11: about 1/6 of the work of
  convolving with its impulse response (60 s: 0.31 s vs 1.9 s), and the tail rings out as the algorithm does instead
  of being cut where the impulse fell below 1e-4. A size change resizes the delay lines keeping their newest sound.
  OfflineAudioContexts with a worklet all render on one shared thread (4 at once = 4x one), so export does not
  split tracks into contexts.
- Echo: DelayNode with a feedback Gain loop.
- Hum: a run of notch BiquadFilterNodes (Q 30), rebuilt when the frequency list changes. De-esser: `sori-deess`.
- Meters (`sori-meter`, live only): pass-through, post [peakL, peakR] every 8 quanta (~21 ms);
  a peak ≥ 1.0 latches the clip indicator until clicked. Input meter uses the same node.
- Metronome + count-in: short oscillator clicks straight to `destination` (never exported). A 25 ms
  timer schedules clicks 150 ms ahead on the project beat grid. The count-in is scheduled whole at the start, so the
  clicks not over yet are kept (`p.clicks`) and `MET.silence` stops them: on `stop()` and at once on
  `stopRecording()` (before its flush), which also ends the pump (`p.metro = null`). Count-in delays `t0` by
  `countIn bars × beats × 60 / bpm`.
- AudioBuffers (`buffers.js`) are cached per Source in a Map pruned to the current project's Sources on every
  play/mixdown and in the 5 s sweep, so history never keeps a second copy of old takes alive. The sweep
  (`buffers.sweep`) lets go of a take's samples and of its buffer together: they share the arrays, and a buffer kept
  after its samples went would sit beside the newly decoded ones when the take comes back (another line, an undo).
  One copy of the samples, not two: a decoded file's arrays and a saved take's unpacked samples (`parked.setAlloc`:
  unpacked straight into a new AudioBuffer) already are an AudioBuffer's own (`owner`, used as is); any other source
  is copied once into a buffer and then uses its arrays (`parked.adopt`). Sources never write their samples, so
  sharing is safe.
  Playhead = `from + (ctx.currentTime - t0) * sr`.
- Mixdown (export): OfflineAudioContext (stereo, project rate), same `buildGraph` without meters.
  Length = range + longest reverb/echo tail; the limiter delay is removed from the start; trailing
  output below 1e-4 is cut back to the range end.
- Output device: `ctx.setSinkId(settings.outputId)`; a missing device falls back to the default.

Audit 2026-11-08: mono is -3 dB per side everywhere — the track panner, the reverb unit's dry
path (StereoPannerNode, pan 0), the destructive reverb's dry copy, renderRegion when mono meets stereo, playPreview.
Playback runs on through the reverb/echo tail (`engine.tailLen`, built on chain `tail()`), the playhead stops at the
clip end. Echo tail = until -60 dB, at most 60 s (`FX.echoTail`, shared); the destructive echo fades its last 0.5 s.
A live parameter's first value is set exactly, later changes glide. Loop: the engine plays passes (core/passes.js) and
queues the next one 0.5 s before it is due on its 25 ms timer, into the same chains, so the seam has no gap and the
loop runs on while the window is minimized (no redraw needed); a source and its envelope leave the graph when it ends.
At most 20 passes are queued a call and a pass already late is skipped (`passes.due`): a loop under about 1 ms plays
rough instead of flooding the graph. play.js restarts playback only when 반복 or the range changes, and not while a
range is being dragged (once, on release). Files with more than 2 channels mix to stereo on import (core/downmix.js:
3-8 channels by WAV order, other counts evenly). mixdown returns subarray views: consumers respect
byteOffset. Export: the mix file goes through safewrite; folder exports run names through uniquePaths; a render with a
sample over 1.0 adds the 0 dB warning to the success toast. Noise profile: only frames fully inside the piece.

## Recording (engine.js)
`getUserMedia` (chosen device, mono/stereo; echoCancellation/noiseSuppression/autoGainControl off; a
missing device falls back to the default and the user gets a toast) -> `sori-rec` worklet sends 4096-frame
chunks with the exact `currentFrame` of its first sample (live ghost waveform + peaks). Stop flushes the
rest and returns `{ ch, lead }`. The first `lead + latencyMs` seconds are cut so overdubs line up (cut while the
chunks are joined, `buffers.join`, each chunk let go once copied: one copy of the take at stop, not two):
`lead` = capture start → audible playback start (count-in, start gap, `outputLatency`), `latencyMs` =
설정 > 녹음 지연 보정 (input latency, which Web Audio cannot see). 자동 측정 plays 4 clicks, finds them in
the mic signal and takes the median offset minus `outputLatency` (needs speakers, fails → null).
The mic is opened before the track is created. New/Open project stops a running recording.
Buttons keep working while recording and the take being recorded is never part of the undo history:
`history.hide` = its id, `snapshot` leaves it out (and a ★ on it), so undo/redo while recording restore older steps and
`undoRedo` puts the take back (a step that would remove its line, or switch the project kind, is cancelled with the inverse). On stop the take becomes
one undo step (`history.commit(lineId)`: viewed at the line it was recorded into, which may not be on screen), then the
clip goes in. `recSpot` finds the take on screen or in its line's takes (an undo step landed on another line and the
stop finishes after it; `goLine` stops the recording before it moves). Its ✕ stops the recording first, then deletes it as a normal step.
The live ghost skips the same `lead + latencyMs` frames (`engine.recLead`, `commands.recTrim`), so it sits where
the take will land. Only one recorder runs at a time: `startRecording` refuses while one is open (자동 측정 too).

Audit 2026-11-08: play() stores `t0` and the master latency `lat` (limiter lookahead) on the recording, so the
cut = count-in + start gap + output latency + lat even when playback stopped mid-take. 미리듣기 is refused while
recording (`noPreview`, effects.js). The take being recorded shows the 'input' meter and clip light on its mixer
strip. History: `history.hide` leaves the recording take out of snapshots only while it has no clips; after a restore
an empty copy is added back (recording goes on); a refused undo returns to the line on screen; `drop()` restores the
redo stack. A timeline or marker drag ends when the state changes under it (drag.last check). The clipboard carries
`sr`; paste converts to the project rate (OfflineAudioContext). Paste and 복제 in a script project make takes
(newTake, ★ when the line has none).

## Autosave + recovery (commands/files.js, main.js)
Every `autosaveMin` minutes, if the project is dirty and not recording: `userData/autosave.vproj` (the
project without its sound, `fileio.saveThin`) + `autosave.json` (`{ filePath, time }`), both written atomically
(temp file + rename). The sound goes to `userData/autosave/pool/<sha1>.snd` (`backup.writeAutosave`, the same pool
code as the backups but its own folder, so a backup tidy never removes what a recovery needs): a sound already there
is not written again, sound the project no longer has goes after the new file is written, so a crash at any point
leaves a file with all its sound. A 188 MB project: 0.65 MB and about 10 ms a time instead of 188 MB and 0.27 s
(and no 188 MB buffer in memory). Recovery reads the pool (`backup.poolReader`); an older whole autosave still
opens. A normal close (saved, or 저장하지 않고 닫기), New and Open remove the file and meta; the pool stays while the
app runs (the next autosave writes only new takes) and a normal close empties it (main.js `dropAutosave`). At
startup, if they exist, the user picks 복구 / 지우기; a recovered project stays dirty and keeps its original file
path for Ctrl+S.
`requestSingleInstanceLock` keeps a second window from overwriting the autosave.
Audit 2026-11-08: one autosave at a time; after it writes, if the project is no longer dirty the files are removed
again. While the recovery question or load runs the page sends `recovery` true (IPC) and main keeps the autosave on
close; a second-instance path waits in `startFile` until the page asks 'start-file'. A recovery file that will not
load is renamed to `userData/autosave-broken-<ms>.vproj` (its pool to `autosave-broken-<ms>/`). Save:
`state.edits` (counted by `setDirty(true)` and the mixer's live changes, not by redraws or selection) around the
write; clean only if no edit came meanwhile and not recording; Ctrl+S while recording saves without the take being
recorded (`history.hide`) and stays dirty. Autosave/backup failures: `writeFailed`/`writeOk` (files.js) toast once per
streak with the cause (ENOSPC, EBUSY/EPERM/EACCES, other). app.js frame() re-arms in finally. Smoke deletes its
temp userData on exit.

## 자동 백업 (core/backup.js, commands/backup.js)
Separate from the crash autosave and never removed on close. `setDirty(true)` sets `state.backupDue`; a new or opened
project clears it (resetProject). Every 10 min (app.js timer, not in the smoke run) `backupNow`: skipped when not due,
recording or busy; else due is cleared first (a change during the write makes the next one due), the project
(`IO.saveThin`, unsaved changes included: the JSON with `pool: true`, each source naming its packed blob by sha1) goes
to `userData/backups/<sha1(key)[:16]>/YYYY-MM-DD HH-MM-SS.vproj` and the blobs not there yet to
`userData/backups/pool/<sha1>.snd` (all temp + rename; about.json, then pool, then the backup), and only the newest 10
stay. Each run first tidies (`BK.tidy`, also once at startup): a group whose newest backup is over 30 days old goes
(not the open project's), then pool files no backup names. One run at a time (`running`), so tidy never meets a write. key = 'file:' + the resolved,
lower-cased file path, or one key per unsaved project object (WeakMap). A failure toasts and stays due.
백업에서 열기 lists every group (the open file's first; size = the backup + its pool sound): confirmDiscard,
loadProjectFile with `pool: BK.poolReader` (the sha1 is checked), then filePath = null,
`state.saveHint` = the backup's file (저장 창's defaultPath), dirty, not due; the autosave is cleared.
tidy sweeps the pool only when every backup was read (`sure`: any error with e.code skips the sweep that run; a damaged
backup names nothing; ENOTDIR = a stray file, ignored). Prune never removes the backup just written (clock moved back)
and a failed prune does not fail the backup. A pool file of the wrong size is rewritten. A bad about.json lists as {}.

## Spectrogram (spectro.js)
Per Source (WeakMap): N = 1024 Hann, hop 512, 96 log-spaced rows 40 Hz–Nyquist, dB mapped to a color LUT.
Columns are computed in slices (`work(ms)`, ~8 ms per frame) so long files never block the UI;
timeline draws what is ready and redraws as columns arrive. Only while the view is on; the 5 s sweep in app.js drops
unfinished ones of sources no longer in the project (`prune`), so they never keep old sound alive.

## Redraw (app.js, timeline/paint.js)
Measured 2026-11-11 on a 144 Hz screen (8 stereo tracks × 3 min, 4 with comp + reverb; a script project of 400 lines
and 800 takes): repainting everything every frame cost about 1.9 cores while playing (1.1 of them GPU), 0.8 with the
mixer open while stopped, 0.65 while recording a take and 0.8 during 이어 녹음. Now about 0.2-0.4 while playing and
0.2 while recording; what is left is the audio thread. So:
- Frames run only while needed. A `changed()` call draws on the next frame. While playing, recording or counting
  in, or while mixer meters still fall (`mixer.render()` returns that), the loop runs about 30 times a second
  (`LIVE_MS`, a timer then a frame); a shown spectrogram being computed takes every frame. An idle window asks for
  no frames. The frame where playing ends by itself (tick) redraws once (`wasLive`). A command that changes what is
  on screen calls `changed()` (N / Shift+N do): the live loop no longer repaints everything anyway.
- The playhead is an element over the canvas (`#playhead`). While it moves the compositor moves it: a 1 s linear
  animation in whole-pixel steps (a slow, zoomed-out playhead changes the screen only when it moves a pixel), started
  again when it ends or the real position is over 1 px off (seek, loop pass, page flip). Playing costs the page no
  style, layout or paint per frame.
- The canvas is drawn only on a change or a new view (scroll, zoom, size). New recorded sound (it comes without
  `changed()`) redraws only the recording lane from where its sound ended last time (`recBand`, a clip rect; every
  layer is drawn there, so it looks the same as a full redraw).
- Track headers, the effect panel and the find box render only on a change; the 이어 녹음 time / level and the chrome
  (time, buttons) on live frames, but `D.setText` / `D.setAttr` write the DOM only when the value differs. `#time` is
  a fixed box with `contain: strict` (its digits never lay out the page); the 이어 녹음 level bar moves by `transform`.
- Mixer meters draw only when they look different (`x.look`); theme colors are read once per theme.

## File formats
`.vproj` (little endian):
```
"VPRJ" (4 bytes) | u32 version (4) | u32 jsonByteLength | JSON (utf8) | padding to 4 | packed source blobs
```
JSON: `{ sampleRate, bpm, beats, grid, master, markers:[{frame,name}],
tracks:[{name,color,gain,pan,mute,solo,fx,view,clips:[{name,start,offset,length,src,gain,fadeIn,fadeOut,fadeInShape?,fadeOutShape?}]}],
sources:[{id, channels, length, byteOffset, size}] }` where `byteOffset` is relative to the start of
the blobs and `size` is the blob's bytes. Unused Sources are not written. A blob (`audiopack.js`): a kind byte, 0 = raw
float32 channels one after another, 16 / 24 = integers (16 when every sample is exactly a 16-bit value, else rounded to
24 bits; |x| > 1 or NaN stays raw) coded per 4096-frame block and channel: 3-bit order 0-4 (fixed predictor = the o-th
difference), warm-up samples in bits + 2 (offset binary), then per 512 frames a 5-bit Rice parameter and zigzag
residuals (24 ones = escape, 32-bit value). `pack` decodes its output and keeps raw when it differs or is not smaller.
Sources never change, so `fileio` packs each once (WeakMap) and reuses the blob for every save, autosave and backup;
a loaded source keeps its blob. Packing is a generator (`AP.packSteps`, a yield every 16 blocks, ~2 ms) working a
block at a time (no full-size int copies; the check decodes block by block): app.js runs `IO.prepack` from
requestIdleCallback after every change (not while recording), so new or old-format sound is packed before a save
needs it, then each blob's sha1 is computed, 4 MB a step (a backup never hashes the whole project at once); a save meets at most
the rest of one source (`AP.finish`). Measured on a voice-like signal: 16-bit 23 %,
24-bit 48 % of float32; pack + check ~30 M samples/s, unpack ~90 M/s (warm). A fully recorded script (334 lines x 3
takes x 4 s, 16-bit) packs to 167 MB from 734 MB. Versions 1-3 (float32 data, channel after channel) still load.
A backup file (`pool: true`) has no blobs: each source has `hash` (sha1 of its blob, /^[0-9a-f]{40}$/ checked before
any read) and `size`; `loadProject(bytes, { pool })` reads them and checks the hash.
Version 1 files (no master/markers/tempo/fx/fades) load with defaults; a newer version gets a "update
Sori" message. Load validates everything (trust boundary: files from disk): magic, lengths, integer
frames, effect values clamped to their ranges (`clampChain`, `clampMaster`), fades clamped, markers
at non-negative integer frames, names cut to 100 characters.
Version 3 = script project: `tracks: []` and `script: { line /* index of the current line */, chars: { name: { color, fx } },
lines: [{ char, num, text, memo, state, star /* index into takes, -1 none */, takes: [track as above] }] }`; sources of
every take are written. An older Sori refuses v3 / v4 ("더 새 버전") instead of opening it empty. Load clamps text (2000) / memo (500) / name (40), keeps only the 'redo'
state, refills a missing or repeated number (`number`), and returns `tracks` = the current line's takes.
The CLI refuses script projects (`SCRIPT_PROJECT`) until `sori script` exists: its loader re-ids tracks and would
drop ★.

Script files (`core/script.js`, spec §5-5): bytes decode as UTF-8, else CP949 (Notepad ANSI / Korean Excel CSV).
`.txt`: `이름: 대사` or `이름-005: 대사` (`:` or `：`, name ≤ 20 characters; `10:30` is not a name), a line without a
name continues the one above, blank and `#` lines skipped, text before the first name dropped, `(지문)` → memo.
`.csv`/`.tsv` (RFC 4180 quotes; tab when the first line has tabs and no commas) and `.xlsx` (first sheet,
`read-excel-file`): a header row naming 캐릭터/이름/… and 대사/내용/… picks the columns (번호, 메모 optional, any
order); without one, column 1 = character, 2 = text. Empty-name rows continue the row above.
Numbers: written ones are kept; the rest count on from the character's previous line and skip every number written
for that character; a repeated written number gets a new one (counted, shown in the toast).
Re-import (`merge`, 대본 넣기 in a script project): the new script is the base. Match by `캐릭터-번호`; new text on a
line with takes → 'redo'; memo-only changes just update; lines missing from it go with their takes (`goneTakes`).
Project kind = whether `project.script` exists. 대본 넣기 in a plain project sets it (tracks deleted) and
보통 프로젝트로 바꾸기 (`unscript`) clears it, every take with sound becoming a track (script order, then take order;
`takeView` color/fx, fresh ids). Both are one undo step: `restore` adds or drops `project.script`, and a script
snapshot carries `chars` (live while the script exists, used only when it comes back). Fresh ids matter: `restore`
keeps live props by id, so a track sharing a take's id would hand the take its new name.

WAV export: PCM 16/24-bit, stereo, project rate, clamped. 16-bit (and the MP3 encoder's Int16 input) goes through
`encoders.to16`: TPDF dither (two uniform randoms one step wide; xorshift32 seeded per file, so the same sound gives
the same bytes), exact zeros stay 0. Measured: a -95 dBFS sine came out as mostly harmonics with rounding (-97.7) and
as silence with the old MP3 truncation; dithered: kept at -95.0, harmonics < -120, floor -96 dBFS rms. 24-bit rounds
(steps 256x finer). MP3: lamejs, 1152-sample frames. lamejs writes
no Info frame, so `encoders.js` puts one first (Xing "Info" + LAME tag, as LAME does): encoder delay 576 and the end
padding, so decoders (FFmpeg/Chromium, foobar, iTunes) play exactly the input samples. Without it a file started
1105 samples (23 ms at 48 kHz) late and ran 1536 samples long (measured with Chromium's decoder; now 0). Above
48 kHz (a project made outside Sori; MP3 has no higher rate) lamejs writes the stream at 48 kHz, and the tag counts
the samples at the stream's rate (counted at the input rate, a 96 kHz file's padding came out wrong).
Export by markers: one file per segment (start→1st marker, between markers, last marker→end; markers past
the end ignored, segments under 10 ms skipped), named `NN 마커이름.ext` in a chosen folder, overwrite asked once.
Export 트랙 = 지금 트랙만: `renderFile` gets `[{ ...track, mute: false, solo: false }]` instead of all tracks, so the
same graph renders that track's chain + fader + pan + the master chain (what solo plays); 전체 = 0 → that track's end.

Audit 2026-11-08: every v4 source carries `hash` (sha1 of its blob) in normal files too; blobs are stored one after
another (byteOffset = running total, else '소리 데이터가 손상됐어요'). A damaged source (hash mismatch, failed or partial
unpack — audiopack.unpack rejects a stream not fully read —, missing or bad pool file) opens as silence of its stated
size, is never cached, and is listed in the load result `damaged: string[]` (track name, or line name + take name);
the app toasts it. Old files without hash open as before. Bad JSON shapes give the Korean damaged-file error. A pack
that throws never caches a blob (save packs it again; idle packing skips it via `failed`). WAV/MP3 encoders moved to
core/encoders.js (fileio re-exports them). `script.chars` is a null-prototype object: read it with Object.hasOwn.
Script re-import: numbered lines match by name, unnumbered ones first by character + text, then by order (`autoNum`
WeakSet in script.js marks lines number() numbered). .txt: a colon right after 1-2 digits at the line start or after a
space is a time.
## AI command line (src/cli, docs/cli.md, spec §5-4)
Two halves, both printing one JSON line per call:

**File commands** (`verbs.js`). Each call loads the `.vproj` (`fileio.loadProject`, as the app opens it: takes are
decoded only when a command touches their sound; a 255 MB project: 2.5 s -> about 0.5 s per command; fresh ids),
applies one edit on the plain project object with the `edit.js` primitives, and saves with write-then-rename (two or
more new sources are packed on workers.js first, `project.packAhead` + `fileio.keep`: the same bytes; 210 cleaned
takes saved in 8 s -> about 2 s). They
follow the same rules as `ui/commands/`: new tracks right below `--track N` (end without it), typed track recipes,
`importAudio` placement, `runFx` targets (range on the tracks, else each whole track), right-to-left results, tempo ripple
+ the marker-follow test, reverb/echo overlay, markers follow ripple edits only when every track is covered, clip volume
-24..12 dB, tempo clamps, export by markers. Three things are copies because `ui/commands/` needs the DOM:
`TRACK_TYPES`, `APPLY` (FXDEFS fields) and `markerSegments`; smoke compares the first two with the app's.
- Script projects (`sori script ...`, verbs with `script: true`): `load` keeps the loaded script (take ids fresh from
  `loadProject`); a track verb on a script project fails `SCRIPT_PROJECT`, a script verb on a normal one `NOT_SCRIPT`
  (`script import` loads either kind: `load(file, 'any')`, or creates the file).
  Verbs edit whole lines from `linesNow` and `putLines` sets `project.tracks` to the current line's takes for saving.
  Track verbs on takes (`takes: true`, `scope.js`): `--line` puts that line's takes (with the character's color and
  effects) in `project.tracks`, `--take` refs become `--track` positions, the verb runs unchanged, and the takes go back
  into the line (new lanes become `테이크 n`, a changed effect becomes the character's); replies and error messages are
  renamed from track numbers to take names. Verbs takes do not have carry `use` (the script verb named in the
  `SCRIPT_PROJECT` message).
  The rules are the app's own functions in `core/script.js` (`nextTakeName`, `takeRef`, `withStar`, `editLine`,
  `addChars`, `exportPick`, `merge`, `unscript`) and `core/scriptfile.js` (reading the script file), so nothing is copied.
  Verb names may be three words (`script take add`): `parse` tries the longest name first. `--dry-run` sets `c.noSave`.
- Why two runtimes: everything except decoding and rendering is pure and runs in plain Node (~0.1 s). Decoding (any
  format, resampled to the project rate by `decodeAudioData`) and the mixdown (`engine.mixdown`, the same graph as
  playback) need Web Audio, which Node lacks. For `import`/`export`, `sori.js` writes `job.json` into a temp folder and
  runs `electron <repo> --cli=<folder>`; `main.js` opens a hidden window (`headless.html`) that calls the same
  `verbs.execute` with an `audio` object built on `engine.js`, writes `result.json` and exits. ~0.9 s per call (measured).
  The job window uses `<folder>/data` as userData (deleted after) and skips the single-instance lock, so it never
  touches the user's settings, recent files or autosave, and the open app is not focused or notified.
- Batch (`batch.js`, a verb like the others so file, hidden-window and live paths are the same): every line is
  parsed with `verbs.parse(argv, live)` first, then each runs through `verbs.execute(argv, { on: project })` on the one
  project object the batch loaded (file) or the app's copy (live), so later lines see earlier edits and nothing is
  saved until the end (a throw = no save; live: `takeProject` once = one undo step). `makeTrack(props, p)` numbers new
  tracks against that object, not `state.project` (the live copy is not it). Waves come from a fixed table of what a
  verb touches (unknown = `all`), only reported for now: running a wave in parallel needs worker threads.
- Open in the app: before any write, `sori.js` asks the running app (live pipe, `state`, 3 s) for its `filePath`.
  The same file, dirty or not -> the command goes to the app as `live <command>` without the project token
  (`args.parse` reports each positional's index), reply + `inApp: true, saved: false` (the app does not watch
  files: editing the file would race its next save). No answer -> `APP_NOT_RESPONDING`. No app -> go ahead.
- Track names: flag types `trk` / `trks` (a number, or a name kept as text) for `--track` / `--to-track` of every
  verb (verbs.js) and `live select`; `args.trackNo` turns a name into its number once the project is loaded
  (`execute`, batch planning against the project before the batch, the app's select). Times: `sec` also reads
  `m:ss` / `h:mm:ss`. Mistyped commands, options and fields: `args.near` (edit distance, about a third of the
  letters). `sori help COMMAND`: usage + about + the `sori COMMAND` lines of docs/cli.md (shipped for this).

**Live commands** (`pipe.js`, `main.js`, `src/ui/live/`). The app serves a named pipe with a new random name
`sori-live-<32 hex>` each run and writes that name to `<app data>/Sori/live-pipe` once it listens; the CLI reads it
there (none: `NO_APP`). Other accounts cannot read that folder, so they can neither find the pipe nor take its name
first (a name made from the user name could be taken by another account, which the CLI would then talk to).
`SORI_PIPE` overrides and writes nothing (smoke uses `sori-smoke-<pid>`). The CLI writes one JSON request line
(≤ 64 KB, op `state` | `commands` | `select` | `run` | `script` | `verb` | `settings`, anything else -> `BAD_REQUEST`) and reads one reply line. No
network port; the pipe has the default DACL (owner, administrators, SYSTEM). `main.js` forwards each request to the
window (IPC `live` with an id; reply on `live-reply`); `live.js` answers one request at a time.
- `run`: only own names of `cmds`, refused when `enabled()` is false. Arguments are accepted only for commands whose label
  ends with `…` (they open a dialog). The command calls `D.modal` synchronously inside `C.run`; that one call is answered
  with the checked values (`args.fill`: unknown key refused, numbers clamped to the field range, options must match, text
  100 characters) and `D.modal` is restored right after, so later dialogs are the user's. Toasts during the run are copied
  into the reply. `edited` = another project, or the top of the undo stack changed (`history.top`). The edit is the command's own
  `history.commit()` step, so Ctrl+Z undoes it. No eval anywhere. `--path` (absolute paths, resolved by the CLI) answers
  `open-dialog` / `save-dialog` by swapping `ipcRenderer.invoke` for the run, and `--yes` answers every `D.ask` with its
  `yes` value (the go-on answer); with `--yes`
  `D.modal` stays answered (defaults) until the command ends. Saving onto an existing file without `--yes` asks the user.
- `verb`: a file command (`verbs.parse(argv, live)`: no `<project>`) runs through `verbs.execute(argv, { on: copy })` on a
  shallow copy of the project (script object copied too; verbs replace arrays and objects, never mutate them), with
  `audioFor(engine)` from the app. Then `commands.takeProject(copy)`: an undo step only when what `restore` brings back
  changed (tracks: ids, order, clips, color; markers; lines: text, memo, state, ★, takes' ids, order, clips), committed
  at the one other line it changed, so undo shows it; names, volume, pan, view and effects stay live as in the app; the line is
  re-viewed (`viewTakes`, keeps the selection; a project that became a script / plain one gets the menu
  command's screen: `enterScript` / `leaveScript`, shared with 대본 넣기 / 보통 프로젝트로 바꾸기; the current line gone from a
  new script: `showLine` of the first) and `tidySel` drops stale ids. Refused while recording; when the
  project changed during an awaited decode (compared field by field), nothing is applied (`CHANGED`).
- `settings`: every key of `S.DEFAULTS` but `keys` / `recent` (`VALUES`), parsed by the type of its default, device ids
  checked against `engine.listDevices`, choices checked against `S.ONE_OF` (refused), ranges clamped by `S.validate`;
  then `S.set`, whose listener in app.js applies them like the window does (panels too). The window's buttons share its
  code: `settings/audio.autoLatency` (`--latencyMs auto`), `shortcuts.rebind` (`--key`, the window's key capture uses it
  too) with `shortcuts.parseKey` for typed keys and `settings/keys.commandList` for the commands, `S.removeRecent`;
  `--mic-test` runs an input test: peakDb from `engine.heldPeak` (every meter report since `resetClip`; 50 ms
  samples missed short sounds), avgDb from `engine.level('input')` sampled every 50 ms.
- `select`: range (`a`, `b`, track ids), clip ids, active track, marker, playhead (`C.seek`); all inputs checked before
  any is applied.
- `state`: `summary.describe(project)` (+ `script` = `describeScript` in a script project) + selection + `{ filePath, dirty, playing, recording, canUndo, canRedo }`.
- `script`: `line` -> `C.goLine` by name; `star` -> `C.setStar` on a take of the current line by `takeRef`.

IPC added: `live` (main -> renderer), `live-reply` (renderer -> main), `cli-done` (hidden job window -> main).

Audit 2026-11-08: sec values at most 24 h (`MAX_SEC`, args.js + live readSelect). project.js stamps mtime + size on
load and save refuses with CHANGED when they differ; writes go through safewrite. Multi-file exports: `writeAll`
(.part files, renamed at the end, removed on failure) + uniquePaths. Pipe requests carry `deadline`; the renderer
answers TIMEOUT for an expired one. live answers BUSY while a dialog is open; CHANGED also counts D.isBusy(). Take
lookup (`takeByRef`): exact take name first, then SC.takeRef. live.js depends on cli/project.
