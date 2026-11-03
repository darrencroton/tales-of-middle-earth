# Repository-wide simplification review

Date: 3 November 2026. Revision reviewed: `dc9ffbf` (main). Read-only: no code was changed. Baseline verified on a fresh install: 317 unit tests pass, `npm run typecheck` is clean.

Outcome: every finding below was implemented on the branch this document is committed with, in the order of section 6, with two corrections found on the way: `ScoreEntry.gold` is read by the memorial card, so it stays (E4); and the main.ts extraction (M2) went further than the six candidates named, since those alone left the file at about 2,700 lines, to thirteen modules (heroes, abilities, the look card, More, the viewport and the quit macros joined them). Verification beyond the tests: the engine's JSON exports dumped on the same savefile with both builds are byte-identical except the fields dropped; every sound rendered with seeded randomness on both builds is unchanged within the offline renderer's run-to-run noise; the e2e suite passes on all three layouts. The sections below are left as the review was written.

## 1. Scope, method and coverage

Everything we own was reviewed: `web/src` (25,471 lines of TypeScript, 4,477 of CSS), `engine/` (3,559 lines of C++ glue), `tests/` (4,136 unit, 2,631 e2e) and the docs. The upstream engine in `external/tome2` is out of scope and was treated as a fixed boundary.

Method: a deterministic code-health pass (composition, exact 6-line duplicate detection, Lizard cyclomatic complexity, git churn) over the whole repository, followed by a full read of every file by six reviewers, one per subsystem (main.ts hub; pop-up UI layer and CSS; play assists, feel and HUD; engine bridge and I/O; audio; flow, render, help and tests). Every finding below cites file and line. Figures labelled *measured* come from the tools or a count in the code; figures labelled *estimated* are the reviewers' line-of-code estimates for a proposed change and should be treated as ±30%.

Coverage limits. Lizard's TypeScript parser mis-attributes complexity when a method has an object-literal return type: its two headline numbers (`director.ts` CCN 75, `map.ts cellCentre` CCN 42) are artefacts that swallowed the rest of the class. They were discarded after reading the code. There are no unit tests for the Web Audio layer (`sfx.ts`, `voices.ts`, `music.ts`, `ambience.ts`, `core.ts`), the canvas renderer or the C++ JSON exports; changes there are verified by the seeded `scripts/measure-sfx.mjs` render, screenshots, and a before/after diff of the engine JSON respectively.

## 2. Overall assessment

The codebase is in good shape. It is unusually well commented, the pure/impure split is disciplined (parsers, planners, cue derivation, chronicle and recents are pure and unit-tested; DOM and engine effects sit in thin shells), there is one pop-up anatomy (`ui/popup.ts`), one list-highlight mechanism (`ListNav`), one macro shape, one key encoder, and the engine bridge is clean (all 33 `web_*` exports are declared, wrapped and used; no unused wrappers; buffer sizes and JSON escaping in `snapshot.cc` are sound). The reviewers found more to leave alone than to change, and no finding changes a game mechanic.

The weaknesses are concentrated and structural rather than diffuse:

1. **`web/src/main.ts` is a god module** (measured: 3,637 lines, 84 module-level `let`s, 73 module-level `const`s, 178 functions, 93 revisions: the most-churned source file). It contains at least six cohesive sub-controllers (reader, shop and services, map memory and explore planning, travel/explore/targeting driver, conversation and attempt watching, game end and return to title) that communicate only through shared mutable module state. The cost shows up as *fragmented reset*: `returnToTitle` resets 45 variables by hand, `enterLevel` resets 11 with a different list, and hero memory is cleared in a third way in `refresh`'s tomb branch and a fourth in `onExit`. Two reviewers independently found real consequences of this (findings M1, P6, P7).
2. **Hand-rolled JSON writing in `engine/snapshot.cc`**: the same "ready" preamble seven times and a first-comma idiom about twenty times (measured), with three incompatible string writers across the five `.cc` files, one of which drops characters instead of escaping them.
3. **Small duplicated helpers across the UI layer**: a stat row builder written five times, a monster-recall renderer twice, three quantity steppers, a sheet header built twice, and the same BFS flood fill in two play modules.
4. **Test scaffolding duplication**: e2e journeys repeat save-and-quit, continue-as, travel-with-retries and find-feature sequences five times each; four unit tests hand-build full `LevelSnapshot` literals.

