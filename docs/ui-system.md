# UI system: pop-ups, menus and navigation

How every menu, sheet, panel and question in the game is organised, why, and
how to add new ones. `AGENTS.md` has the short version; this is the full
record, including the audit it came from.

## 1. Inventory and navigation map

Everything the player can open, by where it is reached from. Depth counts
taps from the map. **Type** refers to the taxonomy in section 3.

```
Map (toolbar, HUD, gestures)
├── Toolbar (≤ 7 buttons: one changing button first — Walk here, Descend/Ascend/Enter rift, Enter shop/home,
│   Attack, Talk, Pick up, Drink, Wield/Light/Eat, Explore/Way down/Way up/World map — then the hero's
│   own buttons in fixed places: quick spell or aimed item, Cast/Powers, Fire, Items, Rest, More,
│   Menu; while exploring: Stop, Speed, Menu)
│   ├── Items ─────────────── Inventory            panel, tabs Pack · Equipment · Floor     depth 1
│   │                         └── Item              card over Inventory (actions)            depth 2
│   │                             ├── How many?     card over Item (Drop, Destroy)           depth 3
│   │                             └── Inscribe      card at the top (text field)             depth 3
│   ├── Cast / Powers ─────── Magic                panel: Recent, books, Powers, Skills     depth 1
│   │                         └── Spell             card over Magic (Cast)                   depth 2
│   ├── More ──────────────── Commands             panel: commands by intent (section 7)   depth 1
│   │   ├── Look ──────────── look mode: banner + look card on the map (each creature and item → its card)
│   │   ├── Magic & powers ── Magic, in the same frame (Back returns to Commands)
│   │   ├── item commands (Drink potion, Read scroll…) → tome2 item prompt (TermView panel, tabs)
│   │   ├── Talk, Give, Steal, doors → direction card on the map (Give then asks which item)
│   │   └── Game options ──── tome2 screen; Commands reopens after
│   └── Menu ──────────────── Menu                 menu                                     depth 1
│       ├── Character ─────── Character            panel, tabs Summary · Skills · Abilities · Full sheet
│       │                     └── Save skill points? card over Character (Discard · Save)
│       ├── Messages ──────── Messages             panel (log, newest at the foot)
│       ├── Knowledge ─────── Knowledge            menu                                     depth 2
│       │                     └── list ─────────── reader (TermView panel); Knowledge reopens after
│       ├── Save game (toast)
│       ├── Save and quit ─── confirmation         card
│       ├── Settings ──────── Settings             panel                                    depth 2
│       ├── Settings ──────── (in a game: Your adventure, the rules fixed at birth, read-only)
│       ├── Help ──────────── Help                 panel: search, topics by group           depth 2
│       │                     ├── topic ────────── panel (See also → topic, ‹ returns)       depth 3
│       │                     │   └── race/class ─ card                                      depth 4
│       │                     └── ToME manual ──── reader (TermView panel); Help reopens after
│       ├── About                                  panel (prose)
│       └── Abandon adventure ─ confirmation       card (red), set apart at the foot
├── HUD (one height always: the strip of ailments and chips keeps its place when empty)
│   ├── hero name ─────────── Character (or Fallen hero after death)
│   ├── quest chip ────────── Quest                card (what the level's quest asks, how many are slain);
│   │                         while it lasts the map's edges glow violet and its foes' chips are marked ⚑
│   ├── creature / item chip ─ Creature / Item     card (a creature beside you, not hostile: Talk · Give)
│   └── message log ───────── Messages             panel
├── Map tap / long-press ───── travel (a neutral creature beside you: talk) / look card (terrain; each creature and item there → its card)
├── A quest begun or ended ─── quest card (the scene tome2 told, then what it asks) or its banner
└── tome2 asks something ───── question card on the map (yes/no, how many, text, direction,
                               aim, lettered choice, message box) or a TermView panel
                               (item prompts, spell lists, shops, options, other menus),
                               led by what tome2 said since it last waited for a command

Shop, home, museum (walk in, or Enter shop on the door)
                ─────────────── native panel: one scrolling list a tab — Buy · Sell · Exit (home: Stored ·
                                Inventory · Exit; museum: Collection · Donate · Exit); services and their cost head the shelf
                                ├── Shelf item      card over the shop (description, how many, Buy/Take)
                                └── Item carried    card over the shop (what it fetches or why not, how many,
                                                    Sell/Store/Donate; wear, take off, inscribe, destroy)
Other buildings ─────────────── native panel: their services as rows · Exit
                                └── A service ───── its answer as a card (a quest, a rumour, the race legends);
                                                    a service that opens a file opens the reader
Death ──────────────────────── death card → end-of-game summary (full screen) → Hall of Fame (full screen)
                                └── a hero ──────── card: how it ended, when, deepest, score; Begin anew · Look back
                                    └── Fallen hero panel, tabs Hero · Gear · Skills · Last moments
                                        └── Item / foe  card
Title ──────────────────────── Continue as (last hero, straight into the game) · Game Roster · New character
                                ├── Game Roster ─── panel, every saved hero
                                │   └── a hero ──── card: where, last played, tale; Play · Delete (→ confirmation)
                                Help (panel) · Settings (panel) · Backup (menu: Export · Import game data)
                                · Soundtrack (panel) · Hall of Fame (panel → a hero: card as after death,
                                  with Remove (→ confirmation))
Character creation ─────────── director screens (full screen, Back/Random/Choose), name card;
                               Ready to begin: the hero, then Your adventure (random quests, birth options)
```

