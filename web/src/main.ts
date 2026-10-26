import './styles.css';
import { Engine } from './engine.ts';
import { Hud, rowSegments } from './hud.ts';
import { attachPinch, attachSwipe, attachTap } from './input/gestures.ts';
import {
  compositionDelta,
  directionKeys,
  KEY_BACKSPACE,
  KEY_ENTER,
  KEY_ESCAPE,
  translateKey,
  translateText,
} from './input/keys.ts';
import { FireEffect } from './render/fire.ts';
import { MapRenderer, MAX_ZOOM, MIN_ZOOM, type MapEffect, type MapPoint } from './render/map.ts';
import { buildMaterials, type FeatureInfo, type Material } from './render/materials.ts';
import { COMMAND_GROUPS, commandKeys, contextActions, pickupCommand, type Action, type CommandDef } from './play/actions.ts';
import { classifyPrompt, directionDigit, isAdjacent, menuChoiceAt } from './play/prompts.ts';
import { TargetPicker } from './play/targeting.ts';
import { STOP_MESSAGES, Travel, type TravelContext } from './play/travel.ts';
import type { GameState, LevelSnapshot } from './render/snapshot.ts';
import {
  collectFiles,
  decodeBundle,
  downloadText,
  encodeBundle,
  exportFilename,
  writeFiles,
} from './saves.ts';
import { ANIMATION_FPS, loadSettings, saveSettings, type Settings } from './settings.ts';
import { CanvasRenderer, TerminalBuffer, type ScreenCopy } from './terminal.ts';
import { TitleScreen, moduleKey, type ModuleChoice } from './title.ts';

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
      terminalCellCentre(col: number, row: number): { x: number; y: number };
      actions(): string[];
      travelling(): boolean;
      lastStopCause(): string;
    };
  }
}

type ViewMode = 'title' | 'map' | 'overlay';

const KEYBOARD_SENTINEL = ' ';
const EFFECT_LINGER_MS = 160;
const HIGHLIGHT_MS = 2500;
const MAX_EFFECT_CELLS = 600;
const TRAVEL_STEP_MS = 45;
const BACKSLASH = 92;
const CTRL_S = 0x13;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const app = byId<HTMLElement>('app');
const stage = byId<HTMLDivElement>('stage');
const fxCanvas = byId<HTMLCanvasElement>('fx');
const mapCanvas = byId<HTMLCanvasElement>('map');
const screenCanvas = byId<HTMLCanvasElement>('screen');
const messagesEl = byId<HTMLDivElement>('messages');
const hudEl = byId<HTMLElement>('hud');
const toolbar = byId<HTMLElement>('toolbar');
const keyboardInput = byId<HTMLInputElement>('keyboard-input');
const menu = byId<HTMLDialogElement>('menu');
const info = byId<HTMLDialogElement>('info');
const infoBody = byId<HTMLDivElement>('info-body');
const settingsDialog = byId<HTMLDialogElement>('settings');
const settingsForm = byId<HTMLFormElement>('settings-form');
const importFile = byId<HTMLInputElement>('import-file');
const commandsDialog = byId<HTMLDialogElement>('commands');
const commandsBody = byId<HTMLDivElement>('commands-body');
const toast = byId<HTMLDivElement>('toast');

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let settings: Settings = loadSettings(reducedMotion);

const buffer = new TerminalBuffer();
const terminal = new CanvasRenderer(screenCanvas, buffer);
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

const hud = new Hud(hudEl, messagesEl, () => buffer.palette, {
  onEntity: (point) => {
    map.flashHighlight(point, HIGHLIGHT_MS);
    dirty = true;
    requestFrame();
    window.setTimeout(() => {
      dirty = true;
      requestFrame();
    }, HIGHLIGHT_MS + 50);
  },
  onMore: () => send([0x20]),
  onHistory: () => {
    if (travel || picker) stopAutomation(null, 'history');
    showHistory();
  },
});

function setCtrlLatched(value: boolean): void {
  ctrlLatched = value;
  for (const el of document.querySelectorAll('[data-ctrl-toggle]')) el.setAttribute('aria-pressed', String(value));
}

let toastTimer = 0;
function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}

/* Opening screen: after Begin, step through tome2's module and news screens. */

let pendingModule: ModuleChoice | null = null;
const introSent = new Set<string>();

function advanceIntro(): void {
  if (!pendingModule || engine.state !== 'running') return;
  const screen = buffer.screenText();
  if (/New Character|Load Savefile/.test(screen)) {
    pendingModule = null;
  } else if (/select a module to play/.test(screen) && !introSent.has('module')) {
    introSent.add('module');
    const key = moduleKey(screen, pendingModule) ?? (pendingModule === 'ToME' ? 'a' : null);
    if (key) send([key.charCodeAt(0)]);
    else pendingModule = null;
  } else if (/\[Press any key to continue\]/.test(screen) && !introSent.has('news')) {
    introSent.add('news');
    send([0x20]);
    pendingModule = null;
  }
}