Nothing here is a reason to pause feature work. The main.ts decomposition is the one change that materially improves future development; the rest is tidying that can ride along with whatever feature next touches each file.

## 3. Findings by subsystem

Each entry: problem, proposal, why it helps, estimated lines added/removed, risk, tests. **Meaningful** marks a change that removes a mechanism or a class of bug; **cosmetic** marks one that only removes lines.

### 3.1 main.ts (hub)

**M1. Fragmented per-game and per-level state (meaningful, the most valuable change).** `main.ts:158-236` declares the state; `returnToTitle` (`main.ts:3158-3222`) resets 45 of the variables by hand; `enterLevel` (`main.ts:1215-1236`) resets 11; `refresh` (`main.ts:1410-1416`) and `onExit` (`main.ts:2677-2683`) each clear hero memory with their own shorter list. Measured gaps between the lists: `spellsCache`, `memoryPos`, `exploreSpotted` and `exploreNextCache` are reset on a level change but not on return to title or the reverse. Proposal: group the state into three plain objects made by factory functions, `newLevelState()` (explore skip, anchor, last stop, seen items, gold, spotted, next cache, approximate flag, memory turn/pos), `newHeroState()` (hero memory id and record, land memory, chronicle, streak, memorial, style cache, spells cache) and `newRunState()` (snapshot, state, place, shop, trade, service, conversation, attempt, lives flags, quitting/abandoning/ended). A level change becomes `level = newLevelState()`, return to title replaces all three. Why: one definition of what belongs to a level, a hero and a run; the "forgot to reset X" class of bug goes. Estimated −60 lines net (the reset lists become three assignments; the declarations move into the factories). Risk: medium, as every reference in main.ts changes name (`exploreSkip` → `level.skip`); the behaviour is unchanged if the factories contain exactly the current initial values. Tests: the whole e2e suite exercises these resets (game.spec save-and-quit-and-continue, memory.spec kept levels, play.spec explore anchor).

**M2. Extract the embedded sub-controllers (meaningful).** Candidates, with measured line ranges: reader and viewer (`main.ts:925-1103`, 7 state variables, ~180 lines), shop and services (`main.ts:1715-1893`, 5 variables, ~180 lines), map memory and explore plan (`main.ts:1169-1339`, ~170 lines), travel/explore/targeting driver (`main.ts:2201-2447`, ~250 lines), conversation and attempt (`main.ts:419-509`, ~90 lines), service-worker updates and backup (`main.ts:3453-3600`, ~150 lines). Each would be a class or module taking a small dependency object (engine, buffer, sheets, send, refuse, showToast) in the way `Director` and `CharacterPanel` already do. Why: main.ts drops from 3,637 to roughly 1,800 lines, each controller's state is private, and the `onIdle` ordering (`main.ts:2698-2797`) reads as a list of `x.idle()` calls. Estimated ±0 lines net (code moves; dependency objects add ~15 lines per module). Risk: medium; the order of calls in `onIdle` and `refresh` must be kept exactly, and the modules share `lastSnap`/`lastState`, which argues for doing M1 first and passing the state objects in. Tests: every e2e journey.

**M3. Repeated guards and strings (cosmetic).** `'Finish what you are doing first.'` appears six times (`main.ts:346,362,391,3418`, `ui/info.ts:53`, `ui/character.ts:159`); `depth === 0 && wild` (the world-map test) three times in main.ts and once each as `CommandContext.where`, `ActionContext.worldMap` and `CommandSituation.worldMap` in `play/actions.ts`; `dirty = true; requestFrame();` 15 times. One `NOT_NOW` constant, one `worldMap(snap)` predicate and one `redraw()` function. Estimated −20 lines. Risk: none. Tests: unit `play.test.ts` (actions), e2e.

