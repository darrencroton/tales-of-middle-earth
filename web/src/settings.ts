import type { VolumeLevel } from './audio/audio.ts';
import type { ExplorePace } from './play/actions.ts';
import type { GlyphMode } from './render/appearance.ts';
import { MAX_ZOOM, MIN_ZOOM } from './render/map.ts';

export type AnimationLevel = 'full' | 'reduced' | 'off';
export type TextSize = 'small' | 'medium' | 'large' | 'xlarge';
/** Messages flow into the log as they happen, or pause for a tap at each -more-. */
export type MessageFlow = 'flow' | 'pause';

export interface Settings {
  animation: AnimationLevel;
  glyphs: GlyphMode;
  zoom: number;
  textSize: TextSize;
  messages: MessageFlow;
  music: VolumeLevel;
  sound: VolumeLevel;
  /** Dungeon levels stay as the hero left them (otherwise each visit makes a new one, as in classic ToME). */
  persistentLevels: boolean;
  /** How fast exploring and travel walk on screen. */
  explorePace: ExplorePace;
}

const STORAGE_KEY = 'tome2mobile.settings';

export const VOLUME_LEVELS: readonly VolumeLevel[] = ['off', 'low', 'medium', 'high'];

export const ANIMATION_FPS: Record<AnimationLevel, number> = {
  full: 20,
  reduced: 8,
  off: 0,
};

/** Base text size in CSS pixels; every piece of text in the app scales from it. */
export const TEXT_SIZE_PX: Record<TextSize, number> = {
  small: 12,
  medium: 14,
  large: 16,
  xlarge: 19,
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  xlarge: 'Extra large',
};

export function defaultSettings(prefersReducedMotion: boolean): Settings {
  return {
    animation: prefersReducedMotion ? 'off' : 'full',
    glyphs: 'brogue',
    zoom: 22,
    textSize: 'medium',
    messages: 'flow',
    music: 'medium',
    sound: 'medium',
    persistentLevels: true,
    explorePace: 'normal',
  };
}

export function sanitiseSettings(raw: unknown, defaults: Settings): Settings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const animation = ['full', 'reduced', 'off'].includes(value.animation as string)
    ? (value.animation as AnimationLevel)
    : defaults.animation;
  const glyphs = value.glyphs === 'classic' || value.glyphs === 'brogue' ? value.glyphs : defaults.glyphs;
  const zoom =
    typeof value.zoom === 'number' && Number.isFinite(value.zoom)
      ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value.zoom))
      : defaults.zoom;
  const textSize = typeof value.textSize === 'string' && Object.hasOwn(TEXT_SIZE_PX, value.textSize) ? (value.textSize as TextSize) : defaults.textSize;
  const messages = value.messages === 'flow' || value.messages === 'pause' ? value.messages : defaults.messages;
  const volume = (v: unknown, fallback: VolumeLevel): VolumeLevel => (VOLUME_LEVELS.includes(v as VolumeLevel) ? (v as VolumeLevel) : fallback);
  const persistentLevels = typeof value.persistentLevels === 'boolean' ? value.persistentLevels : defaults.persistentLevels;
  const explorePace = value.explorePace === 'normal' || value.explorePace === 'relaxed' ? value.explorePace : defaults.explorePace;
  return {
    animation,
    glyphs,
    zoom,
    textSize,
    messages,
    music: volume(value.music, defaults.music),
    sound: volume(value.sound, defaults.sound),
    persistentLevels,
    explorePace,
  };
}

export function loadSettings(prefersReducedMotion: boolean): Settings {
  const defaults = defaultSettings(prefersReducedMotion);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitiseSettings(JSON.parse(stored), defaults) : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, blocked site data): keep in-memory settings only.
  }
}

export function applyTextSize(size: TextSize): void {
  document.documentElement.style.setProperty('--fs', `${TEXT_SIZE_PX[size]}px`);
}
