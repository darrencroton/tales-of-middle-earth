import type { GlyphMode } from './render/appearance.ts';
import { MAX_ZOOM, MIN_ZOOM } from './render/map.ts';

export type AnimationLevel = 'full' | 'reduced' | 'off';

export interface Settings {
  animation: AnimationLevel;
  glyphs: GlyphMode;
  zoom: number;
}

const STORAGE_KEY = 'tome2mobile.settings';

export const ANIMATION_FPS: Record<AnimationLevel, number> = {
  full: 20,
  reduced: 8,
  off: 0,
};

export function defaultSettings(prefersReducedMotion: boolean): Settings {
  return {
    animation: prefersReducedMotion ? 'off' : 'full',
    glyphs: 'brogue',
    zoom: 22,
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
  return { animation, glyphs, zoom };
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
