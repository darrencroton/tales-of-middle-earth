import type { Place } from '../audio/places.ts';
import type { PlayerState } from '../render/snapshot.ts';

/** Lives a hero has in Adventure mode, the first included (engine/adventure.cc). */
export const LIVES = 3;

/** tome2's question between death and life, asked when a life is left to return with (engine/adventure.cc). */
export function isReturnPrompt(rowZero: string): boolean {
  return /^Halls of Waiting:/.test(rowZero.trim());
}

/** The keys that answer it; accepting death is asked once more, and answered yes. */
export const RETURN_KEYS = { battlefield: 'b', safety: 's', accept: 'ay' } as const;

const COUNT_WORDS = ['No', 'One', 'Two', 'Three'];

/** The lives a hero has left, the one being lived included: "Two lives remain". */
export function livesText(lives: number): string {
  if (lives === 1) return 'One life remains: your last';
  return `${COUNT_WORDS[lives] ?? String(lives)} lives remain`;
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
 * Follows a death the hero may return from: `asked` holds the lives they
 * had when asked (null otherwise), and `returned` is true on the first state
 * alive again with fewer. tome2 can stop at a -more- between the choice and
 * the new level, so neither the count nor the hero's life is read at one
 * moment; a rescue of tome2's own spends no life and is no return.
 */
export function followReturn(asked: number | null, player: Pick<PlayerState, 'dead' | 'fate' | 'lives'>): { asked: number | null; returned: boolean } {
  const lives = player.lives ?? 0;
  if (player.dead) return { asked: player.fate === 'choice' ? Math.max(asked ?? 0, lives) : null, returned: false };
  if (asked !== null && lives < asked) return { asked: null, returned: true };
  return { asked, returned: false };
}

/** How many times an Adventure hero has returned from death. */
export function returns(player: Pick<PlayerState, 'adventure' | 'lives'>): number {
  return player.adventure ? LIVES - (player.lives ?? LIVES) : 0;
}

/** How often a hero came back from death: "Once", "Twice". */
export function returnsText(count: number): string {
  return count === 1 ? 'Once' : count === 2 ? 'Twice' : `${count} times`;
}