**M4. Hero-forget sites (meaningful, small; subsumed by M1).** The tomb branch of `refresh` (`main.ts:1410-1416`), `onExit` for an abandoned run (`main.ts:2677-2683`) and `forgetAdventurer` (`main.ts:3382-3390`) each forget a hero with a different subset of stores. One `forgetHero(name)` that both call. Estimated −10 lines. Risk: low.

### 3.2 Pop-up UI layer (`web/src/ui`) and CSS

**U1. `stat()` row written five times (meaningful).** `ui/character.ts:13-17`, `ui/memorial.ts:39-43`, `ui/deeds.ts:154-158`, `ui/gameover.ts:103-107`, `ui/charsheet.ts:233-236` all build `div.stat > span.stat-label + span.stat-value`; `signed()` is duplicated at `character.ts:19-21` and `memorial.ts:45-47`, and `number()` at `memorial.ts:49-51` sits beside nine bare `toLocaleString('en-GB')` calls. Proposal: `stat`, `signed`, `count` in `ui/dom.ts`. Estimated +8/−30. Risk: none (same DOM). Tests: unit `ui.test.ts`, e2e play.spec character sheet, game.spec Hall of Fame.

**U2. Monster recall rendered twice (meaningful).** `ui/info.ts:76-93` and `ui/memorial.ts:128-143` are the same paragraph-splitting loop over coloured runs; `main.ts:1637` already converts the engine's shape to `MemorialLine`. Proposal: `recallParagraphs(lines, empty)` in `memorial.ts` and a shared `recallLines(engine, palette, id)`. Estimated +14/−30. Risk: the colour mapping is identical in both; check one screenshot. Tests: e2e play.spec creature card, game.spec Look back.

**U3. Item-card tails (meaningful; the code-health duplicate at `info.ts:139`, `inventory.ts:178`, `store.ts:322/381`).** `glyph(x.ch, api.palette()[x.attr] ?? '#fff')` appears seven times; description-with-fallback four times (`inventory.ts:168-171`, `info.ts:131-134`, `store.ts:266-271`, `memorial.ts:115-116`). Proposal: `itemGlyph(api, item)` and move `store.ts description()` to `ui/api.ts`. Do not add an `openItemCard` wrapper: the six card tails differ in subtitle and actions. Estimated +6/−18. Risk: none.

**U4. Three quantity steppers and two footer-relabel hacks (meaningful).** `ui/menus.ts:293-315`, `ui/store.ts:241-258`, `ui/promptcard.ts:280-293` are three steppers; `menus.ts:304-305` and `store.ts:261-264` both reach into `.sheet [data-action] .pop-label` to relabel the primary button. They also have two keyboard models (the shop's ± buttons carry `data-nav`, the quantity card handles ArrowLeft/Right in `onKey`). Proposal: one `stepper()` in `dom.ts`, one `relabelAction()` in `popup.ts`, one keyboard model (the quantity card's). Estimated +28/−55. Risk: shop-card keyboard behaviour changes if unified; AGENTS.md's one-rule-for-highlights argues for doing it. Tests: e2e play.spec drop-by-number, shops.spec quantities.

**U5. TermView rebuilds the sheet header by hand (meaningful).** `ui/termview.ts:378-406` and `ui/sheet.ts:75-89` build the same back/title/subtitle/badge/close header; the CSS carries `.tv-title ≡ .sheet-title` (five identical declarations, `styles.css:1255` vs `1669`), `.tv-titles ≡ .sheet-titles`, `.tv-subtitle ≈ .sheet-subtitle`. TermView already borrows `renderFooter` from `popup.ts`; the header is the odd one out. Proposal: `renderHeader()` in `popup.ts` used by both; drop the `tv-` double classes and rules. Estimated TS +20/−35, CSS −30. Risk: one alignment difference (`baseline` vs `center`) and two badge styles to reconcile; screenshot the three layouts. Tests: e2e `@layout` tome2-menus, shops.spec, visuals.spec.

