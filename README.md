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
  - swipe to walk; a long swipe runs
  - toolbar with Esc, Enter and a sticky Ctrl key
- Saves persist in the browser (IndexedDB), with export and import of a `.tome2save` backup.
- It works offline after the first load, through a service worker.
- CI builds the engine, runs unit and end-to-end tests at phone and tablet screen sizes, then deploys to GitHub Pages.

**Milestone 2 — mobile UX** (next)

- Viewport that scrolls the map around the player, with pinch-zoom.
- Compact status and message panels, with portrait and landscape layouts.
- Tap to travel or target, plus a context action bar and menus for inventory and spells.
- Autosave when the app is sent to the background.

---

## Architecture

```
external/tome2/     tome2 engine (git submodule → darrencroton/tome2), unmodified
engine/main-web.cc  Web frontend: implements tome2's Frontend interface, bridges to JS
CMakeLists.txt      Emscripten build: engine + deps → web/public/engine/tome.{js,wasm,data}
web/                Vite + TypeScript app (no framework)
  src/engine.ts       Loads the WASM module; key queue, save syncing
  src/terminal.ts     Terminal cell buffer and canvas renderer
  src/input/          Keyboard and swipe translation to engine keycodes
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
  1. Save in-game with **Ctrl+S**.
  2. Choose **☰ → Export saves** to download a `.tome2save` backup.
  3. Use **☰ → Import saves** to restore it on any device.

---

## Credits and licence

This port is based on **[tome2/tome2](https://github.com/tome2/tome2)**, via the [darrencroton/tome2](https://github.com/darrencroton/tome2) fork. Full credit to the original authors and contributors; see [`external/tome2/doc/credits.txt`](https://github.com/tome2/tome2/blob/master/doc/credits.txt).

The ToME source may be copied and distributed for educational, research and not-for-profit purposes, provided its copyright notices are retained (see the source file headers). This port is distributed free of charge on the same terms.
