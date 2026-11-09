# UI guide (editor screen)

Baseline: made with UI UX Pro Max `--design-system` for "audio editor desktop productivity tool dark mode"
(density 8, variance 3, motion 3): **Minimalism & Swiss style**, slate surfaces, teal primary, orange accent,
Inter type. Where this file differs from that baseline, this file wins; its landing-page pattern, scroll-reveal
motion and Google Fonts link do not apply (desktop app, offline).

Reference feel: FL Studio playlist (colored clip blocks with a name strip), Audacity editing model.

## Layout
```
┌ topbar 48px ──────────────────────────────────────────────────────────────────────────────────┐
│ Sori │ 파일 편집 보기 효과 │ ⏮ ▶ ■ ● ⟲ 𝅘𝅥 │ 00:12.340 │ 120 BPM 4/4 ♫ ⧉ │   − + ↔ │ 믹서 효과 │ ⚙ ? ☾ │
├ header col 224px ┬ ruler 28px (+ markers) ─────────────────────────────┬ effect panel 300px ──┤
│ + 트랙            │ 0:00   ▼마커 1   0:05      0:10                     │ 효과 [마스터 ▾]   ✕ │
├──────────────────┼───────────────────────────────────────────────────┤ note                 │
│ ▌목소리 ≡ M S ✕   │ ┌clip name──────────┐                              │ ┌ 마스터 볼륨 ──────┐│
│ 볼륨 ──●── -3.0dB │ │∿∿∿waveform∿∿∿∿∿│   lane (설정: 64/96/128px)    │ ├ ● EQ [프리셋 ▾] ─┤│
│ 팬   ───●─  C     │ └──────────────────┘                              │ │  EQ curve 140px  ││
├──────────────────┴───────────────────────────────────────────────────┤ │  sliders         ││
│ horizontal scrollbar 12px                                             │ ├ ● 컴프레서 …      ┤│
├ mixer (F9, resizable 120px–60% height, default 220px) ───────────────┤ └──────────────────┘│
│ [tone][효과][pan][fader|meter][dB][M S] [트랙 2] …            [마스터] │                      │
└───────────────────────────────────────────────────────────────────────┴──────────────────────┘
 status 24px: hint (left) · 선택 a – b (n초) · 48000 Hz · 트랙 n개 · 길이 (right)
```
Script mode (`body.script`): `#main` becomes `line list 288px | header col 224px | timeline`, with the line bar on top
of the header col + timeline (the list runs the full height). Header top shows "테이크" instead of the add button.
Body grid: rows topbar / main / hscroll / mixer / status; the effect panel is a right column from main
to mixer. Panels open and close without moving the timeline's time scale.
Lane height from settings (`--lane`, `state.view.laneH`); clip name strip 18px; trim handle 6px each edge;
fade handles 8×8 at the top corners under the name strip; header column scrolls with lanes.
Narrow windows: ≤1280px hides the brand and zoom buttons (Ctrl+= / Ctrl+- / Ctrl+0 stay); ≤1100px also hides
the BPM label and the grid, snap, theme and shortcut buttons (all in the 보기 menu) and narrows the menu names'
padding to 7px. BPM and beats stay. Menu names never wrap (900px wrapped 파일 into 파/일 once the six menus came).

