/** A birth option the last character creation screen offers, by the name the engine gives it. */
export type RunOptionName = 'smallLevels' | 'fates' | 'preserve' | 'noSelling' | 'unusualRooms' | 'jokes';

/** The run as tome2 will play it (`web_run_options_json`): its birth options, in order, and its random quests. */
export interface RunOptions {
  options: { name: RunOptionName; on: number }[];
  /** Random quests drawn, which can be fewer than asked for. */
  drawn: number;
  maxQuests: number;
}

/** How each option is shown: a short name and what it does. */
export const RUN_OPTION_TEXT: Readonly<Record<RunOptionName, { label: string; detail: string }>> = {
  smallLevels: { label: 'Small levels', detail: 'Every dungeon level is small: quicker to explore, closer quarters.' },
  fates: { label: 'Fates', detail: 'As you grow, fate may mark you for a great reward or a dark end.' },
  preserve: { label: 'Artifacts come back', detail: 'An artifact left behind before you knew what it was can turn up again later.' },
  noSelling: { label: 'No selling', detail: 'Shops pay nothing for your finds, but gold lying about is worth five times as much.' },
  unusualRooms: { label: 'Unusual rooms', detail: 'Every level is built from strange rooms. There are no random quests.' },
  jokes: { label: 'Joke monsters', detail: 'A few silly creatures join the dungeon.' },
};

/** How many random quests a run has until the player picks another (tome2's default, which its own prompt cuts to one digit). */
export const DEFAULT_QUESTS = 20;

/* The numbers of random quests offered. */
const QUEST_STEPS = [0, 10, 20, 40, 60];

/** The numbers of random quests to choose from, never more than tome2 allows. */
export function questChoices(max: number): number[] {
  return QUEST_STEPS.filter((n) => n <= max);
}

/** What the random quests are for a number of them. */
export function questsText(n: number): string {
  if (n === 0) return 'No random quests: just the quests of the tale.';
  return `Up to ${n} levels on the way down each hold a creature to hunt for a reward.`;
}
