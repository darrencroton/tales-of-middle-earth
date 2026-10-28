import './styles.css';
import { GameAudio } from './audio/audio.ts';
import type { Place } from './audio/places.ts';
import { doorKinds } from './audio/cues.ts';
import { Engine } from './engine.ts';
import { areaName, Hud, rowSegments, statusLabels, type HudEntity } from './hud.ts';
import { attachMapGestures, attachPinch } from './input/gestures.ts';
import { directionKeys, KEY_BACKSLASH as BACKSLASH, KEY_ENTER, KEY_ESCAPE, translateKey, translateText } from './input/keys.ts';
import { attachSoftKeyboard } from './input/softkeyboard.ts';
import { Director } from './flow/director.ts';
import { FireEffect } from './render/fire.ts';
import { HIT_FLASH_MS, MapRenderer, MAX_ZOOM, MIN_ZOOM, type MapEffect, type MapPoint } from './render/map.ts';
import { buildMaterials, FB_DOOR, FB_NO_WALK, type FeatureInfo, type Material } from './render/materials.ts';
import { commandGroups, commandKeys, contextActions, waitCommand, type Action, type CommandDef, type NativeView } from './play/actions.ts';
import { keyCodes, MacroRunner, type Macro } from './play/macro.ts';
import { classifyPrompt, directionDigit, isAdjacent, type PromptKind } from './play/prompts.ts';
import { TargetPicker } from './play/targeting.ts';
import { approachTarget, edgeCell, forgetUnseen, isKnown, STOP_MESSAGES, Travel, type TravelContext } from './play/travel.ts';
import { Explore, nextStop, WAY_ON, type ExplorePlan } from './play/explore.ts';
import { levelKey, MapMemoryStore, mergeKnown, missingCells, type HeroMemory } from './play/mapmemory.ts';
import { CAVE_MARK, isHostile, LAYER_MASK, LAYER_OBJECT, type GameState, type LevelSnapshot, type MonsterState, type PlayerState, type ScoreEntry, type SpellState } from './render/snapshot.ts';
import {
  collectFiles,
  decodeBundle,
  downloadText,
  encodeBundle,
  exportFilename,
  writeFiles,
} from './saves.ts';
import { ANIMATION_FPS, applyTextSize, loadSettings, saveSettings, type Settings } from './settings.ts';
import { TerminalBuffer, type ScreenCopy } from './terminal.ts';
import { TitleScreen } from './title.ts';
import { openSoundtrack } from './ui/soundtrack.ts';
import { openMagic, openSpell, RecentStore, recentUsable } from './ui/magic.ts';
import { CastWatcher, fireMacro, recentItem, recentItemAction, recentLabel, recentMagicMacro, thenAim, type RecentAction } from './play/recent.ts';
import { descriptionParagraphs, titleName, type GameApi } from './ui/api.ts';
import { GameFeel } from './feel.ts';
import { Coach } from './ui/coach.ts';
import {
  fightingStyle,
  INVEN_AMMO,
  INVEN_BOW,
  INVEN_WIELD,
  itemActions,
  itemMacro,
  SLOT_NAMES,
  suggestedGear,
  type FightingStyle,
  type GearSuggestion,
} from './play/items.ts';
import { buildMemorial, entryKey, memorialKey, type Memorial } from './play/memorial.ts';
import { openFallen, openFoe, type FallenTab } from './ui/memorial.ts';
import { CharacterPanel, openKnowledge, type CharacterScreen } from './ui/character.ts';
import { el, iconText, section } from './ui/dom.ts';
import { describeCell, openFloorObject, openMonster } from './ui/info.ts';
import { openInventory } from './ui/inventory.ts';
import { askQuantity, askText, confirmSheet, openHistory, openMenu, openMessage, openSettings, openTemplate } from './ui/menus.ts';
import { Sheets, type SheetTrail } from './ui/sheet.ts';
import { bufferRows, parseRows, type ChoiceBlock, type OptionBlock } from './ui/termparse.ts';
import { TermView, type TermViewOptions, type TermViewTab } from './ui/termview.ts';
import { PromptCard, type CardKind } from './ui/promptcard.ts';
import type { PopAction } from './ui/popup.ts';
import { cleanPrompt, describableRange, isEmptyFile, isFileViewer } from './ui/prompttext.ts';
import { openStoreItem, parseStore, type StoreScreen } from './ui/store.ts';
import { parseAbilities, parseSkills } from './ui/skills.ts';
import { findMessageBox, type MessageBox } from './ui/msgbox.ts';
import { hallOfFameElements, heroEntry, isHallOfFame, parseTomb, tombElements } from './ui/gameover.ts';
import { careerElements, ChronicleStore } from './ui/deeds.ts';
import { extendStreak, newChronicle, newDeeds, newMessages, nextTimeTip, record, slainMonsters, type Chronicle, type Slain, type Streak } from './play/chronicle.ts';
import { parseFullSheet } from './ui/charsheet.ts';

declare global {
  interface Window {
    __tome?: {
      engine: Engine;
      feel: GameFeel;
      buffer: TerminalBuffer;
      screenText(): string;
      sendText(text: string): void;
      mode(): ViewMode;
      stats(): { renderMs: number; zoom: number };
      tapCell(x: number, y: number): void;
      mapCellCentre(x: number, y: number): { x: number; y: number };
      actions(): string[];
      travelling(): boolean;
      lastStopCause(): string;
      exploreStop(): { kind: string; x: number; y: number; heading: string } | null;
      macroRunning(): boolean;
      director: Director;
      audio: GameAudio;
    };
  }
}

type ViewMode = 'title' | 'screen' | 'map' | 'overlay';

const EFFECT_LINGER_MS = 160;
const HIGHLIGHT_MS = 2500;
const MAX_EFFECT_CELLS = 600;
const TRAVEL_STEP_MS = 45;
const PLACE_POLL_MS = 2000;
const CTRL_S = 0x13;
const CTRL_X = 0x18;
const SPACE = 0x20;
/* Visible height lost to an on-screen keyboard before the layout makes room for it. */
const KEYBOARD_MIN_PX = 120;
/* Below this visible height above the keyboard, text questions shrink to fit. */
const KEYBOARD_TIGHT_PX = 320;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const app = byId<HTMLElement>('app');
const stage = byId<HTMLDivElement>('stage');
const fxCanvas = byId<HTMLCanvasElement>('fx');
const mapCanvas = byId<HTMLCanvasElement>('map');
const messagesEl = byId<HTMLDivElement>('messages');
const hudEl = byId<HTMLElement>('hud');
const toolbar = byId<HTMLElement>('toolbar');
const keyboardInput = byId<HTMLInputElement>('keyboard-input');
const importFile = byId<HTMLInputElement>('import-file');
const toast = byId<HTMLDivElement>('toast');
const lookCard = byId<HTMLDivElement>('look-card');
const recentre = byId<HTMLButtonElement>('recentre');
const lookBanner = byId<HTMLDivElement>('look-banner');

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let settings: Settings = loadSettings(reducedMotion);
const audio = new GameAudio(settings.music, settings.sound);
applySettings();

const buffer = new TerminalBuffer();
const map = new MapRenderer(mapCanvas);
const fire = new FireEffect(fxCanvas);
map.zoom = settings.zoom;
map.glyphMode = settings.glyphs;

let mode: ViewMode = 'title';
let base: ScreenCopy | null = null;
let basePanel = { row: -1, col: -1 };
let lastSnap: LevelSnapshot | null = null;
let lastState: GameState | null = null;
let materialsLoaded = false;
let features: FeatureInfo[] = [];
let materials: Material[] = [];
let travel: Travel | Explore | null = null;
const exploreSkip = new Set<number>();
/** Creatures that have already stopped travel on this level. */
const noticed = new Set<number>();
/* Map memory: the level exploring is on (`levelKey`, or a stand-in where there is none), the hero's memory and the land area's remembered grids. */
let exploreLevel: string | null = null;
let exploreLevelDepth = -1;
let exploreLevelDungeon = -1;
const mapMemory = new MapMemoryStore();
let heroMemory: HeroMemory | null = null;
let heroMemoryId = '';
let landMemory: { key: string; width: number; height: number; mask: Uint8Array; changed: boolean } | null = null;
let memoryTurn = -1;
let memoryPos = -1;
/* Whether exploring may head for the way on (the toolbar's label), by turn and place. */
let wayOnLabel: { key: string; label: string | null } = { key: '', label: null };
/** Where exploring this level began (the map fills outwards from it), and where the hero stood when it last stopped. */
let exploreAnchor: MapPoint | null = null;
let exploreLastStop: MapPoint | null = null;
/** Items seen on this level while exploring (by cell), and those first seen during the current exploration. */
const exploreSeenItems = new Set<number>();
const exploreSpotted = new Map<number, string>();
let travelTimer = 0;
/** The current travel only gets as near as the known way allows. */
let travelApproximate = false;
let lastStopCause = '';
let picker: TargetPicker | null = null;
let lastSavedTurn = -1;
/** A save command was sent; once the engine has written it, storage is synced (and the player told, if asked). */
let pendingSync: 'silent' | 'toast' | null = null;
let currentActions: Action[] = [];
let actionsKey = '';
let dirty = true;
let effectsAt = 0;
let hasEffects = false;
let ctrlLatched = false;
let lastRenderMs = 0;
let placeKey = '';
let placeAt = 0;
/** Where the player is, refreshed with the level and every couple of seconds. */
let place: Place | null = null;
let placePos = { x: -1, y: -1 };
let inStore = false;
/** The end-of-game summary has been shown; the lament plays until the title. */
let ended = false;
/** The fallen hero as they were at the end, once they have died. */
let memorial: Memorial | null = null;
/** A fallen hero to begin again once the title screen is back. */
let pendingAnew: string | null = null;
let looking = false;
let quitting = false;
/** Sheets covered by a tome2 screen, reopened once it closes. */
let returnTo: SheetTrail | null = null;
const macros = new MacroRunner();

let sheetDepth = 0;
const sheets = new Sheets(document.body, () => {
  app.classList.toggle('sheet-open', sheets.isOpen);
  if (sheets.depth !== sheetDepth) audio.cue(sheets.depth > sheetDepth ? 'ui-open' : 'ui-close');
  sheetDepth = sheets.depth;
  updateActionBar();
});

const termView = new TermView(stage, () => buffer.palette, {
  onChoice(key, choice) {
    const store = currentStore();
    if (store && choice.row < store.commandsRow) {
      openStoreItem(api, store, choice);
      return;
    }
    send([key.charCodeAt(0)]);
  },
  onDescribe(key, choice) {
    if (/which spell\?/i.test(rowZeroText()) && describeSpell(choice.label.text.trim(), choice.key)) return;
    send([key.charCodeAt(0)]);
  },
  onOption(option, _index, options) {
    toggleOption(option, options);
  },
  onTapText() {
    continueIfWaiting();
  },
  onClose() {
    send([KEY_ESCAPE]);
  },
});

const promptCard = new PromptCard(stage, (keys) => send(keys));

const hud = new Hud(hudEl, messagesEl, () => buffer.palette, {
  onEntity: (entity) => openEntity(entity),
  onPlayer: () => openNative(lastState?.player?.dead ? 'fallen' : 'character'),
  onSkills: () => openNative('skills'),
  onMore: () => send([SPACE]),
  onHistory: () => {
    if (travel || picker) stopAutomation(null, 'history');
    showHistory();
  },
});