**U6. Three keyboard entry points on TermView (meaningful, medium risk).** `termview.ts:348 navigate`, `:358 readKey`, `:371 handleKey` are chosen between in `main.ts:2971-3003`, and `main.ts:2088-2096 navigate()` repeats `handleKey`'s own guard. Proposal: one `TermView.handleKey(e)` that decides from its own state, plus `step(direction | 'select')` for the swipe path. Estimated −20. Risk: end-of-game Enter with nothing highlighted must still reach `finishGame()`. Tests: e2e tome2-menus, shops, Hall of Fame, knowledge/manual.

**U7. Cosmetic.** `TermViewTab` duplicates `PopTab` (`termview.ts:36-42`, mapped at `:226`): −10. `CharacterDeps.refuse` (`character.ts:52`) is wired to the same function as `api.refuse` which the panel already holds: −3. Four CSS list classes share one declaration block (`.menu-list | .soundtrack-list | .adventurer-list | .spell-list`, likewise `.soundtrack-text | .adventurer-text | .fame-main`, `.tv-empty | .fame-empty`, `.look-name | .tv-label | .item-name`): −25 CSS. Dead CSS (measured, referenced nowhere): `.gameover-date` (`styles.css:3638`), `.fame-details` (`:3698`), `.sheet.sheet-menu` (`:1637`): −10. `ui/info.ts:41` hand-computes the `--fill` that `dom.fraction()` exists for. The `gameover.ts:12` re-export of `fateText`/`fellWhere` exists only for one unit test.

### 3.3 Play assists, feel and HUD

**P1. BFS flood fill written twice (meaningful; the code-health duplicate at `explore.ts:72-92` / `travel.ts:182-215`).** `reach()` in `explore.ts:69-93` and the body of `approachTarget` in `travel.ts:182-215` are the same queue over `grid.passable`; the latter adds an on-dequeue check. Proposal: `floodFill(grid, start, visit?)` in `pathfinding.ts`, beside `findPath`. Estimated +24/−34. Risk: `exact` must still fire on dequeue of the start cell. Tests: unit `explore.test.ts:54-227`, `play.test.ts:246`.

**P2. Hurt/robbed/light-out watch kept in both `Travel` and `Explore` (meaningful; parallel mechanism).** `travel.ts:396-398, 445-447, 487-489` and `explore.ts:168-170, 213-218` hold the same three fields and checks (verified). Inside an `Explore` the inner `Travel`'s copies can never fire, since `Explore` checks first. Proposal: a small `Watch` used by both. Estimated +14/−18. Tests: unit `play.test.ts:269-335`, `explore.test.ts:163, 256`.

**P3. Exit direction and "why nothing is left" reasoned twice (meaningful).** `explore.ts:187` and `main.ts:1345` both compute `(heading === 'up') !== !!stop.back`; `explore.ts:200-204 whyNothingLeft` and `main.ts:1339-1341` both call `nextStop` twice. Proposal: `nextStop` returns `heading` on an exit stop; export `exploreOutcome()` used by `Explore.step` and `exploreNextFrom`. Estimated −8. Risk: `__tome.exploreStop().heading` (read by memory.spec) must keep returning the plan's heading.

**P4. Three JSON file stores (meaningful; the code-health duplicate at `mapmemory.ts:152` / `deeds.ts:62` / `adventurers.ts:110`).** `MapMemoryStore`, `AdventurerStore` and `ChronicleStore` each repeat `load(fs, root)` and `save()` with the same decode/parse/sanitise/catch shape. Proposal: `JsonFile<T>` in `saves.ts`; each store keeps its own sanitiser. Estimated +20/−30. Tests: unit `deeds.test.ts`; e2e memory.spec for the other two.

**P5. Known-cell predicate ×5 and other one-line predicates (cosmetic but "one definition").** `(info[i] & (CAVE_MARK | CAVE_SEEN)) !== 0` at `explore.ts:44, 149`, `travel.ts:111, 243`, `render/appearance.ts:80`; Chebyshev distance inline eleven times across play, ui, main and audio; the filler-line regex `/[^\s=\-_~*]/` three times; `wild ? 0 : depth * 50` three times and `depth * 50` three more; article stripping (`^(a|an|the|some)` and a space) four times (and `travel.ts:14` imports `titleName` from `ui/api.ts`, a play→ui dependency a shared text helper would remove); `memorialKey` and `entryKey` both build `name@turn`. Estimated −25 across the set.

