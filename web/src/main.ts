import './styles.css';
import { GameAudio } from './audio/audio.ts';
import type { Place } from './audio/places.ts';
import { doorKinds } from './audio/cues.ts';
import { Engine } from './engine.ts';
import { areaName, Hud, rowSegments, type HudEntity } from './hud.ts';
import { attachMapGestures, attachPinch } from './input/gestures.ts';
import { directionKeys, KEY_BACKSLASH as BACKSLASH, KEY_ENTER, KEY_ESCAPE, keyCodes, translateKey, translateText } from './input/keys.ts';
import { attachSoftKeyboard } from './input/softkeyboard.ts';
import { Director } from './flow/director.ts';
import { FireEffect } from './render/fire.ts';
import { HIT_FLASH_MS, MapRenderer, MAX_ZOOM, MIN_ZOOM, type MapPoint } from './render/map.ts';
import { drawnEffects, terminalCell } from './render/effects.ts';
import { buildMaterials, FB_DOOR, FB_NO_WALK, walkableFor, type FeatureInfo, type Material } from './render/materials.ts';
import { altarAction } from './play/gods.ts';
import { hasEffect } from './play/effects.ts';
import { contextActions, contextualAction, commandRefusal, CONTROLLING, exploreRefusal, creaturePowersMacro, releaseMacro, restMacro, waitCommand, type Action, type ActionContext, type CommandContext, type NativeView } from './play/actions.ts';
import { MacroRunner, type Macro } from './play/macro.ts';
import { classifyPrompt, directionDigit, isAdjacent, type PromptKind } from './play/prompts.ts';
import { goAction, tapAction, type TapAction } from './play/travel.ts';
import { Journeys } from './play/journeys.ts';
import { HeroMemoryKeeper } from './play/heromemory.ts';
import { Conversation } from './play/conversation.ts';
import { abandonMacro, finishMacro, leaveTombMacro, quitMacro } from './play/quit.ts';
import { gridDistance } from './play/pathfinding.ts';
import { questKey } from './play/mapmemory.ts';
import { isHostile, isNeutral, LEAD_LINES, leadInMessages, newMessages, type GameState, type LevelQuest, type LevelSnapshot, type MessageState, type MonsterState } from './render/snapshot.ts';
import { acquireSessionLock } from './saves.ts';
import { Backup } from './backup.ts';
import { Transfer } from './ui/transfer.ts';
import { Updates } from './updates.ts';
import { ANIMATION_FPS, applyTextSize, EFFECT_DELAY, loadSettings, saveSettings, type Settings } from './settings.ts';
import { TerminalBuffer, type ScreenCopy } from './terminal.ts';
import { TitleScreen } from './title.ts';
import { openSoundtrack } from './ui/soundtrack.ts';
import { openHelp } from './ui/help.ts';
import { openMagic, RecentStore } from './ui/magic.ts';
import { CastWatcher, fireMacro, hasMagic, hasPowers, recentLabel } from './play/recent.ts';
import { NOT_NOW, type GameApi } from './ui/api.ts';
import { titleName } from './play/text.ts';
import { GameFeel, READ_MS, type QuestEvent } from './feel.ts';
import { Coach } from './ui/coach.ts';
import { INVEN_WIELD, itemMacro, listedItem, suggestedGear, type GearSuggestion } from './play/items.ts';
import { ABANDONED, hasFallen } from './play/memorial.ts';
import { battlefieldText, followReturn, isReturnPrompt, SAFETY_CLOSED, safetyText } from './play/lives.ts';
import { CharacterPanel, type CharacterScreen } from './ui/character.ts';
import { companionsLater, openCompanions } from './ui/companions.ts';
import { openKnowledge } from './ui/knowledge.ts';
import { el, iconText } from './ui/dom.ts';
import { onTap } from './ui/tap.ts';
import { openAltarGod } from './ui/gods.ts';
import { openEffect } from './ui/effects.ts';
import { openFloorObject, openMonster, openQuest, openTargets } from './ui/info.ts';
import { openInventory, openItemDetails } from './ui/inventory.ts';
import { askQuantity, askText, confirmSheet, openHistory, openMenu, openMessage, openSettings, openTemplate, type AdventureRules } from './ui/menus.ts';
import { Sheets, type SheetTrail } from './ui/sheet.ts';
import { bufferRows, type OptionBlock } from './ui/termparse.ts';
import { TermView, type TermViewOptions } from './ui/termview.ts';
import { PromptCard, type CardKind } from './ui/promptcard.ts';
import { setRefusal, type PopAction, type PopTab } from './ui/popup.ts';
import { cleanPrompt, describableRange } from './ui/prompttext.ts';
import { Abilities } from './ui/abilities.ts';
import { openCommands } from './ui/commands.ts';
import { Heroes } from './ui/heroes.ts';
import { LookCard } from './ui/lookcard.ts';
import { Reader } from './ui/reader.ts';
import { watchAppHeight } from './ui/viewport.ts';
import { ShopController } from './ui/shop.ts';
import { entranceLabel, shopModel } from './ui/store.ts';
import { parseAbilities, parseSkills } from './ui/skills.ts';
import { findMessageBox, type MessageBox } from './ui/msgbox.ts';
import { heroEntry, isHallOfFame, parseTomb } from './ui/gameover.ts';
import { slainMonsters, type Slain } from './play/chronicle.ts';
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
      /** The gear the toolbar would suggest (weapon, light), whatever the toolbar shows first. */
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
const PLACE_POLL_MS = 2000;
const CTRL_S = 0x13;
const SPACE = 0x20;

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
const receiveFile = byId<HTMLInputElement>('receive-file');
const toast = byId<HTMLDivElement>('toast');
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
let materialsLoaded = false;
let features: FeatureInfo[] = [];
let materials: Material[] = [];
/* The materials as the hero walks them, kept while the terrain they can enter stays the same. */
let walking: { base: readonly Material[]; passes: string; materials: readonly Material[] } | null = null;

/** The terrain as the hero can walk it now, for travel and exploring (trees for a tree walker, a flyer or Yavanna's praying follower). */
function heroMaterials(): readonly Material[] {
  const passes = game.lastState?.player?.passes;
  const key = passes?.join(',') ?? '';
  if (walking?.base !== materials || walking.passes !== key) walking = { base: materials, passes: key, materials: walkableFor(materials, passes) };
  return walking.materials;
}

/** What belongs to one game, from loading or creating the hero until the title is back: replaced there. */
function newRunState() {
  return {
    lastSnap: null as LevelSnapshot | null,
    lastState: null as GameState | null,
    /** Where the player is, refreshed with the level and every couple of seconds. */
    place: null as Place | null,
    placeKey: '',
    placeAt: 0,
    placePos: { x: -1, y: -1 },
    inStore: false,
    /** The lives the hero had when asked whether to return from death (`followReturn`), else null. */
    askedLives: null as number | null,
    /** The hero has returned from death: the game is saved at the next command prompt, as tome2 saves a death at once. */
    saveOnReturn: false,
    quitting: false,
    /** The hero whose adventure is being abandoned through tome2's quit: once the game has closed, what the frontend keeps of them is forgotten. */
    abandoning: null as string | null,
    /** The end-of-game summary has been shown; the lament plays until the title. */
    ended: false,
    /** A save command was sent; once the engine has written it, storage is synced (and the player told, if asked). */
    pendingSync: null as 'silent' | 'toast' | null,
    /** Sheets covered by a tome2 screen, reopened once it closes. */
    returnTo: null as SheetTrail | null,
    lastSavedTurn: -1,
  };
}