function setCtrlLatched(value: boolean): void {
  ctrlLatched = value;
  for (const node of document.querySelectorAll('[data-ctrl-toggle]')) node.setAttribute('aria-pressed', String(value));
}

let toastTimer = 0;
function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}

/* Native views */

const api: GameApi = {
  engine: undefined as unknown as Engine,
  sheets,
  palette: () => buffer.palette,
  snapshot: () => lastSnap,
  state: () => lastState,
  features: () => features,
  send: (keys) => {
    coverSheets(false);
    send(keys);
  },
  command: (command) => {
    if (!lastSnap?.atCommand) {
      coverSheets(false);
      showToast('Finish what you are doing first.');
      return;
    }
    coverSheets(true);
    send([BACKSLASH, ...keyCodes(command)]);
  },
  runMacro: (macro, comeBack = false) => {
    coverSheets(comeBack);
    runMacro(macro);
  },
  travelTo: (point) => {
    sheets.closeAll();
    hideLookCard();
    if (lastSnap?.atCommand) startTravel(point);
  },
  highlight: (point) => flash(point),
  askText: (title, label, initial) => askText(sheets, title, label, initial),
  askQuantity: (question) => askQuantity(sheets, question),
  recent: () => recents.list(lastState?.player?.name ?? ''),
  remember: (entry) => recents.remember(lastState?.player?.name ?? '', entry),
};

const recents = new RecentStore();
const castWatcher = new CastWatcher();

/** Casts a spell or uses a power again (aiming at the nearest foe when `aim`); it is remembered once tome2 has taken it. */
function runRecent(entry: RecentAction, aim = false): void {
  sheets.closeAll();
  if (!lastSnap?.atCommand) {
    showToast('Finish what you are doing first.');
    return;
  }
  if (entry.kind === 'item') {
    const item = recentItem(entry, engine.inventory()?.pack ?? []);
    const action = item ? recentItemAction(entry, item) : null;
    if (!item || !action) return;
    api.remember(entry);
    runMacro(thenAim(itemMacro(action, item, 'pack', '', alwaysPickup()), aim));
    return;
  }
  const macro = recentMagicMacro(entry, aim);
  if (!macro) return;
  if (entry.kind === 'spell') castWatcher.begin('m', [], entry.name);
  else castWatcher.begin(entry.command, entry.steps);
  runMacro(macro);
}

/* Spells carried, read once per game turn for the toolbar. */
let spellsCache: { turn: number; spells: SpellState | null } | null = null;

function currentSpells(): SpellState | null {
  const turn = lastSnap?.turn ?? -1;
  if (spellsCache?.turn !== turn) spellsCache = { turn, spells: engine.spells() };
  return spellsCache.spells;
}

/**
 * The one-tap attack offered on the toolbar while a foe is in view: the
 * last aimed thing the hero did that can be done again (a spell, a power,
 * a wand or rod, a thrown flask...).
 */
function recastEntry(): RecentAction | null {
  if (!lastSnap?.atCommand) return null;
  const pack = engine.inventory()?.pack ?? [];
  const usable = (e: RecentAction) => {
    if (e.kind !== 'item') return recentUsable(e, currentSpells());
    const item = recentItem(e, pack);
    return !!item && !!recentItemAction(e, item);
  };
  const recent = api.recent();
  if (magicLabel() !== null) {
    const magic = recent.find((e) => e.kind !== 'item' && usable(e));
    if (magic) return magic;
  }
  if (!hostileInView()) return null;
  return recent.find((e) => e.aimed && usable(e)) ?? null;
}

/** A hostile creature is in view of the hero at the command prompt. */
function hostileInView(): boolean {
  return mode === 'map' && !!lastSnap?.atCommand && (lastState?.monsters ?? []).some((m) => isHostile(m));
}

/** Shows a spell's description from tome2's spell list ("i" beside it), with Cast. */
function describeSpell(name: string, key: string): boolean {
  const spell = currentSpells()?.books.flatMap((b) => b.spells).find((s) => s.name === name);
  if (!spell) return false;
  openSpell(api, spell, {
    run: () => {
      sheets.closeAll();
      send(keyCodes(key));
    },
  });
  return true;
}

let styleKey = '';
let style: FightingStyle = { weapons: true, magic: true };

/** How the hero fights, read again when their level or skill points change. */
function heroStyle(): FightingStyle {
  const player = lastState?.player;
  if (!player) return style;
  const key = `${player.name}:${player.lev}:${player.skillPoints}`;
  if (key === styleKey) return style;
  const sheet = engine.character();
  if (!sheet) return style;
  styleKey = key;
  style = fightingStyle(sheet.skills);
  return style;
}

/** The toolbar's magic button: Cast with spell books, Powers with only skills or race powers, none without either or for heroes who fight without magic. */
function magicLabel(): string | null {
  if (!heroStyle().magic) return null;
  const spells = currentSpells();
  if (!spells) return 'Cast';
  if (spells.books.length) return 'Cast';
  return spells.powers.length || spells.bonus.length ? 'Powers' : null;
}

/** A launcher with ammunition in the quiver. */
function canFire(): boolean {
  const equip = engine.inventory()?.equip ?? [];
  const ready = (part: number) => equip.some((slot) => slot.part === part && !slot.empty && !!slot.name);
  return ready(INVEN_BOW) && ready(INVEN_AMMO);
}

const character = new CharacterPanel(api, {
  sendKeys: (keys) => send(keys),
  source: (letter) => sheetSource(letter),
  toast: (text) => showToast(text),
  poke: () => {
    if (!engine.awaitingInput || engine.pendingKeys > 0 || macros.running) return;
    const screen = characterScreen();
    character.step(screen);
    character.render(screen);
  },
});

/** What tome2 shows, for the character sheet's tabs. */
function characterScreen(): CharacterScreen {
  const rows = bufferRows(buffer, 0, buffer.rows - 1);
  const skills = parseSkills(rows);
  const abilities = skills ? null : parseAbilities(rows);
  const sheet = skills || abilities ? null : parseFullSheet(rows);
  return { skills, abilities, sheet, box: lastSnap?.icky ? findMessageBox(rows) : null, atCommand: !!lastSnap?.atCommand };
}

/** Closes the sheets; with `comeBack` they reopen once the game is back at the map. */
function coverSheets(comeBack: boolean): void {
  returnTo = comeBack ? sheets.snapshot() : null;
  sheets.closeAll();
}

/** Reopens sheets covered by a tome2 screen once that screen has closed. */
function reopenSheets(): void {
  const snap = lastSnap;
  if (!returnTo || macros.running || !snap) return;
  if (quitting || !snap.inDungeon) {
    returnTo = null;
    return;
  }
  if (!snap.atCommand || snap.icky) return;
  const trail = returnTo;
  returnTo = null;
  if (!sheets.isOpen) sheets.restore(trail);
}

function flash(point: MapPoint): void {
  map.flashHighlight(point, HIGHLIGHT_MS);
  dirty = true;
  requestFrame();
  window.setTimeout(() => {
    dirty = true;
    requestFrame();
  }, HIGHLIGHT_MS + 50);
}

function openEntity(entity: HudEntity): void {
  if (travel || picker) stopAutomation(null, 'entity');
  if ((lastState?.player?.status.hallucinating ?? 0) > 0) {
    flash(entity.kind === 'monster' ? entity.monster : entity.object);
    showToast('You cannot trust your eyes right now.');
    return;
  }
  if (entity.kind === 'monster') {
    flash(entity.monster);
    openMonster(api, entity.monster);
  } else {
    flash(entity.object);
    openFloorObject(api, entity.object);
  }
}

function openNative(view: NativeView): void {
  if (travel || picker) stopAutomation(null, 'native');
  switch (view) {
    case 'inventory':
      openInventory(api, 'pack');
      break;
    case 'equipment':
      openInventory(api, 'equip');
      break;
    case 'character':
      character.open('summary');
      break;
    case 'skills':
      character.open('skills');
      break;
    case 'abilities':
      character.open('abilities');
      break;
    case 'magic':
      openMagic(api, api.recent(), { run: (entry) => runRecent(entry) });
      break;
    case 'recast': {
      const entry = recastEntry();
      if (entry) runRecent(entry, !!entry.aimed && hostileInView());
      break;
    }
    case 'fire':
      runMacro(fireMacro());
      break;
    case 'knowledge':
      openKnowledge(api);
      break;
    case 'finish':
      finishGame();
      break;
    case 'fallen':
      openFallenHero();
      break;
    case 'history':
      showHistory();
      break;
    case 'look':
      setLooking(true);
      break;
    case 'lookDone':
      setLooking(false);
      break;
    case 'explore':
      startExplore();
      break;
    case 'equip':
      useSuggested();
      break;
    case 'overview':
      setOverview(true);
      break;
    case 'overviewDone':
      setOverview(false);
      break;
  }
}

function showHistory(): void {
  openHistory(sheets, engine.gameState(200)?.messages ?? lastState?.messages ?? [], buffer.palette);
}

/* Whole-level map */

function setOverview(on: boolean): void {
  map.overview = on;
  app.classList.toggle('overview', on);
  if (on) {
    setLooking(false);
    recentreMap();
    showToast('Tap a place to travel there');
  }
  updateActionBar(true);
  dirty = true;
  requestFrame();
}

/* Look mode and the look card */

function setLooking(on: boolean): void {
  looking = on;
  lookBanner.hidden = !on;
  if (!on) hideLookCard();
  updateActionBar(true);
}

function hideLookCard(): void {
  lookCard.hidden = true;
  map.setLookCell(null);
  requestFrame();
}

function showLookCard(point: MapPoint): void {
  const description = describeCell(api, point);
  if (!description) return;
  map.setLookCell(point);
  const text = el('p', 'look-text', description.text);
  const buttons = el('div', 'look-buttons');
  const add = (label: string, run: () => void, primary = false) => {
    const button = el('button', primary ? 'look-button primary' : 'look-button', label);
    button.type = 'button';
    button.addEventListener('click', run);
    buttons.append(button);
  };
  const monster = description.monsters[0];
  const object = description.objects[0];
  if (monster) add('About', () => openMonster(api, monster), true);
  else if (object) add('About', () => openFloorObject(api, object), true);
  if (!description.player && description.known && lastSnap?.atCommand) {
    add(monster && isHostile(monster) ? 'Attack' : 'Go there', () => {
      setLooking(false);
      startTravel(point);
    });
  }
  add('✕', () => hideLookCard());
  lookCard.replaceChildren(text, buttons);
  lookCard.hidden = false;
  dirty = true;
  requestFrame();
}

/* View state */

function setMode(next: ViewMode): void {
  if (next === mode) return;
  mode = next;
  app.classList.remove('mode-title', 'mode-screen', 'mode-map', 'mode-overlay');
  app.classList.add(`mode-${next}`);
  if (next !== 'screen' && next !== 'title') fire.clear();
  if (next !== 'map') {
    hideLookCard();
    if (looking) setLooking(false);
    if (map.overview) setOverview(false);
  }
  layout();
}

function terminalToDungeon(snap: LevelSnapshot, col: number, row: number): MapPoint | null {
  if (row < snap.rowMap || row >= buffer.rows - 1 || col < snap.colMap) return null;
  const x = col - snap.colMap + snap.panelCol;
  const y = row - snap.rowMap + snap.panelRow;
  if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) return null;
  return { x, y };
}

function rowZeroText(): string {
  return buffer.rowText(0).trim();
}