## Tokens (`src/ui/styles/base.css :root`) — semantic only, no raw hex in components
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | #0F172A | #EDF0F4 | app background, lanes |
| `--lane-alt` | #131C31 | #E6EAEF | every other lane |
| `--lane-active` | (= `--hover`) | rgba(13,148,136,.09) | the current track's lane (light: teal tint, not gray) |
| `--panel` | #111827 | #FFFFFF | top bar, headers, menus, dialogs |
| `--surface` | #1E293B | #F3F5F8 | inputs, time display, ruler |
| `--line` | #334155 | #D3DAE3 | borders, dividers, grid |
| `--text` | #F8FAFC | #0F172A | primary text |
| `--muted` | #CBD5E1 | #475569 | secondary text (≥4.5:1 on panel) |
| `--subtle` | #94A3B8 | #5B6B7F | ruler labels, shortcuts in menus (≥4.5:1 on surface: 5.71 / 4.97) |
| `--primary` | #0D9488 | #0F766E | primary button, toggles on, focus ring |
| `--on-primary` | #000000 | #FFFFFF | text on primary |
| `--secondary` | #14B8A6 | #0D9488 | playhead, selection edge |
| `--accent` | #EA580C | #C2410C | mute-on, selected-clip outline |
| `--danger` | #EF4444 | #DC2626 | record, delete hover, error text (4.71 / 4.83 on panel) |
| `--sel` | rgba(20,184,166,.20) | rgba(13,148,136,.14) | selection fill |
| `--hover` | rgba(248,250,252,.06) | rgba(15,23,42,.05) | hover layer |
| `--meter-g` `--meter-l` `--meter-y` `--meter-o` `--meter-r` | #22C55E #84CC16 #EAB308 #F97316 #EF4444 | #15803D #4D7C0F #A16207 #EA580C #DC2626 | FL-style meter gradient: green to −24 dB, lime −18, yellow −12, orange −6, red from −2 dB. One gradient over the whole meter height, the bar shows the colors up to its level; the peak line takes the color of its level. Same stops on the settings mic-test bar. Graphic, ≥3:1 on surface |
Shadows: `--shadow-lg` (menus, dialogs) only. Radius: 6px controls, 8px menus/dialogs, 4px clips.
Spacing (density 8): 2/4/8/12/16/24. z-index: canvas 0, overlays 10, menus 40, modal 60, toast 70, busy 80.

Track colors (cycled, readable on both themes): `#38BDF8 #A78BFA #F472B6 #FBBF24 #34D399 #FB923C #60A5FA #E879F9`.
Clip body = track color at 26% (dark) / 90% (light: the strong-clip look); name strip 85%; waveform full color
(dark) / color mixed 70% toward white (light, `--wave-shade: -.7`; positive values mix toward black). Selected clip: 2px
`--accent` outline.

## Type
`"Pretendard Variable"` (Inter-based, has Hangul; bundled from npm `pretendard`), fallback `"Malgun Gothic", sans-serif`.
13px base (dense desktop), 12px minimum anywhere, weights 400 body / 500 labels / 600 titles.
Timers: tabular numbers (`font-variant-numeric: tabular-nums`), 15px.

## Icons
Phosphor `regular` weight only (UI UX Pro Max icons domain: Media → Phosphor), from `@phosphor-icons/core`
SVG assets, inlined at startup by `src/icons.js` via `<i data-icon="name">`. 18px in 32px buttons.
No emoji, no mixed filled/outline at the same level.

## Components
Rule: a button, menu item or shortcut always does the same one job. If the job would change
with the mode (script project) or the selection, it gets its own control instead. Check every new control against this.
A window also opens the same way every time: no memory of the last pick:
effect windows open with their defaults, 내보내기 with the 설정 format, 설정 on its first tab, a new fade is 직선.
Settings and on/off states (theme, panels, snap) are the app's state, not a window's memory, and stay.
- Icon button 32×32 (target ≥24×24, `web-target-size`), `aria-label` = visible tooltip text, toggles expose `aria-pressed`.
- Track buttons M/S/✕ 24×24, letters as well as color (`color-not-only`).
- Button primary (`--primary` / `--on-primary`) and secondary (border `--line`). One primary per dialog.
- Slider: native range restyled; every slider has a visible label and value text.
- Menu: items 28px, label left, shortcut right in `--subtle`, separators, disabled = 45% opacity + `aria-disabled`.
  Top menus: 파일 · 편집 · 트랙 · 마커 · 보기 · 효과 (a menu stays short enough to scan; 편집 is 17 rows).
  Rows only for a script project (menus.js `SCRIPT_ONLY`) are left out otherwise, and a separator never starts,
  ends or doubles a menu.
