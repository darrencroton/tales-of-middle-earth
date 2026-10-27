# AGENTS.md — working on tome2mobile

ToME 2 (Tales of Middle-earth roguelike) compiled to WebAssembly and played as a phone-first PWA. The C++ engine is unmodified; everything the player sees is ours.

## Product direction (most important)

- **UI/UX is the product.** The goal is a modern, intuitive mobile game. tome2's own 80×24 screens, menus and key-hint text are *plumbing*: they may run underneath, but the player should not see them. When a tome2 screen still shows through, the fix is a native view or a modern rendering, not a tweak to the terminal look.
- Fallback order for any tome2 screen: **native view** (sheet/card/director screen built from engine data) → **modern panel** (`TermView`: UI font, tappable rows, labelled columns, switches, no key hints) → nothing raw.
- Every list has a highlighted row: arrows/swipes move it, tap/Enter chooses. Tap outside a panel (or Escape, or swipe down on a sheet header) closes it.
- You can always go back: sheets stack (Back returns to the previous one, with its highlight and scroll kept), and a tome2 screen opened from a sheet to read (`api.command`, `reading` commands and item actions) reopens those sheets when it closes. Character creation has Back too.
- Anything with information is tappable for that information (HUD name → character, creature/item chips → details, map long-press → look).
- One text size everywhere (`--fs`, Settings → Text size). Never hard-code font sizes; use `rem`, `--fs-small`, `--fs-large`, `--fs-title`.
- Layout must adapt to any screen: no fixed widths/heights, respect safe areas (`--safe-*`), test portrait and landscape.
- Icons are symbols rendered with `iconText()` (adds U+FE0E) so iOS doesn't turn them into emoji.
- We are our own version of ToME: rewording or replacing ToME text in our UI is fine. Keep wording neutral and friendly; don't quote or pattern-match on grim engine phrasing when a neutral part of the prompt will do.

## Owner preferences

- UK English. Concise, direct communication; no flattery.
- Comments describe what code does, not why; keep them sparse and match surrounding style.
- Prefer native/platform solutions over new dependencies; ask before adding packages.
- Robust error handling; complete, runnable changes.
- Commit/push only when asked or when checkpointing a long piece of work; open PRs only on request.
- (Preferences evolve — update this section when the owner states new ones.)

## Layout

```
external/tome2/        engine submodule (darrencroton/tome2), never patched
engine/main-web.cc     Frontend bridge to JS; off-screen scratch terminal
engine/snapshot.cc     JSON/array exports: level snapshot, state, inventory, character, item/monster text
web/src/main.ts        App wiring: modes, refresh loop, taps/gestures, toolbar, macros, menus
web/src/engine.ts      WASM loader, key queue, IDBFS sync, export wrappers
web/src/flow/          Director: answers start-up screens, native character creation
web/src/ui/            Sheets, ListNav, TermView (+termparse, prompttext), prompt card, native views
web/src/play/          actions (toolbar), prompts, items (+macros), travel, targeting, pathfinding
web/src/render/        Lit map, materials, lighting, flames, snapshot types
web/src/title.ts       Opening screen (flames, mosaic logo, Continue/New, intro)
tests/unit/            node:test, pure modules
tests/e2e/             Playwright (phone portrait, phone landscape, tablet)
```

## How it works

- **Modes** (`main.ts`): `title` (opening screen), `screen` (pre-dungeon: director views or full TermView over flames), `map` (lit map + HUD), `overlay` (tome2 covers the map → TermView panel built from cells that differ from the last map screen).
- **Engine interaction:** the engine blocks in `inkey()` via Asyncify; `onIdle` fires each time it waits. JS may call exported C functions while it waits. Send keys with `\` before a command to bypass keymaps.
- **Macros** (`play/macro.ts`): generators that yield keys and receive the next screen; used to answer item/quantity/inscription/shop prompts so native buttons map to tome2 commands. Never yield an empty key list.
- **Director** (`flow/director.ts`): auto-answers module/news/savefile screens, feeds Continue/New to the title, drives birth screens (cursor moves with `6`/`4`, confirm with Enter), auto-answers routine birth questions. tome2 has no previous step, so Back sends `S` (start over) and replays the earlier picks by option letter; Random only highlights an option so every pick is known. tome2's sliding intro never waits for a key, so `effectFrame()` (called from `onEffectFrame`) sends the key that cuts it short.
- **Prompts:** `classifyPrompt(row0, cursorOnRow0)`; yes/no, quantity, text, direction and aim become a native `PromptCard`. `cleanPrompt` strips key hints for headings.
- **Gestures:** tap = travel/act, drag = pan (resets on next move), long-press = look, pinch = zoom.
- **Saves:** `~/.tome` on IDBFS; Save and quit sends `\^X`, answers the follow-up screens, then reloads to the title. Any save command sets `pendingSync` so storage is synced (and the player told) once the engine has written the file.
- **Level readiness:** `engine/snapshot.cc` reports `inDungeon` from `character_generated`, not `character_dungeon`, so the map stays native while a new level is generated (quest hooks print `-more-` messages mid-generation).
- **Messages:** Settings → Messages defaults to *Flow past*, which sets tome2's `auto_more` through `web_set_auto_more` (re-applied on every snapshot so a loaded savefile cannot undo it). Messages then only appear in the HUD log and history.
- **Return to sheets** (`main.ts` `coverSheets`/`reopenSheets`, `Sheets.snapshot`/`restore`): sheets covered by a tome2 screen are saved and reopened at the next idle at the command prompt (or straight away when tome2's knowledge menu is redirected). `SheetContent.rebuild` refreshes a sheet whose data may have changed (character).
- **iOS home-screen layout:** iOS can lay a standalone app out one status bar short of the screen; when `navigator.standalone` and the shortfall equals `--safe-top`, `html.fill-screen` sizes `#app`, sheets and the title to `--screen-height`.
- **Service worker:** a new worker waits; the page asks it to take over (and reloads) only while no game is in progress.
- **Keys:** `keyCodes`/`typedAnswer` in `input/keys.ts` are the only text encoders; the engine drops codes outside 0..255.

