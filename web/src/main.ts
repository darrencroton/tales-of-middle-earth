import './styles.css';
import { GameAudio } from './audio/audio.ts';
import type { Place } from './audio/places.ts';
import { attemptOutcome, doorKinds, freshMessages, launcherKind, spellTone, weaponKind, type SpellTone } from './audio/cues.ts';
import { Engine } from './engine.ts';
import { areaName, Hud, rowSegments, shortStandaloneView, statusLabels, type HudEntity } from './hud.ts';
import { attachMapGestures, attachPinch } from './input/gestures.ts';
import { directionKeys, KEY_BACKSLASH as BACKSLASH, KEY_BACKSPACE, KEY_ENTER, KEY_ESCAPE, keyCodes as codesOf, translateKey, translateText } from './input/keys.ts';
import { attachSoftKeyboard } from './input/softkeyboard.ts';
import { Director } from './flow/director.ts';
import { FireEffect } from './render/fire.ts';
import { HIT_FLASH_MS, MapRenderer, MAX_ZOOM, MIN_ZOOM, type MapEffect, type MapPoint } from './render/map.ts';
import { buildMaterials, FB_DOOR, FB_NO_WALK, type FeatureInfo, type Material } from './render/materials.ts';
import { commandGroups, commandKeys, contextActions, contextualAction, transitionUnderfoot, waitCommand, type Action, type ActionContext, type CommandDef, type ExploreNext, type NativeView, type Slot } from './play/actions.ts';
import { keyCodes, MacroRunner, type Macro } from './play/macro.ts';
import { classifyPrompt, directionDigit, isAdjacent, type PromptKind } from './play/prompts.ts';
import { TargetPicker } from './play/targeting.ts';
import { approachTarget, goAction, pushPast, stopMessage as stopText, STOP_MESSAGES, tapAction, Travel, type TapAction, type TravelContext, type TravelStep } from './play/travel.ts';
import { Explore, nextStop, WAY_ON, type ExplorePlan } from './play/explore.ts';
import { levelKey, MapMemoryStore, mergeKnown, missingCells, questKey, type HeroMemory } from './play/mapmemory.ts';
import { CAVE_MARK, isHostile, LAYER_MASK, LEAD_LINES, leadInMessages, newMessages, LAYER_MONSTER, LAYER_OBJECT, type GameState, type LevelQuest, type LevelSnapshot, type MessageState, type MonsterState, type ObjectState, type PlayerState, type ScoreEntry, type SpellState, type StoreCommand, type StoreState } from './render/snapshot.ts';
import {
  collectFiles,
  decodeBundle,
  downloadText,
  encodeBundle,
  exportFilename,
  findSaveIndex,
  writeFiles,
} from './saves.ts';
import { adventurerOf, AdventurerStore, deleteHeroSave, heroLine, saveBase } from './play/adventurers.ts';
import { adventurerSummary, openAdventurers, type AdventurerDetails, type AdventurerHandlers } from './ui/adventurers.ts';
import type { SaveInfo } from './title.ts';
import { ANIMATION_FPS, applyTextSize, EFFECT_DELAY, loadSettings, saveSettings, type Settings } from './settings.ts';
import { TerminalBuffer, type ScreenCopy } from './terminal.ts';
import { TitleScreen } from './title.ts';
import { openSoundtrack } from './ui/soundtrack.ts';
import { openHelp } from './ui/help.ts';
import { openMagic, openSpell, RecentStore } from './ui/magic.ts';
import { CastWatcher, fireMacro, NO_TARGET, quickRecent, recentBlocked, recentItem, recentItemAction, recentLabel, recentMagicMacro, thenAim, type RecentAction } from './play/recent.ts';
import { descriptionParagraphs, titleName, type GameApi } from './ui/api.ts';
import { GameFeel, type FeelEvent } from './feel.ts';
import { Coach } from './ui/coach.ts';
import {
  fightingStyle,
  INVEN_AMMO,
  INVEN_BOW,
  INVEN_WIELD,
  itemMacro,
  SLOT_NAMES,
  suggestedGear,
  type FightingStyle,
  type GearSuggestion,
} from './play/items.ts';
import { ABANDONED, buildMemorial, entryKey, memorialKey, type Memorial } from './play/memorial.ts';
import { openFallen, openFoe, type FallenTab } from './ui/memorial.ts';
import { CharacterPanel, openKnowledge, type CharacterScreen } from './ui/character.ts';
import { el, glyph, iconText, navButton, section } from './ui/dom.ts';
import { onTap } from './ui/tap.ts';
import { describeCell, monsterSummary, openFloorObject, openMonster, openQuest, type CellDescription } from './ui/info.ts';
import { openInventory } from './ui/inventory.ts';
import { askQuantity, askText, confirmSheet, openHistory, openMenu, openMessage, openSettings, openTemplate, type AdventureRules } from './ui/menus.ts';
import { Sheets, type SheetContent, type SheetTrail } from './ui/sheet.ts';
import { bufferRows, type OptionBlock } from './ui/termparse.ts';
import { TermView, type TermViewOptions, type TermViewTab } from './ui/termview.ts';
import { PromptCard, type CardKind } from './ui/promptcard.ts';
import { defaultItem, setRefusal, type PopAction } from './ui/popup.ts';
import { ListNav } from './ui/listnav.ts';
import { cleanPrompt, describableRange } from './ui/prompttext.ts';
import { FilePages, parseHelpFile, viewerSource, viewerHeading, type HelpFile, type HelpLink, type ViewerHeading } from './ui/filepages.ts';
import { drawnBlocks, entranceLabel, offerElements, SERVICE_CLEAR, serviceReply, shelfElements, shelfPage, shopModel, trades, type ShopHandlers, type ShopModel, type ShopTab } from './ui/store.ts';
import { parseAbilities, parseSkills } from './ui/skills.ts';
import { findMessageBox, type MessageBox } from './ui/msgbox.ts';
import { hallOfFameElements, heroEntry, isHallOfFame, openFameCard, parseTomb, tombElements } from './ui/gameover.ts';
import { careerElements, ChronicleStore } from './ui/deeds.ts';
import { extendStreak, newChronicle, newDeeds, nextTimeTip, record, slainMonsters, type Chronicle, type Slain, type Streak } from './play/chronicle.ts';
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
      settings(): Settings;
      lastStopCause(): string;
      exploreStop(): { kind: string; x: number; y: number; heading: string } | null;
      macroRunning(): boolean;
      /** The gear the toolbar would suggest (eat, weapon, light), whatever the toolbar shows first. */
      gear(): string | null;
      takeGear(): void;
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
const RELAXED_STEP_MS = 120;
const PLACE_POLL_MS = 2000;
const CTRL_S = 0x13;
const CTRL_X = 0x18;
const SPACE = 0x20;
/* Messages read to tell what a building's service said. */
const SERVICE_MESSAGES = 30;
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
/** The look card's highlight: its rows and buttons, moved by arrows and swipes. */
const lookNav = new ListNav(lookCard);
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
/* Map memory: the level exploring is on (`levelKey`, or a stand-in where there is none), the hero's memory and the land area's remembered grids. */
let exploreLevel: string | null = null;
let exploreLevelDepth = -1;
/** Exploring's visits on this level are kept between visits: on the land, and on dungeon levels tome2 keeps. */
let exploreKeepsVisits = false;
const mapMemory = new MapMemoryStore();
let heroMemory: HeroMemory | null = null;
let heroMemoryId = '';
let landMemory: { key: string; width: number; height: number; mask: Uint8Array; changed: boolean } | null = null;
let memoryTurn = -1;
let memoryPos = -1;
/* What Explore would do (the toolbar's label), by turn and place. */
let exploreNextCache: { key: string; next: ExploreNext } = { key: '', next: 'explore' };
/** A spell, power, item or shot started from a button: once tome2 is back at the command prompt, a refusal or failure is told. */
let attempt: { turn: number; messages: string[] } | null = null;
/** Where exploring this level began (the map fills outwards from it), and where the hero stood when it last stopped. */
let exploreAnchor: MapPoint | null = null;
let exploreLastStop: MapPoint | null = null;
/** Items seen on this level while exploring (by cell), and those first seen during the current exploration. */
const exploreSeenItems = new Set<number>();
/** Cells where money has been seen on this level: exploring takes it up whatever the hero picks up. */
const levelGold = new Set<number>();
/* Counts changes to `levelGold`, for what Explore would do. */
let levelGoldVersion = 0;
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
/* A map toolbar button that has just changed ignores taps this long (Stop and the pace never do). */
const TOOLBAR_SETTLE_MS = 400;
const NEVER_SETTLE = new Set(['stop', 'pace']);
/** Per toolbar position: the button there (id and label) and until when it ignores taps. */
let toolbarSlots: { key: string; until: number }[] = [];
let dirty = true;
let effectsAt = 0;
let hasEffects = false;
/* A frame of a bolt or blast is being drawn (tome2 is mid-turn). */
let drawingEffect = false;
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
/** The hero whose adventure is being abandoned through tome2's quit: once the game has closed, what the frontend keeps of them is forgotten. */
let abandoning: string | null = null;
/** Sheets covered by a tome2 screen, reopened once it closes. */
let returnTo: SheetTrail | null = null;
const macros = new MacroRunner();

let sheetDepth = 0;
const sheets = new Sheets(document.body, () => {
  app.classList.toggle('sheet-open', sheets.isOpen);
  if (sheets.depth !== sheetDepth) audio.cue(sheets.depth > sheetDepth ? 'ui-open' : 'ui-close');
  sheetDepth = sheets.depth;
  updateActionBar();
  /* A quest moment held while sheets were open is told once they close. */
  tellQuestMoment();
});

