# sori: command line for AIs

Lets Claude and other AIs (and people) work on Sori projects from a terminal. Two parts:
1. **File commands** edit and export a `.vproj` without the app (`sori info`, `sori track add`, `sori import`, ...).
2. **Live commands** drive the running app (`sori live ...`): the user watches each edit happen and can undo it with Ctrl+Z.

Run from the Sori folder: `node src/cli/sori.js <command> ...` (after `npm link` once: `sori <command> ...`).
`sori --help` lists every command with its flags; `sori help COMMAND` (or `sori COMMAND --help`) shows one, with
its examples from this guide (`sori help clip`: every clip command). A mistyped command or option is answered
with the closest one (`unknown command "expor"; did you mean "export"?`). The Korean feature summary is spec.md §5-4; design: architecture.md "AI command line".

## Output
Every command prints exactly one JSON line on stdout and exits 0 (ok) or 1 (error):
```
{"ok":true, ...result}
{"ok":false,"error":"NO_TRACK","message":"track 5 does not exist; the project has 2 track(s)"}
```
Usage errors also carry `"usage"`. CLI messages are English; messages that come from the app itself (a project that
fails to load, toasts in live mode) stay Korean. In Windows PowerShell 5.1, piping one program into another adds a BOM:
read the output directly or use `ConvertFrom-Json`.

| error | meaning |
|---|---|
| `BAD_ARG` | a flag, value or argument count is wrong (see `usage` / `message`) |
| `UNKNOWN_COMMAND` | no such command |
| `NO_FILE`, `READ_FAILED`, `BAD_PROJECT`, `WRITE_FAILED` | project/audio file missing, unreadable, not a Sori project, cannot be saved |
| `EXISTS` | `new` on an existing file, a marker already at that time, or an export onto existing files without `--overwrite` |
| `NO_TRACK`, `NO_CLIP`, `NO_MARKER` | that number (or track name) does not exist (the message says how many there are, or the names) |
| `NOTHING_TO_DO`, `NOTHING_TO_EXPORT` | no clip/sound where the command would act |
| `DECODE_FAILED` | an audio file could not be decoded (nothing was changed) |
| `SCRIPT_PROJECT` | a command takes do not have, on a script project (대본 녹음 모드, .vproj v3): `track add/remove/move/set`, `info`, `export`; the message names the `sori script ...` command to use |
| `NOT_SCRIPT` | a `sori script` command, or `--line` / `--take`, on a normal project (or `live script` with no script project open) |
| `BAD_SCRIPT` | the script file has no lines (a .txt needs `name: text` per line, a table 캐릭터 \| 대사 columns) |
| `NO_LINE`, `NO_TAKE`, `NO_CHAR` | no line with that name (`철수-001`), no such take on the line, no such character (the message lists what exists) |
| `APP_NOT_RESPONDING` | the app runs but did not answer in 3 s (a dialog open?): try again |
| `NO_ELECTRON`, `HEADLESS_FAILED` | import/export could not start or finish the hidden Sori window |
| `NO_APP`, `TIMEOUT`, `NO_WINDOW` | live: the app is not running / did not answer in time (a request still waiting in the app past that deadline is dropped, also `TIMEOUT`) / has no window |
| `BUSY` | live: the app runs a long job (progress on screen) or has a dialog open: try again when it ends |
| `BAD_REQUEST` | live: the app got a request it does not know (an unknown op or unreadable JSON) |
| `PIPE_ERROR` | live: the local channel to the app broke or the reply was unreadable |
| `DISABLED` | live: the command cannot run now (nothing selected, nothing to play, or not in this kind of project) |
| `USE_APP_COMMAND` | live: `new` makes a file; in the app it is `live run newProject` |
| `RECORDING` | live: a file command that edits, while the app records: stop the recording first |
| `CHANGED` | live: the user edited the project (or a long job started) while the command read audio; a file command: the .vproj changed on disk (time or size) since it was read. Nothing was applied or saved: run it again |
| `NOT_HEARD`, `NO_MIC` | live settings: `--latencyMs auto` did not hear its clicks / `--mic-test` could not open the mic (other options given were applied: `applied`) |
| `FAILED` | anything else (message says what); `live run`: the command showed an error (its toasts are in `toasts`) |