function currentPrompt(): PromptKind {
  return classifyPrompt(rowZeroText(), buffer.cursorY === 0);
}

const CARD_KINDS = new Set<PromptKind>(['yesno', 'quantity', 'text', 'direction', 'aim', 'choice']);

/** Pack / Equipment / Floor tabs for tome2's item prompts. */
function itemTabs(prompt: string): TermViewTab[] {
  const mode = /^\((Inven|Equip|Floor):/.exec(prompt)?.[1];
  if (!mode) return [];
  const tabs: TermViewTab[] = [];
  const other = /\/ for (Equip|Inven)/.exec(prompt)?.[1];
  const lists: ['Inven' | 'Equip' | 'Floor', string][] = [
    ['Inven', 'Pack'],
    ['Equip', 'Equipment'],
    ['Floor', 'Floor'],
  ];
  for (const [list, label] of lists) {
    const offered = list === mode || other === list || (list === 'Floor' && /- for floor/.test(prompt));
    if (!offered) continue;
    tabs.push({ label, active: list === mode, run: () => list !== mode && send(keyCodes(list === 'Floor' ? '-' : '/')) });
  }
  return tabs.length > 1 ? tabs : [];
}

/** How a tome2 screen is presented in the native panel: heading, tabs, rows to hide. */
function panelOptions(layout: 'panel' | 'full'): TermViewOptions {
  const prompt = rowZeroText();
  const kind = currentPrompt();
  const options: TermViewOptions = { layout, describe: describableRange(prompt), cursorRow: buffer.cursorY };
  const store = currentStore();
  if (store) {
    const lines = buffer.screenText().split('\n');
    const goldRow = lines.findIndex((l) => /Gold Remaining/.test(l));
    const headerRow = lines.findIndex((l) => /Item Description|Weight\s+Price/.test(l));
    const heading = lines.slice(0, 5).find((l) => /\(\d+\)\s*$/.test(l));
    const parts = heading?.trim().split(/\s{2,}/) ?? [];
    const name = parts.at(-1)?.replace(/\s*\(\d+\)$/, '');
    const keeper = parts.length > 1 ? parts[0].replace(/\s*\(/, ' (') : undefined;
    const gold = goldRow >= 0 ? /Gold Remaining:\s*(\d+)/.exec(lines[goldRow])?.[1] : undefined;
    options.title = name ?? (store.home ? 'Your home' : 'Shop');
    if (keeper) options.subtitle = keeper;
    if (gold) options.badge = `${gold} gold`;
    const firstShown = headerRow >= 0 ? headerRow : 1;
    const lastShown = goldRow >= 0 ? goldRow : store.commandsRow;
    options.hideRow = (row) => row < firstShown || row >= lastShown;
    return options;
  }
  if (prompt && kind !== 'more' && !CARD_KINDS.has(kind)) options.title = cleanPrompt(prompt) || undefined;
  if (kind === 'item') options.tabs = itemTabs(prompt);
  if (isEmptyFile(prompt)) options.empty = 'Nothing here yet.';
  const box = currentBox();
  if (box) options.hideRow = (row) => row >= box.top && row <= box.bottom;
  return options;
}

/** Flips a tome2 option: moves its cursor to the row, then answers y or n. */
function toggleOption(option: OptionBlock, options: OptionBlock[]): void {
  const cursorRow = buffer.cursorY;
  const current = options.findIndex((o) => o.row === cursorRow);
  const target = options.indexOf(option);
  if (current < 0 || target < 0) return;
  const step = target > current ? '2' : '8';
  send([...keyCodes(step.repeat(Math.abs(target - current))), ...keyCodes(option.value ? 'n' : 'y')]);
}

/** tome2's centred message box, while one is drawn. */
function currentBox(): MessageBox | null {
  return lastSnap?.icky ? findMessageBox(bufferRows(buffer, 0, buffer.rows - 1)) : null;
}

function updatePromptCard(): void {
  const box = character.hosting ? null : currentBox();
  if (box && !macros.running && engine.pendingKeys === 0) {
    promptCard.showBox(box);
    return;
  }
  const kind = currentPrompt();
  if (kind === 'yesno' && /Dump the screen\?/.test(rowZeroText()) && !macros.running && engine.pendingKeys === 0) {
    promptCard.showDeath(engine.gameState(0)?.player?.diedFrom ?? '');
    return;
  }
  const menuShown = termView.visible && (termView.choices().length > 0 || termView.options().length > 0);
  const show =
    CARD_KINDS.has(kind) && !(kind === 'text' && menuShown) && !macros.running && !picker && !title.isVisible && engine.pendingKeys === 0;
  if (show) promptCard.show(kind as CardKind, rowZeroText(), /'5'|current target/i.test(rowZeroText()));
  else promptCard.hide();
}

/** Names for the equipment letters on the full character sheet. */
function sheetSource(letter: string): string {
  if (letter === '@') return 'Innate';
  if (letter === 'z') return 'Symbiote';
  const index = INVEN_WIELD + letter.charCodeAt(0) - 'a'.charCodeAt(0);
  const item = engine.inventory()?.equip.find((slot) => slot.i === index && slot.name);
  return item?.name ? titleName(item.name) : 'Equipment';
}

/** Reads engine state and decides how the screen is presented. */
/** Tells the soundtrack where the player is: on a new level, or every couple of seconds for time of day. */
function updatePlace(snap: LevelSnapshot): void {
  const key = `${snap.depth}:${snap.wild}:${snap.width}x${snap.height}`;
  const now = performance.now();
  const moved = Math.max(Math.abs(snap.px - placePos.x), Math.abs(snap.py - placePos.y)) > 1;
  placePos = { x: snap.px, y: snap.py };
  if (key === placeKey && !moved && now - placeAt < PLACE_POLL_MS) return;
  placeKey = key;
  placeAt = now;
  place = engine.place();
  audio.setPlace(place);
}

/* Map memory */

function memoryHeroId(): string | null {
  const player = lastState?.player;
  if (!player?.name || player.dead || place?.heroId === undefined) return null;
  return `${player.name}#${(place.heroId >>> 0).toString(36)}`;
}

/** Exploring's visits are kept between visits on the land, and on dungeon levels while levels are kept. */
function keepsVisits(key: string | null): key is string {
  return !!key && (key.startsWith('land:') || (key.startsWith('level:') && settings.persistentLevels));
}

/** Puts what the hero remembers of the current level into the store, and the store into storage. */
function persistMapMemory(): void {
  if (heroMemory) {
    if (landMemory?.changed) {
      mapMemory.setArea(heroMemory, landMemory.key, landMemory.width, landMemory.height, landMemory.mask);
      landMemory.changed = false;
    }
    if (keepsVisits(exploreLevel)) mapMemory.setVisited(heroMemory, exploreLevel, exploreSkip);
  }
  mapMemory.save();
}

/** Which way the hero is now heading, from the level left and the level entered; null keeps it. */
function headingInto(next: { dungeon: number; depth: number }): 'down' | 'up' | null {
  if (next.depth === 0) return 'down';
  if (exploreLevel === null) return null;
  if (next.dungeon !== exploreLevelDungeon || exploreLevelDepth <= 0) return 'down';
  if (next.depth === exploreLevelDepth) return null;
  return next.depth > exploreLevelDepth ? 'down' : 'up';
}

function enterLevel(key: string, next: { dungeon: number; depth: number }): void {
  persistMapMemory();
  const heading = headingInto(next);
  if (heroMemory && heading) mapMemory.setHeading(heroMemory, heading);
  exploreLevel = key;
  exploreLevelDepth = next.depth;
  exploreLevelDungeon = next.dungeon;
  exploreSkip.clear();
  noticed.clear();
  landMemory = null;
  memoryTurn = -1;
  wayOnLabel = { key: '', label: null };
  exploreAnchor = null;
  exploreLastStop = null;
  exploreSeenItems.clear();
  if (heroMemory && keepsVisits(key)) for (const cell of heroMemory.visited[key] ?? []) exploreSkip.add(cell);
}

/** Items the hero has stood on (or dropped) count as visited. */
function noteVisited(snap: LevelSnapshot): void {
  if (snap.floorObjects > 0) exploreSkip.add(snap.py * snap.width + snap.px);
}

/** Keeps the grids of an area of the land the hero has seen, and restores those tome2 has forgotten. */
function rememberLand(snap: LevelSnapshot, key: string): void {
  if (!heroMemory || !key.startsWith('land:')) return;
  if (!landMemory || landMemory.key !== key || landMemory.width !== snap.width || landMemory.height !== snap.height) {
    landMemory = { key, width: snap.width, height: snap.height, mask: mapMemory.area(heroMemory, key, snap.width, snap.height), changed: false };
  }
  if (mergeKnown(landMemory.mask, snap.info)) landMemory.changed = true;
  const missing = missingCells(landMemory.mask, snap.info);
  if (missing.length === 0 || engine.markKnown(missing) === 0) return;
  for (const cell of missing) snap.info[cell] |= CAVE_MARK;
  dirty = true;
}

function updateMapMemory(snap: LevelSnapshot): void {
  const id = memoryHeroId();
  if (id && id !== heroMemoryId && mapMemory.loaded) {
    persistMapMemory();
    heroMemoryId = id;
    heroMemory = mapMemory.hero(id);
    exploreLevel = null;
  }
  const current = place && place.depth === snap.depth && !!place.wild === snap.wild ? place : null;
  if (!current) return;
  const key = levelKey(current) ?? `other:${current.dungeon}:${current.depth}:${current.wild}`;
  if (key !== exploreLevel) enterLevel(key, current);
  const pos = snap.py * snap.width + snap.px;
  if (snap.turn === memoryTurn && pos === memoryPos) return;
  memoryTurn = snap.turn;
  memoryPos = pos;
  noteVisited(snap);
  rememberLand(snap, key);
}

/* What each terrain feature means to exploring, by feature index (built with the materials). */
let featureRoles: { down: boolean[]; up: boolean[] } = { down: [], up: [] };

function explorePlan(): ExplorePlan {
  const heading = (lastSnap?.depth ?? 0) > 0 ? (heroMemory?.heading ?? 'down') : 'down';
  const role = (table: boolean[]) => (i: number) => !!lastSnap && !!table[lastSnap.feat[i]];
  return {
    skip: exploreSkip,
    heading,
    isExit: role(featureRoles[heading]),
    anchor: exploreAnchor,
    collectItems: alwaysPickup(),
  };
}

/** 'Way down' or 'Way up' once exploring has nothing left but the way on; null otherwise. */
function wayOnLabelFor(snap: LevelSnapshot | null): string | null {
  if (!snap?.atCommand || snap.wild || travel || !materialsLoaded) return null;
  const key = `${exploreLevel}:${snap.turn}:${snap.px},${snap.py}:${exploreSkip.size}:${heroMemory?.heading}`;
  if (wayOnLabel.key !== key) {
    const plan = explorePlan();
    const stop = nextStop(snap, materials, plan);
    wayOnLabel = { key, label: stop?.kind === 'exit' ? (plan.heading === 'up' ? 'Way up' : 'Way down') : null };
  }
  return wayOnLabel.label;
}

function refresh(): void {
  const snap = engine.snapshot();
  if (!snap) return;
  lastSnap = snap;

  if (!snap.inDungeon) {
    ended = false;
    audio.setView('title');
    setMode(title.isVisible ? 'title' : 'screen');
    if (!director.render()) {
      const options = panelOptions('full');
      termView.render(buffer, { x0: 0, y0: options.title ? 1 : 0, x1: buffer.cols - 1, y1: buffer.rows - 1 }, options);
    } else {
      termView.hide();
    }
    updatePromptCard();
    updateActionBar();
    return;
  }
  director.hide();
  updatePlace(snap);

  if (!materialsLoaded) {
    features = engine.features();
    materials = buildMaterials(features);
    featureRoles = {
      down: features.map((f) => WAY_ON.down.test(f.name.toLowerCase())),
      up: features.map((f) => WAY_ON.up.test(f.name.toLowerCase())),
    };
    audio.setDoors(doorKinds(features, FB_DOOR, FB_NO_WALK));
    map.setMaterials(materials);
    materialsLoaded = true;
  }
  map.setPalette(buffer.paletteRgb);
  map.setSnapshot(snap);
  updateMapMemory(snap);

  if (hasEffects && performance.now() - effectsAt > EFFECT_LINGER_MS) {
    map.setEffects([]);
    hasEffects = false;
  }

  if (snap.icky) {
    setMode('overlay');
    const under = engine.savedScreen() ?? base;
    const region = (under ? buffer.diffBounds(under, 1) : null) ?? { x0: 0, y0: 1, x1: buffer.cols - 1, y1: buffer.rows - 1 };
    const rows = bufferRows(buffer, 0, buffer.rows - 1);
    const screen = characterScreen();
    const characterView = !!(screen.skills || screen.abilities || screen.sheet);
    const tomb = parseTomb(rows);
    const fame = !tomb && ended && isHallOfFame(rows);
    if (tomb) ended = true;
    app.classList.toggle('ended', !!tomb || fame);
    if (termView.visible && currentBox() && !character.hosting) {
      /* The panel stays as it was beneath a message box. */
    } else if (tomb) {
      if (chronicles.fall(tomb.name)) chronicles.save();
      if (heroMemoryId) {
        mapMemory.forget(heroMemoryId);
        mapMemory.save();
        heroMemory = null;
        heroMemoryId = '';
        landMemory = null;
      }
      const tale = chronicles.peek(tomb.name);
      const fallen = memorial?.name === tomb.name ? memorial : null;
      termView.renderCustom({ layout: 'full', title: 'Your adventure has ended' }, `${JSON.stringify(tomb)}:${!!fallen}`, () =>
        tombElements(tomb, {
          memorial: fallen,
          tale,
          tip: nextTimeTip(fallen?.tale ?? tale ?? newChronicle(tomb.name), tomb.cause, tomb.depth),
          onHero: (tab) => openFallenHero(tab),
          onFoe: (foe) => openFoe(sheets, foe),
        }),
      );
    } else if (fame) {
      const player = lastState?.player;
      const scores = engine.scores();
      const hero = player ? heroEntry(scores, { name: player.name, level: player.lev, turns: snap.turn }) : -1;
      termView.renderCustom({ layout: 'full', title: 'Hall of Fame', subtitle: 'Tap a hero to look back on them' }, `fame:${scores.length}:${hero}`, () =>
        hallOfFameElements(scores, hero, (entry) => openFameHero(entry, true)),
      );
    } else if (character.render(screen) || characterView) {
      /* The character sheet shows these screens; one typed on the map opens it at the next idle. */
      termView.hide();
    } else {
      termView.render(buffer, region, panelOptions('panel'));
    }
    map.setReticle(null);
  } else {
    setMode('map');
    termView.hide();
    const cursor = rowZeroText() ? terminalToDungeon(snap, buffer.cursorX, buffer.cursorY) : null;
    map.setReticle(cursor && (cursor.x !== snap.px || cursor.y !== snap.py) ? cursor : null);
  }
  updatePromptCard();

  const state = engine.gameState();
  if (state) {
    if (state.player) {
      state.player.area = areaName(place) ?? undefined;
      state.player.inTown = !!place && place.depth === 0 && !place.wild && place.town > 0;
    }
    const previous = lastState;
    lastState = state;
    forgetUnseen(noticed, state.monsters ?? []);
    hud.update(state, snap.py, snap.px);
    if (state.player) feel.update(state.player);
    const sameHero = !!previous && previous.player?.name === state.player?.name;
    const slain = sameHero ? slainMonsters(previous.monsters ?? [], state.monsters ?? [], newMessages(previous, state)) : [];
    if (sameHero) showHits(previous, state, slain);
    if (state.player) chronicleUpdate(state.player, slain, snap.turn, sameHero && (previous.player?.chp ?? 0) > state.player.chp);
    if (state.player?.dead) captureMemorial(state.player, state, snap);
    const store = currentStore();
    if (store && !inStore) audio.cue('shop');
    inStore = !!store;
    audio.setView(ended ? 'gameover' : 'game');
    audio.update(snap, state, inStore);
    coach.update(mode === 'map' && snap.atCommand && !looking && lookCard.hidden && !map.overview, snap.turn);
    hud.updateMessages(
      state.messages ?? [],
      state.messageTotal ?? 0,
      promptCard.visible ? [] : rowSegments(buffer.chars.subarray(0, buffer.cols), buffer.attrs.subarray(0, buffer.cols), buffer.palette),
    );
  }
  updateActionBar();
}

/**
 * Marks creatures whose health dropped since the last state and floats the
 * damage over them; a creature that vanished with a kill message gets a
 * farewell and a ring in its colour instead.
 */
function showHits(previous: GameState, next: GameState, slain: readonly Slain[]): void {
  if (mode !== 'map' || (next.player?.status.hallucinating ?? 0) > 0) return;
  const before = new Map((previous.monsters ?? []).map((m) => [m.id, m]));
  let marked = false;
  const mark = (point: MapPoint, text: string, kind: string) => {
    map.markHit(point);
    marked = true;
    const at = map.cellCentre(point.x, point.y);
    feel.floatAt(at.x, at.y, text, kind);
    return at;
  };
  for (const m of next.monsters ?? []) {
    const was = before.get(m.id);
    if (was && m.hp < was.hp) mark(m, `−${was.hp - m.hp}`, isHostile(m) ? 'damage' : 'damage ally');
  }
  for (const s of slain) {
    const at = mark(s, 'Slain', 'kill');
    feel.ringAt(at.x, at.y, buffer.palette[s.attr] ?? '#ffd56a');
  }
  /* With animation off no frames are scheduled, so the flash is cleared explicitly. */
  if (marked) window.setTimeout(() => requestFrame(), HIT_FLASH_MS + 50);
}

/* Chronicle: kills, streaks, legends and deeds */

let chronicle: Chronicle | null = null;
let streak: Streak = { count: 0, lastTurn: 0 };

function chronicleUpdate(player: PlayerState, slain: readonly Slain[], turn: number, hurt: boolean): void {
  app.classList.toggle('fallen', !!player.dead);
  if (player.dead) return;
  if (chronicle?.name !== player.name) {
    chronicle = chronicles.hero(player.name);
    streak = { count: 0, lastTurn: 0 };
  }
  const hero = chronicle;
  const before = JSON.stringify(hero);
  const careerBefore = JSON.stringify(chronicles.career);
  const next = extendStreak(streak, slain.length, turn);
  streak = next.streak;
  record(hero, chronicles.career, player, slain, streak.count, hurt);
  const legend = slain.find((s) => s.unique);
  if (legend) {
    feel.announce(titleName(legend.name), 'A legend falls', 'legend');
    feel.shake(0.7);
  } else if (next.name) {
    feel.announce(next.name, `${streak.count} foes in quick succession`, 'streak');
  }
  const deeds = newDeeds(hero, chronicles.career, chronicles.earned);
  if (deeds.length) {
    chronicles.award(hero, deeds);
    if (deeds.length > 2) feel.showDeed(`${deeds.length} deeds earned`, deeds.map((d) => d.title).join(' · '));
    else for (const deed of deeds) feel.showDeed(deed.title, deed.text);
    audio.cue('levelup');
  }
  if (deeds.length || JSON.stringify(hero) !== before || JSON.stringify(chronicles.career) !== careerBefore) chronicles.save();
}

/* Fallen heroes */

/** Keeps the hero as they were when they fell: sheet, gear, skills, the foe and the last messages. */
function captureMemorial(player: PlayerState, state: GameState, snap: LevelSnapshot): void {
  const key = memorialKey({ name: player.name, turn: snap.turn });
  if (memorial && memorialKey(memorial) === key) return;
  const kept = chronicles.memorial(key);
  if (kept) {
    memorial = kept;
    return;
  }
  const palette = buffer.palette;
  const built = buildMemorial({
    player,
    character: engine.character(),
    inventory: engine.inventory(),
    messages: engine.gameState(60)?.messages ?? state.messages ?? [],
    monsters: state.monsters ?? [],
    px: snap.px,
    py: snap.py,
    turn: snap.turn,
    place: player.depth > 0 ? player.dungeon : (player.area ?? ''),
    palette,
    slotName: (part) => SLOT_NAMES[part] ?? 'Slot',
    describe: (item) => descriptionParagraphs(engine.objectDescription(item)),
    recall: (m) => (engine.monsterRecall(m.id)?.text ?? []).map(([attr, text]) => ({ text, colour: attr === 1 ? '' : (palette[attr] ?? '') })),
  });
  const tale = chronicles.peek(player.name);
  if (tale) built.tale = structuredClone(tale);
  memorial = built;
  chronicles.remember(key, built);
  chronicles.save();
}

function openFallenHero(tab: FallenTab = 'hero'): void {
  if (!memorial) return;
  if (travel || picker) stopAutomation(null, 'fallen');
  const scores = engine.scores();
  openFallen(sheets, { memorial, entry: scores.find((e) => entryKey(e) === memorialKey(memorial!)) ?? null }, tab);
}

/** A hero in the Hall of Fame; one who fell on this device can be looked back on in full, and some begun anew. */
function openFameHero(entry: ScoreEntry, inGame: boolean): void {
  const kept = chronicles.memorial(entryKey(entry));
  const anew = inGame ? fallenSaveFor(entry) : director.canBeginAnew(entry);
  openFallen(sheets, {
    memorial: kept,
    entry,
    anew: anew
      ? () => {
          sheets.closeAll();
          if (inGame) {
            pendingAnew = entry.name;
            finishGame();
          } else {
            director.beginAnew(entry.name);
          }
        }
      : undefined,
  });
}

/** In the game the savefile list is not at hand; a fallen hero's own savefile is the one just written. */
function fallenSaveFor(entry: ScoreEntry): boolean {
  return !!memorial && memorial.name === entry.name && entryKey(entry) === memorialKey(memorial);
}

/* Shops */

function currentStore(): StoreScreen | null {
  if (mode !== 'overlay') return null;
  const screen = buffer.screenText();
  if (!/You may:/.test(screen)) return null;
  const choices = parseRows(bufferRows(buffer, 0, buffer.rows - 1), 0, 0, buffer.cols - 1).filter(
    (b): b is ChoiceBlock => b.kind === 'choice',
  );
  return parseStore(screen, choices);
}

function storeActions(store: StoreScreen): Action[] {
  const actions: Action[] = [{ id: 'leave', label: 'Leave', icon: '‹', effect: { kind: 'keys', keys: [KEY_ESCAPE] } }];
  for (const command of store.commands) {
    if (!/^(Sell|Drop) an item/i.test(command.label)) continue;
    const label = /^Sell/i.test(command.label) ? 'Sell' : 'Store';
    actions.push({ id: `store-${command.key}`, label, icon: '⇣', effect: { kind: 'keys', keys: [BACKSLASH, command.key.charCodeAt(0)] } });
  }
  if (store.hasNextPage) actions.push({ id: 'nextpage', label: 'More', icon: '»', effect: { kind: 'keys', keys: [SPACE] } });
  actions.push(
    { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } },
    { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } },
  );
  return actions;
}

