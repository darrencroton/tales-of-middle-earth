import { FEET_PER_LEVEL, type LoggedQuest, type QuestLog } from '../render/snapshot.ts';

/** The quest log in the order a player reads it: what is under way, then what is done, then what failed. */
export interface QuestGroups {
  active: LoggedQuest[];
  done: LoggedQuest[];
  failed: LoggedQuest[];
}

/** Sorts the log into its groups: fixed quests by danger level, as tome2's quest log, then random quests by depth. */
export function questGroups(log: QuestLog): QuestGroups {
  const byLevel = (a: LoggedQuest, b: LoggedQuest) => (a.level ?? 0) - (b.level ?? 0);
  const byDepth = (a: LoggedQuest, b: LoggedQuest) => (a.depth ?? 0) - (b.depth ?? 0);
  const all = [...[...log.quests].sort(byLevel), ...[...log.random].sort(byDepth)];
  return {
    active: all.filter((q) => q.state === 'active'),
    done: all.filter((q) => q.state === 'done'),
    failed: all.filter((q) => q.state === 'failed'),
  };
}

/** A quest's line in the log: how dangerous it is or how deep it lay, and a reward still to be claimed. */
export function questLine(quest: LoggedQuest): string {
  const r = quest.random;
  if (r) return [quest.depth ? `${quest.depth * FEET_PER_LEVEL} ft` : '', `${r.count} × ${r.foe}`].filter(Boolean).join(' · ');
  if (quest.unclaimed) return 'Reward waiting';
  return quest.state === 'active' && quest.level ? `Danger level ${quest.level}` : '';
}

/** What a logged quest asked, in words: a fixed quest's description; a random quest done, as what the hero did. */
export function loggedQuestText(quest: LoggedQuest): string[] {
  const r = quest.random;
  if (!r || quest.state === 'active') return [];
  const where = quest.depth ? `, ${quest.depth * FEET_PER_LEVEL} ft down` : '';
  if (r.kind === 'sword') return [`You won back an adventurer's sword from ${r.count} × ${r.foe}${where}.`];
  return [r.count === 1 ? `You set free a princess held captive by ${r.foe}${where}.` : `You set free a princess held captive by ${r.count} × ${r.foe}${where}.`];
}
