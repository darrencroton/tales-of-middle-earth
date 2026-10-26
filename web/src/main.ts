import './styles.css';
import { Engine } from './engine.ts';
import { Hud, rowSegments, type HudEntity } from './hud.ts';
import { attachMapGestures, attachPinch } from './input/gestures.ts';
import {
  compositionDelta,
  directionKeys,
  KEY_BACKSPACE,
  KEY_ENTER,
  KEY_ESCAPE,
  translateKey,
  translateText,
} from './input/keys.ts';
import { Director } from './flow/director.ts';
import { FireEffect } from './render/fire.ts';
import { MapRenderer, MAX_ZOOM, MIN_ZOOM, type MapEffect, type MapPoint } from './render/map.ts';
import { buildMaterials, type FeatureInfo, type Material } from './render/materials.ts';
import { COMMAND_GROUPS, commandKeys, contextActions, pickupCommand, type Action, type CommandDef, type NativeView } from './play/actions.ts';
import { keyCodes, MacroRunner, type Macro } from './play/macro.ts';
import { classifyPrompt, directionDigit, isAdjacent, type PromptKind } from './play/prompts.ts';
import { TargetPicker } from './play/targeting.ts';
import { STOP_MESSAGES, Travel, type TravelContext } from './play/travel.ts';
import { isHostile, type GameState, type LevelSnapshot } from './render/snapshot.ts';
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
import { titleName, type GameApi } from './ui/api.ts';
import { INVEN_WIELD } from './play/items.ts';
import { openCharacter, openKnowledge } from './ui/character.ts';
import { el, iconText } from './ui/dom.ts';
import { describeCell, openFloorObject, openMonster } from './ui/info.ts';
import { openInventory } from './ui/inventory.ts';
import { askText, confirmSheet, openHistory, openMenu, openMessage, openSettings, openTemplate } from './ui/menus.ts';
import { Sheets } from './ui/sheet.ts';
import { bufferRows, parseRows, type ChoiceBlock, type OptionBlock } from './ui/termparse.ts';
import { TermView, type TermViewOptions, type TermViewTab } from './ui/termview.ts';
import { PromptCard, type CardKind } from './ui/promptcard.ts';
import { cleanPrompt, describableRange, isEmptyFile, isFileViewer } from './ui/prompttext.ts';
import { openStoreItem, parseStore, type StoreScreen } from './ui/store.ts';
import { abilitiesElements, abilityMoveKeys, parseAbilities, parseSkills, skillMoveKeys, skillsElements } from './ui/skills.ts';
import { findMessageBox, type MessageBox } from './ui/msgbox.ts';
import { parseTomb, tombElements } from './ui/gameover.ts';
import { fullSheetElements, parseFullSheet, sheetPageKeys, SHEET_PAGES, type FullSheet } from './ui/charsheet.ts';

declare global {
  interface Window {
    __tome?: {
      engine: Engine;
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
      macroRunning(): boolean;
      director: Director;
    };
  }
}

type ViewMode = 'title' | 'screen' | 'map' | 'overlay';

const KEYBOARD_SENTINEL = ' ';
const EFFECT_LINGER_MS = 160;
const HIGHLIGHT_MS = 2500;
const MAX_EFFECT_CELLS = 600;
const TRAVEL_STEP_MS = 45;
const BACKSLASH = 92;
const CTRL_S = 0x13;
const CTRL_X = 0x18;
const SPACE = 0x20;
/* Visible height lost to an on-screen keyboard before the layout makes room for it. */
const KEYBOARD_MIN_PX = 120;

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
applyTextSize(settings.textSize);

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
let travel: Travel | null = null;
let travelTimer = 0;
let lastStopCause = '';
let picker: TargetPicker | null = null;
let lastSavedTurn = -1;
let autosaveSyncPending = false;
let currentActions: Action[] = [];
let actionsKey = '';
let dirty = true;
let effectsAt = 0;
let hasEffects = false;
let ctrlLatched = false;
let lastRenderMs = 0;
let looking = false;
let quitting = false;
const macros = new MacroRunner();