let game = newRunState();
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
let looking = false;
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
    if (!reader.followKey(key)) send([key.charCodeAt(0)]);
  },
  onDescribe(key, choice) {
    if (/which spell\?/i.test(rowZeroText()) && abilities.describeSpell(choice.label.text.trim(), choice.key)) return;
    if (currentPrompt() === 'item') {
      const inventory = engine.inventory();
      const listed = inventory && listedItem(inventory, rowZeroText(), choice.key, choice.label.text);
      if (listed) openItemDetails(api, listed.item, listed.place);
      else refuse('There is nothing more to see there.');
      return;
    }
    send([key.charCodeAt(0)]);
  },
  onOption(option, _index, options) {
    toggleOption(option, options);
  },
  onTapText() {
    continueIfWaiting();
  },
  onClose() {
    if (reader.heading()) reader.close();
    else send([KEY_ESCAPE]);
  },
  onLink(index) {
    reader.followLink(index);
  },
});

const promptCard = new PromptCard(stage, (keys) => send(keys));

const hud = new Hud(hudEl, messagesEl, () => buffer.palette, {
  onEntity: (entity) => openEntity(entity),
  onPlayer: () => openNative(hasFallen(game.lastState?.player) ? 'fallen' : 'character'),
  onSkills: () => openNative('skills'),
  onQuest: (quest) => openQuest(sheets, quest),
  onEffect: (effect) => {
    journeys.interrupt('effect');
    openEffect(api, effect);
  },
  onMore: () => send([SPACE]),
  onHistory: () => {
    journeys.interrupt('history');
    showHistory();
  },
});

function setCtrlLatched(value: boolean): void {
  ctrlLatched = value;
  for (const node of document.querySelectorAll('[data-ctrl-toggle]')) node.setAttribute('aria-pressed', String(value));
}

const TOAST_MS = 2000;
let toastTimer = 0;
/** Shows a short message over the foot of the map, longer when it is to be `read`; unless it repeats one of tome2's (`log` false), it also goes in the message log. */
function showToast(text: string, { log = true, read = false }: { log?: boolean; read?: boolean } = {}): void {
  if (log && inGame()) {
    engine.addNotice(text);
    redraw();
  }
  const area = stage.getBoundingClientRect();
  toast.style.setProperty('--toast-x', `${area.left + area.width / 2}px`);
  toast.style.setProperty('--toast-bottom', `calc(${window.innerHeight - area.bottom}px + 1rem)`);
  toast.style.setProperty('--toast-width', `calc(${area.width}px - 2rem)`);
  toast.textContent = text;
  toast.classList.add('visible');
  /* The deed card at the foot of the map rises above the toast. */
  stage.style.setProperty('--toast-lift', `calc(${toast.offsetHeight}px + 0.75rem)`);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, read ? READ_MS : TOAST_MS);
}

/** Clears a toast the player has moved on from. */
function hideToast(): void {
  window.clearTimeout(toastTimer);
  toast.classList.remove('visible');
  stage.style.removeProperty('--toast-lift');
}

/* A refusal longer than this many words stays as long as a toast to be read. */
const QUICK_READ_WORDS = 8;

/** Says why something cannot be done, with the refusal sound. */
function refuse(text: string): void {
  showToast(text, { read: text.split(/\s+/).length > QUICK_READ_WORDS });
  audio.cue('deny');
}
setRefusal(refuse);

/* Native views */

const api: GameApi = {
  engine: undefined as unknown as Engine,
  sheets,
  palette: () => buffer.palette,
  snapshot: () => game.lastSnap,
  state: () => game.lastState,
  send: (keys) => {
    coverSheets(false);
    send(keys);
  },
  command: (command) => {
    if (!game.lastSnap?.atCommand) {
      coverSheets(false);
      showToast(NOT_NOW);
      return;
    }
    coverSheets(true);
    send([BACKSLASH, ...keyCodes(command)]);
  },
  runMacro: (macro, comeBack = false) => {
    coverSheets(comeBack);
    runMacro(macro);
  },
  converse: (command, digit) => {
    coverSheets(false);
    conversation.converse(command, digit);
  },
  travelTo: (point) => {
    if (!game.lastSnap?.atCommand) {
      refuse(NOT_NOW);
      return;
    }
    sheets.closeAll();
    look.hide();
    journeys.travelTo(point);
  },
  target: (point) => {
    if (!game.lastSnap?.atCommand) {
      refuse(NOT_NOW);
      return;
    }
    sheets.closeAll();
    look.hide();
    journeys.target(point);
  },
  highlight: (point) => flash(point),
  tell: (text) => showToast(text),
  redraw: () => redraw(),
  askText: (title, label, initial) => askText(sheets, title, label, initial),
  askQuantity: (question) => askQuantity(sheets, question),
  recent: () => recents.list(game.lastState?.player?.name ?? ''),
  remember: (entry) => recents.remember(game.lastState?.player?.name ?? '', entry),
  cast: (entry, anyway) => abilities.run(entry, false, anyway),
  castRefusal: (entry) => abilities.refusal(entry),
  refusal: (command) => commandRefusal(command, { worldMap: worldMap(game.lastSnap), controlling: controlling() }),
  travelRefusal,
  refuse,
};

const recents = new RecentStore();
const castWatcher = new CastWatcher();

