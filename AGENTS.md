# AGENTS.md — working on tome2mobile

ToME 2 (Tales of Middle-earth roguelike) compiled to WebAssembly and played as a phone-first PWA. The C++ engine is unmodified; everything the player sees is ours.

## Product direction (most important)

- **UI/UX is the product.** The goal is a modern, intuitive mobile game. tome2's own 80×24 screens, menus and key-hint text are *plumbing*: they may run underneath, but the player should not see them. When a tome2 screen still shows through, the fix is a native view or a modern rendering, not a tweak to the terminal look.
- Fallback order for any tome2 screen: **native view** (sheet/card/director screen built from engine data) → **modern panel** (`TermView`: UI font, tappable rows, labelled columns, switches, no key hints) → nothing raw.
- Every list has a highlighted row: arrows/swipes move it, tap/Enter chooses. Tap outside a panel (or Escape, or swipe down on a sheet header) closes it.
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
- **Director** (`flow/director.ts`): auto-answers module/news/savefile screens, feeds Continue/New to the title, drives birth screens (cursor moves with `6`/`4`, confirm with Enter), auto-answers routine birth questions.
- **Prompts:** `classifyPrompt(row0, cursorOnRow0)`; yes/no, quantity, text, direction and aim become a native `PromptCard`. `cleanPrompt` strips key hints for headings.
- **Gestures:** tap = travel/act, drag = pan (resets on next move), long-press = look, pinch = zoom.
- **Saves:** `~/.tome` on IDBFS; Save and quit sends `\^X`, answers the follow-up screens, then reloads to the title.

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

## Known gaps / next ideas

- Remaining tome2 screens shown via TermView: spell lists, skills, knowledge, help, full character sheet, death screens. Candidates for native views: spells, skills, the shop list itself.
- Hardware-keyboard `i`/`e` are redirected to the native inventory.