const title = new TitleScreen(byId<HTMLElement>('title-screen'), () => settings.animation, {
  onBegin(module) {
    pendingModule = module;
    advanceIntro();
  },
});

/* View state */

function setMode(next: ViewMode): void {
  if (next === mode) return;
  mode = next;
  app.classList.remove('mode-title', 'mode-map', 'mode-overlay');
  app.classList.add(`mode-${next}`);
  if (next !== 'title') fire.clear();
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

/** Reads engine state and decides how the screen is presented. */
function refresh(): void {
  const snap = engine.snapshot();
  if (!snap) return;
  lastSnap = snap;

  if (!snap.inDungeon) {
    setMode('title');
    terminal.setMode({ kind: 'full' });
    updateActionBar();
    return;
  }

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
    const region = base ? buffer.diffBounds(base, 1) : null;
    terminal.setMode({ kind: 'panel', region: region ?? { x0: 0, y0: 1, x1: buffer.cols - 1, y1: buffer.rows - 1 } });
    map.setReticle(null);
  } else {
    setMode('map');
    terminal.setMode({ kind: 'hidden' });
    const cursor = rowZeroText() ? terminalToDungeon(snap, buffer.cursorX, buffer.cursorY) : null;
    map.setReticle(cursor && (cursor.x !== snap.px || cursor.y !== snap.py) ? cursor : null);
  }

  const state = engine.gameState();
  if (state) {
    lastState = state;
    hud.update(state, snap.py, snap.px);
    hud.updateMessages(
      state.messages ?? [],
      state.messageTotal ?? 0,
      rowSegments(buffer.chars.subarray(0, buffer.cols), buffer.attrs.subarray(0, buffer.cols), buffer.palette),
    );
  }
  updateActionBar();
}

/* Action bar */

function underfootName(snap: LevelSnapshot): string {
  return features[snap.feat[snap.py * snap.width + snap.px]]?.name.toLowerCase() ?? '';
}

function updateActionBar(): void {
  const snap = lastSnap;
  const actions = contextActions({
    mode,
    prompt: classifyPrompt(rowZeroText()),
    atCommand: !!snap?.atCommand,
    underfoot: snap && snap.inDungeon ? underfootName(snap) : '',
    floorObjects: snap?.floorObjects ?? 0,
    alwaysPickup: alwaysPickup(),
  });
  currentActions = actions;
  const key = actions.map((a) => a.id).join(',');
  if (key === actionsKey) return;
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
      icon.textContent = action.icon;
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
      menu.showModal();
      break;
    case 'commands':
      commandsDialog.showModal();
      break;
    case 'ctrl':
      setCtrlLatched(!ctrlLatched);
      break;
  }
}

const sheetCommands = new WeakMap<HTMLElement, CommandDef>();

function alwaysPickup(): boolean {
  return !!lastState?.player?.alwaysPickup;
}

function buildCommandSheet(): void {
  const sections = COMMAND_GROUPS.map((group) => {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    const grid = document.createElement('div');
    grid.className = 'command-grid';
    for (const def of group.commands) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command';
      sheetCommands.set(button, def);
      const icon = document.createElement('span');
      icon.className = 'action-icon';
      icon.textContent = def.icon;
      const label = document.createElement('span');
      label.textContent = def.label;
      button.append(icon, label);
      grid.append(button);
    }
    section.append(heading, grid);
    return section;
  });

  const keys = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = 'Keys';
  const grid = document.createElement('div');
  grid.className = 'command-grid';
  const extra: [string, string, string][] = [
    ['⌨', 'Keyboard', 'keyboard'],
    ['^', 'Ctrl + next key', 'ctrl'],
    ['⎋', 'Escape', 'escape'],
    ['⏎', 'Enter', 'enter'],
  ];
  for (const [iconText, labelText, kind] of extra) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command';
    button.dataset.special = kind;
    if (kind === 'ctrl') button.dataset.ctrlToggle = '';
    const icon = document.createElement('span');
    icon.className = 'action-icon';
    icon.textContent = iconText;
    const label = document.createElement('span');
    label.textContent = labelText;
    button.append(icon, label);
    grid.append(button);
  }
  keys.append(heading, grid);
  commandsBody.replaceChildren(...sections, keys);
}

