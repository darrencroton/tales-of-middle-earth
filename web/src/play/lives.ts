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
  if (place?.quest) return 'Wake by the door to the quest. It still waits for you.';
  if (place && place.depth > 0 && !place.kept) return 'Wake at this depth, whole again, on a level made anew.';
  if (place && place.depth > 0) return 'Wake where you fell, whole again. Your foes are still there.';
  return 'Wake where you fell, whole again.';
}

/** What returning to safety means: the town the hero wakes in. */
export function safetyText(haven: string): string {
  return `Wake in ${haven}, weary but whole. The way back is yours to find.`;
}

/** The hero was dead and has come back with one life fewer (not saved by something of tome2's own). */
export function returnedFromDeath(prev: Pick<PlayerState, 'dead' | 'lives'> | null, next: Pick<PlayerState, 'dead' | 'lives'>): boolean {
  return !!prev?.dead && !next.dead && (next.lives ?? 0) < (prev.lives ?? 0);
}

/** How many times an Adventure hero has returned from death. */
export function returns(player: Pick<PlayerState, 'adventure' | 'lives'>): number {
  return player.adventure ? LIVES - (player.lives ?? LIVES) : 0;
}

/** How often a hero came back from death: "Once", "Twice". */
export function returnsText(count: number): string {
  return count === 1 ? 'Once' : count === 2 ? 'Twice' : `${count} times`;
}