const character = new CharacterPanel(api, {
  sendKeys: (keys) => send(keys),
  source: (letter) => sheetSource(letter),
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
  return { skills, abilities, sheet, box: game.lastSnap?.icky ? findMessageBox(rows) : null, atCommand: !!game.lastSnap?.atCommand };
}

/** Closes the sheets; with `comeBack` they reopen once the game is back at the map. */
function coverSheets(comeBack: boolean): void {
  game.returnTo = comeBack ? sheets.snapshot() : null;
  sheets.closeAll();
}

/** Reopens sheets covered by a tome2 screen once that screen has closed. */
function reopenSheets(): void {
  const snap = game.lastSnap;
  if (!game.returnTo || macros.running || !snap) return;
  if (game.quitting || !snap.inDungeon) {
    game.returnTo = null;
    return;
  }
  if (!snap.atCommand || snap.icky) return;
  const trail = game.returnTo;
  game.returnTo = null;
  if (!sheets.isOpen) sheets.restore(trail);
}

function flash(point: MapPoint): void {
  map.flashHighlight(point, HIGHLIGHT_MS);
  redraw();
  window.setTimeout(() => {
    redraw();
  }, HIGHLIGHT_MS + 50);
}

function openEntity(entity: HudEntity): void {
  journeys.interrupt('entity');
  if (hasEffect(game.lastState?.player, 'hallucinating')) {
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
  if (view !== 'pace') journeys.interrupt('native');
  switch (view) {
    case 'inventory':
      openInventory(api, 'pack');
      break;
    case 'character':
      character.open('summary');
      break;
    case 'skills':
      character.open('skills');
      break;
    case 'magic':
    case 'powers':
    case 'magicItems':
      openMagic(api, api.recent(), { run: (entry, anyway) => api.cast(entry, anyway) }, view === 'magic' ? 'magic' : 'powers', false, view === 'magicItems');
      break;
    case 'recast': {
      const entry = abilities.quick();
      if (entry) abilities.run(entry, abilities.targetInSight());
      break;
    }
    case 'fire':
      conversation.watchAttempt();
      runMacro(fireMacro());
      break;
    case 'rest':
      conversation.watchAttempt();
      runMacro(restMacro());
      break;
    case 'release':
      runMacro(releaseMacro());
      break;
    case 'creaturePowers':
      conversation.watchAttempt();
      runMacro(creaturePowersMacro());
      break;
    case 'talk': {
      const partner = talkPartner();
      const digit = partner && game.lastSnap ? directionDigit(partner.x - game.lastSnap.px, partner.y - game.lastSnap.py) : null;
      if (digit) conversation.converse('Y', digit);
      break;
    }
    case 'halt':
      break;
    case 'pace':
      settings = { ...settings, explorePace: settings.explorePace === 'relaxed' ? 'normal' : 'relaxed' };
      saveSettings(settings);
      updateActionBar();
      break;
    case 'finish':
      finishGame();
      break;
    case 'fallen':
      heroes.openFallen();
      break;
    case 'look':
      setLooking(true);
      break;
    case 'lookDone':
      setLooking(false);
      break;
    case 'explore':
      journeys.explore();
      break;
    case 'equip':
      useSuggested();
      break;
    case 'altar': {
      const god = game.lastSnap ? altarGodHere(game.lastSnap) : undefined;
      if (god) openAltarGod(api, god, true);
      break;
    }
    case 'companions':
      openCompanions(api);
      break;
    case 'target':
      openTargets(api);
      break;
    case 'overview':
      setOverview(true);
      break;
    case 'overviewDone':
      setOverview(false);
      break;
    case 'closeFile':
      reader.close();
      break;
  }
}

function showHistory(): void {
  openHistory(sheets, engine.gameState(200)?.messages ?? game.lastState?.messages ?? [], buffer.palette);
}

/* Whole-level map */

function setOverview(on: boolean): void {
  map.overview = on;
  app.classList.toggle('overview', on);
  if (on) {
    setLooking(false);
    recentreMap();
    showToast('Tap a place to travel there', { log: false });
  }
  updateActionBar(true);
  redraw();
}

/* Look mode and the look card */

function setLooking(on: boolean): void {
  looking = on;
  lookBanner.hidden = !on;
  if (!on) look.hide();
  updateActionBar(true);
}

/* View state */

function setMode(next: ViewMode): void {
  if (next === mode) return;
  mode = next;
  app.classList.remove('mode-title', 'mode-screen', 'mode-map', 'mode-overlay');
  app.classList.add(`mode-${next}`);
  if (next !== 'screen' && next !== 'title') fire.clear();
  if (next !== 'map') {
    look.hide();
    if (looking) setLooking(false);
    if (map.overview) setOverview(false);
  }
  layout();
}

function terminalToDungeon(snap: LevelSnapshot, col: number, row: number): MapPoint | null {
  return terminalCell(snap, col, row, buffer.rows);
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
let questMoment: { event: QuestEvent; quest: LevelQuest; since: GameState | null; led: boolean } | null = null;

const CARD_KINDS = new Set<PromptKind>(['yesno', 'quantity', 'text', 'direction', 'aim', 'choice']);

/** Pack / Equipment / Floor tabs for tome2's item prompts. */
function itemTabs(prompt: string): PopTab[] {
  const mode = /^\((Inven|Equip|Floor):/.exec(prompt)?.[1];
  if (!mode) return [];
  const tabs: PopTab[] = [];
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
  /* Items in tome2's item prompts are described by our own card, from the ⓘ beside each. */
  const options: TermViewOptions = { layout, describe: kind === 'item' ? ['A', 'Z'] : describableRange(prompt), cursorRow: buffer.cursorY };
  if (prompt && kind !== 'more' && !CARD_KINDS.has(kind)) options.title = cleanPrompt(prompt) || undefined;
  if (kind === 'item') options.tabs = itemTabs(prompt);
  if (layout === 'panel' && leadMessages.length) {
    options.lead = leadMessages.map((m) => m.text);
    noteLeadShown();
  }
  if (reader.heading()?.size === 0) options.empty = 'Nothing here yet.';
  const box = currentBox();
  if (box) options.hideRow = (row) => row >= box.top && row <= box.bottom;
  else if (/\(1\) User Interface Options/.test(buffer.screenText())) options.hideRow = (row) => OWNED_OPTIONS.test(buffer.rowText(row));
  return options;
}

/*
 * Entries of tome2's options menu left out: what the app sets itself (Settings → Animation sets the delay; the map's
 * edge pulses at low health), what means nothing here (windows, option files), the Automatizer (a keyboard editor)
 * and the menu's own key prompt.
 */
const OWNED_OPTIONS = /\((D|H|T|W|U|O)\) (Base Delay Factor|Hitpoint Warning|Automatizer|Window Flags|Dump Options setting|Load Options setting)|^Command:/;

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
  return game.lastSnap?.icky ? findMessageBox(bufferRows(buffer, 0, buffer.rows - 1)) : null;
}

function updatePromptCard(): void {
  const box = character.hosting ? null : currentBox();
  if (box && !macros.running && engine.pendingKeys === 0) {
    promptCard.showBox(box);
    return;
  }
  const kind = currentPrompt();
  const quiet = !macros.running && engine.pendingKeys === 0;
  /* tome2 asks to dump the screen at a death, or for a last screenshot when undead form ends it. */
  if (kind === 'yesno' && /Dump the screen\?|Make a last screenshot\?/.test(rowZeroText()) && quiet) {
    const player = engine.gameState(0)?.player;
    if (player && !hasFallen(player)) {
      /* A life to return with, or tome2 saves the hero: no death card, and no screen dump. */
      promptCard.hide();
      send(keyCodes('n'));
    } else {
      promptCard.showDeath(player?.diedFrom ?? '', !!player?.adventure && player.lives === 1);
    }
    return;
  }
  if (isReturnPrompt(rowZeroText()) && quiet) {
    const player = engine.gameState(0)?.player;
    promptCard.showReturn({
      cause: player?.diedFrom ?? '',
      lives: (player?.lives ?? 1) - 1,
      battlefield: battlefieldText(game.place),
      safety: player?.closed ? { refusal: SAFETY_CLOSED[player.closed] } : { text: safetyText(player?.haven ?? '') },
      refuse,
    });
    return;
  }
  const menuShown = termView.visible && (termView.choices().length > 0 || termView.options().length > 0);
  const show =
    CARD_KINDS.has(kind) && !(kind === 'text' && menuShown) && !macros.running && !journeys.targeting && !journeys.answering && !title.isVisible && engine.pendingKeys === 0;
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

/** Tells the soundtrack where the player is: on a new level, or every couple of seconds for time of day. */
function updatePlace(snap: LevelSnapshot): void {
  const key = `${snap.depth}:${snap.wild}:${snap.width}x${snap.height}`;
  const now = performance.now();
  const moved = gridDistance({ x: snap.px, y: snap.py }, game.placePos) > 1;
  game.placePos = { x: snap.px, y: snap.py };
  if (key === game.placeKey && !moved && now - game.placeAt < PLACE_POLL_MS) return;
  game.placeKey = key;
  game.placeAt = now;
  game.place = engine.place();
  audio.setPlace(game.place);
}

/** Reads engine state and decides how the screen is presented. */
function refresh(): void {
  const snap = engine.snapshot();
  if (!snap) return;
  game.lastSnap = snap;

  if (!snap.inDungeon) {
    game.ended = false;
    commandState = null;
    leadMessages = [];
    leadShown = false;
    questMoment = null;
    audio.setView('title');
    setMode(title.isVisible ? 'title' : 'screen');
    if (!director.render()) {
      const options = panelOptions('full');
      if (!reader.render('full')) termView.render(buffer, { x0: 0, y0: options.title ? 1 : 0, x1: buffer.cols - 1, y1: buffer.rows - 1 }, options);
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
    journeys.setFeatures(features);
    audio.setDoors(doorKinds(features, FB_DOOR, FB_NO_WALK));
    map.setMaterials(materials);
    materialsLoaded = true;
  }
  map.setPalette(buffer.paletteRgb);
  map.setSnapshot(snap);
  memory.update(snap);

  if (hasEffects && performance.now() - effectsAt > EFFECT_LINGER_MS) {
    map.setEffects([]);
    hasEffects = false;
  }

  const state = engine.gameState();
  /* A shop or other building waits for its own commands under its screen. */
  const atCommands = snap.atCommand || (snap.icky && shop.atCommands());
  const lastCommandState = commandState;
  const ledSince = leadShown;
  if (state && atCommands) {
    commandState = state;
    leadShown = false;
  }
  leadMessages = leadInMessages(commandState, state, atCommands, settings.messages === 'flow');

  if (snap.icky || shop.trading) {
    setMode('overlay');
    const under = engine.savedScreen() ?? base;
    const region = (under ? buffer.diffBounds(under, 1) : null) ?? { x0: 0, y0: 1, x1: buffer.cols - 1, y1: buffer.rows - 1 };
    const rows = bufferRows(buffer, 0, buffer.rows - 1);
    const screen = characterScreen();
    const characterView = !!(screen.skills || screen.abilities || screen.sheet);
    const store = shop.look();
    const tomb = game.abandoning ? null : parseTomb(rows);
    const fame = !tomb && game.ended && isHallOfFame(rows);
    if (tomb) game.ended = true;
    app.classList.toggle('ended', !!tomb || fame);
    if (game.abandoning) {
      /* tome2's end-of-game screens are passed while the adventure is abandoned. */
      termView.hide();
    } else if (termView.visible && currentBox() && !character.hosting) {
      /* The panel stays as it was beneath a message box. */
    } else if (tomb) {
      heroes.forget(tomb.name, { abandoned: engine.gameState(0)?.player?.diedFrom === ABANDONED });
      const summary = heroes.tomb(tomb);
      termView.renderCustom({ layout: 'full', title: 'Your adventure has ended' }, summary.key, summary.build);
    } else if (fame) {
      const player = game.lastState?.player;
      const scores = engine.scores();
      const shown = player ? heroEntry(scores, { name: player.name, level: player.lev, turns: snap.turn }) : -1;
      termView.renderCustom({ layout: 'full', title: 'Hall of Fame', subtitle: 'Tap a hero for their tale' }, `fame:${scores.length}:${shown}`, () =>
        heroes.fameRows(scores, shown, true),
      );
    } else if (store) {
      shop.render();
    } else if (character.render(screen) || characterView) {
      /* The character sheet shows these screens; one typed on the map opens it at the next idle. */
      termView.hide();
    } else if (!reader.render('panel')) {
      termView.render(buffer, region, panelOptions('panel'));
    }
    map.setReticle(null);
  } else {
    setMode('map');
    shop.leave();
    termView.hide();
    const cursor = rowZeroText() ? terminalToDungeon(snap, buffer.cursorX, buffer.cursorY) : null;
    map.setReticle(cursor && (cursor.x !== snap.px || cursor.y !== snap.py) ? cursor : null);
  }
  updatePromptCard();

  if (state) {
    if (state.player) {
      state.player.area = areaName(game.place) ?? undefined;
      state.player.inTown = !!game.place && game.place.depth === 0 && !game.place.wild && game.place.town > 0;
    }
    const previous = game.lastState;
    game.lastState = state;
    memory.level.explore.noteGold(state.objects ?? [], snap);
    hud.update(state, snap.py, snap.px);
    if (state.player) {
      for (const event of feel.update(state.player)) {
        if (questMoment) feel.play(questMoment.event);
        if (event.kind === 'questEnd' && !event.failed) audio.cue('quest');
        /* tome2 can ask (a princess's reward) before it marks the quest done, and with Pause its -more- has shown every word. */
        const led = ledSince || leadShown || (event.kind === 'questEnd' && settings.messages !== 'flow');
        const quest: LevelQuest =
          event.kind === 'quest' ? state.player.quest! : { id: event.id, state: event.failed ? 'failed' : 'done', title: event.title };
        questMoment = { event, quest, since: lastCommandState, led };
      }
      feel.setQuest(
        state.player.quest?.state === 'active' && !state.player.dead,
        !hasEffect(state.player, 'hallucinating') && (state.monsters ?? []).some((m) => m.quest && m.view && isHostile(m)),
      );
    }
    const sameHero = !!previous && previous.player?.name === state.player?.name;
    const slain = sameHero ? slainMonsters(previous.monsters ?? [], state.monsters ?? [], newMessages(previous, state)) : [];
    if (sameHero) showHits(previous, state, slain);
    if (state.player) {
      app.classList.toggle('fallen', hasFallen(state.player) && !game.abandoning);
      app.classList.toggle('between', !!state.player.dead && state.player.fate === 'choice');
      heroes.update(state.player, slain, snap.turn, sameHero && (previous.player?.chp ?? 0) > state.player.chp);
    }
    if (hasFallen(state.player)) heroes.remember(state.player!, state, snap);
    if (shop.shown && !game.inStore) audio.cue('shop');
    game.inStore = !!shop.shown;
    audio.setView(game.ended ? 'gameover' : state.player?.dead && state.player.fate === 'choice' ? 'between' : 'game');
    if (state.player) {
      const follow = followReturn(game.askedLives, state.player);
      game.askedLives = follow.asked;
      if (follow.returned) {
        feel.play({ kind: 'returned', lives: state.player.lives ?? 0 });
        audio.cue('returned');
        game.saveOnReturn = true;
      }
    }
    abilities.hearGear(snap.turn);
    audio.update(snap, state, game.inStore);
    conversation.follow(previous, state);
    coach.update(mode === 'map' && snap.atCommand && !looking && look.hidden && !map.overview, snap.turn);
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
 * those words (with a question, in a creature's words or a building's reply:
 * it waits for a conversation to be told), or said nothing. Otherwise, and on
 * a return to a quest's level, its banner.
 */
function tellQuestMoment(): void {
  const moment = questMoment;
  const snap = game.lastSnap;
  const state = game.lastState;
  if (!moment || !snap || !state || mode !== 'map' || !snap.atCommand || journeys.travelling || macros.running || conversation.talking || sheets.isOpen || promptCard.visible) return;
  questMoment = null;
  const { event, quest } = moment;
  const arrival = event.kind === 'quest';
  const key = questKey(quest, snap.depth);
  const told = arrival && memory.questTold(key);
  const scene = moment.led || !moment.since ? [] : newMessages(moment.since, state).filter((m) => !SCENE_NOISE.test(m.text)).slice(0, LEAD_LINES).reverse().map((m) => m.text);
  if (told || (!arrival && !scene.length)) {
    feel.play(event);
    return;
  }
  if (arrival) memory.noteQuest(key);
  const subtitle = event.kind === 'questEnd' ? (event.failed ? 'Quest failed' : 'Quest complete') : [event.place, event.feet ? `${event.feet} ft` : ''].filter(Boolean).join(' · ') || 'Quest';
  openQuest(sheets, quest, { subtitle, scene, task: arrival });
}

/**
 * Marks creatures whose health dropped since the last state and floats the
 * damage over them; a creature that vanished with a kill message gets a
 * farewell and a ring in its colour instead.
 */
function showHits(previous: GameState, next: GameState, slain: readonly Slain[]): void {
  if (mode !== 'map' || hasEffect(next.player, 'hallucinating')) return;
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

/* Action bar */

function underfootFeat(snap: LevelSnapshot): number {
  return snap.feat[snap.py * snap.width + snap.px];
}

function underfootName(snap: LevelSnapshot): string {
  return features[underfootFeat(snap)]?.name.toLowerCase() ?? '';
}

/** The god of the altar the hero stands at, or undefined. */
function altarGodHere(snap: LevelSnapshot): string | undefined {
  return snap.inDungeon ? features[underfootFeat(snap)]?.god : undefined;
}

/** What the altar underfoot offers the hero, if anything. */
function altarHere(snap: LevelSnapshot): 'worship' | 'offer' | null {
  const p = game.lastState?.player;
  return p ? altarAction(altarGodHere(snap), p.god ?? '', !!p.faithless) : null;
}

/** The button for the door of a shop, the home or another building the hero stands at (tome2 calls them all buildings). */
function entranceHere(snap: LevelSnapshot): string | null {
  if (snap.wild || underfootName(snap) !== 'building') return null;
  const store = engine.store();
  return store ? entranceLabel(store) : null;
}

/** A weapon or light worth equipping from the pack. */
function gearSuggestion(): GearSuggestion | null {
  const snap = game.lastSnap;
  if (!snap?.inDungeon || !snap.atCommand) return null;
  const inventory = engine.inventory();
  if (!inventory?.ready) return null;
  return suggestedGear(inventory, {
    inDungeon: snap.depth > 0,
    wieldsWeapons: abilities.style().weapons,
  });
}

/** The weakest hostile creature next to the player, if any (none while the hero controls another creature, as the hero cannot fight then). */
function adjacentFoe(): MonsterState | null {
  const snap = game.lastSnap;
  if (!snap?.inDungeon || !snap.atCommand || controlling()) return null;
  const foes = (game.lastState?.monsters ?? []).filter((m) => isHostile(m) && isAdjacent(m.x, m.y, snap.px, snap.py));
  foes.sort((a, b) => a.hp / Math.max(1, a.maxhp) - b.hp / Math.max(1, b.maxhp));
  return foes[0] ?? null;
}

/** A neutral creature next to the player (someone to talk to), if any. */
function talkPartner(): MonsterState | null {
  const snap = game.lastSnap;
  if (!snap?.inDungeon || !snap.atCommand) return null;
  return (game.lastState?.monsters ?? []).find((m) => isNeutral(m) && isAdjacent(m.x, m.y, snap.px, snap.py)) ?? null;
}

function useSuggested(): void {
  const gear = gearSuggestion();
  if (gear) runMacro(itemMacro({ id: gear.kind, label: gear.kind, command: gear.command }, gear.item, 'pack'));
}

/** What the map toolbar is built from at the command prompt: what is underfoot and around, what Explore would do, and the hero's own buttons. */
function mapSituation(snap: LevelSnapshot): Partial<ActionContext> {
  if (journeys.exploring) return { exploring: settings.explorePace };
  if (!snap.atCommand) return {};
  const quick = abilities.quick();
  return {
    talk: !!talkPartner(),
    altar: altarHere(snap),
    exploreNext: journeys.exploreNext(snap),
    exploreRefusal: exploreRefusal(surroundings()),
    entrance: entranceHere(snap),
    gear: gearSuggestion()?.kind ?? null,
    quick: quick ? { label: recentLabel(quick), unavailable: abilities.unavailable(quick, true) } : null,
    magic: abilities.magicLabel(),
    fire: abilities.fireSlot(),
  };
}

function updateActionBar(force = false): void {
  /* A bolt or blast being drawn is part of a turn under way: the toolbar waits for it to end. */
  if (drawingEffect) return;
  const snap = game.lastSnap;
  const directed = mode === 'screen' ? director.actions() : null;
  const prompt = currentPrompt();
  const foe = adjacentFoe();
  map.setFoe(foe && mode === 'map' ? { x: foe.x, y: foe.y } : null);
  const actions =
    directed ??
    shop.actions() ??
    contextActions({
      mode,
      /* tome2's question of which door travel is opening is answered by travel, not the player. */
      prompt: journeys.answering ? 'none' : prompt,
      promptText: rowZeroText(),
      cardShown: promptCard.visible,
      listShown: termView.visible && (termView.choices().length > 0 || termView.options().length > 0),
      fallen: hasFallen(game.lastState?.player),
      screen: !termView.visible ? null : termView.options().length ? 'options' : /You may now dump a character record/.test(buffer.screenText()) || (game.ended && /Hall of Fame/.test(rowZeroText())) ? 'gameover' : reader.heading() ? 'file' : null,
      looking,
      overview: map.overview,
      atCommand: !!snap?.atCommand,
      underfoot: snap && snap.inDungeon ? underfootName(snap) : '',
      feat: snap?.inDungeon ? underfootFeat(snap) : undefined,
      floorObjects: snap?.floorObjects ?? 0,
      alwaysPickup: alwaysPickup(),
      ...(mode === 'map' && snap ? mapSituation(snap) : {}),
      foe: foe && snap ? directionDigit(foe.x - snap.px, foe.y - snap.py) : null,
      worldMap: worldMap(snap),
      controlling: controlling(),
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
  if (!action.continues) journeys.interrupt('action');
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
      openCommands(
        {
          api,
          openNative,
          read: (keys) => {
            coverSheets(true);
            send(keys);
          },
          keyboard: () => keyboardInput.focus(),
          toggleCtrl: () => setCtrlLatched(!ctrlLatched),
        },
        commandContext(),
      );
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

/** Up/down/select over a panel: moves its highlight, or tome2's own cursor when the keys go to tome2. */
function navigate(direction: 'up' | 'down' | 'select'): void {
  if (termView.step(direction)) return;
  if (direction === 'select') send([KEY_ENTER]);
  else send(directionKeys(direction === 'up' ? '8' : '2', false));
}

function alwaysPickup(): boolean {
  return !!game.lastState?.player?.alwaysPickup;
}

/** The hero is on the world map (the surface, `wild`). */
function worldMap(snap: LevelSnapshot | null): boolean {
  return !!snap?.inDungeon && snap.depth === 0 && snap.wild;
}

/** Where the hero is, how far they have come, and whether they control another creature. */
function surroundings(): Pick<CommandContext, 'where' | 'town' | 'level' | 'controlling'> {
  const snap = game.lastSnap;
  return {
    where: worldMap(snap) ? 'worldMap' : !snap?.inDungeon || snap.depth > 0 ? 'dungeon' : 'land',
    town: !!game.place && (game.place.town > 0 || game.place.quest > 0),
    level: game.lastState?.player?.lev ?? 0,
    controlling: controlling(),
  };
}

/** What the More sheet needs to know of the hero's situation. */
function commandContext(): CommandContext {
  const snap = game.lastSnap;
  const player = game.lastState?.player;
  return {
    ...surroundings(),
    underfoot: snap?.inDungeon ? underfootName(snap) : '',
    feat: snap?.inDungeon ? underfootFeat(snap) : -1,
    beside: !!snap && (game.lastState?.monsters ?? []).some((m) => isAdjacent(snap.px, snap.py, m.x, m.y)),
    pray: player?.pray ?? 0,
    runes: (player?.runes ?? 0) > 0,
    steals: abilities.steals(),
    magic: hasMagic(abilities.spells()),
    powers: hasPowers(abilities.spells()),
    magicItems: !!abilities.spells()?.items.length,
    targets: (game.lastState?.monsters ?? []).some((m) => isHostile(m) && !!m.target),
  };
}

/** The hero controls another creature (a Fire Golem, or one taken by Mind Steal). */
function controlling(): boolean {
  return !!game.lastState?.player?.control;
}

/** Where the creature the hero controls stands: undefined when they control none, null when it is out of sight. */
function steered(): MapPoint | null | undefined {
  const id = game.lastState?.player?.control;
  if (!id) return undefined;
  const creature = game.lastState?.monsters?.find((m) => m.id === id);
  return creature ? { x: creature.x, y: creature.y } : null;
}

/** Why the hero cannot set off for somewhere while things stay as they are, or null (busy is told when tapped). */
function travelRefusal(): string | null {
  return controlling() ? CONTROLLING : null;
}

/** Refuses a journey of the hero's own while they control another creature. */
function heroHeld(): boolean {
  if (!controlling()) return false;
  refuse(CONTROLLING);
  return true;
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
    exploreNext: journeys.exploreNext(snap),
    entrance: entranceHere(snap),
    gear: gearSuggestion()?.kind ?? null,
    foe: foe ? directionDigit(foe.x - snap.px, foe.y - snap.py) : null,
    worldMap: worldMap(snap),
  });
}

/**
 * tome2's own inventory and equipment screens treat the next key as a new
 * command (so tapping "a" would aim a wand); they are replaced by the
 * native sheets, as are its knowledge menu and pet command.
 */
function redirectNativeScreen(): boolean {
  if (macros.running) return false;
  const m = /^(Inventory|Equipment): carrying/.exec(rowZeroText());
  if (m) {
    engine.sendKeys([KEY_ESCAPE]);
    openInventory(api, m[1] === 'Equipment' ? 'equip' : 'pack');
    return true;
  }
  /* tome2's pet command (`P` typed) gives way to Companions. */
  if (/Select a command:/.test(rowZeroText()) && /a\) dismiss pets/.test(buffer.screenText())) {
    engine.sendKeys([KEY_ESCAPE]);
    game.returnTo = { stack: [companionsLater(api)], places: [] };
    return true;
  }
  if (/Display current knowledge/.test(buffer.screenText())) {
    engine.sendKeys([KEY_ESCAPE]);
    const trail = game.returnTo;
    game.returnTo = null;
    if (trail && !sheets.isOpen) sheets.restore(trail);
    else openKnowledge(api);
    return true;
  }
  return false;
}

/* Macros */

function runMacro(macro: Macro): void {
  journeys.interrupt('macro');
  recentreMap();
  const keys = macros.start(macro);
  if (keys.length) engine.sendKeys(keys);
}

function stepMacro(): void {
  const keys = macros.step({ prompt: rowZeroText(), screen: buffer.screenText(), atCommand: !!game.lastSnap?.atCommand });
  if (keys.length) {
    engine.sendKeys(keys);
    return;
  }
  /* The macro has ended: sheets it covered come back, or a question it ended at shows its card now. */
  reopenSheets();
  updatePromptCard();
  updateActionBar();
}

/* Taps and gestures on the stage */

function recentreMap(): void {
  if (!map.panned) return;
  map.resetPan();
  recentre.hidden = true;
  redraw();
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
  if (journeys.active) {
    journeys.stop(null, 'tap');
    return;
  }
  const prompt = currentPrompt();
  if (prompt === 'more') {
    send([SPACE]);
    return;
  }
  if (promptCard.visible && prompt !== 'aim' && prompt !== 'direction') return;

  const snap = game.lastSnap;
  if (mode === 'map' && snap) {
    const cell = map.cellAt(clientX, clientY);
    if (map.overview) {
      setOverview(false);
      if (cell && snap.atCommand) goTowards(snap, cell);
      return;
    }
    if (looking) {
      if (cell) look.show(cell);
      return;
    }
    if (!look.hidden) {
      look.hide();
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
  doTap(tapAction(snap, heroMaterials(), cell, prompt, game.lastState?.monsters, steered()));
}

function goTowards(snap: LevelSnapshot, point: MapPoint): void {
  doTap(goAction(snap, heroMaterials(), point, game.lastState?.monsters));
}

/** Carries out what a tap on the map decided. */
function doTap(action: TapAction): void {
  switch (action.kind) {
    case 'direction':
      send(directionKeys(action.digit, false));
      break;
    case 'target':
      journeys.target(action.cell);
      break;
    case 'interrupt':
      send([KEY_ESCAPE]);
      break;
    case 'wait':
      send([BACKSLASH, waitCommand(alwaysPickup()).charCodeAt(0)]);
      break;
    case 'travel':
      journeys.travelTo(action.cell);
      break;
    case 'step':
      journeys.stepTo(action.cell);
      break;
    case 'talk':
      conversation.converse('Y', action.digit);
      break;
    case 'steer':
      send([BACKSLASH, ...keyCodes(`;${action.digit}`)]);
      break;
    case 'refuse':
      refuse(action.why);
      break;
    case 'none':
      break;
  }
}

attachMapGestures(stage, {
  onTap: onStageTap,
  onLongPress(clientX, clientY, target) {
    if (title.isVisible || sheets.isOpen || insideControls(target) || mode !== 'map') return;
    const cell = map.cellAt(clientX, clientY);
    if (cell) {
      journeys.interrupt('look');
      navigator.vibrate?.(10);
      look.show(cell);
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
  if (!snap || !snap.inDungeon || !snap.atCommand || snap.icky || game.quitting) return false;
  game.lastSavedTurn = snap.turn;
  game.pendingSync = notify;
  engine.sendKeys([BACKSLASH, CTRL_S]);
  return true;
}

function autosave(): void {
  journeys.interrupt('autosave');
  const snap = engine.state === 'running' ? engine.snapshot() : null;
  if (snap && snap.turn !== game.lastSavedTurn && saveGame('silent')) return;
  memory.persist();
  engine.syncNow().catch((err) => console.error('Saving to browser storage failed', err));
}

/** Collects bolt and explosion glyphs drawn over the map during an animation pause. */
function captureEffects(): void {
  const snap = game.lastSnap;
  if (!snap || !snap.inDungeon || snap.icky || !base) return;
  if (snap.panelRow !== basePanel.row || snap.panelCol !== basePanel.col) return;
  const effects = drawnEffects(snap, buffer, base, buffer.cols, buffer.rows);
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

/** Marks the map as changed and asks for a frame to draw it. */
function redraw(): void {
  dirty = true;
  requestFrame();
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
    redraw();
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
    if (titleRestart !== null) {
      returnToTitle();
      return;
    }
    if (game.quitting) {
      const abandoned = game.abandoning;
      game.abandoning = null;
      if (!abandoned) {
        returnToTitle();
        return;
      }
      game.lastState = null;
      heroes.forget(abandoned);
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
    redraw();
  },
  onIdle() {
    /* Storage has been read from the browser by the time the engine first waits for a key. */
    heroes.load(engine.fs, engine.savePath);
    memory.load(engine.fs, engine.savePath);
    /* A run quit through tome2's quit command is kept in the Hall of Fame as abandoned. */
    engine.markAbandoned();
    if (!macros.running && reader.idle()) return;
    if (shop.idle()) return;
    director.idle();
    dirty = false;
    refresh();
    if (game.lastSnap?.inDungeon && !game.lastSnap.icky) {
      base = buffer.copy();
      basePanel = { row: game.lastSnap.panelRow, col: game.lastSnap.panelCol };
    }
    if (hasEffects) {
      map.setEffects([]);
      hasEffects = false;
    }
    hud.tick();
    if (game.pendingSync && game.lastSnap?.atCommand) {
      const notify = game.pendingSync === 'toast';
      game.pendingSync = null;
      memory.persist();
      engine.syncNow().then(
        () => {
          if (!notify) return;
          showToast(engine.storageError ? 'Saved for this session only' : 'Game saved', { read: !!engine.storageError });
          audio.cue('save');
        },
        (err) => {
          console.error('Save sync failed', err);
          showToast('Saving to browser storage failed', { read: true });
        },
      );
    }
    /* After the sync above, which is for a save already written: this one syncs at the next command prompt. */
    if (game.saveOnReturn && engine.pendingKeys === 0 && saveGame('silent')) game.saveOnReturn = false;
    if (engine.pendingKeys > 0) {
      requestFrame();
      return;
    }
    const used = game.lastSnap?.inDungeon ? castWatcher.idle(rowZeroText(), !!game.lastSnap.atCommand) : null;
    if (used) api.remember(used);
    if (redirectNativeScreen()) {
      requestFrame();
      return;
    }
    if (game.lastSnap?.inDungeon && !macros.running) {
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
      if (!macros.running && reader.idle()) {
        requestFrame();
        return;
      }
    } else {
      journeys.idle();
    }
    conversation.settle();
    shop.settle();
    /* A quest moment held while a macro ran is told once it has finished. */
    tellQuestMoment();
    /* tome2 never comes back to the command prompt after saving to quit: back at it, the quit stopped short, and nothing is left to delete. */
    if (game.quitting && !macros.running && game.lastSnap?.inDungeon && game.lastSnap.atCommand && !game.lastSnap.icky) {
      game.quitting = false;
      game.abandoning = null;
    }
    requestFrame();
  },
  onKey(code) {
    audio.keyConsumed(code, game.lastSnap?.atCommand ?? false);
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
  /* Keys are not followed as the hero's magic while they control another creature. */
  if (key !== null && game.lastSnap?.inDungeon && !controlling()) {
    castWatcher.note(rowZeroText(), buffer.screenText(), key, !!game.lastSnap.atCommand);
    if (castWatcher.casting) audio.castingTone(abilities.castingTone(castWatcher.casting));
  }
  journeys.interrupt('send');
  if (macros.running) macros.cancel();
  conversation.note(codes);
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
    redraw();
  },
});

const feel = new GameFeel(byId<HTMLElement>('stage'), () => settings.animation);
const coach = new Coach(byId<HTMLElement>('stage'));
const title = new TitleScreen(byId<HTMLElement>('title-screen'), () => settings.animation, {
  onChoose: (choice) => director.choose(choice),
  onAdventurers: (saves) => heroes.openRoster(saves),
  describe: (save) => heroes.describe(save),
  onReady: () => {
    if (titleRestart) showToast(titleRestart, { log: false, read: true });
    titleRestart = null;
    const name = heroes.takeAnew();
    if (name && director.beginAnew(name)) return;
    updates.adopt();
  },
  onSettings: () => openSettingsSheet(),
  onBackup: () => backup.open(),
  onMusic: () => openSoundtrack(sheets, audio),
  onFame: () => heroes.openHallOfFame(),
  onHelp: () => openHelpSheet(),
  onHidden: () => {
    redraw();
  },
});
director.attachTitle(title);

/* Controllers */

const abilities = new Abilities({
  api,
  audio,
  castWatcher,
  runMacro,
  watchAttempt: () => conversation.watchAttempt(),
  send,
  alwaysPickup,
});
const look = new LookCard({
  api,
  element: byId<HTMLElement>('look-card'),
  map,
  go: (point) => {
    setLooking(false);
    journeys.travelTo(point);
  },
  redraw,
  requestFrame: () => requestFrame(),
});
const reader = new Reader({ engine, buffer, termView, send, panelOptions, openHelp: () => openHelpSheet() });
const shop = new ShopController({
  api,
  buffer,
  termView,
  send,
  macroRunning: () => macros.running,
  prompt: currentPrompt,
  showToast,
  deny: () => audio.cue('deny'),
  steals: () => abilities.steals(),
  redraw,
  restoreEngineSettings: applyEngineSettings,
  replied: noteLeadShown,
});
const heroes = new Heroes({
  engine,
  sheets,
  director,
  feel,
  recents,
  palette: () => buffer.palette,
  cueDeed: () => audio.cue('levelup'),
  forgetMemory: (name) => memory.forget(name),
  interrupt: () => journeys.interrupt('fallen'),
  finishGame,
  showToast,
  send: (save, name) => transfer.send(save, name),
});
const memory = new HeroMemoryKeeper({
  engine,
  adventurers: heroes.adventurers,
  place: () => game.place,
  state: () => game.lastState,
  onLevel: () => {
    if (journeys.exploring) journeys.stop(null, 'level');
  },
  changed: () => {
    dirty = true;
  },
});
const journeys = new Journeys({
  engine,
  buffer,
  map,
  snapshot: () => game.lastSnap,
  state: () => game.lastState,
  materials: heroMaterials,
  mapMaterials: () => materials,
  level: () => memory.level,
  heading: () => memory.heading,
  alwaysPickup,
  pace: () => settings.explorePace,
  animating,
  cursorCell: () => (game.lastSnap && buffer.cursorY >= 0 ? terminalToDungeon(game.lastSnap, buffer.cursorX, buffer.cursorY) : null),
  held: heroHeld,
  underfoot: underfootName,
  lightOffered: (snap) => changingButton(snap).id === 'equip' && gearSuggestion()?.kind === 'light',
  send,
  showToast: (text) => showToast(text),
  hideToast,
  recentreMap,
  updatePromptCard,
  updateActionBar: () => updateActionBar(),
  requestFrame: () => requestFrame(),
});
const conversation = new Conversation({
  engine,
  snapshot: () => game.lastSnap,
  state: () => game.lastState,
  macroRunning: () => macros.running,
  prompt: currentPrompt,
  held: heroHeld,
  runMacro,
  hideToast,
  showToast,
  openMessage: (title, text) => openMessage(sheets, title, text),
  told: noteLeadShown,
});
const transfer = new Transfer({
  engine,
  sheets,
  input: receiveFile,
  restartTitle,
  showToast: (text) => showToast(text, { log: false, read: true }),
});
const backup = new Backup({ engine, sheets, input: importFile, receive: () => transfer.choose() });
/** What to say once the title has started again for heroes that arrived (null while it is not starting again). */
let titleRestart: string | null = null;

/** Starts the title again, so tome2 lists the heroes as storage now holds them (tome2 quits at its savefile screen on Escape), then says `told`. */
function restartTitle(told: string): void {
  if (!director.atTitle || engine.state !== 'running') return;
  titleRestart = told;
  sheets.closeAll();
  title.setBusy('Bringing in your hero…');
  engine.sendKeys([KEY_ESCAPE]);
}
const updates = new Updates(() => director.atTitle);
updates.register();

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
  redraw();
}

new ResizeObserver(() => layout()).observe(stage);
watchAppHeight();

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
    if (e.key !== 'Escape' && termView.handleKey(e)) return;
    if ((e.key === 'Escape' || e.key === 'Enter') && !macros.running) finishGame();
    return;
  }
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (shop.shown) {
    /* In a shop Escape leaves; a service's letter asks for it as a tap does. */
    const extra = plain ? shopModel(shop.shown).extras.find((a) => a.key === e.key) : undefined;
    if (e.key === 'Escape' || extra) {
      e.preventDefault();
      if (extra && !e.repeat) shop.runService(extra);
      else if (!extra) send([KEY_ESCAPE]);
      return;
    }
  }
  if (reader.heading()) {
    /* Escape leaves the whole viewer; tome2's search and go-to keys would open questions the reader does not show. */
    if (e.key === 'Escape' || /^[=/#%]$/.test(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') reader.close();
      return;
    }
    if (plain && reader.followKey(e.key)) {
      e.preventDefault();
      return;
    }
  }
  /* Arrows and Enter: the how-many card's number, else the panel's highlight or the reader's scroll (TermView decides). */
  if (promptCard.handleKey(e) || termView.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (!look.hidden && mode === 'map') {
    /* The look card is a list: arrows move its highlight, Enter chooses, Escape closes it. */
    if (e.key === 'Escape') {
      e.preventDefault();
      look.hide();
      return;
    }
    if (look.handleKey(e)) {
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
      memory.forgetLevels();
    }
    settings = next;
    saveSettings(settings);
    applySettings();
    applyEngineSettings();
    audio.setVolumes(settings.music, settings.sound);
    map.zoom = settings.zoom;
    pinchStartZoom = settings.zoom;
    map.glyphMode = settings.glyphs;
    redraw();
    title.animationChanged();
  }, adventureRules());
}

/** The rules the hero's adventure was begun with, during a game. */
function adventureRules(): AdventureRules | null {
  const player = game.lastState?.player;
  const run = inGame() ? engine.runOptions() : null;
  return player?.name && run ? { hero: player.name, run, lives: player.lives ?? 0 } : null;
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
  return !!game.lastSnap?.inDungeon;
}

/** Saves, waits for the save to reach browser storage, then returns to the title screen. */
function saveAndQuit(): void {
  sheets.closeAll();
  if (!inGame()) {
    location.reload();
    return;
  }
  game.quitting = true;
  journeys.stop(null, 'quit');
  memory.persist();
  showToast('Saving…', { log: false });
  runMacro(quitMacro());
}

/**
 * Back to the title screen once the engine has exited, with a fresh engine
 * in the same page: the music carries on, as a reload would need another tap
 * before the browser lets it play.
 */
function returnToTitle(): void {
  sheets.closeAll();
  journeys.reset();
  if (macros.running) macros.cancel();
  promptCard.hide();
  termView.hide();
  look.hide();
  if (looking) setLooking(false);
  if (map.overview) setOverview(false);
  base = null;
  game = newRunState();
  reader.reset();
  shop.reset();
  conversation.reset();
  memory.reset();
  abilities.reset();
  hideToast();
  app.classList.remove('fallen', 'between', 'ended');
  buffer.clear();
  hud.reset();
  feel.reset();
  heroes.reset();
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
  game.quitting = true;
  journeys.stop(null, 'quit');
  runMacro(isHallOfFame(bufferRows(buffer, 0, buffer.rows - 1)) ? finishMacro() : leaveTombMacro());
}

/** Help, with the original ToME manual during a game (Help reopens when it closes). */
function openHelpSheet(topic?: string): void {
  openHelp(
    {
      sheets,
      birthData: () => engine.birthData(),
      openManual: inGame()
        ? () => {
            reader.wantManual(!!game.lastSnap?.atCommand);
            api.command('?');
          }
        : undefined,
    },
    topic,
  );
}

/**
 * Ends the hero's adventure for good through tome2's own quit: tome2 keeps
 * the savefile as a fallen hero's (so they can be begun anew) and the run in
 * the Hall of Fame (marked abandoned in `onIdle`); its end-of-game screens are passed.
 */
function abandonAdventure(): void {
  const name = game.lastState?.player?.name;
  if (!name || !inGame()) return;
  sheets.closeAll();
  game.quitting = true;
  game.abandoning = name;
  journeys.stop(null, 'quit');
  showToast('Leaving…', { log: false });
  runMacro(abandonMacro());
}

function openGameMenu(): void {
  const playing = inGame();
  const dead = playing && !!game.lastState?.player?.dead;
  const fallen = playing && hasFallen(game.lastState?.player);
  openMenu(sheets, 'Menu', [
    { label: fallen ? 'Your hero' : 'Character', icon: '@', hidden: !playing, run: () => (fallen ? heroes.openFallen() : character.open('summary')) },
    { label: 'Messages', icon: '≣', hidden: !playing, run: () => showHistory() },
    { label: 'Knowledge', icon: '¶', hint: 'Artifacts, creatures, quests', hidden: !playing || fallen, run: () => openKnowledge(api) },
    { label: 'Save game', icon: '⇩', hidden: !playing || !game.lastSnap?.atCommand, run: () => {
      sheets.closeAll();
      if (!saveGame('toast')) showToast(NOT_NOW);
    } },
    { label: playing ? 'Save and quit' : 'Quit to title', icon: '⏻', hint: 'Back to the title screen', hidden: dead, run: () => {
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
    { label: 'Abandon adventure', icon: '✕', hint: 'End it for good', danger: true, hidden: !playing || dead, run: () => {
      const name = game.lastState?.player?.name ?? 'This hero';
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
    if (game.lastSnap) tapMapCell(game.lastSnap, { x, y }, classifyPrompt(rowZeroText()));
  },
  mapCellCentre: (x, y) => map.cellCentre(x, y),
  actions: () => currentActions.map((a) => a.id),
  travelling: () => journeys.travelling,
  settings: () => settings,
  lastStopCause: () => journeys.lastStopCause,
  exploreStop: () => journeys.nextStop(),
  macroRunning: () => macros.running,
  gear: () => gearSuggestion()?.kind ?? null,
  takeGear: () => useSuggested(),
  director,
  audio,
};

/* Start */

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