## Conventions
- Seconds (`--at`, `--from`, `--sec`, ...) go from 0 to 86400 (24 h); a bigger value is `BAD_ARG`. Numbers may have
  spaces around them.
- Saving a project and exporting files never leave a half-written file: a project is written to a temp file and
  renamed; an export of several files writes `<name>.part` files and renames them all at the end. Two exported files
  with the same name get ` (2)`, ` (3)` before the extension.
- `--take N` / `--take 테이크 N`: a take named exactly like the value comes first, otherwise `N` means `테이크 N`.
- Tracks, clips and markers are numbered **from 1** in the order `sori info` shows: tracks top to bottom, clips by start
  time, markers by time. Numbers can change after an edit, so read `info` again instead of guessing.
- `--track` / `--to-track` also take a track's name (`--track 보컬1`, lists `--track 보컬1,3`): exact, as `info`
  shows it. Two tracks with that name -> `BAD_ARG` (give the number); none -> `NO_TRACK` with the closest name. A
  name made only of digits reads as a number. In a script project the lanes are takes: `--take N|NAME`.
- Times are **seconds** (decimals fine) or as the app shows them, `m:ss` / `h:mm:ss` (`1:23.5`, `1:02:03`), rounded
  to the nearest sample. Volumes are **dB**. Pan is -1 (left) to 1 (right).
- Flags: `--name value` or `--name=value`. Lists are comma separated (`--track 1,3`). Values may be negative (`--volume -6`).
- Effect fields use the names `info` prints (`--lowcut 80 --midFreq 3000`). Unknown fields are refused with the valid list.
- Effect presets are the app's built-in ones (`--preset "목소리 또렷하게"`); a wrong name returns the list.

## File commands
Each one loads the project, makes one change with the app's rules, and saves it in place (temp file + rename).
**There is no undo for file edits**: copy the file first if you may want to go back. `info` and `export` only read,
and they read the saved file: unsaved changes in the open app are not in it (`live state` shows those).

| command | does |
|---|---|
| `info <p>` | everything as JSON: rate, length, tempo, master, markers, tracks (volume, pan, mute, solo, effects + matching preset, clips) |
| `new <p> [--rate 44100\|48000]` | empty project (default 48000) |
| `track add <p> [--type empty\|voice\|music\|sfx\|duplicate] [--track N] [--name T]` | new track right below track N (at the end without `--track`). voice = EQ 목소리 또렷하게 + comp 목소리 고르게; music = -12 dB + EQ 2.5 kHz -3 dB; sfx = -6 dB; duplicate copies track N (sound, effects, volume, pan) |
| `track remove <p> --track N` | delete a track |
| `track move <p> --track N --to M` | reorder |
| `track sort <p>` | sort by name like 트랙 > 이름순 정렬 (가나다 then A-Z, numbers by size); refused in a script project |
| `track set <p> --track N [--name T] [--volume DB] [--pan X] [--mute on\|off] [--solo on\|off] [--color RRGGBB]` | mixer values; volume -60 dB = silent, max +6 dB. `--color`: any hex color, `#` optional (unquoted, a shell reads `#...` as a comment: write `F472B6` or `"#F472B6"`). Only the CLI changes colors; the app shows them |
| `import <p> <audio...> [--track N] [--at SEC]` | WAV/MP3/FLAC/OGG/M4A, resampled to the project rate. Each file = new track at the end starting at 0; with `--track` the first file goes onto track N at `--at` (default 0) |
| `fx <p> (--track N \| --master) <kind> [--preset NAME] [--on\|--off] [--FIELD V ...]` | always-on effects (effect panel). Track kinds: hum eq comp deess reverb echo (chain order); master: eq comp reverb echo limiter, and `gain --gainDb DB` (master volume). A preset or field change turns the effect on unless `--off`. `hum` turned on without `--freq` listens to the track (a character: its takes) for 50 or 60 Hz like the panel; its presets change `--count` only |
| `apply <p> <effect> [--track N,M] [--from S] [--to S] [--preset NAME] [--FIELD V ...]` | effect menu, changes the sound itself (see below) |
| `clip move <p> --track N --clip K [--to S] [--to-track M]` | move a clip in time and/or to another track |
| `clip delete <p> --track N --clip K` | remove one clip, nothing moves |
| `clip split <p> --at S [--track N,M]` | split clips under that time (all tracks without `--track`) |
| `clip set <p> --track N --clip K [--volume DB] [--fade-in S] [--fade-out S] [--fade-in-shape C] [--fade-out-shape C]` | clip volume (-24..12 dB), fades and their curves `linear` \| `smooth` \| `fast` \| `slow` (`info` shows `fadeInShape` / `fadeOutShape`) |
| `clip trim <p> --track N --clip K [--start S] [--end S]` | move clip edges (only within the recorded sound) |
| `clip merge <p> --track N [--clip K,L]` | join clips into one (gaps become silence); all clips without `--clip` |
| `range delete <p> --from S --to S [--track N,M]` | cut out and pull later audio left |
| `range keep <p> --from S --to S [--track N,M]` | remove everything outside the range |
| `range insert <p> --at S --length S [--track N,M]` | insert silence, push later audio right |
| `marker add <p> --at S [--name T]` / `marker remove <p> --marker N` / `marker set <p> --marker N [--name T] [--at S]` | markers |
| `tempo <p> [--bpm 20..300] [--beats 1..12] [--grid time\|beats]` | tempo, beats per bar, beat grid |
| `export <p> <out.wav\|out.mp3\|folder> [--format F] [--from S] [--to S] [--track N [--clip K]] [--markers] [--overwrite]` | render as the app does (see below). `--clip K`: only clip K of track N, from its start to its end (이 클립만 내보내기); not with `--from` / `--to` / `--markers`. Existing files are refused (`EXISTS`, the app asks first) unless `--overwrite` |

