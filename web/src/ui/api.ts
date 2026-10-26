import type { Engine } from '../engine.ts';
import type { Macro } from '../play/macro.ts';
import type { MapPoint } from '../render/map.ts';
import type { FeatureInfo } from '../render/materials.ts';
import type { GameState, LevelSnapshot } from '../render/snapshot.ts';
import type { Sheets } from './sheet.ts';

/** What the native views need from the game. */
export interface GameApi {
  readonly engine: Engine;
  readonly sheets: Sheets;
  palette(): readonly string[];
  snapshot(): LevelSnapshot | null;
  state(): GameState | null;
  features(): readonly FeatureInfo[];
  /** Sends keys to the engine (closing any sheets). */
  send(keys: number[]): void;
  /** Sends an original-keyset command after '\' (closing any sheets). */
  command(command: string): void;
  /** Runs a scripted exchange with the engine (closing any sheets). */
  runMacro(macro: Macro): void;
  travelTo(point: MapPoint): void;
  highlight(point: MapPoint): void;
  /** Asks the player for a line of text in a native sheet. */
  askText(title: string, label: string, initial?: string): Promise<string | null>;
}

export function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Removes a leading article ("a ", "an ", "the ", "7 ") for use as a title. */
export function titleName(name: string): string {
  return capitalise(name.replace(/^(a|an|the|some) /i, ''));
}

/** Paragraphs from tome2's item description (wrapped at 75 columns). */
export function descriptionParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

export function pounds(tenths: number): string {
  return `${(tenths / 10).toFixed(1)} lb`;
}
