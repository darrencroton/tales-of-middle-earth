import type { Engine } from '../engine.ts';
import type { Macro } from '../play/macro.ts';
import type { RecentAction } from '../play/recent.ts';
import type { MapPoint } from '../render/map.ts';
import type { GameState, LevelSnapshot } from '../render/snapshot.ts';
import type { QuantityQuestion } from './menus.ts';
import { el, glyph } from './dom.ts';
import type { Sheets } from './sheet.ts';

/** What the native views need from the game. */
export interface GameApi {
  readonly engine: Engine;
  readonly sheets: Sheets;
  palette(): readonly string[];
  snapshot(): LevelSnapshot | null;
  state(): GameState | null;
  /** Sends keys to the engine (closing any sheets). */
  send(keys: number[]): void;
  /**
   * Shows a tome2 screen with an original-keyset command after '\'; the
   * sheets it covers reopen once it is closed.
   */
  command(command: string): void;
  /** Runs a scripted exchange with the engine (closing any sheets, or covering them when `comeBack`). */
  runMacro(macro: Macro, comeBack?: boolean): void;
  /** Why tome2 will not take one of the hero's commands now (on the world map, or while they control another creature), or null. */
  refusal(command: string): string | null;
  /** Why the hero cannot set off for somewhere while things stay as they are, or null. */
  travelRefusal(): string | null;
  /** Says why something cannot be done (a toast and the refusal sound). */
  refuse(reason: string): void;
  /** Talks to (`Y`) or gives to (`y`) the creature in a keypad direction (closing any sheets). */
  converse(command: 'Y' | 'y', digit: string): void;
  travelTo(point: MapPoint): void;
  highlight(point: MapPoint): void;
  /** Asks the player for a line of text in a native sheet. */
  askText(title: string, label: string, initial?: string): Promise<string | null>;
  /** Asks how many of a stack to use, starting at one. */
  askQuantity(question: QuantityQuestion): Promise<number | null>;
  /** The hero's recently used spells, powers and items, newest first. */
  recent(): readonly RecentAction[];
  remember(entry: RecentAction): void;
}

export { capitalise, titleName } from '../play/text.ts';

/** Why a command cannot be had while tome2 is busy with something else. */
export const NOT_NOW = 'Finish what you are doing first.';

/** Paragraphs from tome2's item description (wrapped at 75 columns). */
export function descriptionParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/** tome2's item description (or paragraphs already split from one) as a block, or `fallback` when there is none. */
export function description(text: string | readonly string[], fallback: string): HTMLElement {
  const box = el('div', 'description');
  const paragraphs = typeof text === 'string' ? descriptionParagraphs(text) : text;
  for (const p of paragraphs.length ? paragraphs : [fallback]) box.append(el('p', undefined, p));
  return box;
}

/** The map symbol of an item or creature, in its palette colour. */
export function itemGlyph(api: GameApi, thing: { ch: number; attr: number }): HTMLElement {
  return glyph(thing.ch, api.palette()[thing.attr] ?? '#fff');
}

export function pounds(tenths: number): string {
  return `${(tenths / 10).toFixed(1)} lb`;
}