const termView = new TermView(stage, () => buffer.palette, {
  onChoice(key) {
    const link = viewerFile()?.help?.links.find((l) => l.key === key);
    if (link) {
      followLink(link.index);
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
    if (viewerHeading(rowZeroText())) closeViewer();
    else send([KEY_ESCAPE]);
  },
  onLink(index) {
    followLink(index);
  },
});

const promptCard = new PromptCard(stage, (keys) => send(keys));

const hud = new Hud(hudEl, messagesEl, () => buffer.palette, {
  onEntity: (entity) => openEntity(entity),
  onPlayer: () => openNative(lastState?.player?.dead ? 'fallen' : 'character'),
  onSkills: () => openNative('skills'),
  onQuest: (quest) => openQuest(sheets, quest),
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

const TOAST_MS = 4400;
let toastTimer = 0;
/** Shows a short message over the foot of the map; unless it repeats one of tome2's (`log` false), it also goes in the message log. */
function showToast(text: string, log = true): void {
  if (log && inGame()) {
    engine.addNotice(text);
    dirty = true;
    requestFrame();
  }
  const area = stage.getBoundingClientRect();
  toast.style.setProperty('--toast-x', `${area.left + area.width / 2}px`);
  toast.style.setProperty('--toast-bottom', `calc(${window.innerHeight - area.bottom}px + 1rem)`);
  toast.style.setProperty('--toast-width', `calc(${area.width}px - 2rem)`);
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), TOAST_MS);
}

/** Clears a toast the player has moved on from. */
function hideToast(): void {
  window.clearTimeout(toastTimer);
  toast.classList.remove('visible');
}

/** Says why something cannot be done, with the refusal sound. */
function refuse(text: string): void {
  showToast(text);
  audio.cue('deny');
}
setRefusal(refuse);

/* Native views */

const api: GameApi = {
  engine: undefined as unknown as Engine,
  sheets,
  palette: () => buffer.palette,
  snapshot: () => lastSnap,
  state: () => lastState,
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
function runRecent(entry: RecentAction, aim = false, anyway = false): void {
  const why = anyway ? null : recentUnavailable(entry, false);
  if (why) {
    refuse(why);
    return;
  }
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
    watchAttempt();
    runMacro(thenAim(itemMacro(action, item, 'pack', '', alwaysPickup()), aim));
    return;
  }
  const macro = recentMagicMacro(entry, aim);
  if (!macro) return;
  if (entry.kind === 'spell') castWatcher.begin('m', [], entry.name);
  else castWatcher.begin(entry.command, entry.steps);
  audio.castingTone(entry.kind === 'spell' ? castingTone(entry.name) : null);
  watchAttempt();
  runMacro(macro);
}

/** The casting sound for a spell in the books carried, by its school. */
function castingTone(name: string): SpellTone | null {
  const school = currentSpells()?.books.flatMap((b) => b.spells).find((s) => s.name === name)?.school;
  return school ? spellTone(school) : null;
}

/** Starts watching an action begun from a button, so a refusal or failure is told once tome2 is back at the command prompt. */
function watchAttempt(): void {
  attempt = lastSnap ? { turn: lastSnap.turn, messages: [] } : null;
}

let gearTurn = -1;

/** Tells the audio what the hero fights and shoots with, once a game turn. */
function hearGear(turn: number): void {
  if (turn === gearTurn) return;
  const equip = engine.inventory()?.equip;
  if (!equip) return;
  gearTurn = turn;
  const held = (part: number) => equip.find((slot) => slot.part === part && !slot.empty && !!slot.name);
  const launcher = held(INVEN_BOW);
  audio.setGear(weaponKind(held(INVEN_WIELD)?.tval), launcherKind(launcher?.tval, launcher?.sval));
}

/** Gathers the messages of a watched action. */
function followAttempt(previous: GameState | null, state: GameState): void {
  if (attempt && previous) attempt.messages.push(...freshMessages(previous, state));
}

/** Once a watched action has ended (its macro done, tome2 back at the command prompt), tells the player when tome2 refused it or it failed. */
function settleAttempt(): void {
  const snap = lastSnap;
  if (!attempt || !snap?.atCommand || snap.icky || macros.running) return;
  const outcome = attemptOutcome(snap.turn !== attempt.turn, attempt.messages);
  attempt = null;
  if (outcome) showToast(outcome.message, false);
}

/* Spells carried, read once per game turn for the toolbar. */
let spellsCache: { turn: number; spells: SpellState | null } | null = null;

function currentSpells(): SpellState | null {
  const turn = lastSnap?.turn ?? -1;
  if (spellsCache?.turn !== turn) spellsCache = { turn, spells: engine.spells() };
  return spellsCache.spells;
}

/** The toolbar's quick repeat (`quickRecent`), while the game waits for a command. */
function quickEntry(): RecentAction | null {
  if (!lastSnap?.atCommand) return null;
  return quickRecent(api.recent(), currentSpells(), engine.inventory()?.pack ?? [], heroStyle().magic, lastState?.player?.lev ?? 0);
}

/** Why a recent action cannot be done now (`recentBlocked`). */
function recentUnavailable(entry: RecentAction, needTarget: boolean): string | null {
  return recentBlocked(entry, currentSpells(), engine.inventory()?.pack ?? [], needTarget, targetInSight());
}

/** A hostile creature a spell or missile can be aimed at, as tome2's "nearest target" needs. */
function targetInSight(): boolean {
  return (lastState?.monsters ?? []).some((m) => isHostile(m) && !!m.target);
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

/**
 * The toolbar's magic button: for a hero who uses magic, Cast with spell
 * books and Powers with only skills or race powers; for others, Powers when
 * their race or class gives them some. None without any.
 */
function magicLabel(): string | null {
  const spells = currentSpells();
  if (!heroStyle().magic) return spells?.bonus.length ? 'Powers' : null;
  if (!spells || spells.books.length) return 'Cast';
  return spells.powers.length || spells.bonus.length ? 'Powers' : null;
}

/** The Fire button, for a hero with a launcher wielded; it says why it cannot shoot now. */
function fireSlot(): Slot | null {
  const equip = engine.inventory()?.equip ?? [];
  const ready = (part: number) => equip.some((slot) => slot.part === part && !slot.empty && !!slot.name);
  if (!ready(INVEN_BOW)) return null;
  return { unavailable: !ready(INVEN_AMMO) ? 'Your quiver is empty.' : !targetInSight() ? NO_TARGET : null };
}

const character = new CharacterPanel(api, {
  sendKeys: (keys) => send(keys),
  source: (letter) => sheetSource(letter),
  refuse,
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
  if ((travel || picker) && view !== 'pace') stopAutomation(null, 'native');
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
      openMagic(api, api.recent(), { run: (entry, anyway) => runRecent(entry, false, anyway) });
      break;
    case 'recast': {
      const entry = quickEntry();
      if (entry) runRecent(entry, targetInSight());
      break;
    }
    case 'fire':
      watchAttempt();
      runMacro(fireMacro());
      break;
    case 'halt':
      break;
    case 'pace':
      settings = { ...settings, explorePace: settings.explorePace === 'relaxed' ? 'normal' : 'relaxed' };
      saveSettings(settings);
      updateActionBar();
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
    case 'closeFile':
      closeViewer();
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
    showToast('Tap a place to travel there', false);
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

/* How the look card says where a cell's contents are known from. */
const LOOK_NOTES: Readonly<Record<CellDescription['note'], string>> = { here: 'Where you stand', view: 'In view', remembered: 'Remembered', unknown: '' };

/** What is at a map cell, as a card at the foot of the map: its terrain, then each creature and item there (a tap opens its card), and Go there. */
function showLookCard(point: MapPoint): void {
  const description = describeCell(api, point);
  if (!description) return;
  map.setLookCell(point);
  const head = el('div', 'look-head');
  head.append(el('p', 'look-title', description.title));
  const note = LOOK_NOTES[description.note];
  if (note) head.append(el('span', 'look-note', note));
  const rows = el('div', 'look-rows');
  const row = (ch: number, attr: number, name: string, aside: string, open: () => void) => {
    const button = el('button', 'look-row');
    button.type = 'button';
    button.dataset.nav = '';
    button.append(glyph(ch, buffer.palette[attr] ?? '#fff'), el('span', 'look-name', name));
    if (aside) button.append(el('span', 'look-aside', aside));
    button.addEventListener('click', open);
    rows.append(button);
  };
  for (const m of description.monsters) row(m.ch, m.attr, titleName(m.name), monsterSummary(m), () => openMonster(api, m));
  for (const o of description.objects) row(o.ch, o.attr, o.name, '', () => openFloorObject(api, o));
  if (description.blurred) rows.append(el('p', 'look-text', 'You cannot make out what is there.'));
  else if (!description.known && !rows.childElementCount) rows.append(el('p', 'look-text', 'You have not explored there.'));
  const buttons = el('div', 'look-buttons');
  const add = (label: string, run: () => void) => {
    const button = el('button', 'look-button', label);
    button.type = 'button';
    button.dataset.nav = '';
    button.addEventListener('click', run);
    buttons.append(button);
  };
  const monster = description.monsters[0];
  if (!description.player && description.known && lastSnap?.atCommand) {
    add(monster && isHostile(monster) ? 'Attack' : 'Go there', () => {
      setLooking(false);
      startTravel(point);
    });
  }
  add('✕', () => hideLookCard());
  lookCard.replaceChildren(head, ...(rows.childElementCount ? [rows] : []), buttons);
  lookCard.hidden = false;
  lookNav.setActive(defaultItem(rows, buttons), false);
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

/** The game state when tome2 last waited for a command (on the map, or a building's). */
let commandState: GameState | null = null;
/**
 * What tome2 has said since it last waited for a command, oldest first, while
 * it asks something: shown with the question or menu (a rescued princess's
 * words above her reward), as tome2's -more- would have shown them first
 * (when messages pause, it has).
 */
let leadMessages: MessageState[] = [];
/** Lead lines have been shown (with a question or a tome2 panel) since tome2 last waited for a command. */
let leadShown = false;

function noteLeadShown(): void {
  leadShown = true;
  if (questMoment) questMoment.led = true;
}

/**
 * A quest begun (the hero arrived on its level) or ended, held back until
 * tome2 next waits for a command on the map, then shown as one card: its
 * title, what tome2 said since the command before it (the scene: a blow on
 * the head and a prison cell; the stairs revealed and Bree saved), and on
 * arrival what the quest asks. `led`: tome2 asked something meanwhile and
 * showed those words with it (a princess's reward), so the banner suffices.
 */
let questMoment: { event: Extract<FeelEvent, { kind: 'quest' | 'questEnd' }>; quest: LevelQuest; since: GameState | null; led: boolean } | null = null;

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
  if (prompt && kind !== 'more' && !CARD_KINDS.has(kind)) options.title = cleanPrompt(prompt) || undefined;
  if (kind === 'item') options.tabs = itemTabs(prompt);
  if (layout === 'panel' && leadMessages.length) {
    options.lead = leadMessages.map((m) => m.text);
    noteLeadShown();
  }
  if (viewerHeading(prompt)?.size === 0) options.empty = 'Nothing here yet.';
  const box = currentBox();
  if (box) options.hideRow = (row) => row >= box.top && row <= box.bottom;
  return options;
}

/* tome2's file viewer (knowledge lists, help, notes), read as whole files by scrolling (docs/ui-system.md). */

/** Files gathered while the viewer is open, by caption and length. */
const viewerFiles = new Map<string, FilePages>();
/** Game files read while the viewer is open, by path. */
const helpFiles = new Map<string, HelpFile>();
/** Files open in tome2's viewer, outermost first: the line each opened at, and where it was scrolled when another covered it. */
let viewerLevels: { key: string; line: number; scrollTop: number | null }[] = [];
/** What the keys just sent to the viewer do: open a file over this one, or go back to the one below. */
let viewerMove: 'open' | 'back' | null = null;
/** A tapped help link: tome2 is asked to show its line, then its link cursor is stepped onto it. */
let linkWanted: { key: string; link: HelpLink; tries: number } | null = null;
/** Escapes still to send to leave the viewer, one per idle. */
let viewerClosing = 0;
/* The original ToME manual was asked for from Help; otherwise tome2's help index (the ? key) gives way to Help. */
let manualWanted = false;
/* Escapes allowed for leaving the viewer, or one more than the files known to be open. */
const VIEWER_DEPTH = 12;

function viewerKey(heading: ViewerHeading): string {
  return `${heading.caption}\u0000${heading.size}`;
}

/** The file on screen, once all of it has been gathered, with its links when it is a help file. */
function viewerFile(): { key: string; file: FilePages; help: HelpFile | null } | null {
  const heading = viewerHeading(rowZeroText());
  if (!heading) return null;
  const key = viewerKey(heading);
  const file = viewerFiles.get(key);
  return file?.complete ? { key, file, help: helpFile(heading.caption) } : null;
}

/** Links and tags of the game file (help, a parchment) a caption names, read as tome2 reads them. */
function helpFile(caption: string): HelpFile | null {
  const source = viewerSource(caption);
  if (!source) return null;
  const path = `/lib/${source.dir}/${source.name}`;
  let help = helpFiles.get(path);
  if (!help) {
    let bytes: Uint8Array = new Uint8Array();
    try {
      bytes = engine.fs?.readFile(path) ?? bytes;
    } catch (err) {
      console.warn(`${path} could not be read`, err);
    }
    help = parseHelpFile(bytes);
    helpFiles.set(path, help);
  }
  return help;
}

/** Notes the file on screen as opened over the last one, or as the one below it come back to. */
function noteViewerLevel(key: string, line: number): void {
  const move = viewerMove;
  viewerMove = null;
  const top = viewerLevels.at(-1);
  if (top?.key === key) return;
  if (move === 'back' || (move === null && viewerLevels.at(-2)?.key === key)) {
    viewerLevels.pop();
    return;
  }
  if (top && termView.visible) top.scrollTop = termView.scrollTop;
  viewerLevels.push({ key, line, scrollTop: null });
}

/**
 * Runs the viewer at each idle: gathers the file tome2 is showing a page at
 * a time (each Space is read at once, so only the whole file is ever
 * shown), steps tome2's link cursor onto a tapped help link, and sends the
 * Escapes that leave it. True when keys were sent.
 */
function readViewer(): boolean {
  const heading = viewerHeading(rowZeroText());
  if (!heading) {
    viewerFiles.clear();
    helpFiles.clear();
    viewerLevels = [];
    viewerMove = null;
    linkWanted = null;
    viewerClosing = 0;
    return false;
  }
  if (engine.pendingKeys > 0) return false;
  if (!manualWanted && viewerLevels.length === 0 && heading.caption === "Help file 'help.hlp'") {
    engine.sendKeys([KEY_ESCAPE]);
    openHelpSheet();
    return true;
  }
  manualWanted = false;
  if (viewerClosing > 0) {
    viewerClosing--;
    engine.sendKeys([KEY_ESCAPE]);
    return true;
  }
  const key = viewerKey(heading);
  noteViewerLevel(key, heading.line);
  let file = viewerFiles.get(key);
  if (!file) {
    file = new FilePages(heading, buffer.rows - 4);
    viewerFiles.set(key, file);
  }
  const page = bufferRows(buffer, 2, buffer.rows - 3);
  if (!file.complete) {
    if (!file.add(heading.line, page)) return false;
    engine.sendKeys([SPACE]);
    return true;
  }
  const wanted = linkWanted;
  linkWanted = null;
  const help = helpFile(heading.caption);
  if (!wanted || wanted.key !== key || !help) return false;
  let current: number | null = null;
  page.forEach((row, i) => {
    for (const link of help.lines.get(heading.line + i) ?? []) {
      if (current === null && row.attrs[link.col] === help.selected) current = link.index;
    }
  });
  if (current === null) {
    /* Paging past the last link leaves tome2's cursor beyond it, on no link: one step back puts it on a link, in view. */
    if (wanted.tries <= 0) return false;
    linkWanted = { ...wanted, tries: wanted.tries - 1 };
    engine.sendKeys(codesOf('4'));
    return true;
  }
  const delta = wanted.link.index - current;
  viewerMove = 'open';
  engine.sendKeys([...codesOf((delta > 0 ? '6' : '4').repeat(Math.abs(delta))), KEY_ENTER]);
  return true;
}

/**
 * Follows a help link: one to another place in the same file only scrolls;
 * otherwise tome2 goes to the link's line, and `readViewer` then selects
 * and opens it.
 */
function followLink(index: number): void {
  const shown = viewerFile();
  const link = shown?.help?.links[index];
  if (!shown?.help || !link) return;
  if (link.file === viewerSource(shown.file.caption)?.name) {
    termView.scrollToRow(shown.file.rowOf(shown.help.tags.get(link.anchor) ?? 0));
    return;
  }
  linkWanted = { key: shown.key, link, tries: 1 };
  send([...codesOf(`#${link.line}`), KEY_ENTER]);
}

/** Leaves the viewer, however many files are open in it. */
function closeViewer(): void {
  viewerClosing = Math.max(VIEWER_DEPTH, viewerLevels.length + 1) - 1;
  send([KEY_ESCAPE]);
}

/**
 * Shows the whole file on screen in the panel; true whenever tome2's
 * viewer is open (while a file is still being gathered the panel stays as
 * it was).
 */
function renderViewer(layout: 'panel' | 'full'): boolean {
  if (!viewerHeading(rowZeroText())) return false;
  const shown = viewerFile();
  if (!shown) return true;
  const { key, file, help } = shown;
  const level = viewerLevels.at(-1);
  termView.render(file.source(buffer.cols), { x0: 0, y0: 0, x1: buffer.cols - 1, y1: Math.max(0, file.rows.length - 1) }, {
    ...panelOptions(layout),
    describe: null,
    cursorRow: undefined,
    back:
      viewerLevels.length > 1
        ? () => {
            viewerMove = 'back';
            send([KEY_BACKSPACE]);
          }
        : undefined,
    links: help ? (row) => help.lines.get(file.lineAt(row)) ?? [] : undefined,
    scroll: { key: `${viewerLevels.length}\u0000${key}`, top: level?.scrollTop ?? null, row: file.rowOf(level?.line ?? 0) },
  });
  return true;
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
  if (show) {
    promptCard.show(kind as CardKind, rowZeroText(), /'5'|current target/i.test(rowZeroText()), leadMessages.map((m) => m.text));
    if (leadMessages.length) noteLeadShown();
  } else promptCard.hide();
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

/** Puts what the hero remembers of the current level into the store, and the store into storage; notes where the hero is for the title screen. */
function persistMapMemory(): void {
  const player = lastState?.player;
  if (player?.name && !player.dead && adventurers.loaded) {
    adventurers.note(adventurerOf(player));
    adventurers.save();
  }
  if (heroMemory) {
    if (landMemory?.changed) {
      mapMemory.setArea(heroMemory, landMemory.key, landMemory.width, landMemory.height, landMemory.mask);
      landMemory.changed = false;
    }
    if (exploreLevel && exploreKeepsVisits) mapMemory.setVisited(heroMemory, exploreLevel, exploreSkip);
  }
  mapMemory.save();
}

/**
 * Which way the hero is now heading below ground, from the depth left and
 * the depth entered (tome2 depths hold across dungeons); null keeps it.
 */
function headingInto(next: Place): 'down' | 'up' | null {
  if (exploreLevel === null || next.depth === 0 || next.depth === exploreLevelDepth) return null;
  return next.depth > exploreLevelDepth ? 'down' : 'up';
}

function enterLevel(key: string, next: Place): void {
  persistMapMemory();
  const heading = headingInto(next);
  if (heroMemory && heading) mapMemory.setHeading(heroMemory, heading);
  exploreLevel = key;
  exploreLevelDepth = next.depth;
  exploreKeepsVisits = key.startsWith('land:') || !!next.kept;
  exploreSkip.clear();
  landMemory = null;
  memoryTurn = -1;
  exploreNextCache = { key: '', next: 'explore' };
  exploreAnchor = null;
  exploreLastStop = null;
  exploreSeenItems.clear();
  levelGold.clear();
  if (heroMemory && exploreKeepsVisits) for (const cell of heroMemory.visited[key] ?? []) exploreSkip.add(cell);
}

/**
 * Notes the cells in view that hold money, taking them out of the places
 * exploring is done with, and forgets those that hold something else or
 * nothing (a creature standing on money hides it).
 */
function noteGold(objects: readonly ObjectState[], snap: LevelSnapshot): void {
  const cells = objects.map((o) => o.y * snap.width + o.x);
  const gold = new Set(cells.filter((_, i) => objects[i].gold));
  let changed = false;
  for (const cell of cells) {
    if (gold.has(cell)) {
      changed ||= !levelGold.has(cell);
      levelGold.add(cell);
      exploreSkip.delete(cell);
    } else {
      changed ||= levelGold.delete(cell);
    }
  }
  for (const cell of levelGold) {
    const top = snap.layer[cell] & LAYER_MASK;
    if (top !== LAYER_OBJECT && top !== LAYER_MONSTER) changed ||= levelGold.delete(cell);
  }
  if (changed) levelGoldVersion++;
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
  const pos = snap.py * snap.width + snap.px;
  if (key !== exploreLevel) {
    enterLevel(key, current);
    memoryPos = pos;
  }
  if (snap.turn === memoryTurn && pos === memoryPos) return;
  memoryTurn = snap.turn;
  memoryPos = pos;
  noteVisited(snap);
  rememberLand(snap, key);
}

/* What each terrain feature means to exploring, by feature index (built with the materials). */
let featureRoles: { down: boolean[]; up: boolean[] } = { down: [], up: [] };

/**
 * Exploring's plan for this level. Below ground the way on is in the hero's
 * heading; a dungeon level with no known way that way (the bottom of a
 * dungeon, the top of one entered from its far end) is left the other way.
 * On the land it leads to no entrance: finding them is the player's.
 */
function explorePlan(): ExplorePlan {
  const heading = heroMemory?.heading ?? 'down';
  const underground = (lastSnap?.depth ?? 0) > 0;
  const role = (roles: boolean[]) => (i: number) => underground && !!lastSnap && !!roles[lastSnap.feat[i]];
  return {
    skip: exploreSkip,
    heading,
    isExit: role(featureRoles[heading]),
    isBackExit: underground ? role(featureRoles[heading === 'up' ? 'down' : 'up']) : undefined,
    anchor: exploreAnchor,
    collect: alwaysPickup() ? () => true : (i) => levelGold.has(i),
  };
}

/** What Explore would do now (see `ExploreNext`); on the land, once nothing is left, the way on is the world map. */
function exploreNext(snap: LevelSnapshot | null): ExploreNext {
  if (!snap?.atCommand || snap.wild || !materialsLoaded) return 'explore';
  const key = `${exploreLevel}:${snap.turn}:${snap.px},${snap.py}:${exploreSkip.size}:${levelGoldVersion}:${heroMemory?.heading}:${alwaysPickup()}`;
  if (exploreNextCache.key !== key) exploreNextCache = { key, next: exploreNextFrom(snap) };
  return exploreNextCache.next;
}

function exploreNextFrom(snap: LevelSnapshot): ExploreNext {
  const plan = explorePlan();
  const stop = nextStop(snap, materials, plan, companionCells(snap));
  if (!stop && nextStop(snap, materials, plan, 'all')) return 'explore';
  if (!stop) return snap.depth === 0 ? 'worldMap' : 'none';
  if (stop.kind !== 'exit') return 'explore';
  if (stop.x === snap.px && stop.y === snap.py) return 'here';
  return (plan.heading === 'up') !== !!stop.back ? 'up' : 'down';
}

function refresh(): void {
  const snap = engine.snapshot();
  if (!snap) return;
  lastSnap = snap;

  if (!snap.inDungeon) {
    ended = false;
    commandState = null;
    leadMessages = [];
    leadShown = false;
    questMoment = null;
    audio.setView('title');
    setMode(title.isVisible ? 'title' : 'screen');
    if (!director.render()) {
      const options = panelOptions('full');
      if (!renderViewer('full')) termView.render(buffer, { x0: 0, y0: options.title ? 1 : 0, x1: buffer.cols - 1, y1: buffer.rows - 1 }, options);
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

  const state = engine.gameState();
  /* A shop or other building waits for its own commands under its screen. */
  const atCommands = snap.atCommand || (snap.icky && atBuildingCommands());
  const lastCommandState = commandState;
  const ledSince = leadShown;
  if (state && atCommands) {
    commandState = state;
    leadShown = false;
  }
  leadMessages = leadInMessages(commandState, state, atCommands, settings.messages === 'flow');

  /* tome2 clears its screen flag when an item prompt ends, though the shop is still open until the trade's last question. */
  const trading = !!trade && !!engine.store();
  if (snap.icky || trading) {
    setMode('overlay');
    const under = engine.savedScreen() ?? base;
    const region = (under ? buffer.diffBounds(under, 1) : null) ?? { x0: 0, y0: 1, x1: buffer.cols - 1, y1: buffer.rows - 1 };
    const rows = bufferRows(buffer, 0, buffer.rows - 1);
    const screen = characterScreen();
    const characterView = !!(screen.skills || screen.abilities || screen.sheet);
    shownShop = currentShop();
    const tomb = abandoning ? null : parseTomb(rows);
    const fame = !tomb && ended && isHallOfFame(rows);
    if (tomb) ended = true;
    app.classList.toggle('ended', !!tomb || fame);
    if (abandoning) {
      /* tome2's end-of-game screens are passed while the adventure is abandoned. */
      termView.hide();
    } else if (termView.visible && currentBox() && !character.hosting) {
      /* The panel stays as it was beneath a message box. */
    } else if (tomb) {
      if (chronicles.fall(tomb.name, engine.gameState(0)?.player?.diedFrom === ABANDONED)) chronicles.save();
      if (adventurers.forget(tomb.name)) adventurers.save();
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
      termView.renderCustom({ layout: 'full', title: 'Hall of Fame', subtitle: 'Tap a hero for their tale' }, `fame:${scores.length}:${hero}`, () =>
        hallOfFameElements(scores, hero, (entry) => openFameHero(entry, true)),
      );
    } else if (shownShop) {
      renderShop(shownShop);
    } else if (character.render(screen) || characterView) {
      /* The character sheet shows these screens; one typed on the map opens it at the next idle. */
      termView.hide();
    } else if (!renderViewer('panel')) {
      termView.render(buffer, region, panelOptions('panel'));
    }
    map.setReticle(null);
  } else {
    setMode('map');
    shownShop = null;
    shopTab = null;
    termView.hide();
    const cursor = rowZeroText() ? terminalToDungeon(snap, buffer.cursorX, buffer.cursorY) : null;
    map.setReticle(cursor && (cursor.x !== snap.px || cursor.y !== snap.py) ? cursor : null);
  }
  updatePromptCard();

  if (state) {
    if (state.player) {
      state.player.area = areaName(place) ?? undefined;
      state.player.inTown = !!place && place.depth === 0 && !place.wild && place.town > 0;
    }
    const previous = lastState;
    lastState = state;
    noteGold(state.objects ?? [], snap);
    hud.update(state, snap.py, snap.px);
    if (state.player) {
      const quest = state.player.quest ?? previous?.player?.quest;
      for (const event of feel.update(state.player, (e) => (e.kind === 'quest' || e.kind === 'questEnd') && !!quest)) {
        if (questMoment) feel.play(questMoment.event);
        /* tome2 can ask (a princess's reward) before it marks the quest done, and with Pause its -more- has shown every word. */
        const led = ledSince || leadShown || (event.kind === 'questEnd' && settings.messages !== 'flow');
        questMoment = { event: event as NonNullable<typeof questMoment>['event'], quest: quest!, since: lastCommandState, led };
      }
      feel.setQuest(
        state.player.quest?.state === 'active' && !state.player.dead,
        !state.player.status.hallucinating && (state.monsters ?? []).some((m) => m.quest && m.view && isHostile(m)),
      );
    }
    const sameHero = !!previous && previous.player?.name === state.player?.name;
    const slain = sameHero ? slainMonsters(previous.monsters ?? [], state.monsters ?? [], newMessages(previous, state)) : [];
    if (sameHero) showHits(previous, state, slain);
    if (state.player) chronicleUpdate(state.player, slain, snap.turn, sameHero && (previous.player?.chp ?? 0) > state.player.chp);
    if (state.player?.dead) captureMemorial(state.player, state, snap);
    if (shownShop && !inStore) audio.cue('shop');
    inStore = !!shownShop;
    audio.setView(ended ? 'gameover' : 'game');
    hearGear(snap.turn);
    audio.update(snap, state, inStore);
    followAttempt(previous, state);
    coach.update(mode === 'map' && snap.atCommand && !looking && lookCard.hidden && !map.overview, snap.turn);
    /* A card that shows what tome2 has just said leaves the log to it. */
    hud.updateMessages(
      promptCard.hasLead ? [] : (state.messages ?? []),
      state.messageTotal ?? 0,
      promptCard.visible ? [] : rowSegments(buffer.chars.subarray(0, buffer.cols), buffer.attrs.subarray(0, buffer.cols), buffer.palette),
    );
    tellQuestMoment();
  }
  updateActionBar();
}

/* tome2's notes of things used up or gone, left out of a quest's scene. */
const SCENE_NOISE = /^You have no more /;

/**
 * Tells a held quest moment once tome2 waits for a command on the map with
 * nothing else open: a quest's first arrival as a card with the scene and
 * what it asks; its end as a card with the scene, unless tome2 already showed
 * those words with a question, or said nothing. Otherwise, and on a return
 * to a quest's level, its banner.
 */
function tellQuestMoment(): void {
  const moment = questMoment;
  const snap = lastSnap;
  const state = lastState;
  if (!moment || !snap || !state || mode !== 'map' || !snap.atCommand || travel || macros.running || sheets.isOpen || promptCard.visible) return;
  questMoment = null;
  const { event, quest } = moment;
  const arrival = event.kind === 'quest';
  const key = questKey(quest, snap.depth);
  const told = arrival && (!heroMemory || !key || heroMemory.quests.includes(key));
  const scene = moment.led || !moment.since ? [] : newMessages(moment.since, state).filter((m) => !SCENE_NOISE.test(m.text)).slice(0, LEAD_LINES).reverse().map((m) => m.text);
  if (told || (!arrival && !scene.length)) {
    feel.play(event);
    return;
  }
  if (arrival && heroMemory) mapMemory.noteQuest(heroMemory, key);
  const subtitle = event.kind === 'questEnd' ? (event.failed ? 'Quest failed' : 'Quest complete') : [event.place, event.feet ? `${event.feet} ft` : ''].filter(Boolean).join(' · ') || 'Quest';
  openQuest(sheets, quest, { subtitle, scene, task: arrival });
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
  app.classList.toggle('fallen', !!player.dead && !abandoning);
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
    for (const deed of deeds) engine.addNotice(`Deed earned: ${deed.title}.`);
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

/**
 * A hero in the Hall of Fame, as a card: one whose adventure ended on this
 * device can be looked back on in full, some begun anew, and on the title
 * screen any can be removed.
 */
function openFameHero(entry: ScoreEntry, inGame: boolean): void {
  const kept = chronicles.memorial(entryKey(entry));
  const anew = inGame ? fallenSaveFor(entry) : director.canBeginAnew(entry);
  openFameCard(sheets, { memorial: kept, entry }, {
    lookBack: kept ? () => openFallen(sheets, { memorial: kept, entry }) : undefined,
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
    remove: inGame ? undefined : () => removeFameEntry(entry),
    removeEndsAnew: anew && engine.scores().filter((e) => saveBase(e.name) === saveBase(entry.name)).length === 1,
  });
}

/**
 * Takes a hero out of the Hall of Fame with what was remembered of them;
 * the last of a name also takes the fallen hero's savefile, which only
 * Begin anew used.
 */
function removeFameEntry(entry: ScoreEntry): void {
  /* The confirmation and the hero's card close back to the Hall of Fame. */
  sheets.back();
  sheets.back();
  const same = (e: ScoreEntry) => entryKey(e) === entryKey(entry) && e.points === entry.points && e.day === entry.day;
  const index = engine.scores().findIndex(same);
  if (index < 0 || !engine.removeScore(index)) {
    showToast('The Hall of Fame could not be changed.', false);
    return;
  }
  if (chronicles.forgetMemorial(entryKey(entry))) chronicles.save();
  if (!engine.scores().some((e) => saveBase(e.name) === saveBase(entry.name)) && director.forgetFallen(entry.name)) deleteSavefile(entry.name);
  const shown = fameSheet;
  if (shown) sheets.update(hallOfFameSheet(), shown);
  engine.syncNow().then(
    () => showToast(`${entry.name} was removed from the Hall of Fame.`, false),
    (err) => {
      console.error('Saving to browser storage failed', err);
      showToast('Browser storage could not be updated.', false);
    },
  );
}

/** In the game the savefile list is not at hand; a fallen hero's own savefile is the one just written. */
function fallenSaveFor(entry: ScoreEntry): boolean {
  return !!memorial && memorial.name === entry.name && entryKey(entry) === memorialKey(memorial);
}

/* Shops */

/** The shop or home shown in the native panel, and which of its lists is open (kept while the hero stays inside). */
let shownShop: StoreState | null = null;
let shopTab: { name: string; tab: ShopTab } | null = null;
/** A trade under way: what is said once it has gone through, and how things stood before, to tell whether it did. */
let trade: { done: string | null; before: string; state: GameState | null } | null = null;

/**
 * The shop (or home, or museum) tome2 is in, shown natively from the
 * engine's data whatever its kind: while tome2 waits at the shop's own
 * commands, or while a trade answers its questions.
 */
function currentShop(): StoreState | null {
  if (mode !== 'overlay') return null;
  const store = engine.store();
  if (!store) return null;
  return trade || atBuildingCommands() ? store : null;
}

/** tome2 waits at a building's own commands (row 21 "You may:"), asking nothing else. */
function atBuildingCommands(): boolean {
  const prompt = currentPrompt();
  return (prompt === 'none' || prompt === 'other') && /^You may:/.test(buffer.rowText(21));
}

const shopHandlers: ShopHandlers = {
  trade(macro, done) {
    trade = { done, before: tradeState(), state: engine.gameState(20) };
    api.runMacro(macro);
    if (!macros.running) settleTrade();
  },
  page: () => shelfPage(buffer.screenText()),
};

/** Gold, stock and what the hero carries, to tell whether a trade went through. */
function tradeState(): string {
  const store = engine.store();
  const inventory = engine.inventory();
  return JSON.stringify([store?.gold, store?.stock.map((i) => [i.name, i.number]), inventory?.pack.map((i) => [i.name, i.number]), inventory?.equip.map((i) => i.name)]);
}

/** Once a trade's questions are answered: says it went through, or what tome2 said instead (no room, not enough gold). */
function settleTrade(): void {
  if (!trade || macros.running) return;
  const { done, before, state } = trade;
  trade = null;
  if (tradeState() !== before) {
    if (done) showToast(done, false);
    return;
  }
  const next = engine.gameState(20);
  const said = state && next ? newMessages(state, next)[0]?.text : undefined;
  if (!said && !done) return;
  showToast(said ? said.replace(/\s*-more-\s*$/, '') : 'Nothing changed.', false);
  audio.cue('deny');
}

function setShopTab(tab: ShopTab): void {
  if (!shopTab) return;
  shopTab.tab = tab;
  dirty = true;
  requestFrame();
}

/** The shop as a panel: its shelf (its services first) and what the hero can offer it as tabs, Exit beside them; a building that does not trade lists its services. */
function renderShop(store: StoreState): void {
  const model = shopModel(store);
  if (shopTab?.name !== store.name) shopTab = { name: store.name, tab: 'shelf' };
  if (!trades(store)) {
    termView.renderCustom(
      { layout: 'panel', title: store.name, subtitle: store.owner.replace(/\s*\(/, ' (') || undefined, actions: [{ id: 'exit', label: 'Exit', run: () => send([KEY_ESCAPE]) }] },
      JSON.stringify(model.extras),
      () => [servicesElement(model)],
    );
    return;
  }
  const tab = model.offer ? shopTab.tab : 'shelf';
  const inventory = engine.inventory();
  const tabs: TermViewTab[] = [
    { id: 'shelf', label: model.shelf.label, active: tab === 'shelf', run: () => setShopTab('shelf') },
    ...(model.offer ? [{ id: 'offer', label: model.offer.label, active: tab === 'offer', run: () => setShopTab('offer') }] : []),
    { id: 'exit', label: 'Exit', active: false, run: () => send([KEY_ESCAPE]) },
  ];
  const key = JSON.stringify([tab, store, inventory?.pack, inventory?.equip]);
  const shop = !store.home && !store.museum;
  termView.renderCustom({ layout: 'panel', title: store.name, subtitle: store.owner.replace(/\s*\(/, ' (') || undefined, badge: shop ? `${store.gold} gold` : undefined, tabs }, key, () =>
    tab === 'offer' && inventory
      ? offerElements(api, store, model, inventory, shopHandlers)
      : model.extras.length
        ? [section('Services', servicesElement(model)), section('For sale', ...shelfElements(api, store, model, shopHandlers))]
        : shelfElements(api, store, model, shopHandlers),
  );
}

/** A building's services (a quest to take, the town's history), each sent to tome2 as its own command. */
function servicesElement(model: ShopModel): HTMLElement {
  const list = el('div', 'menu-list');
  for (const extra of model.extras) {
    const row = navButton(extra.name, {
      hint: serviceHint(extra),
      className: `row-button${extra.closed ? ' unavailable' : ''}`,
      onClick: () => runService(extra),
    });
    row.dataset.key = extra.key;
    list.append(row);
  }
  if (!model.extras.length) list.append(el('p', 'empty', 'There is nothing to do here.'));
  return list;
}

/** What a service costs, or that the keeper will not do it for this hero. */
function serviceHint(command: StoreCommand): string | undefined {
  if (command.closed) return 'Not for you';
  return command.cost > 0 ? `${command.cost} gold` : undefined;
}

/**
 * A building's service under way: tome2 answers it by drawing over the
 * building's screen, which the native panel covers, and pages long answers
 * with -more- (held while it runs), so each page is kept as it is shown.
 */
let service: { name: string; before: string[]; state: GameState | null; pages: string[][][] } | null = null;

/** Asks for a service, or says why it cannot be had (no gold spent either way when it cannot); only while tome2 waits at the building's commands. */
function runService(command: StoreCommand): void {
  if (service || trade || macros.running || engine.pendingKeys > 0 || !atBuildingCommands()) return;
  if (command.closed) refuse('The keeper will not do that for you.');
  else if (command.cost > (lastState?.player?.au ?? 0)) refuse(`That costs ${command.cost} gold, more than you have.`);
  else {
    /* The rows a service draws on are blanked first, so an answer the same as the last one still shows. */
    engine.clearRows(SERVICE_CLEAR.first, SERVICE_CLEAR.last);
    service = { name: command.name, before: screenLines(), state: engine.gameState(SERVICE_MESSAGES), pages: [] };
    engine.setAutoMore(false);
    send([BACKSLASH, command.key.charCodeAt(0)]);
  }
}

function screenLines(): string[] {
  return buffer.screenText().split('\n');
}

/** Keeps what a service has drawn so far, leaving out blocks kept from an earlier page. */
function keepPage(run: NonNullable<typeof service>): void {
  const kept = new Set(run.pages.flat().map((block) => block.join('\n')));
  run.pages.push(drawnBlocks(run.before, screenLines()).filter((block) => !kept.has(block.join('\n'))));
}

/** Follows a service at each idle: keeps a page and turns it at -more-; once back at the building's commands (or out of it), shows what it said. True when a key was sent. */
function followService(): boolean {
  const run = service;
  if (!run || macros.running || engine.pendingKeys > 0 || viewerHeading(rowZeroText())) return false;
  if (currentPrompt() === 'more') {
    keepPage(run);
    engine.sendKeys([SPACE]);
    return true;
  }
  const inside = !!engine.store() && atBuildingCommands();
  const snap = engine.snapshot();
  if (!inside && snap?.inDungeon && !(snap.atCommand && !snap.icky)) return false;
  service = null;
  applyEngineSettings();
  if (inside) keepPage(run);
  const state = engine.gameState(SERVICE_MESSAGES);
  /* Oldest first, without tome2's count of a repeated message ("… <2x>"). */
  const said = run.state && state ? newMessages(run.state, state).map((m) => m.text.replace(/\s*<\d+x>$/, '')).reverse() : [];
  const reply = serviceReply(run.pages.filter((page) => page.length), said);
  if (reply.length) openMessage(sheets, run.name, reply, 'sheet-service');
  return false;
}

/** The toolbar while in a shop (beneath its panel). */
function shopActions(): Action[] {
  return [
    { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } },
    { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } },
  ];
}

/* Action bar */

function underfootName(snap: LevelSnapshot): string {
  return features[snap.feat[snap.py * snap.width + snap.px]]?.name.toLowerCase() ?? '';
}

/** The button for the door of a shop, the home or another building the hero stands at (tome2 calls them all buildings). */
function entranceHere(snap: LevelSnapshot): string | null {
  if (snap.wild || underfootName(snap) !== 'building') return null;
  const store = engine.store();
  return store ? entranceLabel(store) : null;
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
  if (gear) runMacro(itemMacro({ id: gear.kind, label: gear.kind, command: gear.command }, gear.item, 'pack'));
}

/** What the map toolbar is built from at the command prompt: what is underfoot and around, what Explore would do, and the hero's own buttons. */
function mapSituation(snap: LevelSnapshot): Partial<ActionContext> {
  if (travel instanceof Explore) return { exploring: settings.explorePace };
  if (!snap.atCommand) return {};
  const quick = quickEntry();
  return {
    exploreNext: exploreNext(snap),
    entrance: entranceHere(snap),
    gear: gearSuggestion()?.kind ?? null,
    quick: quick ? { label: recentLabel(quick), unavailable: recentUnavailable(quick, true) } : null,
    magic: magicLabel(),
    fire: fireSlot(),
  };
}

function updateActionBar(force = false): void {
  /* A bolt or blast being drawn is part of a turn under way: the toolbar waits for it to end. */
  if (drawingEffect) return;
  const snap = lastSnap;
  const directed = mode === 'screen' ? director.actions() : null;
  const prompt = currentPrompt();
  const foe = adjacentFoe();
  map.setFoe(foe && mode === 'map' ? { x: foe.x, y: foe.y } : null);
  const actions =
    directed ??
    (shownShop ? shopActions() : null) ??
    contextActions({
      mode,
      prompt,
      promptText: rowZeroText(),
      cardShown: promptCard.visible,
      listShown: termView.visible && (termView.choices().length > 0 || termView.options().length > 0),
      fallen: !!lastState?.player?.dead,
      screen: !termView.visible ? null : termView.options().length ? 'options' : /You may now dump a character record/.test(buffer.screenText()) || (ended && /Hall of Fame/.test(rowZeroText())) ? 'gameover' : viewerHeading(rowZeroText()) ? 'file' : null,
      looking,
      overview: map.overview,
      atCommand: !!snap?.atCommand,
      underfoot: snap && snap.inDungeon ? underfootName(snap) : '',
      floorObjects: snap?.floorObjects ?? 0,
      alwaysPickup: alwaysPickup(),
      ...(mode === 'map' && snap ? mapSituation(snap) : {}),
      foe: foe && snap ? directionDigit(foe.x - snap.px, foe.y - snap.py) : null,
      worldMap: !!snap?.inDungeon && snap.depth === 0 && snap.wild,
    });
  currentActions = actions;
  termView.setActions(mode === 'overlay' ? panelActions(actions) : []);
  const key = actions.map((a) => `${a.id}:${a.label}:${a.icon}:${!!a.unavailable}:${!!a.primary}`).join(',');
  if (key === actionsKey && !force) return;
  actionsKey = key;
  const now = performance.now();
  const settle = toolbarSlots.length > 0;
  toolbarSlots = mode !== 'map' ? [] : actions.map((action, i) => {
    const slot = `${action.id}:${action.label}`;
    const old = toolbarSlots[i];
    if (old?.key === slot) return old;
    return { key: slot, until: settle && !NEVER_SETTLE.has(action.id) ? now + TOOLBAR_SETTLE_MS : 0 };
  });
  while (toolbar.childElementCount > actions.length) toolbar.lastElementChild?.remove();
  actions.forEach((action, i) => {
    const button = (toolbar.children[i] as HTMLButtonElement | undefined) ?? toolbar.appendChild(actionButton());
    drawAction(button, action, (toolbarSlots[i]?.until ?? 0) - now);
  });
}

function actionButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.append(el('span', 'action-icon'), el('span'));
  return button;
}

/** Shows an action on a toolbar button, in place; a button given another action loses focus, and a tap begun on it is dropped. */
function drawAction(button: HTMLButtonElement, action: Action, settleMs: number): void {
  const tap = `${action.id}:${action.label}`;
  if (button.dataset.tap !== tap && document.activeElement === button) button.blur();
  button.dataset.tap = tap;
  button.dataset.action = action.id;
  button.className = ['action', action.primary ? 'primary' : '', action.unavailable ? 'unavailable' : ''].filter(Boolean).join(' ');
  window.clearTimeout(Number(button.dataset.settle ?? 0));
  if (settleMs > 0) {
    button.classList.add('settling');
    button.dataset.settle = String(window.setTimeout(() => button.classList.remove('settling'), settleMs));
  }
  button.setAttribute('aria-label', action.label);
  const description = action.unavailable ?? action.detail;
  if (description) button.setAttribute('aria-description', description);
  else button.removeAttribute('aria-description');
  const [icon, label] = button.children as unknown as [HTMLElement, HTMLElement];
  icon.textContent = iconText(action.icon);
  label.className = action.label.length > 9 ? 'action-label longer' : action.label.length > 6 ? 'action-label long' : 'action-label';
  label.textContent = action.label;
}

/* Toolbar actions a pop-up's own frame already offers (its close button) or that belong to the map. */
const FRAME_ACTIONS = new Set(['menu', 'escape', 'keyboard']);

/** What a tome2 panel offers at its foot: the toolbar's actions for the screen, less those its frame covers. */
function panelActions(actions: readonly Action[]): PopAction[] {
  return actions
    .filter((a) => !FRAME_ACTIONS.has(a.id))
    .map((a) => ({ id: a.id, label: a.label, icon: a.icon, primary: a.primary, unavailable: a.unavailable, run: () => runAction(a) }));
}

function runAction(action: Action): void {
  hideToast();
  if (action.unavailable) {
    refuse(action.unavailable);
    return;
  }
  if ((travel || picker) && !action.continues) stopAutomation(null, 'action');
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
  return { snap: lastSnap, materials, monsters: lastState.monsters ?? [], hp: lastState.player.chp, gold: lastState.player.au, passing: companionCells(lastSnap) };
}

/** Cells of the companions travel and exploring walk through, swapping places as tome2 lets the hero (`pushPast`). */
function companionCells(snap: LevelSnapshot): Set<number> {
  const player = lastState?.player;
  const monsters = lastState?.monsters ?? [];
  if (!player || !monsters.some((m) => m.status > 0)) return new Set();
  const weapon = engine.inventory()?.equip.find((slot) => slot.i === INVEN_WIELD)?.name ?? '';
  return pushPast(snap, materials, monsters, {
    confused: (player.status.confused ?? 0) > 0,
    stunned: (player.status.stun ?? 0) > 0,
    hallucinating: (player.status.hallucinating ?? 0) > 0,
    stormbringer: /Stormbringer/.test(weapon),
  });
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
  updateActionBar();
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
    const spotted = travel instanceof Explore ? spottedText() : null;
    const message = [stopMessage(travel, step, ctx.snap), spotted].filter(Boolean).join(' ');
    stopAutomation(message || null, step.reason);
    return;
  }
  map.setPath(step.path);
  engine.sendKeys(step.keys);
  if (travel instanceof Travel && travel.oneStep) stopAutomation(null, 'step');
  requestFrame();
}

/** The toolbar's changing button at the command prompt once nothing is running. */
function changingButton(snap: LevelSnapshot): Action {
  const foe = adjacentFoe();
  return contextualAction({
    mode: 'map',
    prompt: 'none',
    atCommand: true,
    underfoot: underfootName(snap),
    floorObjects: snap.floorObjects,
    alwaysPickup: alwaysPickup(),
    exploreNext: exploreNext(snap),
    entrance: entranceHere(snap),
    gear: gearSuggestion()?.kind ?? null,
    foe: foe ? directionDigit(foe.x - snap.px, foe.y - snap.py) : null,
    worldMap: snap.depth === 0 && snap.wild,
  });
}

/** What to tell the player when travel or exploring stops. */
function stopMessage(journey: Travel | Explore, step: Extract<TravelStep, { kind: 'stop' }>, snap: LevelSnapshot): string | null {
  return stopText(step, {
    light: changingButton(snap).id === 'equip' && gearSuggestion()?.kind === 'light',
    exploring: journey instanceof Explore,
    walked: journey instanceof Travel ? journey.walked : 0,
    approximate: travelApproximate,
    depth: snap.depth,
    lightRadius: snap.lightRadius,
  });
}

/**
 * Walks towards a place on the map: there when a known way leads there,
 * otherwise as far as the known way goes towards it.
 */
function startTravel(goal: MapPoint): void {
  const ctx = travelContext();
  if (!ctx) return;
  stopAutomation(null, 'new travel');
  hideToast();
  recentreMap();
  const snap = ctx.snap;
  const approach = approachTarget(snap, materials, goal, ctx.passing);
  if (!approach && !isAdjacent(snap.px, snap.py, goal.x, goal.y)) {
    showToast(STOP_MESSAGES.unreachable ?? '');
    return;
  }
  travel = new Travel(approach?.point ?? goal, ctx);
  travelApproximate = !!approach && !approach.exact;
  stepTravel();
}

/** The pause between steps of travel and exploring: Relaxed walks at its own slower pace, whatever the animation setting. */
function travelStepMs(): number {
  if (settings.explorePace === 'relaxed') return RELAXED_STEP_MS;
  return animating() ? TRAVEL_STEP_MS : 0;
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
 * explored level, goes to the way on, which a further press takes (on the
 * land, once nothing is left, it opens the world map).
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
  const next = exploreNext(ctx.snap);
  const way = next === 'worldMap' ? '<' : next === 'here' ? transitionUnderfoot(underfootName(ctx.snap))?.command : null;
  if (way) {
    send([BACKSLASH, way.charCodeAt(0)]);
    return;
  }
  travel = new Explore(explorePlan());
  travelApproximate = false;
  updateActionBar();
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
      if (cell && snap.atCommand) goTowards(snap, cell);
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
    const goal = cell ?? (prompt === 'none' ? map.gridAt(clientX, clientY) : null);
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

function tapMapCell(snap: LevelSnapshot, cell: MapPoint, prompt: ReturnType<typeof classifyPrompt>): void {
  doTap(tapAction(snap, materials, cell, prompt));
}

function goTowards(snap: LevelSnapshot, point: MapPoint): void {
  doTap(goAction(snap, materials, point));
}

/** Carries out what a tap on the map decided. */
function doTap(action: TapAction): void {
  switch (action.kind) {
    case 'direction':
      send(directionKeys(action.digit, false));
      break;
    case 'target':
      startTargeting(action.cell);
      break;
    case 'interrupt':
      send([KEY_ESCAPE]);
      break;
    case 'wait':
      send([BACKSLASH, waitCommand(alwaysPickup()).charCodeAt(0)]);
      break;
    case 'travel':
      startTravel(action.cell);
      break;
    case 'step':
      startStep(action.cell);
      break;
    case 'none':
      break;
  }
}

/** One step to a neighbouring cell (a closed door there is opened, then walked through). */
function startStep(cell: MapPoint): void {
  const ctx = travelContext();
  if (!ctx) return;
  stopAutomation(null, 'step');
  hideToast();
  const mat = materials[ctx.snap.feat[cell.y * ctx.snap.width + cell.x]];
  const door = !!mat?.door && !mat.walkable;
  travel = new Travel(cell, ctx, { oneStep: !door });
  travelApproximate = false;
  stepTravel();
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
  audio.effects(effects, snap.heroActing);
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
    applyEngineSettings();
    dirty = true;
    requestFrame();
    const storageError = engine.storageError;
    if (storageError) {
      openMessage(
        sheets,
        'Saves unavailable',
        `Saved games could not be loaded from this browser's storage (${storageError}). Saving to the browser is switched off for this session so existing saves are not overwritten. You can still play, but this game cannot be kept.`,
      );
    }
  },
  onExit(message) {
    if (quitting) {
      const abandoned = abandoning;
      abandoning = null;
      if (!abandoned) {
        returnToTitle();
        return;
      }
      lastState = null;
      heroMemory = null;
      heroMemoryId = '';
      landMemory = null;
      forgetAdventurer(abandoned);
      engine.syncNow().catch((err) => console.error('Saving to browser storage failed', err)).finally(() => returnToTitle());
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
    if (!adventurers.loaded) adventurers.load(engine.fs, engine.savePath);
    /* A run quit through tome2's quit command is kept in the Hall of Fame as abandoned. */
    engine.markAbandoned();
    if (!macros.running && readViewer()) return;
    if (followService()) return;
    director.idle();
    dirty = false;
    refresh();
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
      /* A macro that ends in tome2's file viewer (reading a parchment) leaves it to the reader. */
      if (!macros.running && readViewer()) {
        requestFrame();
        return;
      }
    } else if (travel && !travelTimer) {
      travelTimer = window.setTimeout(stepTravel, travelStepMs());
    } else if (picker) {
      stepTargeting();
    }
    settleAttempt();
    settleTrade();
    /* A quest moment held while a macro ran is told once it has finished. */
    tellQuestMoment();
    /* tome2 never comes back to the command prompt after saving to quit: back at it, the quit stopped short, and nothing is left to delete. */
    if (quitting && !macros.running && lastSnap?.inDungeon && lastSnap.atCommand && !lastSnap.icky) {
      quitting = false;
      abandoning = null;
    }
    requestFrame();
  },
  onKey(code) {
    audio.keyConsumed(code, lastSnap?.atCommand ?? false);
  },
  onEffectFrame() {
    director.effectFrame();
    drawingEffect = true;
    try {
      refresh();
    } finally {
      drawingEffect = false;
    }
    captureEffects();
    if (mode === 'map' || mode === 'overlay') map.render(performance.now(), animating());
  },
});
(api as { engine: Engine }).engine = engine;

function send(codes: number[] | null): void {
  if (!codes || codes.length === 0) return;
  const key = codes.length === 1 ? codes[0] : codes.length === 2 && codes[0] === BACKSLASH ? codes[1] : null;
  if (key !== null && lastSnap?.inDungeon) {
    castWatcher.note(rowZeroText(), buffer.screenText(), key, !!lastSnap.atCommand);
    if (castWatcher.casting) audio.castingTone(castingTone(castWatcher.casting));
  }
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
const adventurers = new AdventurerStore();
const coach = new Coach(byId<HTMLElement>('stage'));
const title = new TitleScreen(byId<HTMLElement>('title-screen'), () => settings.animation, {
  onChoose: (choice) => director.choose(choice),
  onAdventurers: (saves) => openAdventurers(sheets, saves, adventurerHandlers),
  describe: (save) => {
    const details = adventurerDetails(save);
    return { name: details.name, line: adventurerSummary(details) };
  },
  onReady: () => {
    const name = pendingAnew;
    pendingAnew = null;
    if (name && director.beginAnew(name)) return;
    adoptUpdate?.();
  },
  onSettings: () => openSettingsSheet(),
  onBackup: () => openBackupMenu(),
  onMusic: () => openSoundtrack(sheets, audio),
  onFame: () => openHallOfFame(),
  onHelp: () => openHelpSheet(),
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

/* Height of the view without the on-screen keyboard, for the current width. */
let fullHeight = 0;
let fullWidth = 0;

function editingText(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'search'));
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
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  root.classList.toggle('short-view', shortStandaloneView(standalone, window.innerWidth, window.innerHeight, screen.width, screen.height, standalone ? safeTop() : 0));
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
  const directed = mode === 'screen' ? director.handleKey(e) : false;
  if (directed === 'browser') return;
  if (directed) {
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
  if (shownShop) {
    /* In a shop, arrows move through its list, Enter opens the highlighted item and Escape leaves; a service's letter asks for it as a tap does. */
    if (e.key === 'Escape' || termView.navigate(e)) {
      e.preventDefault();
      if (e.key === 'Escape') send([KEY_ESCAPE]);
      return;
    }
    const extra = !e.ctrlKey && !e.metaKey && !e.altKey ? shopModel(shownShop).extras.find((a) => a.key === e.key) : undefined;
    if (extra) {
      e.preventDefault();
      if (!e.repeat) runService(extra);
      return;
    }
  }
  if (viewerHeading(rowZeroText())) {
    /* Escape leaves the whole viewer; tome2's search and go-to keys would open questions the reader does not show. */
    if (e.key === 'Escape' || /^[=/#%]$/.test(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') closeViewer();
      return;
    }
    const link = viewerFile()?.help?.links.find((l) => l.key === e.key);
    if (link && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      followLink(link.index);
      return;
    }
  }
  if ((viewerFile() && termView.readKey(e)) || termView.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (!lookCard.hidden && mode === 'map') {
    /* The look card is a list: arrows move its highlight, Enter chooses, Escape closes it. */
    if (e.key === 'Escape') {
      e.preventDefault();
      hideLookCard();
      return;
    }
    if (lookNav.handleKey(e)) {
      e.preventDefault();
      return;
    }
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

attachSoftKeyboard(
  keyboardInput,
  (codes) => {
    if (!director.readyShowing) send(codes);
  },
  () => ctrlLatched,
);

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

onTap(toolbar, 'button[data-action]', (button) => {
  const action = currentActions.find((a) => a.id === button.dataset.action);
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
    if (settings.persistentLevels && !next.persistentLevels) {
      if (heroMemory) mapMemory.forgetLevels(heroMemory);
      if (exploreLevel?.startsWith('level:')) exploreKeepsVisits = false;
    }
    settings = next;
    saveSettings(settings);
    applySettings();
    applyEngineSettings();
    audio.setVolumes(settings.music, settings.sound);
    map.zoom = settings.zoom;
    pinchStartZoom = settings.zoom;
    map.glyphMode = settings.glyphs;
    dirty = true;
    requestFrame();
    title.animationChanged();
  }, adventureRules());
}

/** The rules the hero's adventure was begun with, during a game. */
function adventureRules(): AdventureRules | null {
  const hero = lastState?.player?.name;
  const run = inGame() ? engine.runOptions() : null;
  return hero && run ? { hero, run } : null;
}

/** Applies the settings that live in CSS: text size and animation. */
function applySettings(): void {
  applyTextSize(settings.textSize);
  document.documentElement.dataset.animation = settings.animation;
}

/** Applies the settings tome2 itself keeps: messages flowing past, kept levels, and how bolts and blasts are drawn. */
function applyEngineSettings(): void {
  engine.setAutoMore(settings.messages === 'flow');
  engine.setPersistentLevels(settings.persistentLevels);
  engine.setEffectDelay(EFFECT_DELAY[settings.animation]);
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
  persistMapMemory();
  showToast('Saving…', false);
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
  shownShop = null;
  shopTab = null;
  trade = null;
  service = null;
  ended = false;
  quitting = false;
  memorial = null;
  chronicle = null;
  streak = { count: 0, lastTurn: 0 };
  persistMapMemory();
  exploreSkip.clear();
  exploreLevel = null;
  exploreAnchor = null;
  exploreLastStop = null;
  exploreSeenItems.clear();
  levelGold.clear();
  exploreLevelDepth = -1;
  exploreKeepsVisits = false;
  heroMemory = null;
  heroMemoryId = '';
  landMemory = null;
  memoryTurn = -1;
  exploreNextCache = { key: '', next: 'explore' };
  attempt = null;
  hideToast();
  mapMemory.loaded = false;
  placeKey = '';
  gearTurn = -1;
  styleKey = '';
  place = null;
  placePos = { x: -1, y: -1 };
  app.classList.remove('fallen', 'ended');
  buffer.clear();
  hud.reset();
  feel.reset();
  chronicles.loaded = false;
  adventurers.loaded = false;
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

function* abandonMacro(): Macro {
  let s = yield [KEY_ESCAPE, KEY_ESCAPE, KEY_ESCAPE];
  for (let i = 0; i < 6 && !s.atCommand; i++) s = yield [KEY_ESCAPE];
  s = yield [BACKSLASH, ...keyCodes('Q')];
  if (/really want to quit|want to retire/.test(s.prompt)) s = yield keyCodes('y');
  if (/verify QUITTING/.test(s.prompt)) s = yield keyCodes('@');
  for (let i = 0; i < 12; i++) {
    if (s.atCommand) return;
    s = yield [KEY_ESCAPE];
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
  sheets.open(hallOfFameSheet());
}

/** The title screen's Hall of Fame sheet, built afresh (and kept to be updated in place when a hero is removed). */
let fameSheet: SheetContent | null = null;

function hallOfFameSheet(): SheetContent {
  const body = el('div', 'fame');
  body.append(section('Heroes remembered', ...hallOfFameElements(engine.scores(), -1, (entry) => openFameHero(entry, false))), ...careerElements(chronicles));
  fameSheet = { title: 'Hall of Fame', subtitle: 'Heroes of Middle-earth, remembered', body, className: 'sheet-fame' };
  return fameSheet;
}

/** Help, with the original ToME manual during a game (Help reopens when it closes). */
function openHelpSheet(topic?: string): void {
  openHelp(
    {
      sheets,
      birthData: () => engine.birthData(),
      openManual: inGame()
        ? () => {
            manualWanted = !!lastSnap?.atCommand;
            api.command('?');
          }
        : undefined,
    },
    topic,
  );
}

/** Backup of everything the game keeps in this browser, on the title screen only: every adventure, the Hall of Fame and the deeds earned. */
function openBackupMenu(): void {
  openMenu(
    sheets,
    'Backup',
    [
      { label: 'Export game data', icon: '⤒', hint: 'Download a backup file', run: startExport },
      { label: 'Import game data', icon: '⤓', hint: 'Restore from a backup file', run: startImport },
    ],
    'Your adventures, the Hall of Fame and your deeds live in this browser. A backup keeps them safe or moves them to another device.',
  );
}

/* Saved heroes on the title screen */

/** A saved hero's own name: tome2's list gives the savefile's ("Old_Tom"), its index the hero's ("Old Tom, the Hobbit Rogue"). */
function heroName(save: SaveInfo): string {
  return save.description.split(', the ')[0] || save.name;
}

/** What is known of a saved hero: the details noted when they were last saved, their tale so far, else tome2's own description. */
function adventurerDetails(save: SaveInfo): AdventurerDetails {
  const name = heroName(save);
  const noted = adventurers.get(name);
  const tale = chronicles.peek(name);
  const alive = tale && !tale.fallen ? tale : null;
  return {
    name,
    line: noted ? heroLine(noted) : save.description.replace(/^.*?, the /, ''),
    place: noted?.place,
    saved: noted?.saved,
    kills: alive?.kills,
    deepestFeet: alive?.deepestFeet,
  };
}

const adventurerHandlers: AdventurerHandlers = {
  details: adventurerDetails,
  play: (save) => director.choose({ kind: 'continue', save }),
  remove: (save) => {
    const name = heroName(save);
    deleteAdventurer(name);
    director.forgetSave(save.name);
    engine.syncNow().then(
      () => showToast(`${name}'s adventure was deleted.`, false),
      (err) => {
        console.error('Saving to browser storage failed', err);
        showToast('Browser storage could not be updated.', false);
      },
    );
  },
};

/** Deletes a hero's adventure: the savefile and kept levels, and what the frontend keeps of them. */
function deleteAdventurer(name: string): void {
  deleteSavefile(name);
  forgetAdventurer(name);
}

/** Deletes a hero's savefile and kept levels, and their line in tome2's savefile index. */
function deleteSavefile(name: string): void {
  const fs = engine.fs;
  const root = engine.savePath;
  const index = fs && root ? findSaveIndex(fs, root) : null;
  try {
    if (fs && index) deleteHeroSave(fs, index, name);
  } catch (err) {
    console.error(`Deleting ${name}'s save failed`, err);
  }
}

/** Forgets what the frontend keeps of a hero whose adventure is over: map memory, tale, title details, recents. */
function forgetAdventurer(name: string): void {
  mapMemory.forgetNamed(name);
  mapMemory.save();
  chronicles.forget(name);
  chronicles.save();
  adventurers.forget(name);
  adventurers.save();
  recents.forget(name);
}

/**
 * Ends the hero's adventure for good through tome2's own quit: tome2 keeps
 * the savefile as a fallen hero's (so they can be begun anew) and the run in
 * the Hall of Fame (marked abandoned in `onIdle`); its end-of-game screens are passed.
 */
function abandonAdventure(): void {
  const name = lastState?.player?.name;
  if (!name || !inGame()) return;
  sheets.closeAll();
  quitting = true;
  abandoning = name;
  stopAutomation(null, 'quit');
  showToast('Leaving…', false);
  runMacro(abandonMacro());
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
    { label: playing ? 'Save and quit' : 'Quit to title', icon: '⏻', hint: 'Back to the title screen', hidden: fallen, run: () => {
      if (!playing) {
        saveAndQuit();
      } else if (engine.storageError) {
        confirmSheet(
          sheets,
          'Quit without keeping this game?',
          'Browser storage is unavailable this session, so this game cannot be kept.',
          'Quit anyway',
          () => saveAndQuit(),
          true,
        );
      } else {
        confirmSheet(sheets, 'Save and quit?', 'Your game is saved and you return to the title screen.', 'Save and quit', () => saveAndQuit());
      }
    } },
    { label: 'Settings', icon: '⚙', hint: 'Text size, animation, map', run: () => openSettingsSheet() },
    { label: 'Help', icon: '?', hint: 'How to play, with a search', run: () => openHelpSheet() },
    { label: 'About', icon: 'ℹ', run: () => openTemplate(sheets, 'About', 'about-template') },
    { label: 'Abandon adventure', icon: '✕', hint: 'End it for good', danger: true, hidden: !playing || fallen, run: () => {
      const name = lastState?.player?.name ?? 'This hero';
      confirmSheet(
        sheets,
        'Abandon this adventure?',
        `${name}'s adventure ends here and cannot be taken up again. It is remembered in the Hall of Fame, where you can begin anew with the same hero.`,
        'Abandon',
        abandonAdventure,
        true,
      );
    } },
  ]);
}

async function exportSaves(): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    openMessage(sheets, 'Export game data', 'The game is still loading. Try again in a moment.');
    return;
  }
  await engine.syncNow().catch((err) => console.warn('Sync before export failed; exporting from memory', err));
  const files = collectFiles(fs, root);
  if (files.length === 0) {
    openMessage(sheets, 'Export game data', 'There is nothing to back up yet.');
    return;
  }
  downloadText(exportFilename(), encodeBundle(files));
}

async function importSaves(file: File): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    openMessage(sheets, 'Import game data', 'The game is still loading. Try again in a moment.');
    return;
  }
  if (engine.storageError) {
    openMessage(sheets, 'Import game data', 'Browser storage is unavailable this session, so imported data would be lost on restart.');
    return;
  }
  const files = decodeBundle(await file.text());
  confirmSheet(
    sheets,
    'Import game data?',
    `Restore ${files.length} file(s) from this backup? Adventures with the same names are replaced, and the game restarts.`,
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
  settings: () => settings,
  lastStopCause: () => lastStopCause,
  exploreStop: () => {
    if (!lastSnap) return null;
    const plan = explorePlan();
    const stop = nextStop(lastSnap, materials, plan, companionCells(lastSnap));
    return { kind: stop?.kind ?? 'none', x: stop?.x ?? -1, y: stop?.y ?? -1, heading: plan.heading ?? 'down' };
  },
  macroRunning: () => macros.running,
  gear: () => gearSuggestion()?.kind ?? null,
  takeGear: () => useSuggested(),
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
