import type { Ambience, Layer, Theme } from './themes.ts';
import { themeById, variant } from './themes.ts';

/** Where the player is, from engine/snapshot.cc web_place_json. */
export interface Place {
  ready: number;
  dungeon: number;
  dungeonName: string;
  depth: number;
  maxDepth: number;
  wild: number;
  /** Position on the world map. */
  wx?: number;
  wy?: number;
  /** Fixed at birth: tells apart heroes who share a name. */
  heroId?: number;
  /** 1 when tome2 keeps this dungeon level as the hero leaves it. */
  kept?: number;
  town: number;
  townDestroyed: number;
  quest: number;
  levelName: string;
  terrain: string;
  terrainIdx: number;
  night: number;
  /** 0 at the start; 1 once the Necromancer falls, 2 after Sauron, 3 after Morgoth. */
  stage: number;
  lev: number;
}

export type View = 'title' | 'game' | 'gameover';

/** d_info.txt dungeon indices. */
const DUNGEON_THEMES: Readonly<Record<number, string>> = {
  1: 'mirkwood',
  2: 'mordor',
  3: 'angband',
  4: 'barrow',
  5: 'doom',
  6: 'nether',
  7: 'numenor',
  8: 'mandos',
  9: 'cirith-ungol',
  10: 'heart',
  11: 'void',
  16: 'paths-dead',
  17: 'illusory',
  18: 'maze',
  19: 'orc-cave',
  20: 'erebor',
  21: 'old-forest',
  22: 'moria',
  23: 'dol-guldur',
  24: 'water-cave',
  25: 'sacred',
  26: 'rhun',
  27: 'sandworm',
  28: 'lament',
  29: 'helcaraxe',
  30: 'temple',
};

/** tome2 QUEST_* indices (defines.hpp). */
const QUEST_THEMES: Readonly<Record<number, string>> = {
  1: 'dol-guldur',
  2: 'doom',
  3: 'angband',
  4: 'thieves',
  5: 'captive',
  6: 'hobbit',
  7: 'nazgul',
  8: 'trolls',
  9: 'wight',
  10: 'spiders',
  11: 'poison',
  12: 'narsil',
  13: 'eol',
  14: 'nirnaeth',
  15: 'gondolin-falls',
  16: 'alliance',
  17: 'doom',
  18: 'hobbit',
  19: 'thrain',
  20: 'apotheosis',
  21: 'apotheosis',
  22: 'wolves',
  23: 'dragons',
  24: 'haunted',
  25: 'evil',
  27: 'temple',
  28: 'temple',
  29: 'temple',
};

const TOWN_THEMES: Readonly<Record<number, string>> = {
  1: 'bree',
  2: 'gondolin',
  3: 'minas-anor',
  4: 'lorien',
  5: 'khazad',
};

/** Wilderness terrain (wf_info.txt names) to theme. */
function terrainTheme(terrain: string): string {
  const name = terrain.toLowerCase();
  if (/forest|jungle|mirkwood|lothlorien/.test(name)) return 'forest';
  if (/mountain|moria|khazad|hill/.test(name)) return /hill/.test(name) ? 'plains' : 'mountains';
  if (/swamp/.test(name)) return 'marsh';
  if (/desert/.test(name)) return 'desert';
  if (/glacier/.test(name)) return 'ice';
  if (/water|ekkaia/.test(name)) return 'coast';
  if (/mordor|angband|nether/.test(name)) return 'ashlands';
  if (/gondolin/.test(name)) return 'gondolin';
  return 'plains';
}

export interface Scene {
  /** Theme id before adaptation. */
  base: string;
  night: boolean;
  stage: number;
  ruined: boolean;
  /** The last level of a dungeon, where its master waits. */
  climax: boolean;
  /** Depth in levels, for darker colours further down. */
  depth: number;
}

export function sceneFor(view: View, place: Place | null): Scene {
  const scene: Scene = { base: 'title', night: false, stage: 0, ruined: false, climax: false, depth: 0 };
  if (view === 'title') return scene;
  if (view === 'gameover') return { ...scene, base: 'lament' };
  if (!place || !place.ready) return scene;
  scene.stage = place.stage;
  scene.night = place.night === 1;
  scene.depth = place.depth;
  if (place.wild) return { ...scene, base: 'overworld', night: false };
  if (place.quest > 0 && QUEST_THEMES[place.quest]) return { ...scene, base: QUEST_THEMES[place.quest] };
  if (place.depth === 0) {
    if (place.town > 0) {
      return { ...scene, base: TOWN_THEMES[place.town] ?? 'haven', ruined: place.townDestroyed === 1 };
    }
    return { ...scene, base: terrainTheme(place.terrain) };
  }
  if (place.town > 0) return { ...scene, base: 'haven', night: false };
  return {
    ...scene,
    base: DUNGEON_THEMES[place.dungeon] ?? 'depths',
    night: false,
    climax: place.maxDepth > 0 && place.depth >= place.maxDepth,
  };
}