## Build, run, test

```zsh
source /path/to/emsdk/emsdk_env.sh     # Emscripten 6.0.13
npm ci
npm run engine:configure && npm run engine:build   # after any engine/*.cc or CMake change
npm run dev            # http://localhost:5173
npm test               # unit tests, fast — run often
npm run typecheck
npm run build          # needed before e2e; tsc also checks tests/
npm run test:e2e       # slow (~30+ min for all projects in CI)
```

- New engine exports must be added to `-sEXPORTED_FUNCTIONS` in `CMakeLists.txt`.
- Test in small batches while working (unit tests, a typecheck, targeted Playwright scripts or `npx playwright test -g "<name>" --project=phone-portrait`). Run the full e2e suite at the end of a piece of work, not after every change.
- Headless Chromium can't emulate iOS safe areas or emoji fonts; check those with CSS overrides (`--safe-left: 59px` etc.) and owner screenshots.
- `?wizard` starts in wizard mode (a y/n prompt appears at birth); e2e uses it to jump levels.
- Debug hook: `window.__tome` (engine, buffer, screenText, sendText, mode, actions, director…).

## Play assists

- Travel stops once per creature: `noticed` (per level, shared by `Travel` and `Explore`) holds creatures that already stopped it; they are ignored until they leave sight. Being hurt always stops.
- `play/explore.ts`: `exploreTarget` (BFS to the nearest item or frontier cell), `Explore` (chains `Travel`s, danger radius 1, heads for `DOWN_EXIT` when done). Skip set is per depth (`exploreSkip` in `main.ts`).
- `play/items.ts` `suggestedGear`: heal > eat > wield > light; toolbar `equip` action runs the matching item macro.
- `feel.ts`: `playerEvents(prev, next)` (pure) → hurt flash, level-up/depth banners, gold float, low-health pulse; honours the animation setting.
- `ui/coach.ts`: first-game tips (localStorage `tome2mobile.coach.v1`); e2e `createCharacter` dismisses it.
- Map toolbar is capped at 7 buttons (`MAX_MAP_ACTIONS`); Look gives way first, Rest hides when a foe is adjacent. In town, Explore is replaced by Dungeon (travel to the nearest known way down); while resting or running the bar shows Stop, and a map tap also interrupts.
- Attack targets the weakest adjacent hostile and the map brackets it in red (`map.setFoe`); creatures that lose health get a flash and a floating damage number (`showHits` in `main.ts`, `feel.floatAt`).

## Native views of tome2 screens

Parsed from the terminal each refresh (`main.ts` `refresh()` → `renderCustom`); keys are still sent to tome2 underneath.

| Screen | Parser | Notes |
|---|---|---|
| Skills / Abilities | `ui/skills.ts` | taps move the cursor with `2`/`8`; toolbar raises/learns |
| Full sheet (`C`) | `ui/charsheet.ts` | tabs press `n` to cycle pages; equipment letters map to `INVEN_WIELD + n` |
| Message boxes | `ui/msgbox.ts` | `msg_box_auto` boxes → `PromptCard.showBox`; panel under a box is frozen |
| End of game | `ui/gameover.ts` | *Continue* runs `finishMacro` (Escapes) and reloads to the title |
| Shop item | `ui/store.ts` | description via `web_store_object_desc(page*12 + letter)` |
| Knowledge (`~`) | `ui/character.ts` | native menu sends `\~N`; file viewer gets Done/Page toolbar |

## Known gaps / next ideas

- Still TermView (modern text, not native): spell lists, help files, options, knowledge file contents, the shop list itself.
- Hardware-keyboard `i`/`e`/`~` are redirected to the native inventory and knowledge menu (`redirectNativeScreen`).
- Renaming from the full sheet (`c`) edits inline on row 2 and is not offered.
