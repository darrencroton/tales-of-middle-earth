import { countText, heroEffects, type Effect, type EffectKind } from '../play/effects.ts';
import type { GameApi } from './api.ts';
import { el, iconText, navButton, section } from './dom.ts';
import { openHeroGod } from './gods.ts';

const KIND_NAMES: Readonly<Record<EffectKind, string>> = { bane: 'Ailment', boon: 'Blessing', sustained: 'Sustained' };

const GROUPS: [EffectKind, string][] = [
  ['bane', 'Ailments'],
  ['boon', 'Blessings'],
  ['sustained', 'Sustained'],
];

/** How long an effect has left, in words: "23 turns left", or how long it lasts. */
function leftText(effect: Effect): string {
  return effect.left ? `${countText(effect.left.count, effect.left.unit)} left` : effect.lasts;
}

/** An effect's glyph, in its kind's colour. */
function effectGlyph(effect: Effect): HTMLElement {
  return el('span', `glyph effect-glyph ${effect.kind}`, iconText(effect.icon));
}

/** An effect's card: what it does, how strong it is, how long it has left and what ends it. Praying opens the god's card. */
export function openEffect(api: GameApi, effect: Effect): void {
  if (effect.id === 'praying') {
    openHeroGod(api);
    return;
  }
  const body = el('div', 'description effect-card');
  if (effect.strength) body.append(el('p', 'effect-strength', effect.strength));
  body.append(el('p', undefined, effect.does), el('p', 'muted', effect.ends));
  api.sheets.open({
    title: effect.name,
    subtitle: `${KIND_NAMES[effect.kind]} · ${leftText(effect)}`,
    badge: effectGlyph(effect),
    body,
    kind: 'card',
    className: `sheet-effect ${effect.kind}`,
  });
}

/** The character summary's effects in force, grouped (ailments, blessings, sustained); nothing when there are none. */
export function effectSections(api: GameApi): HTMLElement[] {
  const player = api.state()?.player;
  if (!player) return [];
  const effects = heroEffects(player);
  return GROUPS.flatMap(([kind, title]) => {
    const rows = effects.filter((e) => e.kind === kind);
    if (!rows.length) return [];
    const list = el('div', 'effect-list');
    for (const effect of rows) {
      const row = navButton(effect.name, {
        className: `row-button effect-row ${effect.kind}${effect.fading ? ' fading' : ''}${effect.severe ? ' severe' : ''}`,
        hint: [effect.strength, leftText(effect)].filter(Boolean).join(' · '),
        onClick: () => openEffect(api, effect),
      });
      row.prepend(effectGlyph(effect));
      list.append(row);
    }
    return [section(title, list)];
  });
}