commandsBody.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button.command');
  if (!button) return;
  commandsDialog.close();
  const def = sheetCommands.get(button);
  if (def) {
    send(commandKeys(def, alwaysPickup()));
    return;
  }
  switch (button.dataset.special) {
    case 'keyboard':
      keyboardInput.focus();
      break;
    case 'ctrl':
      setCtrlLatched(!ctrlLatched);
      break;
    case 'escape':
      send([KEY_ESCAPE]);
      break;
    case 'enter':
      send([KEY_ENTER]);
      break;
  }
});

buildCommandSheet();

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

/* Taps */

function onStageTap(clientX: number, clientY: number, target: EventTarget | null): void {
  if (title.isVisible) return;
  if (target instanceof Element && target.closest('#messages')) return;
  if (travel || picker) {
    stopAutomation(null, 'tap');
    return;
  }
  const prompt = classifyPrompt(rowZeroText());
  if (prompt === 'more') {
    send([0x20]);
    return;
  }

  const snap = lastSnap;
  if (mode === 'map' && snap) {
    const cell = map.cellAt(clientX, clientY);
    if (!cell) return;
    tapMapCell(snap, cell, prompt);
    return;
  }

  const hit = terminal.cellAt(clientX, clientY);
  if (!hit) return;
  if (mode === 'overlay' && !hit.inside) {
    send([KEY_ESCAPE]);
    return;
  }
  const letter = menuChoiceAt(buffer.rowText(hit.y), hit.x);
  if (letter) send([letter.charCodeAt(0)]);
  else if (/Press any key/.test(buffer.screenText())) send([0x20]);
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

attachTap(stage, onStageTap);

/* Autosave */

function autosave(): void {
  if (travel || picker) stopAutomation(null, 'autosave');
  const snap = engine.state === 'running' ? engine.snapshot() : null;
  if (snap && snap.inDungeon && snap.atCommand && !snap.icky && snap.turn !== lastSavedTurn) {
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
    if (mode === 'title') {
      fire.render(animating());
    } else {
      map.render(now, animating());
    }
    lastRenderMs = performance.now() - started;
    terminal.render();
  }

  if (animating() || dirty) requestFrame();
}

/* Engine */

const engine = new Engine(buffer, terminal, {
  onStatus(text, fraction) {
    title.setStatus(/^Downloading/.test(text) ? 'Kindling the fires…' : text.replace(/\s*\(\d.*\)$/, '…'), fraction);
  },
  onRunning() {
    title.setReady();
    layout();
    dirty = true;
    requestFrame();
    const storageError = engine.storageError;
    if (storageError) {
      showMessage(
        'Saves unavailable',
        `Saved games could not be loaded from this browser's storage (${storageError}). Saving to the browser is switched off for this session so existing saves are not overwritten. You can still play and use Export saves to keep a copy.`,
      );
    }
  },
  onExit(message) {
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
    advanceIntro();
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
    if (travel && !travelTimer) {
      travelTimer = window.setTimeout(stepTravel, animating() ? TRAVEL_STEP_MS : 0);
    } else if (picker) {
      stepTargeting();
    }
    requestFrame();
  },
  onEffectFrame() {
    refresh();
    captureEffects();
    if (mode !== 'title') map.render(performance.now(), animating());
  },
});

function send(codes: number[] | null): void {
  if (!codes || codes.length === 0) return;
  if (travel || picker) stopAutomation(null, 'send');
  engine.sendKeys(codes);
  if (ctrlLatched) setCtrlLatched(false);
}

/* Layout */

function layout(): void {
  const rect = stage.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  terminal.resize(width, height);
  map.resize(width, height);
  fire.resize(width, height);
  dirty = true;
  requestFrame();
}

function updateAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

new ResizeObserver(() => layout()).observe(stage);
window.visualViewport?.addEventListener('resize', updateAppHeight);
window.addEventListener('resize', updateAppHeight);
updateAppHeight();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave();
  else requestFrame();
});
window.addEventListener('pagehide', () => autosave());

/* Hardware keyboard and soft keyboard */

function dialogOpen(): boolean {
  return menu.open || info.open || settingsDialog.open || commandsDialog.open;
}

const CONTROL_KEYS = new Set(['Tab', 'Enter', ' ']);

/** True when the focused element handles this key itself (text fields: all keys; buttons and links: Tab, Enter, Space). */
function controlOwnsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement) || target === keyboardInput) return false;
  if (target.closest('input, select, textarea, [contenteditable]')) return true;
  return CONTROL_KEYS.has(key) && target.closest('button, a') !== null;
}

