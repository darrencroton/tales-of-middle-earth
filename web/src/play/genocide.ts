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
  const kind = g.race && g.ch ? `${g.race} and its kind (${String.fromCharCode(g.ch)})` : '';
  if (g.erased) {
    if (g.mass) return { kind: 'banner', title, subtitle: 'The creatures around you are erased' };
    if (!kind) return { kind: 'banner', title, subtitle: 'Its kind is erased from this level' };
    if (g.spared) return { kind: 'banner', title, subtitle: `Its kind (${String.fromCharCode(g.ch!)}) is erased · the ${g.race} withstands it` };
    return { kind: 'banner', title, subtitle: `${kind} erased from this level` };
  }
  if (g.mass) return { kind: 'toast', text: `Nothing nearby could be erased. ${WITHSTAND}`, logged: true };
  if (g.race && g.spared) return { kind: 'toast', text: `The ${g.race} withstands genocide, and nothing of its kind could be erased.`, logged: true };
  return { kind: 'toast', text: `Nothing of its kind could be erased. ${WITHSTAND}`, logged: true };
}
