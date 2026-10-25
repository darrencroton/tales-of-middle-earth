import './styles.css';
import { Engine } from './engine.ts';
import { attachSwipe } from './input/gestures.ts';
import {
  compositionDelta,
  directionKeys,
  KEY_BACKSPACE,
  KEY_ENTER,
  KEY_ESCAPE,
  translateKey,
  translateText,
} from './input/keys.ts';
import {
  collectFiles,
  decodeBundle,
  downloadText,
  encodeBundle,
  exportFilename,
  writeFiles,
} from './saves.ts';
import { CanvasRenderer, TerminalBuffer } from './terminal.ts';

declare global {
  interface Window {
    __tome?: {
      engine: Engine;
      buffer: TerminalBuffer;
      screenText(): string;
      sendText(text: string): void;
    };
  }
}

const KEYBOARD_SENTINEL = ' ';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const terminalEl = byId<HTMLDivElement>('terminal');
const canvas = byId<HTMLCanvasElement>('screen');
const toolbar = byId<HTMLElement>('toolbar');
const keyboardInput = byId<HTMLInputElement>('keyboard-input');
const splash = byId<HTMLDivElement>('splash');
const splashStatus = byId<HTMLParagraphElement>('splash-status');
const splashProgress = byId<HTMLProgressElement>('splash-progress');
const menu = byId<HTMLDialogElement>('menu');
const info = byId<HTMLDialogElement>('info');
const infoBody = byId<HTMLDivElement>('info-body');
const importFile = byId<HTMLInputElement>('import-file');
const ctrlButton = toolbar.querySelector<HTMLButtonElement>('[data-action="ctrl"]');

const buffer = new TerminalBuffer();
const renderer = new CanvasRenderer(canvas, buffer);

let ctrlLatched = false;

function setCtrlLatched(value: boolean): void {
  ctrlLatched = value;
  ctrlButton?.setAttribute('aria-pressed', String(value));
}

function showSplashActions(actions: { label: string; run: () => void }[]): void {
  splash.querySelector('.actions')?.remove();
  const row = document.createElement('div');
  row.className = 'actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    row.append(button);
  }
  splash.append(row);
}

const engine = new Engine(buffer, renderer, {
  onStatus(text, fraction) {
    splashStatus.textContent = text.replace(/\s*\(\d.*\)$/, '…');
    if (fraction === null) splashProgress.removeAttribute('value');
    else splashProgress.value = fraction;
  },
  onRunning() {
    splash.hidden = true;
    resize();
    const storageError = engine.storageError;
    if (storageError) {
      showMessage(
        'Saves unavailable',
        `Saved games could not be loaded from this browser's storage (${storageError}). Saving to the browser is switched off for this session so existing saves are not overwritten. You can still play and use Export saves to keep a copy.`,
      );
    }
  },
  onExit(message) {
    splash.hidden = false;
    splash.classList.remove('error');
    splashProgress.hidden = true;
    splashStatus.textContent = message ?? 'The game has ended. Your progress is saved in this browser.';
    showSplashActions([{ label: 'Play again', run: () => location.reload() }]);
  },
  onError(message) {
    splash.hidden = false;
    splash.classList.add('error');
    splashProgress.hidden = true;
    splashStatus.textContent = message;
    showSplashActions([{ label: 'Reload', run: () => location.reload() }]);
  },
});

function send(codes: number[] | null): void {
  if (!codes || codes.length === 0) return;
  engine.sendKeys(codes);
  if (ctrlLatched) setCtrlLatched(false);
}

/* Layout */

function resize(): void {
  const rect = terminalEl.getBoundingClientRect();
  renderer.resize(Math.floor(rect.width), Math.floor(rect.height));
}

function updateAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

new ResizeObserver(() => resize()).observe(terminalEl);
window.visualViewport?.addEventListener('resize', updateAppHeight);
window.addEventListener('resize', updateAppHeight);
updateAppHeight();

/* Hardware keyboard and soft keyboard */

function dialogOpen(): boolean {
  return menu.open || info.open;
}

/** Elements whose own keyboard behaviour (Tab, Enter, Space) must not be taken over. */
function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target !== keyboardInput &&
    target.closest('button, a, input, select, textarea, [contenteditable]') !== null
  );
}

window.addEventListener('keydown', (e) => {
  if (dialogOpen() || e.isComposing || isControl(e.target)) return;
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

attachSwipe(terminalEl, (swipe) => send(directionKeys(swipe.digit, swipe.run)));

/* Toolbar */

toolbar.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'keyboard':
      if (document.activeElement === keyboardInput) keyboardInput.blur();
      else keyboardInput.focus();
      break;
    case 'escape':
      send([KEY_ESCAPE]);
      break;
    case 'enter':
      send([KEY_ENTER]);
      break;
    case 'ctrl':
      setCtrlLatched(!ctrlLatched);
      break;
    case 'menu':
      menu.showModal();
      break;
  }
});

/* Toolbar buttons must not steal focus from the soft keyboard. */
toolbar.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button[data-action]:not([data-action="menu"])')) e.preventDefault();
});

/* Menu */

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

/* Persistence */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    engine.syncNow().catch((err) => console.error('Saving to browser storage failed', err));
  }
});

/* Test and debugging hook */

window.__tome = {
  engine,
  buffer,
  screenText: () => buffer.screenText(),
  sendText: (text) => engine.sendKeys(translateText(text)),
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

resize();
acquireSessionLock().then((acquired) => {
  if (!acquired) {
    splash.classList.add('error');
    splashProgress.hidden = true;
    splashStatus.textContent = 'ToME 2 is already open in another tab or window. Close it, then reload this page.';
    showSplashActions([{ label: 'Reload', run: () => location.reload() }]);
    return;
  }
  engine.start(new URL(`engine/tome.js?v=${__ENGINE_VERSION__}`, document.baseURI).href).catch((err) => {
    console.error(err);
  });
});