## 2. Audit findings (before this redesign)

| Where | Problem |
|---|---|
| Knowledge lists, help, notes (tome2's file viewer) | Read a screenful at a time: Done · Back · Page up · Page down filled the footer; no natural scrolling. |
| Help | Only the lettered links could be tapped; the dozens of links inside the text (the whole alphabetical index) needed a keyboard (6/4/Enter). Escape in a lettered help file only went back one file. |
| Item, spell, creature, shop item, memorial item/foe | Two lines of text in a pop-up the full pop-up height (owner screenshots: Leather Gloves, Ent's Potion). |
| Item from Inventory, spell from Magic | The detail replaced its list in the same frame: the list vanished, and ✕ on the detail closed the list too. |
| Questions over a detail (How many?, Inscribe) | Same: the question replaced the item it was about. |
| Menu, Knowledge, Saved games | Short lists of places stretched to the full pop-up height. |
| In-game Menu | Export saves and Import saves as two top-level rows, while the title screen groups them under Saved games. |

What already worked and was kept: one pop-up anatomy (`ui/popup.ts`), tabs fixed at the foot,
stacked sheets with Back keeping highlight and scroll, tome2 screens reopening the sheets they
covered, the TermView modernisation of tome2 menus, the map's question cards.

## 3. Taxonomy

Every interface is one of these. Pick by what the player is doing, not by
where the code comes from.

| Type | Purpose | Examples | Size | Where |
|---|---|---|---|---|
| **Panel** | A screen of its own: a list to work through, several views, or long reading | Inventory, Character, Magic, Commands, Messages, Settings, Soundtrack, Hall of Fame, Fallen hero, Help and its topics; every tome2 panel (item prompts, spell lists, shops, options, the reader) | fixed: `--popup-height` | bottom sheet (centred on wide screens) |
| **Menu** | A short list of places to go | Menu, Knowledge, Backup | its rows, capped at `--popup-height` | bottom sheet |
| **Card** | Details of one thing, or a question | Item, spell, creature, shop item, memorial item/foe, a saved hero (Game Roster), a hero of the Hall of Fame, How many?, Inscribe, confirmations, messages, tome2 message boxes over a sheet | its content, capped (shorter than a panel beneath it) | floats above whatever opened it |
| **Map card** | A question or note that leaves the map usable | tome2 questions (yes/no, direction, aim…), look card (what is at a cell, each creature and item a row opening its card), death card | its content | bottom of the map, no backdrop |
| **Full screen** | A screen that replaces the game | title, character creation, end of game, Hall of Fame after death | whole screen | — |

A map card or tome2 panel shown while tome2 is not at its command prompt (or a
building's) starts with what tome2 said since it last was (`leadMessages` in
`main.ts`, the last six, shown by `leadIn`): a rescued princess's words above
her reward, the adventurer's above *join you?*. With messages flowing past, that
is what its `-more-` would have made the player read first (with *Pause*, it
has, so there is none). A question the player asked for has nothing before it.
A map card with a lead-in takes the message log's place while it shows.

Map cards and full screens predate this work and already behave consistently;
the rules below are about panels, menus and cards (`ui/sheet.ts` `SheetKind`,
and `ui/termview.ts` for tome2 panels).

## 4. Templates

### Shared anatomy (`ui/popup.ts`)

Header: ‹ Back (only when there is somewhere to go back to in the same frame) ·
badge glyph · title and subtitle · ✕. Body: the only part that scrolls. Footer:
with tabs, a fixed row of tabs at the very bottom and the current view's
actions just above them, smaller; without tabs, the actions are the bottom row.
No key hints anywhere.

### Panel

- Always `--popup-height` (or the screen, if shorter), so switching tabs or
  pages never moves the tabs or buttons.
- A panel or menu opened from a panel takes its place in the same frame;
  ‹ returns with the previous highlight and scroll.
- tome2 panels follow the same anatomy (`TermView`), with the toolbar's
  actions for the screen in the footer (`panelActions`).

### Menu

- As tall as its rows. A menu opened from a menu (Menu → Knowledge) takes its
  place, with ‹.
- Rows are grouped by kind; a destructive row (red) comes last, set apart by a
  gap.

### Card

- As tall as its content up to `--popup-height`; over a panel, at least 4rem
  shorter, so the panel's heading stays in view above it.
- Floats with rounded corners clear of the screen edges, in a frame of its own
  above whatever opened it, which stays visible (less dimmed) beneath.
- Actions in a grid at the foot; the likely one is primary. Destructive ones
  are red. No tabs.
- A quest's first arrival and its end are told in a card over the map
  (title, the scene tome2 told in the lead-in style, then what the quest
  asks), once tome2 waits for a command with nothing else open.
- A card's ✕, a tap outside it, Escape or a swipe down on its header close
  **the card only**, returning to what is beneath.
- Anything opened from a card (a question about the item) floats above it in
  turn.

### Reader (tome2 file viewer → panel)

- tome2 shows files (knowledge lists, help, notes, command help) 20 lines at a
  time. `ui/filepages.ts` gathers every page as tome2 shows it (one Space per
  idle, read at once, so the player only ever sees the whole file) and the
  panel shows the whole file as one scrolling list (`renderViewer` in
  `main.ts`).
- A file opened part-way down (a help link to an anchor) opens scrolled there.
- Help links are tappable wherever they are: lettered links as rows, links
  inside the text as inline links. The help file itself is read from the
  game's files and parsed as tome2 parses it (`parseHelpFile`), so every link
  has its exact place and its place in tome2's order (link names with two
  spaces, links side by side, and orange text that is not a link are all
  handled). A link to another place in the same file (the index's letters,
  the command list) just scrolls there; any other asks tome2 to show the
  link's line (`#` *line*), steps tome2's link cursor onto it and opens it.
- ‹ in the header returns to the help file that linked here, scrolled where it
  was left; ✕ (or Escape, or Done) leaves help altogether, however many files
  are open.
- No footer: nothing to page.

### Highlight, default action and what cannot be done

Four things look different and never stand for each other:

| State | Looks | Rule |
|---|---|---|
| Highlight | gold outline | Arrows, swipes and Enter act on it. First: the item a view marks current (tome2's cursor), else a pop-up's first usable row, else the footer's default action, else the tab of the view shown (`defaultItem`). A list rebuilt in place keeps it on the same row, or the row now in its place (`ListNav.mark`/`find`). |
| Default action | gold fill | The action marked primary, or else the only one that can be done unless destructive (`defaultAction`): a building's lone Exit, a card's lone OK. |
| Selected tab | gold fill in the tab row | Which view shows; never an action. |
| Cannot be done now | dimmed in place | `PopAction.unavailable`: never the default, still tappable, and says why (a toast and the deny sound, as the toolbar does). Rows that cannot be used now (a shop item too dear, a service not for you) are dimmed and still open their card. |

## 5. Navigation rules

| Gesture | Effect |
|---|---|
| ‹ (header) | Previous sheet in the same frame, highlight and scroll as left. |
| ✕ (header) | Closes the frame it is on: a card returns to what is beneath; a panel or menu returns to the map (or the title). |
| Tap outside | Same as ✕ for the topmost frame. |
| Swipe down on the header | Same as ✕. |
| Escape | One step back: the previous sheet in the frame, or closes a card. |
| Backspace | Back, when the frame has a previous sheet. |
| Arrows / swipes | Move the highlight; Enter / tap chooses. Long lists scroll naturally. |

- **Context is kept.** Sheets covered by a tome2 screen (a reading command,
  `api.command`, an item action that only shows something) reopen when it
  closes, with their highlight and scroll.
- **Turns.** An action that spends a game turn (use, wear, drop, cast, buy)
  closes the pop-ups and shows the map, so its result is seen; anything that
  only shows information keeps the player where they were. Destroying asks
  how many first and is red.
- **Stable controls.** Tabs and actions never move while a pop-up is open: a
  panel's size is fixed; a card's size is set by its content when it opens.

## 6. Journeys

| Journey | Before | Now |
|---|---|---|
| Items → item → look → back | Item replaced the list; ✕ closed both | Item card floats over the list; ✕ / tap outside returns to the list at the same row |
| Items → item → Drop → how many → Drop | Each step replaced the last | Question floats over the item over the list; Drop closes all and shows the map |
| Menu → Knowledge → Unique creatures → back | Paged list, Page down × 6, Done | One scrolling list (119 rows); ✕ returns to Knowledge with Unique creatures highlighted |
| Help | tome2's 80×24 help files under More, How to play under Menu; none on the title | One Help (Menu, title): search or browse our own topics; ‹ returns with the search kept; the original manual from Help, which reopens after |
| Cast → spell ⓘ → Cast | Spell description filled the pop-up | Spell card over Magic; Cast casts, ✕ returns to Magic |
| Map → creature chip → close | Tall pop-up | Card the size of the recall |
| Menu → Saved games → Export | Two rows in Menu | On the title only, as Backup → Export game data: a backup of everything, not a way to save |
| Shop → item | Paged tome2 list; a tap on an item could buy it, and a tap on a row of tome2's item prompt opened the wrong card (*Take 1* while storing) | Whole stock in one list; a tap opens the item's card; Buy (or Sell, Store, Take) with how many is the only way to trade |
| Character → Skills → Raise → keep the points | Points were kept only by closing the sheet or changing tab, which then asked tome2's question; Raise looked available with no points | Raise and Lower are dimmed when tome2 would refuse, saying why; unsaved points show on their rows; Save asks (Discard · Save) and stays on Skills |
| Shop → sell several things in turn | Each sale took the list back to the top | The list stays where it was, the highlight on the item (or the next, when it is gone) |
| Long-press a remembered item | Only the terrain (items were known only while in view) | The terrain, then each item noticed there, in view or remembered, as a row opening its card |
| Thieves' Hideout | The quest's title in a banner; the blow, the cell and the theft only in the log | A card with the scene, then the task; its end told the same way |
| Title with many heroes | A Continue row per hero | Continue as the last hero goes straight into the game; every hero in the Game Roster panel, each a card with Play and Delete |

## 7. Command coverage

Every command of tome2's dispatcher (`process_command` in `dungeon.cc`, the
original keyset) and where a player reaches it. The More sheet groups what is
left by what the player means to do. It leaves out what the hero cannot ever
do (Pray without a god, Engrave without runes, Steal without the skill) and
dims, saying why, what cannot be done here: a fountain's or altar's command
off one, Talk, Give and Steal with no one beside the hero, and on the world
map whatever tome2 ignores there. What Talk or Give brings out is shown in a
card named for the creature.

| tome2 | Command | Reached from |
|---|---|---|
| `;` `-` `.` | walk, run | tap, travel, Explore |
| `,` `g` | stay, pick up | tap yourself (wait); changing button *Pick up*; Items → Floor |
| `R` | rest | toolbar *Rest*; More |
| `<` `>` | stairs, world map | changing button (Descend, Ascend, Walk here…); More (*Go down*, *Go up* / *World map*) |
| `_` | enter a building | walk in; changing button *Enter shop* |
| `o` `c` `B` `j` `T` | open, close, bash, jam (spikes), tunnel | tap a door (opens it); More → Doors and walls |
| `+` | alter (attack, open or tunnel by terrain) | covered by the above and Attack |
| `Y` | talk | tap a neutral creature beside you; changing button *Talk*; its card; More |
| `y` | give | a creature's card beside you; More |
| `Z` | steal from a creature | More (with the Stealing skill); in a shop, *Steal one* on a shelf card |
| `P` | command allies | More → *Command allies* |
| `H` `O` | drink at a fountain, sacrifice at an altar | changing button; More |
| `x` | engrave a rune | More, once a rune is learnt |
| `l` `M` `L` `*` | look, level map, locate, target | long-press; More (*Look*, *Level map*, *Choose target*); dragging the map |
| `i` `e` `w` `t` `d` `k` `{` `}` `I` | inventory and its management | Items and each item's card (Inscribe with nothing removes an inscription) |
| `q` `r` `E` `a` `u` `z` `A` `F` `v` `f` `b` | use items, fire, throw, browse | item cards, *Recently used*, Again, Fire, gear suggestions; More → Use an item / Fight and magic |
| `h` `K` | butcher a corpse, cure meat | the corpse's or meat's card |
| `m` `U` `p` | magic and skills, race and class powers, pray | Cast/Powers; More (*Magic & powers*, *Pray*/*Stop praying* for a god's follower) |
| `G` `N` `C` | skills, abilities, character | HUD name; Menu → Character (tabs) |
| `~` `^P` `^O` | knowledge, messages | Menu → Knowledge, Messages; the HUD log |
| `^F` `^T` `:` | level feeling, time of day, write a note | More → Journal (notes are read in Knowledge) |
| `^S` `^X` `Q` | save, save and quit, quit | Menu (*Save game*, *Save and quit*, *Abandon adventure*) |
| `=` | options | More → *Game options*; our own in Settings |
| `?` `V` | help, version | Menu → Help, About |

Left out on purpose: `/` (identify a symbol: Look and creature cards tell
more), `^R` redraw, `^I` window toggles, `@` `%` `&` `"` `$` and the
extended `#` commands (keyboard macros, visuals, colours, pref lines, the
macro recorder, an HTML screen dump: terminal set-up with no meaning on a
phone), `^W` `^A` (wizard and debug modes: `?wizard` is for testing). The
Keyboard and Ctrl buttons at the foot of More still reach any of them.

Removed from More: *Search* (`s`, which this tome2 no longer has), *Bonus
power* (the Powers tab of Magic), and the inventory, equipment, character,
skills, abilities, knowledge, messages and save buttons that repeated Items
and the Menu.

## 8. Validation

Checked in the real game (headless Chromium, `?wizard`) with targeted
Playwright scripts in phone portrait and phone landscape, and the e2e suite
on all three projects (phone portrait, phone landscape, tablet): Knowledge
lists (119 rows, scroll, ✕ back to Knowledge with its highlight), help
(lettered link, inline link in the 572-line index, letter jumps within the
index, two-space command names in the 1223-line command list, a link back to
the main menu, ‹ back with scroll kept, ✕ and Escape out of three levels),
Inventory → item card → How many? stacking and unwinding, Magic → spell card,
card ✕ and backdrop closing only the card, tabs fixed, the name question at
the top in landscape. A new e2e test covers the reader, help links and cards
(`play.spec.ts`).

## 9. Exceptions and next refinements

- **Shops** are native panels built from the engine's data (`web_store_json`);
  tome2 still pages its own list underneath, and a trade turns it to the
  item's page first.
- **Character → Full sheet** keeps tome2's pages as labelled buttons (they are
  different views, not pagination).
- The **original ToME manual** (reached from Help) is tome2's own text, keys
  and all; our Help topics are what the player is meant to read.
- **Spell lists, options and other tome2 menus** remain TermView panels
  (modern rows, not native views); see AGENTS.md *Known gaps*.

## 10. Sources

- Apple Human Interface Guidelines, *Sheets* and *Modality*: sheets for
  scoped tasks, a clear way to dismiss, keep the parent visible.
- Material Design 3, *Bottom sheets* and *Dialogs*: modal sheets for
  secondary content; dialogs sized to their content for short decisions.
- Shattered Pixel Dungeon: item windows open as small cards over the open
  bag, and closing one returns to the bag — the model for item and spell cards.
- DCSS and Brogue: full-screen, scrollable knowledge and help screens rather
  than pages.