- Dialog: `role="dialog" aria-modal`, title, note, fields `label | slider | number + unit`, footer [미리듣기] … [취소] [적용].
  Enter = 적용, Esc = 취소, focus moves into the dialog and returns to the trigger after close.
- Toast: bottom center, `aria-live="polite"`, 3.5 s, error variant uses `--danger` + "오류" text. Destructive actions say how to undo ("Ctrl+Z로 되돌리기").
- 재생 button: `disabled` (base `button:disabled`, opacity .45) whenever `playPause` is not enabled (nothing to
  play); updated with the other top-bar states in `updateChrome`.
- 백업에서 열기 sheet (narrow): a hint line, then a section per project (h3 = name, `(지금 프로젝트)` first; title =
  its path) with one full-width row button per backup: local time left, size right (subtle). Click/Enter opens it.
- Question window (`D.ask`): the app's own instead of the Windows message box. Same box as dialogs (440px),
  title, one note line, buttons right-aligned in reading order ([저장] [저장 안 함] [취소]; [지우기] [복구]; [취소]
  [덮어쓰기]); the primary one is filled and focused (Enter), Esc = the safe answer. `role=alertdialog`, note =
  `aria-describedby`. File pickers (열기, 저장 위치, 폴더) stay the Windows ones.
- Busy overlay: appears only if work exceeds 150 ms (`loading-states`, no flash), label says what runs. Long jobs add,
  under it (360px max): a 6px bar (white on 25 % white, `role=progressbar`), a 13px line '42% · 하는 일 · 트랙'
  (tabular numbers, one line with ellipsis) and [멈추기 (Esc)] (28px, white outline). Stopping toasts '멈췄어요 — 바뀐 것
  없어요'. While it shows, no key or click reaches the app (Esc = 멈추기).
- Empty state: title + how to start (drag, Ctrl+O, R).
- Switch (effect on/off, settings toggles): 34×20 button, `aria-pressed`, knob moves right + `--primary` fill when on.
- Select (preset, channel, beats): native `<select>`, 28px, `--surface` + `--line`; preset select shows
  "직접 조절" when the values match no preset.
- Segmented choices (settings, dialog options): buttons with `aria-pressed`, selected = `--secondary` border + `--sel` fill.
  A list choice (`multi`) looks the same and any number can be pressed (a click toggles one): 대사별 내보내기 캐릭터. A field
  can show only for one choice of another (`when`): the 캐릭터 row appears under 범위 = 캐릭터 고르기.
  An option may carry a number under its word (`sub`, 11px `--subtle`): 음량 [작게 · 보통 · 크게] show -23 · -16 · -14 LUFS.
- Strength window (목소리 정리): one segmented row (세기 [약하게 · 보통 · 강하게] / 크기 [작게 · 보통 · 크게]), no number
  fields, 보통 pressed at open, footer 미리듣기 · 취소 · 적용 (Enter = 적용). 한 번에 깔끔하게 = one row per step with
  [끄기] first, always opening with the same rows (no memory of the last pick: a button always does the same).
- Menu group title (`'#title'` in menus.js): 12px `--subtle` text row, not focusable; the rows under it (up to the next
  separator) are indented 22px. Used for 효과 > 목소리 정리.
- Effect panel head: 4px band in the channel color `--ch` (track color, master `--secondary` like its mixer strip),
  title "트랙 효과 · name" / "마스터 효과 · 전체 소리에" 15px with ✕, channel select full width under it, note says
  where the effects apply. Cards get a 3px left edge in `--ch` (`color-not-only`: the title says it too).
- Effect card (effect panel): header [switch] name [preset ▾]; body (sliders, EQ curve) only when on;
  border `--primary` when on. Every slider: label · range · value text; double-click = default value.
- EQ curve (`eqgraph.js`): log 20 Hz–20 kHz × ±18 dB, grid at 50/100/200/500/1k/2k/5k/10k and ±6/±12 dB,
  response line `--secondary` 2px with `--sel` fill to 0 dB, 5 band points (cut bands hollow when off),
  hover/drag shows "band value" in a small label. The sliders under it are the keyboard alternative.