/* Action bar */

function underfootName(snap: LevelSnapshot): string {
  return features[snap.feat[snap.py * snap.width + snap.px]]?.name.toLowerCase() ?? '';
}

/** A weapon or light worth equipping from the pack. */
function gearSuggestion(): GearSuggestion | null {
  const snap = lastSnap;
  if (!snap?.inDungeon || !snap.atCommand) return null;
  const inventory = engine.inventory();
  const player = lastState?.player;
  if (!inventory?.ready || !player) return null;
  return suggestedGear(inventory, {
    inDungeon: snap.depth > 0,
    hurt: player.mhp > 0 && player.chp < player.mhp / 2,
    hungry: statusLabels(player).some((l) => l === 'Hungry' || l === 'Weak'),
    wieldsWeapons: heroStyle().weapons,
  });
}

/** The weakest hostile creature next to the player, if any. */
function adjacentFoe(): MonsterState | null {
  const snap = lastSnap;
  if (!snap?.inDungeon || !snap.atCommand) return null;
  const foes = (lastState?.monsters ?? []).filter((m) => isHostile(m) && isAdjacent(m.x, m.y, snap.px, snap.py));
  foes.sort((a, b) => a.hp / Math.max(1, a.maxhp) - b.hp / Math.max(1, b.maxhp));
  return foes[0] ?? null;
}

