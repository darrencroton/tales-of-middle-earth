import type { GenocideState } from '../render/snapshot.ts';

/**
 * How a Genocide is told: a banner when something was erased (the map shows
 * it too), else a toast saying why nothing was, `logged` when tome2 has not
 * said so itself. Only what the hero could know is told: the creature chosen
 * when they saw it, and that something was erased (the strain hurts for each),
 * never how many out of sight.
 */
export type GenocideTelling = { kind: 'banner'; title: string; subtitle: string } | { kind: 'toast'; text: string; logged: boolean };

const SPENT = 'The magic is spent.';
const WITHSTAND = 'Uniques and quest foes withstand genocide.';

function capitalised(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

export function genocideTelling(g: GenocideState): GenocideTelling {
  const title = g.mass ? 'Mass genocide' : 'Genocide';
  switch (g.outcome) {
    case 'stopped':
      return { kind: 'toast', text: 'A mysterious force stops the genocide.', logged: false };
    case 'cancelled':
      return { kind: 'toast', text: `No creature was chosen. ${SPENT}`, logged: true };
    case 'empty':
      return { kind: 'toast', text: `No creature there. ${SPENT}`, logged: false };
    case 'cast':
      break;
  }
  const symbol = g.ch ? String.fromCharCode(g.ch) : '';
  /* A unique is named bare ("Lagduf, the Snaga"), others as one of their kind ("the Cave orc"). */
  const who = g.race ? (g.unique ? g.race : `the ${g.race}`) : '';
  if (g.erased) {
    if (g.mass) return { kind: 'banner', title, subtitle: 'The creatures around you are erased' };
    if (!who) return { kind: 'banner', title, subtitle: 'Its kind is erased from this level' };
    if (g.spared) return { kind: 'banner', title, subtitle: `Its kind (${symbol}) is erased · ${who} withstands it` };
    return { kind: 'banner', title, subtitle: `${g.race} and its kind (${symbol}) erased from this level` };
  }
  if (g.mass) return { kind: 'toast', text: `Nothing nearby could be erased. ${WITHSTAND}`, logged: true };
  if (who && g.spared) return { kind: 'toast', text: `${capitalised(who)} withstands genocide, and nothing of its kind could be erased.`, logged: true };
  return { kind: 'toast', text: `Nothing of its kind could be erased. ${WITHSTAND}`, logged: true };
}