window.addEventListener('keydown', (e) => {
  if (title.isVisible) {
    if ((e.key === 'Enter' || e.key === ' ') && title.isReady && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      title.begin('ToME');
    }
    return;
  }
  if (dialogOpen() || e.isComposing || controlOwnsKey(e.target, e.key)) return;
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

/* Touch */

attachSwipe(stage, (swipe) => send(directionKeys(swipe.digit, swipe.run)));

let pinchStartZoom = settings.zoom;
attachPinch(
  stage,
  (ratio) => {
    if (mode === 'title') return;
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
    if (!e.ctrlKey || mode === 'title') return;
    e.preventDefault();
    map.zoom = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, map.zoom * (e.deltaY < 0 ? 1.08 : 0.92))));
    settings = { ...settings, zoom: map.zoom };
    pinchStartZoom = map.zoom;
    saveSettings(settings);
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

/* Menu and dialogs */

function showInfo(templateId: string): void {
  const template = document.getElementById(templateId) as HTMLTemplateElement | null;
  if (!template) return;
  infoBody.replaceChildren(template.content.cloneNode(true));
  info.showModal();
}

function showMessage(title: string, message: string): void {
  const heading = document.createElement('h2');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = message;
  infoBody.replaceChildren(heading, body);
  info.showModal();
}

function showHistory(): void {
  const heading = document.createElement('h2');
  heading.textContent = 'Message history';
  const list = document.createElement('ol');
  list.className = 'history';
  const messages = engine.gameState(200)?.messages ?? lastState?.messages ?? [];
  for (const m of [...messages].reverse()) {
    const item = document.createElement('li');
    item.textContent = m.text;
    item.style.color = buffer.palette[m.color] ?? '#ddd';
    list.append(item);
  }
  if (messages.length === 0) list.append(Object.assign(document.createElement('li'), { textContent: 'No messages yet.' }));
  infoBody.replaceChildren(heading, list);
  info.showModal();
  list.lastElementChild?.scrollIntoView({ block: 'end' });
}

function showSettings(): void {
  for (const input of settingsForm.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    input.checked = settings[input.name as 'animation' | 'glyphs'] === input.value;
  }
  const zoom = settingsForm.querySelector<HTMLInputElement>('input[name="zoom"]');
  if (zoom) zoom.value = String(map.zoom);
  settingsDialog.showModal();
}

function applySettings(next: Settings): void {
  settings = next;
  saveSettings(settings);
  map.zoom = settings.zoom;
  pinchStartZoom = settings.zoom;
  map.glyphMode = settings.glyphs;
  dirty = true;
  requestFrame();
}

settingsForm.addEventListener('input', () => {
  const data = new FormData(settingsForm);
  applySettings({
    animation: (data.get('animation') as Settings['animation']) ?? settings.animation,
    glyphs: (data.get('glyphs') as Settings['glyphs']) ?? settings.glyphs,
    zoom: Number(data.get('zoom') ?? settings.zoom),
  });
});

async function exportSaves(): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    showMessage('Export saves', 'The game is still loading. Try again in a moment.');
    return;
  }
  await engine.syncNow().catch((err) => console.warn('Sync before export failed; exporting from memory', err));
  const files = collectFiles(fs, root);
  if (files.length === 0) {
    showMessage('Export saves', 'There are no saved games yet. Save in-game with Ctrl+S first.');
    return;
  }
  downloadText(exportFilename(), encodeBundle(files));
}

async function importSaves(file: File): Promise<void> {
  const fs = engine.fs;
  const root = engine.savePath;
  if (!fs || !root) {
    showMessage('Import saves', 'The game is still loading. Try again in a moment.');
    return;
  }
  if (engine.storageError) {
    showMessage('Import saves', 'Browser storage is unavailable this session, so imported saves would be lost on restart.');
    return;
  }
  const files = decodeBundle(await file.text());
  const proceed = confirm(
    `Import ${files.length} file(s)? Saves with the same names will be replaced and the game will restart. Unsaved progress in the current game will be lost.`,
  );
  if (!proceed) return;
  writeFiles(fs, root, files);
  await engine.syncNow();
  location.reload();
}

menu.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu]');
  if (!button) return;
  const action = button.dataset.menu;
  menu.close();
  switch (action) {
    case 'export':
      exportSaves().catch((err) => showMessage('Export failed', String(err instanceof Error ? err.message : err)));
      break;
    case 'import':
      importFile.value = '';
      importFile.click();
      break;
    case 'settings':
      showSettings();
      break;
    case 'history':
      showHistory();
      break;
    case 'help':
      showInfo('help-template');
      break;
    case 'about':
      showInfo('about-template');
      break;
  }
});

importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (!file) return;
  importSaves(file).catch((err) => showMessage('Import failed', String(err instanceof Error ? err.message : err)));
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
  terminalCellCentre: (col, row) => terminal.cellCentre(col, row),
  actions: () => currentActions.map((a) => a.id),
  travelling: () => travel !== null,
  lastStopCause: () => lastStopCause,
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
const engineArgs = new URLSearchParams(location.search).has('wizard') ? ['-w'] : [];
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