function useSuggested(): void {
  const gear = gearSuggestion();
  if (!gear) return;
  const command = gear.kind === 'heal' ? 'q' : gear.kind === 'eat' ? 'E' : 'w';
  const action = itemActions(gear.item, 'pack').find((a) => a.command === command);
  if (action) runMacro(itemMacro(action, gear.item, 'pack'));
}

function updateActionBar(force = false): void {
  const snap = lastSnap;
  const directed = mode === 'screen' ? director.actions() : null;
  const prompt = currentPrompt();
  const store = prompt === 'none' || prompt === 'other' ? currentStore() : null;
  const foe = adjacentFoe();
  map.setFoe(foe && mode === 'map' ? { x: foe.x, y: foe.y } : null);
  const actions =
    directed ??
    (store ? storeActions(store) : null) ??
    contextActions({
      mode,
      prompt,
      promptText: rowZeroText(),
      cardShown: promptCard.visible,
      listShown: termView.visible && (termView.choices().length > 0 || termView.options().length > 0),
      fallen: !!lastState?.player?.dead,
      screen: !termView.visible ? null : termView.options().length ? 'options' : /You may now dump a character record/.test(buffer.screenText()) || (ended && /Hall of Fame/.test(rowZeroText())) ? 'gameover' : /Help file '/.test(rowZeroText()) ? 'help' : isFileViewer(rowZeroText()) ? 'file' : null,
      looking,
      overview: map.overview,
      atCommand: !!snap?.atCommand,
      underfoot: snap && snap.inDungeon ? underfootName(snap) : '',
      floorObjects: snap?.floorObjects ?? 0,
      alwaysPickup: alwaysPickup(),
      gear: gearSuggestion()?.kind ?? null,
      foe: foe && snap ? directionDigit(foe.x - snap.px, foe.y - snap.py) : null,
      foeInView: hostileInView(),
      recast: mode === 'map' && snap?.atCommand ? (() => {
        const entry = recastEntry();
        return entry ? recentLabel(entry) : null;
      })() : null,
      canFire: mode === 'map' && !!snap?.atCommand && canFire(),
      magic: mode === 'map' && snap?.atCommand ? magicLabel() : undefined,
      worldMap: !!snap?.inDungeon && snap.depth === 0 && snap.wild,
      wayOn: mode === 'map' ? wayOnLabelFor(snap) : null,
    });
  currentActions = actions;
  termView.setActions(mode === 'overlay' ? panelActions(actions) : []);
  const key = actions.map((a) => `${a.id}:${a.label}`).join(',');
  if (key === actionsKey && !force) return;
  actionsKey = key;
  toolbar.replaceChildren(
    ...actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action.id;
      button.className = action.primary ? 'action primary' : 'action';
      button.setAttribute('aria-label', action.label);
      const icon = document.createElement('span');
      icon.className = 'action-icon';
      icon.textContent = iconText(action.icon);
      const label = document.createElement('span');
      label.className = action.label.length > 9 ? 'action-label longer' : action.label.length > 6 ? 'action-label long' : 'action-label';
      label.textContent = action.label;
      button.append(icon, label);
      return button;
    }),
  );
}

/* Toolbar actions a pop-up's own frame already offers (its close button) or that belong to the map. */
const FRAME_ACTIONS = new Set(['menu', 'escape', 'keyboard', 'leave']);

/** What a tome2 panel offers at its foot: the toolbar's actions for the screen, less those its frame covers. */
function panelActions(actions: readonly Action[]): PopAction[] {
  return actions
    .filter((a) => !FRAME_ACTIONS.has(a.id))
    .map((a) => ({ id: a.id, label: a.label, icon: a.icon, primary: a.primary, run: () => runAction(a) }));
}

function runAction(action: Action): void {
  if (travel || picker) stopAutomation(null, 'action');
  switch (action.effect.kind) {
    case 'keys':
      send(action.effect.keys);
      break;
    case 'keyboard':
      if (document.activeElement === keyboardInput) keyboardInput.blur();
      else keyboardInput.focus();
      break;
    case 'menu':
      openGameMenu();
      break;
    case 'commands':
      openCommands();
      break;
    case 'ctrl':
      setCtrlLatched(!ctrlLatched);
      break;
    case 'native':
      openNative(action.effect.view);
      break;
    case 'nav':
      navigate(action.effect.direction);
      break;
    case 'run':
      action.effect.run();
      break;
  }
}

/** Up/down/select in tome2 menus: moves tome2's own cursor when it has one, otherwise the highlight. */
function navigate(direction: 'up' | 'down' | 'select'): void {
  if (termView.visible && termView.choices().length > 0 && !termView.hasCursor) {
    if (direction === 'select') termView.activate();
    else termView.move(direction);
    return;
  }
  if (direction === 'select') send([KEY_ENTER]);
  else send(directionKeys(direction === 'up' ? '8' : '2', false));
}

function alwaysPickup(): boolean {
  return !!lastState?.player?.alwaysPickup;
}

/* Native views that open over the Commands sheet, so Back returns to it. */
const STACKED_VIEWS = new Set<NativeView>(['inventory', 'equipment', 'character', 'skills', 'abilities', 'magic', 'knowledge', 'history']);

function openCommands(): void {
  const body = el('div', 'commands');
  const run = (def: CommandDef) => {
    if (def.native && STACKED_VIEWS.has(def.native)) {
      openNative(def.native);
    } else if (def.native) {
      sheets.closeAll();
      openNative(def.native);
    } else if (def.reading && lastSnap?.atCommand) {
      coverSheets(true);
      send(commandKeys(def, alwaysPickup()));
    } else {
      api.send(commandKeys(def, alwaysPickup()));
    }
  };
  const snap = lastSnap;
  const where = !snap?.inDungeon || snap.depth > 0 ? 'dungeon' : snap.wild ? 'worldMap' : 'land';
  for (const group of commandGroups(where)) {
    const sectionEl = el('section', 'sheet-section');
    const grid = el('div', 'command-grid');
    for (const def of group.commands) {
      const button = el('button', 'command');
      button.type = 'button';
      button.dataset.nav = '';
      button.append(el('span', 'command-icon', iconText(def.icon)), el('span', undefined, def.label));
      button.addEventListener('click', () => run(def));
      grid.append(button);
    }
    sectionEl.append(el('h3', undefined, group.title), grid);
    body.append(sectionEl);
  }
  const keys = el('section', 'sheet-section');
  const grid = el('div', 'command-grid');
  const extra: [string, string, () => void][] = [
    ['⌨', 'Keyboard', () => {
      sheets.closeAll();
      keyboardInput.focus();
    }],
    ['^', 'Ctrl + next key', () => {
      sheets.closeAll();
      setCtrlLatched(!ctrlLatched);
    }],
    ['⎋', 'Escape', () => api.send([KEY_ESCAPE])],
    ['⏎', 'Enter', () => api.send([KEY_ENTER])],
  ];
  for (const [icon, label, onClick] of extra) {
    const button = el('button', 'command');
    button.type = 'button';
    button.dataset.nav = '';
    button.append(el('span', 'command-icon', iconText(icon)), el('span', undefined, label));
    button.addEventListener('click', onClick);
    grid.append(button);
  }
  keys.append(el('h3', undefined, 'Keys'), grid);
  body.append(keys);
  sheets.open({ title: 'Commands', body, className: 'sheet-commands' });
}

/* Travel and targeting */

function travelContext(): TravelContext | null {
  if (!lastSnap || !lastState?.player) return null;
  return { snap: lastSnap, materials, monsters: lastState.monsters ?? [], hp: lastState.player.chp };
}

function stopAutomation(message: string | null, cause: string): void {
  if (travel || picker) lastStopCause = cause;
  if (travel instanceof Explore && lastSnap) {
    exploreAnchor = travel.anchor;
    exploreLastStop = { x: lastSnap.px, y: lastSnap.py };
  }
  window.clearTimeout(travelTimer);
  travelTimer = 0;
  travel = null;
  picker = null;
  map.setPath(null);
  if (message) showToast(message);
  requestFrame();
}

function stepTravel(): void {
  travelTimer = 0;
  if (!engine.awaitingInput) return;
  const ctx = travelContext();
  if (!travel || !ctx) return;
  if (travel instanceof Explore) noteSpotted(ctx.snap);
  const step = travel.step(ctx);
  if (step.kind === 'stop') {
    const dark = step.reason === 'explored' && travel instanceof Explore && gearSuggestion()?.kind === 'light';
    const spotted = travel instanceof Explore ? spottedText() : null;
    const reason = dark
      ? 'It is too dark to explore. Tap Light to light your way.'
      : step.creature
        ? `You stop: ${titleName(step.creature)} is near.`
        : step.reason === 'arrived' && travelApproximate
          ? STOP_MESSAGES.closest
          : STOP_MESSAGES[step.reason];
    const message = [reason, spotted].filter(Boolean).join(' ');
    stopAutomation(message || null, step.reason);
    return;
  }
  map.setPath(step.path);
  engine.sendKeys(step.keys);
  requestFrame();
}

/**
 * Walks towards a place on the map: there when a known way leads there,
 * otherwise as far as the known way goes towards it.
 */
function startTravel(goal: MapPoint): void {
  const ctx = travelContext();
  if (!ctx) return;
  stopAutomation(null, 'new travel');
  recentreMap();
  const snap = ctx.snap;
  const approach = approachTarget(snap, materials, goal);
  if (!approach && !isAdjacent(snap.px, snap.py, goal.x, goal.y)) {
    showToast(STOP_MESSAGES.unreachable ?? '');
    return;
  }
  travel = new Travel(approach?.point ?? goal, ctx, { noticed });
  travelApproximate = !!approach && !approach.exact;
  stepTravel();
}

/* Exploring carries on from where it began when the hero is about where it last stopped. */
const ANCHOR_DRIFT = 3;

