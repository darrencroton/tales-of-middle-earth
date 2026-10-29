# UI system: pop-ups, menus and navigation

How every menu, sheet, panel and question in the game is organised, why, and
how to add new ones. `AGENTS.md` has the short version; this is the full
record, including the audit it came from.

## 1. Inventory and navigation map

Everything the player can open, by where it is reached from. Depth counts
taps from the map. **Type** refers to the taxonomy in section 2.

```
Map (toolbar, HUD, gestures)
├── Toolbar (≤ 7 buttons, chosen for the moment: Attack, recast, Fire, Wield/Heal/Eat/Light,
│   Pick up, Descend/Ascend, Explore/Way on/Walk here, Items, Rest, Cast, Look, More, Menu)
│   ├── Items ─────────────── Inventory            panel, tabs Pack · Equipment · Floor     depth 1
│   │                         └── Item              card over Inventory (actions)            depth 2
│   │                             ├── How many?     card over Item (Drop, Destroy)           depth 3
│   │                             └── Inscribe      card at the top (text field)             depth 3
│   ├── Cast / Powers ─────── Magic                panel: Recent, books, Powers, Skills     depth 1
│   │                         └── Spell             card over Magic (Cast)                   depth 2
│   ├── Look ──────────────── look mode: banner + look card on the map (About → card)
│   ├── More ──────────────── Commands             panel: command grid by group             depth 1
│   │   ├── native commands → the native panel, in the same frame (Back returns to Commands)
│   │   ├── item commands (Quaff, Read…) → tome2 item prompt (TermView panel, tabs)
│   │   └── reading commands (Inspect, Help, Options) → tome2 screen; Commands reopens after
│   │       └── Help ──────── reader (TermView panel): links open files, ‹ returns
│   └── Menu ──────────────── Menu                 menu                                     depth 1
│       ├── Character ─────── Character            panel, tabs Summary · Skills · Abilities · Full sheet
│       │                     └── tome2 question    card over Character (save skills?)
│       ├── Messages ──────── Messages             panel (log, newest at the foot)
│       ├── Knowledge ─────── Knowledge            menu                                     depth 2
│       │                     └── list ─────────── reader (TermView panel); Knowledge reopens after
│       ├── Save game (toast)
│       ├── Settings ──────── Settings             panel                                    depth 2
│       ├── How to play / About                    panel (prose)
│       ├── Saved games ───── Saved games          menu: Export · Import                    depth 2
│       └── Save and quit ─── confirmation         card
├── HUD
│   ├── hero name ─────────── Character (or Fallen hero after death)
│   ├── creature / item chip ─ Creature / Item     card
│   └── message log ───────── Messages             panel
├── Map tap / long-press ───── travel / look card
└── tome2 asks something ───── question card on the map (yes/no, how many, text, direction,
                               aim, lettered choice, message box) or a TermView panel
                               (item prompts, spell lists, shops, options, other menus)

Shop (walk in) ─────────────── TermView panel (store list; Sell/Store/More in its footer)
                                └── Shop item       card over the shop (Buy with quantity)
Death ──────────────────────── death card → end-of-game summary (full screen) → Hall of Fame (full screen)
                                └── Fallen hero     panel, tabs Hero · Gear · Skills · Last moments
                                    └── Item / foe  card
Title ──────────────────────── Continue/New · Settings (panel) · Saved games (menu)
                                · Soundtrack (panel) · Hall of Fame (panel → Fallen hero)
Character creation ─────────── director screens (full screen, Back/Random/Choose), name card
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
| **Panel** | A screen of its own: a list to work through, several views, or long reading | Inventory, Character, Magic, Commands, Messages, Settings, Soundtrack, Hall of Fame, Fallen hero, How to play; every tome2 panel (item prompts, spell lists, shops, options, the reader) | fixed: `--popup-height` | bottom sheet (centred on wide screens) |
| **Menu** | A short list of places to go | Menu, Knowledge, Saved games | its rows, capped at `--popup-height` | bottom sheet |
| **Card** | Details of one thing, or a question | Item, spell, creature, shop item, memorial item/foe, How many?, Inscribe, confirmations, messages, tome2 message boxes over a sheet | its content, capped (shorter than a panel beneath it) | floats above whatever opened it |
| **Map card** | A question or note that leaves the map usable | tome2 questions (yes/no, direction, aim…), look card, death card | its content | bottom of the map, no backdrop |
| **Full screen** | A screen that replaces the game | title, character creation, end of game, Hall of Fame after death | whole screen | — |

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

### Card

- As tall as its content up to `--popup-height`; over a panel, at least 4rem
  shorter, so the panel's heading stays in view above it.
- Floats with rounded corners clear of the screen edges, in a frame of its own
  above whatever opened it, which stays visible (less dimmed) beneath.
- Actions in a grid at the foot; the likely one is primary. Destructive ones
  are red. No tabs.
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
| More → Help → index → a topic → back | Lettered links only; keyboard for the rest; Back via footer | Tap any link; ‹ returns to the index where it was left; ✕ returns to Commands |
| Cast → spell ⓘ → Cast | Spell description filled the pop-up | Spell card over Magic; Cast casts, ✕ returns to Magic |
| Map → creature chip → close | Tall pop-up | Card the size of the recall |
| Menu → Saved games → Export | Two rows in Menu | One row, same menu as the title screen |

## 7. Validation

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

## 8. Exceptions and next refinements

- **Shops** still page tome2's list (twelve items a page, *More* in the
  footer): buying needs tome2 to be on the item's page. A gathered shop list
  would need to page tome2 to an item before buying it.
- **Character → Full sheet** keeps tome2's pages as labelled buttons (they are
  different views, not pagination).
- The **help index** still shows tome2's *Basic keys* table, which means
  nothing on a touch screen; rewriting help text is out of scope.
- **Spell lists, options and other tome2 menus** remain TermView panels
  (modern rows, not native views); see AGENTS.md *Known gaps*.

## 9. Sources

- Apple Human Interface Guidelines, *Sheets* and *Modality*: sheets for
  scoped tasks, a clear way to dismiss, keep the parent visible.
- Material Design 3, *Bottom sheets* and *Dialogs*: modal sheets for
  secondary content; dialogs sized to their content for short decisions.
- Shattered Pixel Dungeon: item windows open as small cards over the open
  bag, and closing one returns to the bag — the model for item and spell cards.
- DCSS and Brogue: full-screen, scrollable knowledge and help screens rather
  than pages.
