/** Sending a hero to another device as a file, through the share sheet, and receiving one. */
import type { Engine } from '../engine.ts';
import { arrival, decodeHeroBundle, deviceName, encodeHeroBundle, heroBundle, HERO_EXTENSION, journeyChoice, type JourneyChoice, type JourneySide } from '../play/transfer.ts';
import { collectFiles, downloadText } from '../saves.ts';
import { el } from './dom.ts';
import { openMessage } from './menus.ts';
import type { Sheets } from './sheet.ts';

interface TransferDeps {
  engine: Engine;
  sheets: Sheets;
  /** The file input a hero is received with. */
  input: HTMLInputElement;
  /** Starts the title again, so tome2 lists the heroes as they now are, then says `told`. */
  restartTitle(told: string): void;
  showToast(text: string): void;
}

function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

/** This device's name: "iPhone", "iPad", "Mac". */
function thisDevice(): string {
  return deviceName(navigator.userAgent, navigator.maxTouchPoints);
}

/** A moment by the clock: "today, 14:02", "yesterday, 09:15", "Sat 7 Nov, 14:02". */
export function clockTime(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export class Transfer {
  private readonly deps: TransferDeps;

  constructor(deps: TransferDeps) {
    this.deps = deps;
    deps.input.addEventListener('change', () => {
      const file = deps.input.files?.[0];
      if (!file) return;
      this.receive(file).catch((err) => openMessage(deps.sheets, 'The hero could not be received', errorText(err)));
    });
  }

  /**
   * Sends a saved hero (savefile name `save`) as a file: the share sheet
   * (AirDrop, Messages, Files) where the browser has one, else a download.
   * Built at once, within the tap, as the share sheet needs.
   */
  send(save: string, name: string): void {
    const { engine, sheets } = this.deps;
    const fs = engine.fs;
    const root = engine.savePath;
    if (!fs || !root) {
      openMessage(sheets, 'Send hero', 'The game is still loading. Try again in a moment.');
      return;
    }
    const text = encodeHeroBundle(heroBundle(collectFiles(fs, root), { save, name }, thisDevice()));
    const filename = `${name}${HERO_EXTENSION}`;
    const file = new File([text], filename, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        downloadText(filename, text);
      });
      return;
    }
    downloadText(filename, text);
    this.deps.showToast(`${filename} saved: open Receive a hero on the other device`);
  }

  /** Asks for a hero's file to receive. */
  choose(): void {
    this.deps.sheets.closeAll();
    this.deps.input.value = '';
    this.deps.input.click();
  }

  /** Receives a hero sent from another device: added, or chosen between when this device has them too. */
  private async receive(file: File): Promise<void> {
    const { engine, sheets } = this.deps;
    const fs = engine.fs;
    const root = engine.savePath;
    if (!fs || !root) {
      openMessage(sheets, 'Receive a hero', 'The game is still loading. Try again in a moment.');
      return;
    }
    if (engine.storageError) {
      openMessage(sheets, 'Receive a hero', 'Browser storage is unavailable this session, so a hero received now would be lost on restart.');
      return;
    }
    const bundle = decodeHeroBundle(await file.text());
    const local = collectFiles(fs, root);
    const plan = arrival(local, bundle);
    if (plan.same) {
      this.deps.showToast(`${bundle.name} is already here, as sent`);
      return;
    }
    if (plan.conflict && (await chooseJourney(sheets, journeyChoice(local, bundle, thisDevice()))) !== 'remote') return;
    for (const { path, data } of plan.write) {
      const absolute = `${root}/${path}`;
      fs.mkdirTree(absolute.slice(0, absolute.lastIndexOf('/')));
      fs.writeFile(absolute, data);
    }
    for (const path of plan.remove) fs.unlink(`${root}/${path}`);
    await engine.syncNow();
    this.deps.restartTitle(`${bundle.name} has arrived from your ${bundle.device}`);
  }
}

function side(facts: JourneySide): HTMLElement {
  const column = el('div', `journey-side${facts.fallen ? ' fallen' : ''}`);
  column.append(el('h3', undefined, facts.where));
  const list = el('dl', 'hero-facts');
  const fact = (label: string, value: string | undefined) => {
    if (value) list.append(el('dt', undefined, label), el('dd', undefined, value));
  };
  const time = (iso: string | undefined) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? clockTime(ms) : undefined;
  };
  fact('Hero', facts.line);
  fact('Where', facts.place);
  fact('Saved', time(facts.saved));
  fact('Sent', time(facts.sent));
  fact('State', facts.fallen ? 'Fallen' : 'Alive');
  column.append(list);
  return column;
}

/** "Which journey continues?": a hero received is here already, as another copy; null when the card is closed. */
export function chooseJourney(sheets: Sheets, choice: JourneyChoice): Promise<'local' | 'remote' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: 'local' | 'remote' | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = el('div', 'journey');
    body.append(el('p', undefined, `${choice.hero} is on this device already, and the copy received is another journey. One goes on here; the other is lost.`));
    const sides = el('div', 'journey-sides');
    sides.append(side(choice.local), side(choice.remote));
    body.append(sides);
    sheets.open({
      title: 'Which journey continues?',
      body,
      kind: 'card',
      className: 'sheet-journey',
      onClose: () => finish(null),
      actions: [
        { id: 'keep-local', label: 'Keep this one', primary: choice.suggested === 'local', run: () => (finish('local'), sheets.back()) },
        { id: 'keep-remote', label: 'Take the one received', primary: choice.suggested === 'remote', run: () => (finish('remote'), sheets.back()) },
      ],
    });
  });
}