- Mixer strip 84px (master 92px): name button with track color top border (click = show its effects),
  [효과 n] button (`aria-pressed` when shown in the panel), pan + value, vertical fader (dB, double-click 0 dB)
  next to a stereo peak meter (fall 30 dB/s, 1.5 s peak hold line, 0 dB line) with a clip indicator
  above it (click to clear), dB text, M/S. Meters are canvas; values are also text (`color-not-only`).
- Split button (`+ 트랙 [▾]`): left part runs the default (빈 트랙), [▾] opens a list menu (`data-list` → menus.js
  `LISTS`), `aria-haspopup=menu` + `aria-expanded`; the two halves share one border.
- Line list (script mode): character tabs = 26px pills (dot in the character color, `done/total` in `--subtle`, pressed =
  `--sel` + `--secondary` border); search field 28px; '녹음 안 한 것만' = `.switch` + label. Rows are buttons:
  `캐릭터-번호` 12px/600 + take count right (`★ 테이크 n` in `--secondary` when recorded, `녹음 전` in `--subtle`), the line
  13px (2 lines max), memo 12px `--muted`, badge '다시 녹음 필요' in `--accent` on a 16% tint. Current row: `--sel` background + 3px left edge in the character color, `aria-current`.
- Line bar / prompter (script mode): 4px left edge in the character color (`--danger` while recording), `캐릭터-번호`
  13px/700 `--muted`, the line 20px/600 (32px while recording, max 30vh then scrolls), memo 13px, hint right 12px; while
  recording the next line shows below in 14px `--subtle` ("다음 · 영희-005 …").
- Take count (script mode): in `#headers-top` instead of the add button, plain text `테이크 n개` 12px `--muted` (not a
  button: every take always shows), then [+ 테이크] (`.btn-small.take-add`, same look as [+ 트랙]; disabled while
  recording). A line without takes: the empty timeline says how to record one.
- Take ★ button (script mode): replaces M in the take header, 24×24 `.tbtn`, pressed = `--accent` fill with black ★.
  Takes have no S either (one take plays at a time); the mixer hides M/S rows in script mode.
- Track header grip: `dots-six-vertical` 14px in `--subtle` (hover `--text`), first item of the name row; while dragging
  the header is 60% opacity and a 2px `--primary` line marks the drop gap.
- Sheet (설정, 단축키): large dialog 760×600 max, title bar with ✕, scrolls inside; Esc closes, focus trapped.
  설정 = vertical tabs (`role=tablist`, ↑/↓ moves) + panel of rows "label | control + hint".
  Shortcut capture: [바꾸기] → "키를 누르세요… (Esc 취소)"; a key used elsewhere moves here and a toast says so.
- Markers: ruler flag in `--accent` with name, thin line through the lanes; selected = brighter + outline.
- Fades: clip envelope drawn as its curve (24 segments) over the waveform, area above it darkened; handle = 8×8
  `--text` square; right-click on a handle = shape menu (직선 · 부드럽게 (S자) · 빠르게 · 천천히, current one ✓).

## Motion
Hover/press color transitions 150 ms ease-out; menus/toasts fade 120 ms in, 80 ms out (`exit-faster-than-enter`).
Only opacity/transform animate. Record pulse and spinner are the only loops. `prefers-reduced-motion: reduce`
removes all transitions and the pulse (spinner becomes static text).