/** Notes items that come into view while exploring. */
function noteSpotted(snap: LevelSnapshot): void {
  const here = snap.py * snap.width + snap.px;
  for (const o of lastState?.objects ?? []) {
    const cell = o.y * snap.width + o.x;
    if (cell === here || exploreSeenItems.has(cell)) continue;
    exploreSeenItems.add(cell);
    exploreSpotted.set(cell, o.name);
  }
}

/** Items first seen during an exploration that are still lying there, for its closing message. */
function spottedText(): string | null {
  const snap = lastSnap;
  if (!snap || alwaysPickup()) return null;
  const names = [...exploreSpotted].filter(([cell]) => (snap.layer[cell] & LAYER_MASK) === LAYER_OBJECT).map(([, name]) => name);
  if (names.length === 0) return null;
  return names.length === 1 ? `You spotted ${names[0]} on the way.` : `You spotted ${names.length} items on the way.`;
}

/**
 * Walks to unexplored places until something needs attention; on an
 * explored level, goes to the way on, which a
 * further press takes.
 */
function startExplore(): void {
  const ctx = travelContext();
  if (!ctx) return;
  stopAutomation(null, 'explore');
  recentreMap();
  const here = { x: ctx.snap.px, y: ctx.snap.py };
  const resumed = !!exploreLastStop && Math.max(Math.abs(exploreLastStop.x - here.x), Math.abs(exploreLastStop.y - here.y)) <= ANCHOR_DRIFT;
  if (!exploreAnchor || !resumed) exploreAnchor = here;
  exploreSpotted.clear();
  for (const o of lastState?.objects ?? []) exploreSeenItems.add(o.y * ctx.snap.width + o.x);
  const plan = explorePlan();
  const stop = nextStop(ctx.snap, materials, plan);
  if (stop?.kind === 'exit' && stop.x === ctx.snap.px && stop.y === ctx.snap.py) {
    send([BACKSLASH, (plan.heading === 'up' ? '<' : '>').charCodeAt(0)]);
    return;
  }
  travel = new Explore(plan, noticed);
  travelApproximate = false;
  stepTravel();
}

function startTargeting(goal: MapPoint): void {
  stopAutomation(null, 'new target');
  picker = new TargetPicker(goal, lastState?.monsters?.length ?? 0);
  engine.sendKeys(picker.begin());
}

function stepTargeting(): void {
  const snap = lastSnap;
  if (!picker || !snap) return;
  const cursor = buffer.cursorY >= 0 ? terminalToDungeon(snap, buffer.cursorX, buffer.cursorY) : null;
  const prompt = classifyPrompt(rowZeroText());
  const targeting = !snap.atCommand && prompt !== 'aim' && prompt !== 'more';
  const step = picker.step(cursor, { x: snap.px, y: snap.py }, targeting);
  if (step.kind === 'keys') engine.sendKeys(step.keys);
  else stopAutomation(step.kind === 'fail' ? 'Could not target there.' : null, 'target');
}

/**
 * tome2's own inventory and equipment screens treat the next key as a new
 * command (so tapping "a" would aim a wand); they are replaced by the
 * native sheets.
 */
function redirectNativeScreen(): boolean {
  if (macros.running) return false;
  const m = /^(Inventory|Equipment): carrying/.exec(rowZeroText());
  if (m) {
    engine.sendKeys([KEY_ESCAPE]);
    openInventory(api, m[1] === 'Equipment' ? 'equip' : 'pack');
    return true;
  }
  if (/Display current knowledge/.test(buffer.screenText())) {
    engine.sendKeys([KEY_ESCAPE]);
    const trail = returnTo;
    returnTo = null;
    if (trail && !sheets.isOpen) sheets.restore(trail);
    else openKnowledge(api);
    return true;
  }
  return false;
}

/* Macros */

function runMacro(macro: Macro): void {
  if (travel || picker) stopAutomation(null, 'macro');
  recentreMap();
  const keys = macros.start(macro);
  if (keys.length) engine.sendKeys(keys);
}

function stepMacro(): void {
  const keys = macros.step({ prompt: rowZeroText(), screen: buffer.screenText(), atCommand: !!lastSnap?.atCommand });
  if (keys.length) {
    engine.sendKeys(keys);
    return;
  }
  /* The macro ended at a question for the player: show its card now. */
  updatePromptCard();
  updateActionBar();
}

/* Taps and gestures on the stage */

function recentreMap(): void {
  if (!map.panned) return;
  map.resetPan();
  recentre.hidden = true;
  dirty = true;
  requestFrame();
}