/** A key that changes whenever the music should change. */
export function sceneKey(scene: Scene): string {
  return [scene.base, scene.night ? 'n' : 'd', scene.stage, scene.ruined ? 'r' : '', scene.climax ? 'c' : '', Math.min(4, Math.floor(scene.depth / 10))].join(':');
}

const NIGHT_SWAP: Partial<Record<Ambience, Ambience>> = { birds: 'crickets' };

function withoutRoles(layers: readonly Layer[], roles: readonly Layer['role'][]): Layer[] {
  return layers.filter((l) => !roles.includes(l.role));
}

/** The overworld changes with the story: shadow, then triumph, then peace. */
function overworldForStage(theme: Theme, stage: number): Theme {
  switch (stage) {
    case 1:
      return variant(theme, theme.id, {
        mood: 'The Shadow grows in the East: the road is darker now.',
        scale: 'aeolian',
        bpm: 84,
        bright: 0.55,
        layers: [
          ...withoutRoles(theme.layers, ['melody', 'perc']),
          { role: 'melody', inst: 'cello', octave: 1, in: ['a'] },
          { role: 'melody', inst: 'horn', octave: 1, vol: 0.8, in: ['b'] },
          { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x.....', vol: 0.45 },
        ],
      });
    case 2:
      return variant(theme, theme.id, {
        mood: 'The Dark Lord has fallen: banners and bells across the land.',
        scale: 'ionian',
        bpm: 96,
        bright: 0.9,
        layers: [
          ...withoutRoles(theme.layers, ['perc']),
          { role: 'perc', inst: 'timpani', octave: -1, pattern: 'x..o..', vol: 0.45 },
          { role: 'bells', inst: 'bell', octave: 1, density: 0.25 },
        ],
      });
    case 3:
      return variant(theme, theme.id, {
        mood: 'Morgoth is cast out: a world at peace, and the long road home.',
        scale: 'lydian',
        bpm: 80,
        bright: 0.9,
        layers: [
          ...withoutRoles(theme.layers, ['perc']),
          { role: 'pad', inst: 'choir', octave: 1, vol: 0.4 },
          { role: 'bells', inst: 'celesta', octave: 2, density: 0.3 },
        ],
      });
    default:
      return theme;
  }
}

/** The theme to play for a scene, adapted to time of day, story, ruin and depth. */
export function themeFor(scene: Scene): Theme {
  let theme = themeById(scene.base);
  if (theme.id === 'overworld') theme = overworldForStage(theme, scene.stage);
  if (scene.ruined) {
    theme = variant(theme, theme.id, {
      mood: `${theme.mood.split(':')[0]} lies in ruins: what was lost still echoes.`,
      scale: 'aeolian',
      bpm: Math.round(theme.bpm * 0.75),
      bright: 0.45,
      layers: [
        ...withoutRoles(theme.layers, ['perc', 'arp', 'bells', 'melody']),
        { role: 'melody', inst: 'strings', octave: 1 },
      ],
      ambience: [['wind', 0.45], ['fire', 0.12]],
    });
  }
  if (scene.night) {
    theme = variant(theme, theme.id, {
      bpm: Math.round(theme.bpm * 0.88),
      bright: Math.max(0.3, (theme.bright ?? 0.7) - 0.2),
      layers: theme.layers
        .filter((l) => l.role !== 'perc' || l.from !== undefined)
        .map((l) => (l.inst === 'whistle' ? { ...l, inst: 'flute' } : l.role === 'arp' ? { ...l, density: (l.density ?? 1) * 0.7 } : l)),
      ambience: theme.ambience.map(([kind, level]) => [NIGHT_SWAP[kind] ?? kind, level] as [Ambience, number]),
    });
  }
  if (scene.climax) {
    theme = variant(theme, theme.id, { floor: Math.max(theme.floor ?? 0, 0.5), bpm: Math.round(theme.bpm * 1.06) });
  }
  if (scene.depth > 0) {
    const shade = Math.min(0.3, scene.depth / 150);
    theme = variant(theme, theme.id, { bright: Math.max(0.25, (theme.bright ?? 0.7) - shade) });
  }
  return theme;
}