const sheets = new Sheets(document.body, () => {
  app.classList.toggle('sheet-open', sheets.isOpen);
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
  onDescribe(key) {
    send([key.charCodeAt(0)]);
  },
  onOption(option, _index, options) {
    toggleOption(option, options);
  },
  onTapText() {
    continueIfWaiting();
  },
});

const promptCard = new PromptCard(stage, (keys) => send(keys));

const hud = new Hud(hudEl, messagesEl, () => buffer.palette, {
  onEntity: (entity) => openEntity(entity),
  onPlayer: () => openCharacter(api),
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
    sheets.closeAll();
    send(keys);
  },
  command: (command) => {
    sheets.closeAll();
    send([BACKSLASH, ...[...command].map((c) => c.charCodeAt(0))]);
  },
  runMacro: (macro) => {
    sheets.closeAll();
    runMacro(macro);
  },
  travelTo: (point) => {
    sheets.closeAll();
    hideLookCard();
    if (lastSnap?.atCommand) startTravel(point);
  },
  highlight: (point) => flash(point),
  askText: (title, label, initial) => askText(sheets, title, label, initial),
};

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
      openCharacter(api);
      break;
    case 'knowledge':
      openKnowledge(api);
      break;
    case 'finish':
      finishGame();
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

const CARD_KINDS = new Set<PromptKind>(['yesno', 'quantity', 'text', 'direction', 'aim']);

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
  const options: TermViewOptions = { layout, describe: describableRange(prompt) };
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
  const box = currentBox();
  if (box && !macros.running && engine.pendingKeys === 0) {
    promptCard.showBox(box);
    return;
  }
  const kind = currentPrompt();
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

function renderFullSheet(sheet: FullSheet): void {
  const tabs: TermViewTab[] = SHEET_PAGES.map((label, page) => ({
    label,
    active: page === sheet.page,
    run: () => page !== sheet.page && send(keyCodes(sheetPageKeys(sheet.page, page))),
  }));
  termView.renderCustom({ layout: 'panel', title: 'Character sheet', tabs }, JSON.stringify(sheet), () =>
    fullSheetElements(sheet, { send: (keys) => send(keyCodes(keys)), source: sheetSource }),
  );
}