## Mouse map (timeline) + keyboard alternatives (`dragging-alternative`)
| Where | Mouse | Keyboard alternative |
|---|---|---|
| Ruler | click / drag → move playhead / scrub | ←/→, Shift+←/→, Home/End |
| Lane / clip body | drag → range (vertical spans tracks); click → playhead + active track | Shift+←/→ with range? → Ctrl+A, Esc |
| Anywhere in lanes | Shift+click → extend range | — |
| Clip name strip | click / Ctrl+click → select / toggle | Tab focus in header selects track |
| Clip name strip | drag (after 4px threshold) → move clips, snaps to edges/playhead within 8px | Alt+←/→ move 0.1 s (Shift = 1 s), Alt+↑/↓ move to track above/below |
| Clip edge 6px | drag → trim | S split + Delete, or Ctrl+T keep |
| Clip | double-click → select its span | — |
| Anywhere | right-click → context menu | Shift+F10 / ContextMenu key |
| Wheel | vertical scroll; Shift = horizontal; Ctrl = zoom at cursor | Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+Shift+F (선택 구간 확대) |
| Clip top corner handle | drag → fade in / fade out length; right-click → fade shape | 클립 볼륨 · 페이드… (편집 menu / right-click) |
| Ruler marker | click → select + playhead; drag → move (snaps); double-click → rename; right-click → menu | M add, [ / ] jump, Delete removes selected marker |
| EQ curve point | drag → frequency (x) + gain (y); wheel on 중음 → width (Q); double-click → band default | sliders under the curve |
| Mixer fader / pan | drag; double-click → 0 dB / center | focused slider ←/→ (Space still plays) |
| Track header grip ⠇ | drag → reorder (line shows the gap, Esc cancels) | Ctrl+Alt+↑/↓ (편집 > 트랙 위로/아래로 옮기기) |
| Line list row (script mode) | click → that line; double-click → 대사 고치기 | ↑/↓ (편집 > 이전/다음 대사), 편집 > 대사 고치기… |
| Take lane / header (script mode) | click → select the take; the next playback plays it | Tab focus in header |
| Take ★ (script mode) | click → this take is the one exported | — (Tab to the button, Enter) |
| Mixer top edge | drag → panel height (120px to 60% of the window; a saved height is capped the same way when the window shrinks) | focus the edge, ↑/↓ 20px |
Keyboard focus rules: shortcuts are off only while typing in a text field. Space is always play/pause
(buttons are activated with Enter); a focused slider keeps ←/→. Mouse clicks on the ruler/lanes never
scroll the view; keyboard moves of the playhead scroll it into view.
Cursors: `text` over lanes, `grab`/`grabbing` on name strip, EQ points and the track grip, `ew-resize` on edges and markers,
`ns-resize` on the mixer edge, `pointer` on buttons/menu items.

## Wording (Korean UI glossary)
트랙, 클립, 구간 선택, 재생 위치, 잘라내기, 복사, 붙여넣기, 삭제, 나누기, 합치기, 복제, 선택만 남기기,
무음 넣기, 무음 처리, 실행취소, 다시실행, 내보내기, 프로젝트 저장, 음소거(M), 솔로(S), 볼륨, 팬,
믹서, 효과 패널, 마스터, 트랙 효과, 프리셋, 직접 조절, 리미터, 마커, 페이드 인/아웃, 클립 볼륨, 메트로놈,
카운트인, 빠르기(BPM), 박자 격자, 스냅, 스펙트로그램, 자동 저장, 복구, 녹음 지연 보정, 설정, 단축키.
Effect names as spec.md §5. Messages short, polite-informal (…했어요). Errors = cause + what to do.

## Checklist (UI UX Pro Max pre-delivery, desktop subset) — tick per UI change, both themes
- [ ] Text contrast ≥4.5:1 (primary, muted, subtle) in dark and light; borders/states visible in both
- [ ] Focus ring visible on every control (2px `--primary`), tab order = visual order
- [ ] Icon-only buttons have `aria-label`; toggles have `aria-pressed`; decorative icons `aria-hidden`
- [ ] Targets ≥24×24, 4px+ gap; `cursor: pointer` on clickable
- [ ] Hover/press feedback ≤150 ms, no layout shift on press
- [ ] Disabled = reduced opacity + semantic attribute + no action
- [ ] Every drag has a keyboard alternative (table above)
- [ ] Toasts don't steal focus; errors say cause + fix; destructive actions are undoable and say so
- [ ] reduced-motion respected; no animation blocks input
- [ ] Phosphor regular icons only; no emoji; tokens only (no raw hex in components)
- [ ] Window min size 900×560 shows everything without overlap
