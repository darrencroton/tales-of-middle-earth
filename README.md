# tome2mobile

A mobile-friendly web port of **ToME 2 — Tales of Middle-earth**, the Angband-derived roguelike. The original C++ engine is compiled to WebAssembly and runs in the browser as an installable, offline-capable Progressive Web App (PWA). No App Store needed.

**Play:** <https://darrencroton.github.io/tome2mobile/> (deployed from `main`)

---

## Status

**Milestone 1 — playable in the browser** ✅

- The tome2 engine runs unmodified as WebAssembly (Emscripten + Asyncify).
- The classic 80×24 terminal is drawn on a canvas and scaled to fit the screen.
- Input:
  - hardware keyboard: arrow keys walk, Shift+arrow runs
  - on-screen keyboard
  - swipe to walk; a long swipe runs (replaced in Milestone 4 by drag to pan)
  - toolbar with Esc, Enter and a sticky Ctrl key
- Saves persist in the browser (IndexedDB), with export and import of a `.tome2save` backup.
- It works offline after the first load, through a service worker.
- CI builds the engine, runs unit and end-to-end tests at phone and tablet screen sizes, then deploys to GitHub Pages.

**Milestone 2 — Brogue-inspired presentation and mobile layout** ✅

The visual design takes inspiration from [Brogue: Community Edition](https://github.com/tmewett/BrogueCE). No Brogue code, colour tables or assets are used; Brogue CE is AGPL-3.0.

- **Lit map from engine state.** The dungeon is drawn from a snapshot of tome2's own lighting data, not from the terminal text:
  - warm torch light that falls off and flickers
  - light from lit rooms and from monsters that carry light
  - glowing lava and fire, blocked by walls
  - a dim, blue-tinted memory of remembered areas
  - shimmering water and lava
  - bolts and explosions that light up their surroundings
- **Brogue-style glyphs:** solid shaded walls, `·` floor, `≈` water and lava, `♣` trees, `"` grass, `▲` mountains. Classic ASCII is available in settings.
- **Camera:** follows the player, with pinch-zoom on touch screens and Ctrl+scroll on desktop.
- **Sidebar:**
  - Health, Mana and Sanity bars and status chips
  - visible creatures and items, nearest first, each with a health bar; tap one to highlight it on the map
  - laid out along the bottom in portrait and on the left in landscape
- **Messages:** fade as turns pass. Tap them for the full history, or tap *more ▸* to continue.
- **Translucent panels:** menus, inventory and other tome2 screens appear in a panel over the dimmed map, scaled to fit.
- **Opening screen:**
  - Flames ignite from the bottom with a flare, and embers drift upward.
  - The title "ToME" is a Brogue-style mosaic of stone cells, lit from below by the flame columns: crimson at the top, molten gold at the base, flickering with the fire.
  - The subtitle and the Ring verse fade in.
  - **Enter Middle-earth** sets off an eruption of flame, then steps automatically through tome2's module and news screens into character creation. There is also a link to play the Theme module.
  - The opening screen replaces the old loading splash and also shows download progress, errors and the end-of-game message.
- **Character creation:** a flame backdrop burns behind the screens, and the text is scaled to fit.
- **Display settings:**
  - animation: Full (20 fps), Reduced (8 fps) or Off; defaults to Off when the system's reduced-motion setting is on, and pauses in the background
  - glyph set
  - zoom

**Milestone 3 — touch play** ✅

- **Tap to travel:**
  - Tap a place on the map to walk there along a known path. Closed doors are opened on the way.
  - As in Brogue, travel stops when you arrive, when you're hurt, when a new creature appears, or when an awake hostile creature comes within two steps.
  - Tap again to stop.
- **Tap to target:**
  - At an aiming prompt, tap a creature or place.
  - The app drives tome2's own targeting: it cycles through targets, then falls back to moving a free cursor to the tapped cell.
- **Tap menus:** tap a line in any tome2 list (inventory, spells, shops, character creation) to choose it. Tap outside a panel to close it.
- **Context action bar:**
  - The buttons follow what the game is waiting for: Continue at *-more-*, Yes/No, Nearest target when aiming, or Escape in menus.
  - At the command prompt you get Items, Rest, Cast and Look, plus Pick up, Descend or Ascend when they apply.
  - **More** opens a sheet of every command.
  - Commands are sent with tome2's keymap bypass (`\`), so they also work with the roguelike keyset.
- **Autosave:** when the app is hidden or closed at the command prompt, the game saves itself (Ctrl+S) and flushes to browser storage.

**Milestone 4 — native mobile interface** ✅

The game now plays through a phone-first interface; tome2's 80×24 screens only appear where nothing better exists, and then as readable HTML.

- **One text size everywhere:** messages, panels, menus, sheets and character creation all scale from a single base size. *Settings → Text size* offers Small, Medium, Large and Extra large.
- **Opening screen:**
  - The flames are a smooth noise field that drifts slowly upwards (no per-frame randomness), with gentler embers.
  - It offers **Continue** for each saved hero (with tome2's summary, e.g. "Grodon, the Ent Warrior") and **New character**. Links: Settings, Saves (export/import), Theme module.
  - tome2's module and news screens are answered automatically. Its sliding intro is replaced by the same words rising from the flames in one piece.
- **Character creation:** race, race modifier, class, specialisation and god are tappable cards. Tapping one shows its description; tapping again (or *Choose*) confirms. *Random* and *Start over* are on the toolbar. Stats appear on a hero card with *Reroll* and *Accept*; routine questions (options, quests, minimum stats, name) are answered for you.
- **Native sheets** (bottom sheets on phones, centred cards on wider screens): tap outside or press Escape to close; one row is always highlighted, and arrow keys or swipes move it.
  - **Inventory and equipment:** tap an item for what you know about it and what you can do: eat, quaff, read, aim, wield, wear, take off, drop one or all, throw, inscribe, destroy. The app answers tome2's item, quantity and inscription prompts itself.
  - **Character:** tap your name or health bars for attributes, combat, progress, and links to skills, abilities and the full sheet.
  - **Creatures and items:** tap one in the list under the map for its health, recall text and actions (attack, approach, show on map).
  - **Game menu:** character, messages, save, settings, how to play, export/import, about, and **Save and quit**, which saves and returns to the title screen.
  - **Commands:** every command, grouped.
- **Map:**
  - **Drag** to look around without moving; your next move (or *Centre*) brings the view back.
  - **Press and hold**, or use **Look** and tap, to see what is there: "You see a Village idiot (awake, unhurt) on grass", with *About* and *Go there* / *Attack*.
  - **Level map** shows the whole level; tap a place to travel there.
- **tome2 screens** (spells, shops, skills, help, knowledge, options) are rendered as HTML text at the chosen size. Menu entries become tappable rows with a highlight; columns line up and wrap onto a second line on narrow screens; prose reflows; ASCII art keeps its shape.
- **Shops:** tap an item to buy it (with a quantity stepper) or examine it. The toolbar offers Leave, Sell and More.
- **Layout:** the HUD and toolbar extend into the safe areas, so nothing is cut off beside a notch or home indicator, in either orientation.

---

## Architecture

```
external/tome2/     tome2 engine (git submodule → darrencroton/tome2), unmodified
engine/main-web.cc  Web frontend: implements tome2's Frontend interface, bridges to JS
engine/snapshot.cc  Exports level, lighting, player, monster and message state to JS
CMakeLists.txt      Emscripten build: engine + deps → web/public/engine/tome.{js,wasm,data}
web/                Vite + TypeScript app (no framework)
  src/engine.ts       Loads the WASM module; key queue, save syncing
  src/terminal.ts     Terminal cell buffer
  src/render/         Lit map: snapshot reader, materials, lighting, cell appearance, flames
  src/hud.ts          Sidebar (bars, entities) and fading messages
  src/title.ts        Opening screen (flames, mosaic title, embers, Continue / New character, intro)
  src/flow/           Start-up and character creation driven behind native screens
  src/ui/             Sheets, list navigation, HTML rendering of tome2 screens, native views
  src/settings.ts     Settings (stored per browser)
  src/play/           Touch play: prompts, pathfinding, travel, targeting, actions, item macros
  src/input/          Keyboard and gesture handling
  src/saves.ts        Save export/import (.tome2save bundles)
tests/unit/         node:test unit tests
tests/e2e/          Playwright tests (phone portrait, phone landscape, tablet)
```

**Design decisions**

- **Engine unmodified:** tome2 is a submodule. Platform gaps are filled at link time with `--wrap` in `main-web.cc`, not by patching the engine:
  - `getpwuid` gives the game a home directory.
  - `nanosleep` becomes an asynchronous sleep, so projectile animations repaint.
- **Asyncify:**
  - The engine's blocking `inkey()` loop pauses at `process_event()` and resumes when a key arrives.
  - During long runs without input (resting, running), the engine yields to the browser every 50 ms.
  - This works on any static host. The alternative, Web Workers with `SharedArrayBuffer`, needs COOP/COEP headers, which GitHub Pages can't send.
- **Storage:**
  - Game data (`lib/`, about 4 MB) is preloaded read-only at `/lib`.
  - `~/.tome` (`/home/web_user/.tome`) is mounted on IDBFS.
  - It is flushed to IndexedDB shortly after the engine goes idle waiting for input, when the page is hidden, and on exit.
- **Presentation modes:**
  - Before a character exists, a director answers tome2's start-up screens and shows native character creation; any screen it does not recognise is shown as HTML text over the flames.
  - In the dungeon, the lit map replaces tome2's map view, with the sidebar and message area alongside.
  - When tome2 covers the screen with a menu, the cells that differ from the last map screen are parsed into text, menu choices and art, and shown as an HTML panel over the dimmed map.
- **Native views and macros:**
  - The engine exports the pack, equipment, floor items, character summary, item descriptions and monster recall as JSON (`engine/snapshot.cc`). Monster recall runs against an off-screen terminal so the visible screen is untouched.
  - Actions from native views are sent as short scripts (generators in `src/play/macro.ts`) that read each prompt tome2 shows and answer it: which list the item is in, the item letter, a quantity, an inscription.
- **Engine snapshot:**
  - JavaScript calls exported C++ functions while the engine is paused waiting for input, so the state it reads is always consistent.
  - The terrain, light flags, glyphs and colours for the whole level are copied out of WebAssembly memory once per frame, and only when something changed.
- **Dependencies:**
  - fmt, jsoncons and pcg are fetched by CMake at the versions upstream tome2 uses.
  - Boost headers come from Emscripten's `boost_headers` port (1.83).
  - Boost.Filesystem 1.83 is compiled from source, single-threaded.

---

## Building

### Prerequisites

- **Node.js 22+**
- **CMake 3.24+**
- **Emscripten SDK 6.0.13**: install it from <https://emscripten.org/docs/getting_started/downloads.html>, then load its environment in your shell:

  ```zsh
  source /path/to/emsdk/emsdk_env.sh
  ```

### Steps

```zsh
git clone --recurse-submodules https://github.com/darrencroton/tome2mobile.git
cd tome2mobile
npm ci

npm run engine:configure   # emcmake cmake -S . -B build
npm run engine:build       # → web/public/engine/

npm run dev                # http://localhost:5173 (also reachable from your phone on the LAN)
npm run build              # production build → dist/
npm run preview            # serve dist/ on http://localhost:4173
```

If you cloned without submodules, run `git submodule update --init`.

Add `?wizard` to the URL to start tome2 in wizard mode, so its debug commands (Ctrl+A) are available. The end-to-end tests use this to jump to dungeon levels.

### Tests

```zsh
npm test           # unit tests (node:test)
npm run typecheck  # TypeScript
npm run test:e2e   # Playwright; needs a production build (npm run build) and Chromium
```

The first run of `npx playwright install chromium` downloads the browser.

---

## Deployment

`.github/workflows/build-deploy.yml` builds and tests every push and pull request. Pushes to `main` are deployed to GitHub Pages.

One-off setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

---

## Saves

- **Where they live:** saves are stored in your browser for this site. Clearing site data, or uninstalling the home-screen app on some platforms, deletes them.
- **Backing up:**
  1. Save in-game with **☰ → Save game** (or Ctrl+S). The game also saves when you leave the app, and on **☰ → Save and quit**.
  2. Choose **☰ → Export saves** (or **Saves** on the title screen) to download a `.tome2save` backup.
  3. Use **Import saves** from either place to restore it on any device.

---

## Credits and licence

This port is based on **[tome2/tome2](https://github.com/tome2/tome2)**, via the [darrencroton/tome2](https://github.com/darrencroton/tome2) fork. Full credit to the original authors and contributors; see [`external/tome2/doc/credits.txt`](https://github.com/tome2/tome2/blob/master/doc/credits.txt).

The ToME source may be copied and distributed for educational, research and not-for-profit purposes, provided its copyright notices are retained (see the source file headers). This port is distributed free of charge on the same terms.