function continueIfWaiting(): void {
  const prompt = classifyPrompt(rowZeroText());
  if (prompt === 'more' || /Press any key|\[Press any key/.test(buffer.screenText())) send([SPACE]);
}

function insideControls(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('#messages, .tv-layer, #look-card, #recentre, #look-banner, .director, .prompt-card, .coach');
}

function onStageTap(clientX: number, clientY: number, target: EventTarget | null): void {
  if (title.isVisible || sheets.isOpen || insideControls(target)) return;
  if (travel || picker) {
    stopAutomation(null, 'tap');
    return;
  }
  const prompt = currentPrompt();
  if (prompt === 'more') {
    send([SPACE]);
    return;
  }
  if (promptCard.visible && prompt !== 'aim' && prompt !== 'direction') return;

  const snap = lastSnap;
  if (mode === 'map' && snap) {
    const cell = map.cellAt(clientX, clientY);
    if (map.overview) {
      setOverview(false);
      if (cell && snap.atCommand) startTravel(cell);
      return;
    }
    if (looking) {
      if (cell) showLookCard(cell);
      return;
    }
    if (!lookCard.hidden) {
      hideLookCard();
      return;
    }
    const outside = map.gridAt(clientX, clientY);
    const goal = cell ?? (onLand(snap) && outside ? edgeCell(snap.width, snap.height, outside) : null);
    recentreMap();
    if (goal) tapMapCell(snap, goal, prompt);
    return;
  }
  if (mode === 'overlay') {
    send([KEY_ESCAPE]);
    return;
  }
  continueIfWaiting();
}

/** Walking the land, where stepping off the edge of an area leads into the next. */
function onLand(snap: LevelSnapshot): boolean {
  return snap.inDungeon && snap.depth === 0 && !snap.wild && !place?.quest;
}

function tapMapCell(snap: LevelSnapshot, cell: MapPoint, prompt: ReturnType<typeof classifyPrompt>): void {
  const player = { x: snap.px, y: snap.py };
  const near = isAdjacent(player.x, player.y, cell.x, cell.y);
  const digit = (dx: number, dy: number) => directionKeys(directionDigit(dx, dy) ?? '5', false);

  if (prompt === 'direction') {
    if (near) send(digit(cell.x - player.x, cell.y - player.y));
    return;
  }
  if (prompt === 'aim') {
    if (near) send(digit(cell.x - player.x, cell.y - player.y));
    else startTargeting(cell);
    return;
  }
  if (!snap.atCommand) {
    /* Resting, running or repeating: a tap interrupts it. */
    if (prompt === 'none') send([KEY_ESCAPE]);
    return;
  }
  if (cell.x === player.x && cell.y === player.y) {
    send([BACKSLASH, waitCommand(alwaysPickup()).charCodeAt(0)]);
    return;
  }
  if (!isKnown(snap, cell)) {
    strideInto(snap, cell);
    return;
  }
  startTravel(cell);
}

/** A tap on unseen ground: walks as near as the known way leads, or one step into the dark. */
function strideInto(snap: LevelSnapshot, cell: MapPoint): void {
  if (approachTarget(snap, materials, cell)) {
    startTravel(cell);
    return;
  }
  const digit = directionDigit(cell.x - snap.px, cell.y - snap.py);
  if (digit && digit !== '5') send([BACKSLASH, ...keyCodes(';' + digit)]);
}

attachMapGestures(stage, {
  onTap: onStageTap,
  onLongPress(clientX, clientY, target) {
    if (title.isVisible || sheets.isOpen || insideControls(target) || mode !== 'map') return;
    const cell = map.cellAt(clientX, clientY);
    if (cell) {
      if (travel || picker) stopAutomation(null, 'look');
      navigator.vibrate?.(10);
      showLookCard(cell);
    }
  },
  onPan(dx, dy) {
    if (mode !== 'map' || title.isVisible || map.overview) return;
    map.panBy(dx, dy);
    recentre.hidden = !map.panned;
    requestFrame();
    map.render(performance.now(), animating());
  },
  onPanEnd() {
    map.endPan();
  },
});

recentre.addEventListener('click', () => recentreMap());

/* Autosave */

/** Sends tome2's save command at the command prompt; the sync to browser storage follows once the engine is back at it. */
function saveGame(notify: 'silent' | 'toast'): boolean {
  const snap = engine.state === 'running' ? engine.snapshot() : null;
  if (!snap || !snap.inDungeon || !snap.atCommand || snap.icky || quitting) return false;
  lastSavedTurn = snap.turn;
  pendingSync = notify;
  engine.sendKeys([BACKSLASH, CTRL_S]);
  return true;
}

function autosave(): void {
  if (travel || picker) stopAutomation(null, 'autosave');
  const snap = engine.state === 'running' ? engine.snapshot() : null;
  if (snap && snap.turn !== lastSavedTurn && saveGame('silent')) return;
  persistMapMemory();
  engine.syncNow().catch((err) => console.error('Saving to browser storage failed', err));
}

/** Collects bolt and explosion glyphs drawn over the map during an animation pause. */
function captureEffects(): void {
  const snap = lastSnap;
  if (!snap || !snap.inDungeon || snap.icky || !base) return;
  if (snap.panelRow !== basePanel.row || snap.panelCol !== basePanel.col) return;
  const effects: MapEffect[] = [];
  for (let row: number = snap.rowMap; row < buffer.rows - 1; row++) {
    for (let col: number = snap.colMap; col < buffer.cols; col++) {
      const i = row * buffer.cols + col;
      const ch = buffer.chars[i];
      if (ch === 0x20 || (ch === base.chars[i] && buffer.attrs[i] === base.attrs[i])) continue;
      const point = terminalToDungeon(snap, col, row);
      if (point) effects.push({ ...point, ch, attr: buffer.attrs[i] });
    }
  }
  if (effects.length > MAX_EFFECT_CELLS) return;
  map.setEffects(effects);
  audio.effects(effects);
  hasEffects = effects.length > 0;
  effectsAt = performance.now();
}

/* Frame loop */

let frameHandle = 0;
let lastFrame = 0;

function animating(): boolean {
  return settings.animation !== 'off' && document.visibilityState === 'visible';
}

let renderWanted = false;

/** Asks for a frame; `draw` false only keeps an animation ticking at its frame rate. */
function requestFrame(draw = true): void {
  if (draw) renderWanted = true;
  if (!frameHandle) frameHandle = requestAnimationFrame(frame);
}

function frame(now: number): void {
  frameHandle = 0;
  const fps = ANIMATION_FPS[settings.animation];
  const due = fps > 0 && now - lastFrame >= 1000 / fps - 2;

  if (dirty || due || renderWanted) {
    renderWanted = false;
    if (dirty) {
      dirty = false;
      if (engine.state === 'running') refresh();
    }
    lastFrame = now;
    const started = performance.now();
    if (mode === 'screen') {
      fire.render(animating());
    } else if (mode !== 'title') {
      map.render(now, animating());
    }
    lastRenderMs = performance.now() - started;
  }

  if ((animating() && mode !== 'title') || dirty) requestFrame(false);
}

/* Engine */

const engine = new Engine(buffer, {
  onStatus(text, fraction) {
    title.setStatus(/^Downloading/.test(text) ? 'Kindling the fires…' : text.replace(/\s*\(\d.*\)$/, '…'), fraction);
  },
  onRunning() {
    layout();
    engine.setAutoMore(settings.messages === 'flow');
    engine.setPersistentLevels(settings.persistentLevels);
    dirty = true;
    requestFrame();
    const storageError = engine.storageError;
    if (storageError) {
      openMessage(
        sheets,
        'Saves unavailable',
        `Saved games could not be loaded from this browser's storage (${storageError}). Saving to the browser is switched off for this session so existing saves are not overwritten. You can still play and use Export saves to keep a copy.`,
      );
    }
  },
  onExit(message) {
    if (quitting) {
      returnToTitle();
      return;
    }
    title.showEnd(message ?? 'The game has ended. Your progress is saved in this browser.', false, [
      { label: 'Play again', run: () => returnToTitle() },
    ]);
  },
  onError(message) {
    title.showEnd(message, true, [{ label: 'Reload', run: () => location.reload() }]);
  },
  onFlush() {
    dirty = true;
    requestFrame();
  },
  onIdle() {
    /* Storage has been read from the browser by the time the engine first waits for a key. */
    if (!chronicles.loaded) chronicles.load(engine.fs, engine.savePath);
    if (!mapMemory.loaded) mapMemory.load(engine.fs, engine.savePath);
    director.idle();
    refresh();
    dirty = false;
    if (lastSnap?.inDungeon && !lastSnap.icky) {
      base = buffer.copy();
      basePanel = { row: lastSnap.panelRow, col: lastSnap.panelCol };
    }
    if (hasEffects) {
      map.setEffects([]);
      hasEffects = false;
    }
    hud.tick();
    if (pendingSync && lastSnap?.atCommand) {
      const notify = pendingSync === 'toast';
      pendingSync = null;
      persistMapMemory();
      engine.syncNow().then(
        () => {
          if (!notify) return;
          showToast(engine.storageError ? 'Saved for this session only' : 'Game saved');
          audio.cue('save');
        },
        (err) => {
          console.error('Save sync failed', err);
          showToast('Saving to browser storage failed');
        },
      );
    }
    if (engine.pendingKeys > 0) {
      requestFrame();
      return;
    }
    const used = lastSnap?.inDungeon ? castWatcher.idle(rowZeroText(), !!lastSnap.atCommand) : null;
    if (used) api.remember(used);
    if (redirectNativeScreen()) {
      requestFrame();
      return;
    }
    if (lastSnap?.inDungeon && !macros.running) {
      const screen = characterScreen();
      if (!character.isOpen) character.adopt(screen);
      if (character.step(screen)) {
        requestFrame();
        return;
      }
    }
    reopenSheets();
    if (macros.running) {
      stepMacro();
    } else if (travel && !travelTimer) {
      travelTimer = window.setTimeout(stepTravel, animating() ? TRAVEL_STEP_MS : 0);
    } else if (picker) {
      stepTargeting();
    }
    requestFrame();
  },
  onKey(code) {
    audio.keyConsumed(code, lastSnap?.atCommand ?? false);
  },
  onEffectFrame() {
    director.effectFrame();
    refresh();
    captureEffects();
    if (mode === 'map' || mode === 'overlay') map.render(performance.now(), animating());
  },
});
(api as { engine: Engine }).engine = engine;

function send(codes: number[] | null): void {
  if (!codes || codes.length === 0) return;
  const key = codes.length === 1 ? codes[0] : codes.length === 2 && codes[0] === BACKSLASH ? codes[1] : null;
  if (key !== null && lastSnap?.inDungeon) castWatcher.note(rowZeroText(), buffer.screenText(), key, !!lastSnap.atCommand);
  if (travel || picker) stopAutomation(null, 'send');
  if (macros.running) macros.cancel();
  recentreMap();
  engine.sendKeys(codes);
  if (ctrlLatched) setCtrlLatched(false);
}

const director = new Director({
  root: stage,
  buffer,
  engine,
  sheets,
  palette: () => buffer.palette,
  send: (keys) => engine.sendKeys(keys),
  requestRefresh: () => {
    dirty = true;
    requestFrame();
  },
});

const feel = new GameFeel(byId<HTMLElement>('stage'), () => settings.animation);
const chronicles = new ChronicleStore();
const coach = new Coach(byId<HTMLElement>('stage'));
const title = new TitleScreen(byId<HTMLElement>('title-screen'), () => settings.animation, {
  onChoose: (choice) => director.choose(choice),
  onReady: () => {
    const name = pendingAnew;
    pendingAnew = null;
    if (name && director.beginAnew(name)) return;
    adoptUpdate?.();
  },
  onSettings: () => openSettingsSheet(),
  onSaves: () => openSavesMenu(),
  onMusic: () => openSoundtrack(sheets, audio),
  onFame: () => openHallOfFame(),
  onHidden: () => {
    dirty = true;
    requestFrame();
  },
});
director.attachTitle(title);

/* Layout */

/* Matches the CSS for landscape, where the HUD is a sidebar and the message log moves into it. */
const sidebarLayout = window.matchMedia('(orientation: landscape) and (min-width: 560px)');

function layout(): void {
  if (sidebarLayout.matches && messagesEl.parentElement !== hudEl) hudEl.append(messagesEl);
  else if (!sidebarLayout.matches && messagesEl.parentElement !== stage) stage.insertBefore(messagesEl, lookBanner);
  const rect = stage.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  map.resize(width, height);
  fire.resize(width, height);
  dirty = true;
  requestFrame();
}

/** The top safe-area inset in CSS pixels. */
function safeTop(): number {
  const probe = el('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;padding-top:var(--safe-top)';
  document.body.append(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

/**
 * True when an iOS home-screen app's view is shorter than the screen by the
 * status bar: the view then ends above the home indicator.
 */
function shortStandaloneView(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return false;
  const portrait = window.innerHeight >= window.innerWidth;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const missing = full - window.innerHeight;
  const top = safeTop();
  return missing > 0 && top > 0 && Math.abs(missing - top) <= 2;
}

/* Height of the view without the on-screen keyboard, for the current width. */
let fullHeight = 0;
let fullWidth = 0;

function editingText(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === 'text');
}

/**
 * The app fills the screen with CSS; only while the on-screen keyboard
 * covers part of it does it shrink to the visible area above the keyboard.
 */
function updateAppHeight(): void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const visible = viewport?.height ?? window.innerHeight;
  const layout = Math.max(window.innerHeight, root.clientHeight);
  if (window.innerWidth !== fullWidth) {
    fullWidth = window.innerWidth;
    fullHeight = 0;
  }
  fullHeight = editingText() ? Math.max(fullHeight, layout) : Math.max(layout, visible);
  const keyboard = visible < fullHeight - KEYBOARD_MIN_PX;
  root.classList.toggle('keyboard-open', keyboard);
  root.classList.toggle('keyboard-tight', keyboard && visible < KEYBOARD_TIGHT_PX);
  if (keyboard) {
    root.style.setProperty('--app-height', `${Math.round(visible)}px`);
    root.style.setProperty('--app-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
  } else if (window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
  root.classList.toggle('short-view', shortStandaloneView());
}

new ResizeObserver(() => layout()).observe(stage);
window.visualViewport?.addEventListener('resize', updateAppHeight);
window.visualViewport?.addEventListener('scroll', updateAppHeight);
window.addEventListener('resize', updateAppHeight);
document.addEventListener('focusin', updateAppHeight);
document.addEventListener('focusout', () => window.setTimeout(updateAppHeight, 100));
window.addEventListener('orientationchange', () => window.setTimeout(updateAppHeight, 250));
updateAppHeight();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave();
  else requestFrame();
});
window.addEventListener('pagehide', () => autosave());

/* Hardware keyboard and soft keyboard */

const CONTROL_KEYS = new Set(['Tab', 'Enter', ' ']);

/** True when the focused element handles this key itself (text fields: all keys; buttons and links: Tab, Enter, Space). */
function controlOwnsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement) || target === keyboardInput) return false;
  if (target.closest('input, select, textarea, [contenteditable]')) return true;
  return CONTROL_KEYS.has(key) && target.closest('button, a') !== null;
}

/* Browsers only start audio from a gesture; this also resumes audio the system interrupted. */
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) {
  window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
}
audio.start();

window.addEventListener('keydown', (e) => {
  if (sheets.isOpen) {
    sheets.handleKey(e);
    return;
  }
  if (title.isVisible) {
    title.handleKey(e);
    return;
  }
  if (e.isComposing || controlOwnsKey(e.target, e.key)) return;
  if (mode === 'screen' && director.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (currentActions.some((a) => a.id === 'finish')) {
    /* End of game: arrows move through the Hall of Fame, Enter opens a row, Escape (or Enter with nothing to open) continues. */
    e.preventDefault();
    if (e.key !== 'Escape' && termView.navigate(e)) return;
    if ((e.key === 'Escape' || e.key === 'Enter') && !macros.running) finishGame();
    return;
  }
  if (termView.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if ((looking || map.overview) && e.key === 'Escape') {
    e.preventDefault();
    setLooking(false);
    setOverview(false);
    return;
  }
  const codes = translateKey(e, ctrlLatched);
  if (!codes) return;
  e.preventDefault();
  send(codes);
});

attachSoftKeyboard(keyboardInput, send, () => ctrlLatched);

/* Zoom */

let pinchStartZoom = settings.zoom;
attachPinch(
  stage,
  (ratio) => {
    if (mode !== 'map' && mode !== 'overlay') return;
    if (map.overview) setOverview(false);
    map.zoom = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom * ratio)));
    requestFrame();
    map.render(performance.now(), animating());
  },
  () => {
    settings = { ...settings, zoom: map.zoom };
    pinchStartZoom = map.zoom;
    saveSettings(settings);
  },
);

stage.addEventListener(
  'wheel',
  (e) => {
    if (insideControls(e.target)) return;
    if (mode !== 'map') return;
    e.preventDefault();
    if (e.ctrlKey) {
      map.zoom = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, map.zoom * (e.deltaY < 0 ? 1.08 : 0.92))));
      settings = { ...settings, zoom: map.zoom };
      pinchStartZoom = map.zoom;
      saveSettings(settings);
    } else {
      map.panBy(-e.deltaX, -e.deltaY);
      map.endPan();
      recentre.hidden = !map.panned;
    }
    map.render(performance.now(), animating());
  },
  { passive: false },
);

/* Toolbar */

toolbar.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const action = currentActions.find((a) => a.id === button?.dataset.action);
  if (action) runAction(action);
});

/* Toolbar buttons must not steal focus from the soft keyboard. */
toolbar.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button[data-action]:not([data-action="menu"]):not([data-action="commands"])')) {
    e.preventDefault();
  }
});

/* Game menu */

function openSettingsSheet(): void {
  openSettings(sheets, settings, (next) => {
    if (settings.persistentLevels && !next.persistentLevels && heroMemory) mapMemory.forgetLevels(heroMemory);
    settings = next;
    engine.setPersistentLevels(settings.persistentLevels);
    saveSettings(settings);
    applySettings();
    engine.setAutoMore(settings.messages === 'flow');
    audio.setVolumes(settings.music, settings.sound);
    map.zoom = settings.zoom;
    pinchStartZoom = settings.zoom;
    map.glyphMode = settings.glyphs;
    dirty = true;
    requestFrame();
    title.animationChanged();
  });
}