/** Reads engine state and decides how the screen is presented. */
function refresh(): void {
  const snap = engine.snapshot();
  if (!snap) return;
  lastSnap = snap;

  if (!snap.inDungeon) {
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

  if (!materialsLoaded) {
    features = engine.features();
    materials = buildMaterials(features);
    map.setMaterials(materials);
    materialsLoaded = true;
  }
  map.setPalette(buffer.paletteRgb);
  map.setSnapshot(snap);

  if (hasEffects && performance.now() - effectsAt > EFFECT_LINGER_MS) {
    map.setEffects([]);
    hasEffects = false;
  }

  if (snap.icky) {
    setMode('overlay');
    const region = (base ? buffer.diffBounds(base, 1) : null) ?? { x0: 0, y0: 1, x1: buffer.cols - 1, y1: buffer.rows - 1 };
    const rows = bufferRows(buffer, 0, buffer.rows - 1);
    const skills = parseSkills(rows);
    const abilities = skills ? null : parseAbilities(rows);
    const fullSheet = skills || abilities ? null : parseFullSheet(rows);
    const tomb = parseTomb(rows);
    if (termView.visible && currentBox()) {
      /* The panel stays as it was beneath a message box. */
    } else if (tomb) {
      termView.renderCustom({ layout: 'full', title: 'Your adventure has ended' }, JSON.stringify(tomb), () => tombElements(tomb));
    } else if (fullSheet) {
      renderFullSheet(fullSheet);
    } else if (abilities) {
      termView.renderCustom(
        { layout: 'panel', title: 'Abilities', badge: `${abilities.points} point${abilities.points === 1 ? '' : 's'} to spend` },
        JSON.stringify(abilities),
        () =>
          abilitiesElements(abilities, (ability) => {
            const keys = abilityMoveKeys(abilities, ability);
            if (keys) send(keyCodes(keys));
          }),
      );
    } else if (skills) {
      termView.renderCustom(
        { layout: 'panel', title: 'Skills', badge: `${skills.points} point${skills.points === 1 ? '' : 's'} to spend` },
        JSON.stringify(skills),
        () =>
          skillsElements(skills, (skill) => {
            if (skill.selected) {
              if (skill.branch) send([KEY_ENTER]);
            } else {
              const keys = skillMoveKeys(skills, skill);
              if (keys) send(keyCodes(keys));
            }
          }),
      );
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
    lastState = state;
    hud.update(state, snap.py, snap.px);
    hud.updateMessages(
      state.messages ?? [],
      state.messageTotal ?? 0,
      promptCard.visible ? [] : rowSegments(buffer.chars.subarray(0, buffer.cols), buffer.attrs.subarray(0, buffer.cols), buffer.palette),
    );
  }
  updateActionBar();
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

function updateActionBar(force = false): void {
  const snap = lastSnap;
  const directed = mode === 'screen' ? director.actions() : null;
  const prompt = currentPrompt();
  const store = prompt === 'none' || prompt === 'other' ? currentStore() : null;
  const actions =
    directed ??
    (store ? storeActions(store) : null) ??
    contextActions({
      mode,
      prompt: currentPrompt(),
      promptText: rowZeroText(),
      cardShown: promptCard.visible,
      listShown: termView.visible && (termView.choices().length > 0 || termView.options().length > 0),
      screen: !termView.visible ? null : termView.options().length ? 'options' : /Skills Screen/.test(rowZeroText()) ? 'skills' : /Abilities Screen/.test(rowZeroText()) ? 'abilities' : /'p' for previous, 'n' for next/.test(buffer.screenText()) ? 'sheet' : /You may now dump a character record/.test(buffer.screenText()) ? 'gameover' : /Help file '/.test(rowZeroText()) ? 'help' : isFileViewer(rowZeroText()) ? 'file' : null,
      looking,
      overview: map.overview,
      atCommand: !!snap?.atCommand,
      underfoot: snap && snap.inDungeon ? underfootName(snap) : '',
      floorObjects: snap?.floorObjects ?? 0,
      alwaysPickup: alwaysPickup(),
    });
  currentActions = actions;
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
      label.className = 'action-label';
      label.textContent = action.label;
      button.append(icon, label);
      return button;
    }),
  );
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

function openCommands(): void {
  const body = el('div', 'commands');
  const run = (def: CommandDef) => {
    if (def.native) {
      sheets.closeAll();
      openNative(def.native);
    } else {
      api.send(commandKeys(def, alwaysPickup()));
    }
  };
  for (const group of COMMAND_GROUPS) {
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
  const step = travel.step(ctx);
  if (step.kind === 'stop') {
    stopAutomation(STOP_MESSAGES[step.reason], step.reason);
    return;
  }
  map.setPath(step.path);
  engine.sendKeys(step.keys);
  requestFrame();
}

function startTravel(goal: MapPoint): void {
  const ctx = travelContext();
  if (!ctx) return;
  stopAutomation(null, 'new travel');
  recentreMap();
  travel = new Travel(goal, ctx);
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
function redirectInventoryScreen(): boolean {
  const m = /^(Inventory|Equipment): carrying/.exec(rowZeroText());
  if (!m || macros.running) return false;
  engine.sendKeys([KEY_ESCAPE]);
  openInventory(api, m[1] === 'Equipment' ? 'equip' : 'pack');
  return true;
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
  if (keys.length) engine.sendKeys(keys);
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
  return target instanceof Element && !!target.closest('#messages, .termview, #look-card, #recentre, #look-banner, .director, .prompt-card');
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
    recentreMap();
    if (cell) tapMapCell(snap, cell, prompt);
    return;
  }
  if (mode === 'overlay') {
    send([KEY_ESCAPE]);
    return;
  }
  continueIfWaiting();
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
  if (!snap.atCommand) return;
  if (cell.x === player.x && cell.y === player.y) {
    if (snap.floorObjects > 0) send([BACKSLASH, pickupCommand(alwaysPickup()).charCodeAt(0)]);
    return;
  }
  startTravel(cell);
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

function autosave(): void {
  if (travel || picker) stopAutomation(null, 'autosave');
  const snap = engine.state === 'running' ? engine.snapshot() : null;
  if (snap && snap.inDungeon && snap.atCommand && !snap.icky && snap.turn !== lastSavedTurn && !quitting) {
    lastSavedTurn = snap.turn;
    autosaveSyncPending = true;
    engine.sendKeys([BACKSLASH, CTRL_S]);
    return;
  }
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
  hasEffects = effects.length > 0;
  effectsAt = performance.now();
}

/* Frame loop */

let frameHandle = 0;
let lastFrame = 0;

function animating(): boolean {
  return settings.animation !== 'off' && document.visibilityState === 'visible';
}

function requestFrame(): void {
  if (!frameHandle) frameHandle = requestAnimationFrame(frame);
}

function frame(now: number): void {
  frameHandle = 0;
  const fps = ANIMATION_FPS[settings.animation];
  const due = fps > 0 && now - lastFrame >= 1000 / fps - 2;

  if (dirty || due) {
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

  if ((animating() && mode !== 'title') || dirty) requestFrame();
}

/* Engine */

const engine = new Engine(buffer, {
  onStatus(text, fraction) {
    title.setStatus(/^Downloading/.test(text) ? 'Kindling the fires…' : text.replace(/\s*\(\d.*\)$/, '…'), fraction);
  },
  onRunning() {
    layout();
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
      location.reload();
      return;
    }
    title.showEnd(message ?? 'The game has ended. Your progress is saved in this browser.', false, [
      { label: 'Play again', run: () => location.reload() },
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
    director.idle();
    refresh();
    dirty = true;
    if (lastSnap?.inDungeon && !lastSnap.icky) {
      base = buffer.copy();
      basePanel = { row: lastSnap.panelRow, col: lastSnap.panelCol };
    }
    if (hasEffects) {
      map.setEffects([]);
      hasEffects = false;
    }
    hud.tick();
    if (autosaveSyncPending) {
      autosaveSyncPending = false;
      engine.syncNow().catch((err) => console.error('Autosave sync failed', err));
    }
    if (engine.pendingKeys > 0) {
      requestFrame();
      return;
    }
    if (redirectInventoryScreen()) {
      requestFrame();
      return;
    }
    if (macros.running) {
      stepMacro();
    } else if (travel && !travelTimer) {
      travelTimer = window.setTimeout(stepTravel, animating() ? TRAVEL_STEP_MS : 0);
    } else if (picker) {
      stepTargeting();
    }
    requestFrame();
  },
  onEffectFrame() {
    refresh();
    captureEffects();
    if (mode === 'map' || mode === 'overlay') map.render(performance.now(), animating());
  },
});
(api as { engine: Engine }).engine = engine;

function send(codes: number[] | null): void {
  if (!codes || codes.length === 0) return;
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

const title = new TitleScreen(byId<HTMLElement>('title-screen'), () => settings.animation, {
  onChoose: (choice) => director.choose(choice),
  onSettings: () => openSettingsSheet(),
  onSaves: () => openSavesMenu(),
  onHidden: () => {
    dirty = true;
    requestFrame();
  },
});
director.attachTitle(title);

/* Layout */

function layout(): void {
  const rect = stage.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  map.resize(width, height);
  fire.resize(width, height);
  dirty = true;
  requestFrame();
}

/**
 * The app fills the screen with CSS; only while the on-screen keyboard
 * covers part of it does it shrink to the visible area above the keyboard.
 */
function updateAppHeight(): void {
  const visible = window.visualViewport?.height ?? window.innerHeight;
  const keyboard = visible < window.innerHeight - KEYBOARD_MIN_PX;
  app.classList.toggle('keyboard-open', keyboard);
  if (keyboard) document.documentElement.style.setProperty('--app-height', `${Math.round(visible)}px`);
}

new ResizeObserver(() => layout()).observe(stage);
window.visualViewport?.addEventListener('resize', updateAppHeight);
window.addEventListener('resize', updateAppHeight);
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

keyboardInput.value = KEYBOARD_SENTINEL;

let composing = false;
let composed = '';

function inputText(): string {
  const value = keyboardInput.value;
  return value.startsWith(KEYBOARD_SENTINEL) ? value.slice(KEYBOARD_SENTINEL.length) : value;
}

keyboardInput.addEventListener('compositionstart', () => {
  composing = true;
  composed = '';
});

keyboardInput.addEventListener('compositionend', () => {
  composing = false;
  composed = '';
  keyboardInput.value = KEYBOARD_SENTINEL;
});

keyboardInput.addEventListener('beforeinput', (e) => {
  if (composing || e.isComposing) return;
  if (e.inputType === 'insertText' && e.data) {
    e.preventDefault();
    send(translateText(e.data, ctrlLatched));
  } else if (e.inputType === 'insertLineBreak') {
    e.preventDefault();
    send([KEY_ENTER]);
  } else if (e.inputType.startsWith('delete')) {
    e.preventDefault();
    send([KEY_BACKSPACE]);
  }
});

keyboardInput.addEventListener('input', () => {
  if (composing) {
    const current = inputText();
    const delta = compositionDelta(composed, current);
    composed = current;
    send([...Array<number>(delta.backspaces).fill(KEY_BACKSPACE), ...translateText(delta.text, ctrlLatched)]);
    return;
  }
  const value = keyboardInput.value;
  if (value === KEYBOARD_SENTINEL) return;
  if (value === '') {
    send([KEY_BACKSPACE]);
  } else {
    send(translateText(inputText(), ctrlLatched));
  }
  keyboardInput.value = KEYBOARD_SENTINEL;
});

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
    settings = next;
    saveSettings(settings);
    applyTextSize(settings.textSize);
    map.zoom = settings.zoom;
    pinchStartZoom = settings.zoom;
    map.glyphMode = settings.glyphs;
    dirty = true;
    requestFrame();
  });
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

/** Leaves the end-of-game screens and returns to the title. */
function finishGame(): void {
  quitting = true;
  stopAutomation(null, 'quit');
  runMacro(finishMacro());
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
  openMenu(sheets, 'Menu', [
    { label: 'Character', icon: '@', hidden: !playing, run: () => {
      sheets.closeAll();
      openCharacter(api);
    } },
    { label: 'Messages', icon: '≣', hidden: !playing, run: () => {
      sheets.closeAll();
      showHistory();
    } },
    { label: 'Save game', icon: '⇩', hidden: !playing, run: () => {
      api.send([BACKSLASH, CTRL_S]);
      autosaveSyncPending = true;
      showToast('Game saved');
    } },
    { label: 'Settings', icon: '⚙', hint: 'Text size, animation, map', run: () => openSettingsSheet() },
    { label: 'How to play', icon: '?', run: () => openTemplate(sheets, 'How to play', 'help-template') },
    { label: 'Export saves', icon: '⤒', run: startExport },
    { label: 'Import saves', icon: '⤓', run: startImport },
    { label: 'About', icon: 'ℹ', run: () => openTemplate(sheets, 'About', 'about-template') },
    { label: playing ? 'Save and quit' : 'Quit to title', icon: '⏻', hint: 'Back to the title screen', run: () => {
      if (playing) {
        confirmSheet(sheets, 'Save and quit?', 'Your game is saved and you return to the title screen.', 'Save and quit', saveAndQuit);
      } else {
        saveAndQuit();
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
      writeFiles(fs, root, files);
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
  macroRunning: () => macros.running,
  director,
};

/* Service worker */

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
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
director.module = params.get('module') === 'theme' ? 'Theme' : 'ToME';
acquireSessionLock().then((acquired) => {
  if (!acquired) {
    title.showEnd('ToME 2 is already open in another tab or window. Close it, then reload this page.', true, [
      { label: 'Reload', run: () => location.reload() },
    ]);
    return;
  }
  engine.start(new URL(`engine/tome.js?v=${__ENGINE_VERSION__}`, document.baseURI).href, engineArgs).catch((err) => {
    console.error(err);
  });
});