**P6. `feel.reset()` is incomplete (bug, verified).** `feel.ts:206-215` clears banners but not `deeds`, `deedTimer` or the visible deed card (`feel.ts:129-131`), so a deed card queued at the end of one game can show at the start of the next after Return to title. +3 lines.

**P7. Per-level explore state belongs in `play/explore.ts` (meaningful; the play half of M1).** The nine explore variables at `main.ts:166-195` are reset with different lists in `enterLevel` and `returnToTitle`. A `LevelExploration` holder in `explore.ts` with the `ANCHOR_DRIFT` resume rule (`main.ts:2352`) is where M1's `newLevelState()` should live.

**P8. Cosmetic.** `'closest'` in `TravelStopReason` (`travel.ts:38`) is never returned; `actions.ts:465-467` dims `HERO_ACTS` by hand while `commandRefusal` is the rule elsewhere; `macro.ts:61` re-exports `keyCodes`, imported from there by three files while AGENTS.md names `input/keys.ts` as the only encoder.

### 3.4 Engine bridge (`engine/*.cc`, `engine.ts`, `terminal.ts`, I/O)

**E1. Hand-rolled JSON writing in `snapshot.cc` (meaningful).** Measured: the "ready" preamble (`json.clear(); json += '{'; if (!level_ready()) {...}`) seven times (`snapshot.cc:882, 1132, 1423, 1514, 1839, 1980, 2071`); the first-comma idiom about twenty times in two spellings; 38 `json_int(..., false)` "last field" flags that exist only to serve the trailing-comma convention; and a `json.pop_back(); json += ','` splice at `:1173-1174` to add a field to an object already closed. Proposal: a ~45-line `engine/json.hpp` writer with object/array scopes that emit the comma before each member after the first, plus `begin_ready()`. Why: removes the comma parameter, every `first` flag and the splice; removes a class of malformed-JSON bugs. Estimated −85 to −100 net. Risk: medium, as it touches every export and there are no output tests; mitigate with a Playwright script that dumps each `__tome.engine.*()` JSON before and after and diffs them. Tests afterwards: e2e shops (store), game (scores, Halls of Waiting), memory (kept levels), play (skills, abilities, magic), visuals (birth).