/** Applies the settings that live in CSS: text size and animation. */
function applySettings(): void {
  applyTextSize(settings.textSize);
  document.documentElement.dataset.animation = settings.animation;
}

function inGame(): boolean {
  return !!lastSnap?.inDungeon;
}

/** Saves, waits for the save to reach browser storage, then returns to the title screen. */
function saveAndQuit(): void {
  sheets.closeAll();
  if (!inGame()) {
    location.reload();
    return;
  }
  quitting = true;
  stopAutomation(null, 'quit');
  showToast('Saving…');
  runMacro(quitMacro());
}

/**
 * Back to the title screen once the engine has exited, with a fresh engine
 * in the same page: the music carries on, as a reload would need another tap
 * before the browser lets it play.
 */
function returnToTitle(): void {
  sheets.closeAll();
  stopAutomation(null, 'title');
  if (macros.running) macros.cancel();
  promptCard.hide();
  termView.hide();
  hideLookCard();
  if (looking) setLooking(false);
  if (map.overview) setOverview(false);
  base = null;
  lastSnap = null;
  lastState = null;
  returnTo = null;
  pendingSync = null;
  lastSavedTurn = -1;
  inStore = false;
  ended = false;
  quitting = false;
  memorial = null;
  chronicle = null;
  streak = { count: 0, lastTurn: 0 };
  persistMapMemory();
  exploreSkip.clear();
  noticed.clear();
  exploreLevel = null;
  exploreAnchor = null;
  exploreLastStop = null;
  exploreSeenItems.clear();
  exploreLevelDepth = -1;
  exploreLevelDungeon = -1;
  heroMemory = null;
  heroMemoryId = '';
  landMemory = null;
  memoryTurn = -1;
  wayOnLabel = { key: '', label: null };
  mapMemory.loaded = false;
  placeKey = '';
  styleKey = '';
  place = null;
  placePos = { x: -1, y: -1 };
  app.classList.remove('fallen', 'ended');
  buffer.clear();
  hud.reset();
  feel.reset();
  chronicles.loaded = false;
  director.reset();
  title.reset();
  setMode('title');
  audio.setView('title');
  updateActionBar(true);
  engine.reset();
  startEngine();
}

/** Moves on from the end-of-game summary to the Hall of Fame, and from there to the title. */
function finishGame(): void {
  quitting = true;
  stopAutomation(null, 'quit');
  runMacro(isHallOfFame(bufferRows(buffer, 0, buffer.rows - 1)) ? finishMacro() : leaveTombMacro());
}

/* Stops at the Hall of Fame, which has its own Continue; the game ends at once when there are no scores to show. */
function* leaveTombMacro(): Macro {
  let s = yield [KEY_ESCAPE];
  for (let i = 0; i < 8 && /-more-/.test(s.prompt); i++) s = yield [KEY_ESCAPE];
}

function* finishMacro(): Macro {
  let s = yield [KEY_ESCAPE];
  for (let i = 0; i < 8; i++) {
    if (/Press ESC to quit/.test(s.screen) || /-more-/.test(s.prompt)) s = yield [KEY_ESCAPE];
    else return;
  }
}

function* quitMacro(): Macro {
  let s = yield [KEY_ESCAPE, KEY_ESCAPE, KEY_ESCAPE];
  for (let i = 0; i < 6 && !s.atCommand; i++) s = yield [KEY_ESCAPE];
  s = yield [BACKSLASH, CTRL_X];
  for (let i = 0; i < 8; i++) {
    if (/Press ESC to quit/.test(s.screen)) s = yield [KEY_ESCAPE];
    else if (/Press Return|-more-/.test(s.prompt)) s = yield [KEY_ENTER];
    else return;
  }
}

function startExport(): void {
  sheets.closeAll();
  exportSaves().catch((err) => openMessage(sheets, 'Export failed', String(err instanceof Error ? err.message : err)));
}

function startImport(): void {
  sheets.closeAll();
  importFile.value = '';
  importFile.click();
}

/** The Hall of Fame from the title screen. */
function openHallOfFame(): void {
  const body = el('div', 'fame');
  body.append(section('Fallen heroes', ...hallOfFameElements(engine.scores(), -1, (entry) => openFameHero(entry, false))), ...careerElements(chronicles));
  sheets.open({ title: 'Hall of Fame', subtitle: 'Heroes of Middle-earth, remembered', body, className: 'sheet-fame' });
}

function openSavesMenu(): void {
  openMenu(
    sheets,
    'Saved games',
    [
      { label: 'Export saves', icon: '⤒', hint: 'Download a backup', run: startExport },
      { label: 'Import saves', icon: '⤓', hint: 'Restore a backup', run: startImport },
    ],
    'Saves are kept in this browser. Export them to keep a backup or move them to another device.',
  );
}

function openGameMenu(): void {
  const playing = inGame();
  const fallen = playing && !!lastState?.player?.dead;
  openMenu(sheets, 'Menu', [
    { label: fallen ? 'Your hero' : 'Character', icon: '@', hidden: !playing, run: () => (fallen ? openFallenHero() : character.open('summary')) },
    { label: 'Messages', icon: '≣', hidden: !playing, run: () => showHistory() },
    { label: 'Knowledge', icon: '¶', hint: 'Artifacts, creatures, quests', hidden: !playing || fallen, run: () => openKnowledge(api) },
    { label: 'Save game', icon: '⇩', hidden: !playing || !lastSnap?.atCommand, run: () => {
      sheets.closeAll();
      if (!saveGame('toast')) showToast('Finish what you are doing first.');
    } },
    { label: 'Settings', icon: '⚙', hint: 'Text size, animation, map', run: () => openSettingsSheet() },
    { label: 'How to play', icon: '?', run: () => openTemplate(sheets, 'How to play', 'help-template') },
    { label: 'Export saves', icon: '⤒', run: startExport },
    { label: 'Import saves', icon: '⤓', run: startImport },
    { label: 'About', icon: 'ℹ', run: () => openTemplate(sheets, 'About', 'about-template') },
    { label: playing ? 'Save and quit' : 'Quit to title', icon: '⏻', hint: 'Back to the title screen', hidden: fallen, run: () => {
      if (!playing) {
        saveAndQuit();
      } else if (engine.storageError) {
        confirmSheet(
          sheets,
          'Quit without keeping this game?',
          'Browser storage is unavailable this session, so this game cannot be kept. Export saves first if you want to keep it.',
          'Quit anyway',
          saveAndQuit,
          true,
        );
      } else {
        confirmSheet(sheets, 'Save and quit?', 'Your game is saved and you return to the title screen.', 'Save and quit', saveAndQuit);
      }
    } },
  ]);
}

async function exportSaves(): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    openMessage(sheets, 'Export saves', 'The game is still loading. Try again in a moment.');
    return;
  }
  await engine.syncNow().catch((err) => console.warn('Sync before export failed; exporting from memory', err));
  const files = collectFiles(fs, root);
  if (files.length === 0) {
    openMessage(sheets, 'Export saves', 'There are no saved games yet. Save from the menu first.');
    return;
  }
  downloadText(exportFilename(), encodeBundle(files));
}

async function importSaves(file: File): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    openMessage(sheets, 'Import saves', 'The game is still loading. Try again in a moment.');
    return;
  }
  if (engine.storageError) {
    openMessage(sheets, 'Import saves', 'Browser storage is unavailable this session, so imported saves would be lost on restart.');
    return;
  }
  const files = decodeBundle(await file.text());
  confirmSheet(
    sheets,
    'Import saves?',
    `Import ${files.length} file(s)? Saves with the same names are replaced and the game restarts. Unsaved progress in the current game is lost.`,
    'Import',
    () => {
      sheets.closeAll();
      try {
        writeFiles(fs, root, files);
      } catch (err) {
        openMessage(sheets, 'Import failed', `Nothing was changed: ${String(err instanceof Error ? err.message : err)}`);
        return;
      }
      engine.syncNow().then(() => location.reload(), (err) => openMessage(sheets, 'Import failed', String(err)));
    },
    true,
  );
}

importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (!file) return;
  importSaves(file).catch((err) => openMessage(sheets, 'Import failed', String(err instanceof Error ? err.message : err)));
});

/* Test and debugging hook */

window.__tome = {
  engine,
  feel,
  buffer,
  screenText: () => buffer.screenText(),
  sendText: (text) => engine.sendKeys(translateText(text)),
  mode: () => mode,
  stats: () => ({ renderMs: lastRenderMs, zoom: map.zoom }),
  tapCell: (x, y) => {
    if (lastSnap) tapMapCell(lastSnap, { x, y }, classifyPrompt(rowZeroText()));
  },
  mapCellCentre: (x, y) => map.cellCentre(x, y),
  actions: () => currentActions.map((a) => a.id),
  travelling: () => travel !== null,
  lastStopCause: () => lastStopCause,
  exploreStop: () => {
    if (!lastSnap) return null;
    const plan = explorePlan();
    const stop = nextStop(lastSnap, materials, plan);
    return { kind: stop?.kind ?? 'none', x: stop?.x ?? -1, y: stop?.y ?? -1, heading: plan.heading ?? 'down' };
  },
  macroRunning: () => macros.running,
  director,
  audio,
};

/* Service worker */

/** How often an open app asks for a new version, and the least time between two asks when it returns to the foreground. */
const UPDATE_EVERY_MS = 30 * 60_000;
const UPDATE_RECHECK_MS = 60_000;

/** Set once a service worker is registered: asks a waiting update to take over if the title screen idles. */
let adoptUpdate: (() => void) | null = null;

/**
 * A new version waits until nothing is in progress: it takes over (and the
 * page reloads) only while the title screen idles, so a game or a character
 * being created is never lost.
 */
function watchUpdates(registration: ServiceWorkerRegistration): void {
  const adopt = (worker: ServiceWorker | null) => {
    if (worker && worker.state === 'installed' && navigator.serviceWorker.controller && director.atTitle) {
      worker.postMessage({ type: 'skip-waiting' });
    }
  };
  adoptUpdate = () => adopt(registration.waiting);
  adopt(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => adopt(worker));
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (director.atTitle) location.reload();
  });
  let checkedAt = performance.now();
  const check = () => {
    const now = performance.now();
    if (document.visibilityState !== 'visible' || now - checkedAt < UPDATE_RECHECK_MS) return;
    checkedAt = now;
    registration.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', check);
  window.setInterval(check, UPDATE_EVERY_MS);
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(watchUpdates)
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}

/* Start */

/**
 * Holds an exclusive lock for this page so that two tabs never load and sync
 * the same saves. Resolves false when another tab already holds it.
 */
function acquireSessionLock(): Promise<boolean> {
  if (!('locks' in navigator)) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks
      .request('tome2mobile-session', { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>(() => undefined);
      })
      .catch(() => resolve(true));
  });
}

layout();
const params = new URLSearchParams(location.search);
const engineArgs = params.has('wizard') ? ['-w'] : [];
acquireSessionLock().then((acquired) => {
  if (!acquired) {
    title.showEnd('ToME 2 is already open in another tab or window. Close it, then reload this page.', true, [
      { label: 'Reload', run: () => location.reload() },
    ]);
    return;
  }
  startEngine();
});

function startEngine(): void {
  engine.start(new URL(`engine/tome.js?v=${__ENGINE_VERSION__}`, document.baseURI).href, engineArgs).catch((err) => {
    console.error(err);
  });
}
