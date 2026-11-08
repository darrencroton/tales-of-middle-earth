import type { Place } from '../audio/places.ts';
import type { PlayerState } from '../render/snapshot.ts';

/** tome2's question between death and life, asked at each death in Adventure mode (engine/adventure.cc). */
export function isReturnPrompt(rowZero: string): boolean {
  return /^Halls of Waiting:/.test(rowZero.trim());
}

/** The keys that answer it; accepting death is asked once more, and answered yes. */
export const RETURN_KEYS = { battlefield: 'b', safety: 's', accept: 'ay' } as const;

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

const TIMES = ['', 'once', 'twice'];

/** "No deaths", "One death", "Two deaths", "12 deaths". */
export function deathsText(deaths: number): string {
  return `${COUNT_WORDS[deaths] ?? String(deaths)} ${deaths === 1 ? 'death' : 'deaths'}`;
}

/** How often: "once", "twice", "three times", "12 times". */
export function timesText(n: number): string {
  return TIMES[n] ?? `${(COUNT_WORDS[n] ?? String(n)).toLowerCase()} times`;
}

/** What the Halls of Waiting say to a hero who has stood in them `deaths` times before: the scene, and what a return means. */
export function hallsWords(deaths: number): { scene: string; count: string } {
  const scene =
    deaths === 0
      ? 'Darkness, then a grey hall beyond the walls of the world. A voice like the sea: “Your thread is not yet cut. Will you go back?”'
      : deaths < 5
        ? 'The grey hall once more, and the voice like the sea, patient: “Your thread holds yet. Will you go back?”'
        : 'The grey hall knows your step now. The voice like the sea is grave: “Your thread is frayed, but it holds. Will you go back?”';
  const before = deaths === 0 ? 'Your first time in these halls.' : `${timesText(deaths)[0].toUpperCase()}${timesText(deaths).slice(1)} before you stood here.`;
  return { scene, count: `${before} A return dims your renown.` };
}

/** What returning to the battlefield means from where the hero fell. */
export function battlefieldText(place: Pick<Place, 'depth' | 'kept' | 'quest'> | null): string {
  if (place?.quest) return 'Wake on the surface, outside the quest’s own place.';
  if (place && place.depth > 0 && !place.kept) return 'Wake at this depth, whole again, on a level made anew.';
  if (place && place.depth > 0) return 'Wake where you fell, whole again. Your foes are still there.';
  return 'Wake where you fell, whole again.';
}

/** What returning to safety means: the town the hero wakes in. */
export function safetyText(haven: string): string {
  return `Wake in ${haven}, weary but whole. The way back is yours to find.`;
}

/** Why the hero cannot return to safety (`closed` in web_state_json). */
export const SAFETY_CLOSED: Readonly<Record<NonNullable<PlayerState['closed']>, string>> = {
  astral: 'An astral being must find the way up on foot.',
  held: 'Nothing that leaves this place by magic can leave it now.',
  none: 'No town stands to return to.',
};

/**
 * Follows a death the hero may return from: `asked` holds the deaths they
 * had when asked (null otherwise), and `returned` is true on the first state
 * alive again with more. tome2 can stop at a -more- between the choice and
 * the new level, so neither the count nor the hero's life is read at one
 * moment; a rescue of tome2's own counts no death and is no return.
 */
export function followReturn(asked: number | null, player: Pick<PlayerState, 'dead' | 'fate' | 'deaths'>): { asked: number | null; returned: boolean } {
  const deaths = player.deaths ?? 0;
  if (player.dead) return { asked: player.fate === 'choice' ? Math.min(asked ?? deaths, deaths) : null, returned: false };
  if (asked !== null && deaths > asked) return { asked: null, returned: true };
  return { asked, returned: false };
}