`apply` effects (names = the app's menu commands) and their fields; a field left out takes the dialog's default:
`fxGain --db` (-24..24, default 3) · `fxNormalize --db` (-12..0, -1) · `fxFadeIn` · `fxFadeOut` · `fxSilence` · `fxReverse` ·
`fxTempo --percent` (50..200, 110) · `fxPitch --semitones` (-12..12, 2) · `fxEq` / `fxComp` / `fxReverb` / `fxEcho` with the
effect fields or `--preset` · `fxNoise --reduction --sensitivity` (or `--preset 약하게|보통|강하게`) plus
`--profile-from S --profile-to S`, a part with only noise.

목소리 정리 (the menu group, same work as the app: `core/voicedit.js`): `voiceLoud` · `voiceGaps` · `voiceDeess` ·
`voiceHum` · `voiceGate` · `voiceEven` take `--level low|mid|high` (default mid; 약하게 · 보통 · 강하게, for voiceLoud 작게
-23 · 보통 -16 · 크게 -14 LUFS). `voiceClean` (한 번에 깔끔하게) takes `--noise --lowcut --even --gaps --loud off|low|mid|high`
(defaults all mid: the rows the app's window always opens with, `voice.js CLEAN`). The noise floor is measured
from the quietest 0.5 s of each range; a step that cannot measure is skipped and listed in `skipped` (step names:
noise, gate, loud; gaps then goes by the speech level alone), the rest still runs. The reply adds `cuts` (pauses cut, and start/end pads); `changed` lists only ranges whose sound changed, each with its
`newLength`.
`voiceGaps` works on each track's own pauses (breaths count as quiet): one between speech longer than the level's
limit keeps the kept length (1 · 0.5 · 0.3 s); the start and end pauses become exactly that length at any length, cut
or padded with digital silence, measured to the last sound heard (breaths and soft word ends count there; a tail 35 dB
under the speech and rumble under 150 Hz do not), at a real edge only (a range edge inside a recording stays). A marker follows only
when that track is every track (a one-track project).

Rules that match the app (architecture.md "Edit semantics"):
- `range delete`, `range insert` and `fxTempo` move markers only when they cover **every** track; a marker inside a deleted
  range moves to its start.
- `apply` without `--from/--to` works on each whole track; with a range on `--track` (or all tracks). `fxTempo` pulls or
  pushes later audio; `fxReverb`/`fxEcho` tails overlay what follows.
- `export`: all tracks mixed through volume, pan, mute/solo, track and master effects, stereo at the project rate.
  `--track N` = only that track as solo plays it (its mute ignored). Format from the extension (`.wav` = wav16,
  `.mp3` = mp3_192) or `--format wav16|wav24|mp3_128|mp3_192|mp3_320`. `--markers`: `<out>` is a folder, one file per
  segment named `01 마커이름.wav` (first segment `시작`). Existing files are refused (`EXISTS`) unless `--overwrite`. The
  reply lists each file's `frames` (stereo sample frames) and seconds; reverb/echo tails are included. A failed
  export (here and `script export`) writes no file and removes the folders it made.
- import/export start a hidden Sori window (about 1 s); it never touches the user's settings or autosave and works while
  the app is open.

### Example
```
sori new 단편.vproj
sori track add 단편.vproj --type voice
sori import 단편.vproj voice.wav --track 1
sori fx 단편.vproj --track 1 eq --preset "목소리 또렷하게"
sori apply 단편.vproj fxNormalize --db -1
sori marker add 단편.vproj --at 12.5 --name 2장
sori export 단편.vproj out.wav
```

### Script projects (대본 녹음 모드, `sori script`)
A script project holds lines (`캐릭터-번호`, e.g. `철수-001`) and per line its takes; the ★ take is the one exported.
In the app a line's takes are the timeline's lanes, so the file commands that work on tracks work on them too:
- `clip ...`, `range ...`, `apply`, `import` and `fx` take `--line NAME` (the line whose takes are the lanes) and
  `--take` / `--to-take` where they say `--track` / `--to-track` (lists too: `--take 1,3`; no `--take` = every take of
  the line, as no `--track` = every track). The reply has `line` and names takes (`"take": "테이크 2"`, `"takes"`).
  `--line` is required on a script project (`--track` is refused there), and `--line` / `--take` on a normal one
  (`NOT_SCRIPT`).
- `import --line NAME` without `--take`: each file a new take (like `script take add`); with `--take N [--at S]` the
  first file goes onto that take. A line without ★ gives ★ to the first new take.
- `fx --line NAME --take N` sets the character's effect (the app's effect panel shows the character's effects for a
  take); the reply has `char`. `fx --master`, `marker ...` and `tempo` need no `--line`.
- What takes do not have is refused (`SCRIPT_PROJECT`, the message names the command to use): `track add / remove /
  move / set` (→ `script take add / remove / move / set`; takes have no M/S), `info` (→ `script info`), `export`
  (→ `script export`).

```
sori clip split 대본.vproj --line 철수-001 --take 2 --at 1.5
sori range delete 대본.vproj --line 철수-001 --from 0 --to 0.4
sori apply 대본.vproj fxNormalize --line 철수-001 --take 2 --db -1
```

목소리 정리 on several lines at once (`apply voiceX`, script projects only): `--line 철수-001,영희-003` (two or more
names), `--char 철수[,영희]` or `--all-lines` (required for every line: no selector is refused as before). Each line's ★
take, whole (`--take` / `--from` / `--to` are refused here); each take is worked out on another CPU, then put in one
line at a time exactly as `apply voiceX --line L --take ★` puts it (the same sound, byte for byte). Lines without a ★
take with sound are listed in `noStar`, not run. Only the 목소리 정리 effects (`voice…`); other effects stay one line at
a time. The reply: `effect`, `params`, `changed` (lines whose sound changed), `lines` (`line`, `take`, `newLength` when
changed, `cuts`, `skipped` steps), `noStar`. In a batch it touches each named line, each character, or all.
```
sori apply 대본.vproj voiceClean --all-lines
sori apply 대본.vproj voiceGaps --char 철수 --level mid
```

The script commands do the rest of the app's script-mode work with the same rules.
- Lines are named, not numbered: `--line 철수-001` (names as `script info` prints them).
- Takes go by their name number: `--take 3` = `테이크 3` (deleting a take never renames the others, so `3` stays the
  same take); a renamed take by its name (`--take "좋음"`).
- `state`: `null` or `redo` (다시 녹음 필요: the text changed after recording). `done` = has ★ and is not `redo`.
- ★ never moves by itself: a new take gets it only when the line has none; removing the ★ take leaves no ★.

| command | does |
|---|---|
| `script info <p>` | `current` line, `progress`, `characters` (color, done/lines, effects + preset), `lines` (name, char, num, text, memo, state, done, star, takes: name, length, star, volumeDb, pan and clips numbered as in `info`) |
| `script import <p> <script> [--rate 44100\|48000] [--dry-run]` | like 대본 넣기, from `.txt` / `.csv` / `.tsv` / `.xlsx`. `action`: `created` (no file yet; `--rate`, default 48000), `converted` (a plain project becomes a script project, its `deletedTracks` tracks are deleted) or `updated` (a script project: the new script is the base, `counts` + `added` / `changed` / `gone` line names; lines match by name and keep their takes, a recorded line with new text becomes `redo`, a missing line is deleted with its takes, `counts.goneTakes`). Numbers optional: `철수-005: …` keeps 005, others count on per character; `renumbered` = repeated numbers given new ones. `--dry-run` reports and saves nothing |
| `script unscript <p> [--dry-run]` | like 보통 프로젝트로 바꾸기: every take becomes a track named `철수-001 테이크 1` (script order, then recording order, from 0 s) with its character color and effects; lines, memos and ★ are gone. `tracks` = the new track names |
| `script line set <p> --line NAME [--text T] [--memo T]` | like 대사 고치기 (text up to 1000, memo 300 characters); a recorded line whose text changes becomes `redo` |
| `script take add <p> --line NAME <audio...>` | each file = a new take (`테이크 n`, from 0 s), like dropping it in the app |
| `script split <p> --line NAME <audio> [--cut S,S…] [--every-gap] [--gap 0.3..5] [--join] [--char NAME[,NAME…]] [--todo] [--dry-run]` | like 긴 녹음 나누기: one long recording of several lines -> new takes (`테이크 n`, ★ if the line had none). Lines: `--line`, then the ones after it in script order (`--char` / `--todo` keep only those, like the app's list). A new line starts only at a `--cut` (seconds, like N while recording: moved to the middle of the nearest quiet stretch over 0.2 s within 2 s) or, with `--every-gap`, before every piece. Pieces = speech apart by more than `--gap` s (default 1), 0.3 s of quiet kept each side, shorter than 0.3 s is no piece; each piece of a line is its own take, `--join` makes one take per line (the quiet between kept). Reply: `pieces` (line, from, to in the audio), `boundaries` (s), `over` (pieces past the last line, left out). `--dry-run` reports and saves nothing |
| `script take set <p> --line NAME --take N\|NAME [--name T] [--volume DB] [--pan P]` | a take's header and mixer values, like `track set` (no M/S; color and effects come from the character) |
| `script take remove <p> --line NAME --take N` | delete a take (the ★ one leaves the line without ★) |
| `script take move <p> --line NAME --take N --to M` | put the take at position M among the line's takes, like dragging its grip (names stay) |
| `script star <p> --line NAME --take N` | ★ that take; picking ★ (even the same one) clears `redo` |
| `script fx <p> --char NAME <eq\|comp\|reverb\|echo> [--preset NAME] [--on\|--off] [--FIELD V ...]` | the character's effects (all its lines and takes), same rule as `fx` |
| `script color <p> --char NAME --color RRGGBB` | the character's color: all its lines and takes (any hex code, `#` optional, 6 digits, stored upper case; CLI only, like `track set --color`) |
| `script export <p> <folder> [--format F] [--char NAME[,NAME…] \| --line NAME [--take N\|NAME] [--clip K]] [--overwrite]` | like 대사별 내보내기: the ★ take of every line (or the characters given, `--char 철수,영희`, or one line) with the character + master effects. Every line and `--char`: a folder per character, `<folder>/철수/철수-001.wav` (the app makes `<folder>` itself, '녹음 대사 2026-11-09 17-40', in the folder picked; here `<folder>` is that folder); `--line`: `<folder>/철수-001.wav`; with `--take N` that take instead of the ★ (as `measure`), with `--clip K` only clip K of it (the ★ take's without `--take`), from its start to its end (이 클립만 내보내기; the reply's file has `clip`). Lines without ★ are listed in `skipped`; `redo` lines with ★ are exported and listed in `redo`. Existing files are refused (`EXISTS`) unless `--overwrite` |

```
sori script import 대본.vproj 대본.xlsx
sori script take add 대본.vproj --line 철수-001 take1.wav take2.wav
sori script star 대본.vproj --line 철수-001 --take 2
sori script split 대본.vproj --line 철수-001 긴녹음.wav --cut 12.5,30.2 --dry-run
sori script import 대본.vproj 고친대본.txt --dry-run
sori script export 대본.vproj 납품
```

### Measuring what is heard (`measure`)
An AI cannot listen, so `sori measure <project>` (or `sori live measure`) renders the sound **as heard** (track or
character effects and the master: EQ, limiter, volume, the same render as export) and reports numbers. It changes
nothing.
- A normal project: `tracks` = each track alone (as 지금 트랙만 exports it, mute/solo ignored) and `mix` = all of them as
  exported. `--track N`: that track only (no `mix`).
- A script project: `lines` = each line's ★ take with its character's effects (as 대사별 내보내기), `skipped` = lines
  without a ★ take with sound. `--char 철수[,영희]` those characters' lines; `--line 철수-001` one line; with `--take N`
  that take instead of the ★.
- `--from SEC` / `--to SEC`: that part only (seconds on the track, or from the take's start), cut at the end of the
  sound; nothing there -> `{ "seconds": 0, "empty": true }`.

Each measured piece: `seconds`; `lufs` (integrated loudness, BS.1770); `peakDb` (highest sample, dBFS); `clipped`
(`count` = places over 0 dBFS, samples within 10 ms one place; `at` = the first 20 start times); `noiseDb` (the room
noise: quietest 0.5 s above 150 Hz, digital silence at the ends left out; -100 = only digital silence was quiet);
`speechDb` (90th percentile 0.5 s level); `quiet` = `[{ from, to }]`, every stretch of 0.5 s or more where nothing is
heard over the room noise, by the rule 긴 침묵 줄이기 uses between words (breaths count as quiet). dB values are rounded
to 0.1; `null` = nothing to measure (silence or too short). A file `measure` runs in the hidden window (210 lines of
a real script project: 23 s); `sori live measure` waits up to an hour.

### Many commands at once (`batch`)
`sori batch <project> <commands.txt|->` runs many commands on one project; `sori live batch <commands.txt|->` on the
project open in the app. The file has one command per line, written as for `sori live` (no `<project>`; a leading
`sori` / `sori live` is fine); words with spaces go in `"..."` or `'...'`; a line starting with `#` is a note; `-` reads
the lines from stdin.
```
# 철수's lines
script line set --line 철수-001 --memo "다시 들어 보기"
apply --line 철수-001 --take 2 voiceGaps --level mid
script star --line 철수-001 --take 2
```
- Every line is parsed first (a typo on the last line stops it before the first runs). Then the lines run in the order
  written, on one copy of the project. The project is saved only when every line succeeded; the app takes the result
  as **one undo step** (one Ctrl+Z undoes the whole batch).
- A failing line: the reply is that line's error (`NO_TRACK`, ...) with `"line": N` and the line in the message; nothing
  is saved or applied. Not allowed in a batch (`BAD_ARG`): `new`, `export`, `script export` (exported files cannot be
  taken back when a later line fails; run them after the batch) and `batch`.
- The reply: `commands` = `[{ line, command, touches, result }]` (each line's usual reply in `result`) and `waves`.
  `touches` is what the line changes or reads: `line 철수-001`, `character 철수`, `track 2`, `master`, `markers`,
  `tempo`, or `all` (info, track add/remove/move/sort, range edits, 대본 넣기, script split, and anything not
  known); an `apply` of fxTempo, voiceGaps or voiceClean also touches `markers` (they follow a length change). `waves` lists line numbers that could run at the same time: each line goes one wave after the last
  earlier line it shares something with (`all` shares with everything; a line shares with its character). The lines
  still run one by one.
- `--check` runs nothing and saves nothing: the same `commands` (without `result`) and `waves`, plus `dryRun: true`.
- With an `import` line, a file batch runs in the hidden window. `sori live batch` waits up to an hour for the app.

### When the app has the project open
Before saving, file commands ask the running app which file it has open. If it is the same project (saved or not)
the command runs in the app instead, exactly as `sori live <command>` without the project file (see below): one
undo step there, refused while recording. The reply adds `"inApp": true, "saved": false` and a note: the file
changes when the project is saved in the app (`sori live run save`). Editing the file itself would race the app,
which does not watch it: its next save would overwrite the CLI edit, or the CLI would drop unsaved work.

## Live commands (the running app)
Live commands use the app's own menu commands, so each edit shows up at once and is one Ctrl+Z step for the user.
Commands act on the **selection**, exactly as when the user presses a key: set it with `live select` first.

| command | does |
|---|---|
| `live state` | `app` (filePath, dirty, playing, recording, canUndo, canRedo), `selection`, `project` (same shape as `info`), `ui` (mixer, fxPanel, spectrogram = 스펙트로그램 보기 for the whole timeline; script: list = tab / todo + visible line names) |
| `live commands` | every menu command: `name`, `label`, `enabled`, `dialog` (true = takes field values), `checked` for toggles |
| `live select [--from S] [--to S] [--track N,M] [--clip T:K,...] [--active N] [--marker N] [--playhead S] [--none]` | a time range (on `--track` or all tracks), or clips (`2:1` = track 2 clip 1), the current track, a marker, the play position; `--none` clears range, clips and marker |
| `live run <name> [--preset NAME] [--FIELD V ...] [--path P ...] [--yes]` | run one command; the reply has `edited` (it made, undid or redid an undo step, or opened another project), the app's `toasts`, `canUndo` |
| `live <file command>` | any file command above, without `<project>`, on the project open in the app (below) |
| `live settings [--NAME VALUE ...]` | everything the app remembers. Without options: `settings`, audio `devices` (id, name), `recent` files and `shortcuts` (command, label, keys, `changed`). Options change them, checked like the window or menu: `inputId`/`outputId` (a device id, `""` = Windows default), `recChannels` 1\|2, `latencyMs` 0-500 or `auto` (자동 측정: plays 4 clicks, sets it; `measuredMs`), `countIn` 0\|1\|2, `metroVol` 0-100, `metronome`/`snap`/`mixer`/`fxPanel`/`follow`/`stopReturn` on\|off, `mixerH` 120-600, `autosaveMin` 0\|1\|2\|5\|10, `exportFormat`, `sampleRate` (new projects), `undoOnlyGB`, `theme` dark\|light, `zoom` 90\|100\|110\|125, `laneH` 64\|96\|128. Buttons: `--key CMD=KEY` (like Ctrl+S, Shift+F5; the key leaves the command that had it: `keyTakenFrom`) or `CMD=default`, `--keys default` (all), `--recent clear` or `--recent PATH` (one), `--mic-test SEC` 1-10 (`micTest`: peakDb, avgDb, clipped) |
| `live script line <NAME>` | script project: go to that line, as clicking it in the list (not an undo step; a recording stops first, its take kept, and playback stops) |
| `live script star <N\|NAME>` | script project: ★ a take of the current line (undoable) |
| `live script view [--char NAME \| --all] [--todo on\|off]` | script project: the line list's character tab and 녹음 안 한 것만 (what `prevLine` / `nextLine` and `live find` walk through; not an undo step) |
| `live find TEXT [--clips] [--markers] [--memo] [--next \| --prev]` | Ctrl+F: goes to what matches TEXT (a part; case and spaces ignored): track names, or in a script project the listed lines (number, text). `--clips` / `--markers` / `--memo` also look in clip names, marker names, line memos. Without `--next` / `--prev` it stays on a match it is on, else goes to the first from the current track / line on; while recording it only counts (as typing in the box), `--next` / `--prev` move (and stop the recording, as Enter does). Reply: `count`, `at` (1-based, null when none), `hit` {kind, name}, `selection`, `line` (script). Not an undo step |

In a script project `live state` also has `script` (same shape as `script info`); its `project.tracks` are the current
line's takes (all on screen). Menu commands for script mode work with `live run`: `prevLine`, `nextLine`,
`editLine --text --memo`, `importScript` / `unscript` (the user picks the file / confirms), `export`.

`live run` takes field values only for commands with a dialog (label ends with `…`, `dialog: true`). The values fill
the dialog instead of showing it, checked against that dialog's fields (numbers clamped to their range). Without
values the dialog appears for the user. Fields today: `fxGain --db`, `fxNormalize --db`, `fxTempo --percent`,
`fxPitch --semitones`, `fxNoise/fxEq/fxComp/fxReverb/fxEcho` effect fields or `--preset`, `voiceLoud/voiceGaps/voiceDeess/
voiceHum/voiceGate/voiceEven --level low|mid|high`, `voiceClean --noise --lowcut --even --gaps --loud off|low|mid|high`,
`insertSilence --sec`,
`clipProps --db --fi --fo` (fades in seconds), `markerRename --name`, `export --format --tracks all|cur --range all|sel|markers` (a script project: `export --format --lines all|chars|line --chars 철수,영희`; a list field takes names separated by commas). A wrong field name is refused with the dialog's field list.

`--path` answers the command's file or folder window (`open`, `saveAs`, `export`, `importScript`, per-marker and
per-line export folders; several `--path` for `open` = several audio files). `--yes` answers the app's questions
(unsaved changes, "덮어쓸까요?", the 대본 넣기 / 보통 프로젝트로 바꾸기 warnings) with yes, and every later dialog of that
command with its defaults (values fill only the first). Saving with `--path` onto an existing file without `--yes` shows
the user "덮어쓸까요?". Whatever is not given, the user is asked on screen, as before. `fxNoise` needs `fxProfile` first (select a noise-only range).
A command that never answers in 2 minutes returns `TIMEOUT` (it may still be waiting for the user).

```
sori live state
sori live select --from 12.5 --to 14 --track 2
sori live run delete
sori live select --playhead 30 --active 1
sori live run split
sori live select --from 0 --to 60
sori live run fxNormalize --db -1
sori live run undo
sori live run export --format mp3_192 --path 완성.mp3 --yes
sori live run importScript --path 대본.txt --yes
```

### File commands on the open project
Every file command works live without `<project>`: `sori live track set --track 1 --volume -3`, `sori live clip move ...`,
`sori live script take remove --line 철수-001 --take 2`, on a script project `sori live clip split --line 철수-001
--take 2 --at 1.5`. It runs on the project in the app, nothing is saved (the user
saves). What the app's Ctrl+Z covers (tracks, clips, track colors, markers, lines and takes) becomes one undo step;
mixer values, names, effects, character colors and tempo change live without one, as in the app. The reply has the
command's usual result plus `undoStep` and `canUndo`. `script import` and `script unscript` work here too (no warning
window, one undo step; the screen shows what the menu command shows). `new` makes a file, so it is refused with
`USE_APP_COMMAND` (use `live run newProject`). Refused while
recording (`RECORDING`). While the app runs a long job with its progress bar (an effect, 목소리 정리, import, open,
export), or has a dialog open, every `live` request but `state` and `commands` gets `BUSY`: try again when it ends. Commands that read audio (`import`, `script take add`) take a moment: if the user edits the
project meanwhile, nothing is applied (`CHANGED`).

The channel is a local named pipe (`\\.\pipe\sori-live-<user>`), never a network port. Only command names from the
app's list are accepted; nothing is evaluated.

## Not here yet
- Recording takes (needs the mic: `live run record` in the app).
- File commands for copy/paste and clip duplicate (live has them: `live run copy`, `paste`, `duplicate`), recording
  (live: `live run record`).