**E2. Three incompatible string writers (meaningful, small).** `adventure.cc:396-404 json_text` *drops* `"`, `\` and controls instead of escaping (verified); `runoptions.cc:106-126` builds its object from string literals with no escaping; `snapshot.cc:188 json_string` escapes properly. Share the header from E1. Estimated −16. Risk: low (today's names are fixed ASCII).

**E3. Dead tracking in `TerminalBuffer` (meaningful, hot path).** `terminal.ts` maintains `bounds`/`extendBounds`/`contentBounds` and `dirty`/`markAllDirty`/`takeDirtyRows` on every `drawText`, `setCursor` and `setColour`, but no app code reads them (measured: only `hud.test.ts` and `terminal.test.ts`). Estimated −30 in `terminal.ts`, −15 in tests. Risk: none.

**E4. Dead JSON fields (meaningful, small).** Emitted and typed but read only by test fixtures (measured): `terrainIdx` (`snapshot.cc:1477-1491`, `audio/places.ts:27`), `MonsterState.ridx` and `ego` (`snapshot.cc:975-976`), `CharacterState.maxExp` (`:1548`), `ScoreEntry.gold` (`:1653`). Estimated −14. Check `ego` is not wanted for a future recall first.

**E5. Small repeats (cosmetic).** `web_store_object_desc` (`snapshot.cc:1242-1250`) repeats `store_here()` (`:620-629`) line for line: −7. `stat_names[6]` defined twice (`:1525`, `:2083`). Thráin's-level test twice in `memory.cc:54-55, 130-131`. `engine.ts` repeats `const mod = this.module; if (!mod || this.state !== 'running') return` nineteen times: a private `running()` getter, −19; `gameState()` and `features()` parse JSON without the try/catch `callJson` gives everything else. `gestures.ts:116 TAP_MAX_MS * 2` with `TAP_MAX_MS = 450` is one stale number. Orphaned comment at `snapshot.cc:749-751`.

**E6. Robustness (no bug today).** `adventure.cc:246-248` ignores `town_area`'s return, leaving `x`/`y` uninitialised if `haven()` were 0 (unreachable now: `ask()` only returns SAFETY when `!safety_closed()`); one early return. `snapshot.cc:1067-1068` indexes `st_info`/`d_info` by `c_ptr->special` unchecked, as tome2's own look does; two lines.

### 3.5 Audio

**A1. `sfx.ts dispatch` (meaningful, provably identical).** The CCN 80 function (`sfx.ts:167-317`) is a flat switch of 73 cases, 58 of which call one named method; the sound building already lives in ~60 small methods on nine primitives, so a data-recipe format would be an interpreter larger than what it replaced. Proposal: a `Record<CueId, (cue, t, s, far) => void>` table with the same calls. Why: identical output, and TypeScript then enforces that every `CueId` has a sound (today a new id with no case compiles and plays nothing). Estimated +75/−150. Risk: none to sound. Verification: the seeded `measure-sfx.mjs` render before and after.

**A2. Shared `filter`/`osc`/`gain` builders (meaningful, modest).** `createBiquadFilter` + type/frequency/Q hand-written seven times in `sfx.ts` and four in `ambience.ts` while `voices.ts:33-56` already has `filter()`/`osc()`/`gain()` and `core.ts:164-171` a private `biquad()`. Export from `core.ts`. Identical output (the clamps and defaults cover every value used). Do not merge `sfx.noise` with `voices.noiseBurst` or `ambience.tone` with `sfx.tone`: their stop multipliers differ. Estimated +5/−48.

**A3. Dead code (verified).** `GameAudio.play`'s `counts` map (`audio.ts:415-420`) can never reach two: `now` is fixed within one call, so the repeat guard (`now - last < 0.05`) rejects a same-id cue first. `Layer.below` (`themes.ts:50-51`, `composer.ts:214`) is set by no theme; `SectionKind 'outro'` is handled in three places and never emitted; `heartbeat` bypasses `play()` so it never shows in `status.recent`. Estimated −15.

**A4. Leave alone.** `themes.ts`'s repeated blocks are leitmotif headers of deliberately different themes; sharing them would hide the voicing the owner tunes by ear. `playerCues` branching is real. `messageCues` as a table saves no lines. Node lifetimes, timers and double-start guards were checked and are sound.

### 3.6 Flow, title, render and help

**F1. `director.ts` has two "answer once" mechanisms (meaningful, small).** `director.ts:369-371` guards with a boolean `nameSent`; `:408-412` with a screen-keyed `lastAuto`. One `answerOnce(key, keys)`; −6/+3. `anew` duplicates `template` (`startCreating` does not clear it): derive one from the other, −4. `showHero.field()` (`:711-717`) re-implements `parseBirthChoice`'s header parse (`birth.ts:85-89`): export `parseHeader`, −8/+5. The screen-matching if/else chains should stay: each branch has a different side effect and their order is the priority order.

**F2. `title.ts` shares a 10-line prologue between `reset()` and `showEnd()` (`title.ts:348-358`, `370-381`; the code-health duplicate).** Extract `reappear()`: −8. Two button builders (`:220-237`, `:384-392`): −9. The title is rightly not a `Sheets` pop-up.

**F3. `render/map.ts` draws corner brackets twice (meaningful; the 13-line duplicate at `:349-359` / `:397-407`, verified byte-identical).** A `corners(left, top, w, h, arm)` method: −22/+10, same path commands. The camera clamp formula appears at `:168-173` and `:439-443`: −6. `MapRenderer.render` (`:230-418`) is one 190-line function; splitting into cells and overlays is readability only, ±0.

**F4. Help data.** `help/topics.ts` is prose and already derives what is derivable. Three places will drift from code (the toolbar topic names every `play/actions.ts` label, the settings topic each `ui/menus.ts` section, the dungeons topic hand-copies depths). Deriving them would lose the hand-written explanations; the cheapest guard is a six-line assertion in `help.test.ts` that every term in the toolbar topic is a label `contextActions`/`commandGroups` can produce.

### 3.7 Tests

**T1. e2e helpers that belong in `helpers.ts` (meaningful).** Measured copies across specs: save-and-quit five (game.spec 50-53, 494-498, 528-534; play.spec 803-807; memory.spec 231-235); continue-as three; travel-to-cell-with-retries three (memory 114-122, 202-210, play 737-745; the code-health duplicate); find-feature-by-name four; quit-from-keyboard and walk-to-Finish two plus three follow-up loops (game 277-281, 457-461; the other duplicate). Inside `helpers.ts`, `jumpToLevel` (222-229) and `wizardCommand` (262-269) share the debug-menu loop, and play.spec 274-282 inlines it a third time; three specs send `'\u0001z'` raw while others call `wizardCommand(page, 'z')`. Estimated −110 spec lines, +45 in helpers. Risk: none; run the full suite once.

**T2. Unit fixtures (meaningful).** Four hand-built `LevelSnapshot` literals (`play.test.ts:91-111`, `render.test.ts:31-60`, `explore.test.ts:26-46`, `info.test.ts`), four `monster()` builders, three `TermRow` builders, two in-memory FS stubs. A `tests/unit/fixtures.ts` ends the "add a field, edit three tests" tax. Estimated +35/−85.

**T3. A test re-implementing production code.** `hud.test.ts:90-100` spells out the expected sanitised settings object field by field; it should be `{ ...defaultSettings(false), zoom: MAX_ZOOM }`. −9. The `audio.test.ts:24` / `audio.ts:8` duplicate is only a shared import list.

**T4. Heroes created needlessly (AGENTS.md "journeys").** memory.spec creates six heroes for five tests and play.spec eleven. Clear merges: memory "Homebody" into "Keeper", memory "Rescuer" into "Warden", play "Tapper" into "Packer"; each saves one character creation per project. "Wanderer" rightly stays separate (own settings). play.spec and memory.spec both name a hero "Rescuer".

**T5. Over-testing is minor.** `play.test.ts:455-474` asserts exact id arrays for six modes that five later tests cover from other angles; −8. No mocking beyond the two FS stubs.

### 3.8 Exports and docs

Measured with a script over `web/src` and `tests`: 129 symbols carry `export` but are referenced only within their own file (mostly types; 25 constants and functions), and 64 production exports exist only for a unit test (legitimate, but `gameover.ts:12` is a re-export solely for one test). One symbol is referenced nowhere at all: `FB_PERMANENT` (`render/materials.ts:8`). Dropping the stale `export` keywords is cosmetic but matches AGENTS.md's "nothing stale". The backticked identifiers in `AGENTS.md`, `README.md` and `docs/ui-system.md` all resolve to code or to tome2/DCSS names; the docs are not stale.

## 4. Bugs and functional gaps discovered

Verified in code during the review; none is a crash.

1. **Sheet scroll kept across a tab change** (`ui/sheet.ts:303-306`). `update()` drops the highlight mark when the view differs but saves and restores `scrollTop` unconditionally. `CharacterPanel.select` uses `update`, so Summary → Skills → Summary reopens Summary at the Skills scroll offset, while Inventory/Magic/Fallen tabs go through `replace` and start at the top. One line: `frame.body.scrollTop = sameView ? scroll : 0`.
2. **Deed card leaks into the next game** (`feel.ts:206-215`, P6). `reset()` leaves the deed queue, its timer and the visible card.
3. **TermView footer cache ignores `icon`** (`termview.ts:227`): a toolbar slot whose icon alone changes is not redrawn in a tome2 panel's footer. Key on the action minus `run`.
4. **Reset lists disagree** (M1): `spellsCache` is not cleared on return to title (a hero begun anew at the same turn and skill points as the last could read the last hero's spell list for one refresh); `exploreNextCache` is cleared on a level change but not on return to title.
5. **Lossy JSON text in `adventure.cc:396-404`** (E2): characters are dropped, not escaped. Harmless for today's town names; wrong by construction.
6. **Dead repeat counter in `audio.ts:415-420`** (A3): the apparent intent of up to two of a cue per refresh never happens; the no-sound-change fix is to delete it.
7. **Uninitialised read guarded only by a caller** (`adventure.cc:246-248`, E6).

## 5. Size and complexity estimates

All estimates; the measured baseline is 35,797 lines across `web/src`, `engine` and `tests` (25,471 TS, 4,477 CSS, 3,559 C++, 6,767 tests).

| Area | Net lines (estimate) | Kind |
|---|---|---|
| main.ts state objects and hero-forget (M1, M3, M4) | −90 | meaningful: one reset path |
| main.ts sub-controller extraction (M2) | ±0 (moves ~1,000 lines out) | meaningful: private state, readable idle loop |
| UI helpers, header, steppers, keyboard (U1–U7) | −150 TS, −65 CSS | meaningful: U1–U6; cosmetic: U7 |
| Play walkers, watch, outcome, stores, predicates (P1–P5, P8) | −95 | meaningful: P1–P4 |
| Engine JSON writer and dead fields (E1–E5) | −160 C++/TS | meaningful: E1–E4 |
| Audio dispatch table, builders, dead code (A1–A3) | −130 | meaningful: A1 (exhaustiveness), A2 |
| Flow, title, render (F1–F3) | −60 | small, safe |
| Tests (T1–T5) | −130 | meaningful: ends scaffold drift |
| Stale `export` keywords, dead CSS | −10 (plus ~125 keywords) | cosmetic |
| **Total** | **about −850 net (2.4%)** | |

The honest reading: line count falls by a little over two percent. The meaningful reduction is in *mechanisms*, not lines: one reset path instead of four, one flood fill, one hurt-watch, one JSON writer, one stat row, one stepper, one sheet header, one TermView key handler, one dispatch table that the compiler checks, and e2e journeys built from shared steps. Those are what stop special cases accumulating.

## 6. Recommended implementation order

Grouped so each step is one PR that follows the usual workflow (unit tests and typecheck as you go, real-game verification on the three layouts, a fresh-eyes review, then the PR).

1. **Safe fixes and dead code** (one PR, low risk, −150): bugs 1, 2, 3, 6, 7; E3, E4, E5; A3; U7's dead CSS; `FB_PERMANENT`; stale `export`s; F1, F2, F3. Nothing here changes behaviour the player can see except the two bug fixes.
2. **Test scaffolding** (T1–T5): makes every later PR cheaper to verify; run the full e2e suite once.
3. **Shared UI helpers** (U1, U2, U3, U5): screenshot the three layouts; these touch most views.
4. **Play consolidation** (P1–P5, P8): pure modules with good unit coverage; low risk.
5. **main.ts state objects** (M1, M4, P7): the highest-value structural change; do before M2 so the extracted modules receive state objects rather than a dozen variables.
6. **main.ts extraction** (M2): one controller per PR (reader, shop, travel driver, memory, conversation, updates), each verified by the e2e journeys that reach it.
7. **Engine JSON writer** (E1, E2): one PR with the before/after JSON diff script in the description.
8. **Audio** (A1, A2): one PR with the seeded render diff.
9. **Steppers and TermView keys** (U4, U6): last, since they change keyboard behaviour slightly and want the e2e menu, shop and reader tests on all three projects.

Out of bounds for a simplification pass, noted for the owner: unifying the shop stepper's keyboard model with the quantity card's (U4) and consolidating the three TermView key entry points (U6) change which key does what in two places; both are improvements under AGENTS.md's one-highlight rule but are behaviour changes and need a decision.
