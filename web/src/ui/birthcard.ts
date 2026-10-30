import type { BirthDetails } from '../flow/birthinfo.ts';
import { el } from './dom.ts';

function signedStat(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0';
}

/** What a race, modifier, class or specialisation gives: description, stat changes, traits and skills; `fallback` is the text shown without details. */
export function birthCard(label: string, details: BirthDetails | null, fallback: readonly string[], tag: string | null): HTMLElement {
  const card = el('article', 'birth-card');
  card.append(el('h3', undefined, details?.title ?? label));
  if (tag) card.append(el('p', 'birth-tag', tag));
  const text = details?.paragraphs.length ? details.paragraphs : fallback;
  for (const p of text) card.append(el('p', undefined, p));
  if (!details) return card;

  if (details.stats.length) {
    const stats = el('div', 'birth-stats');
    for (const s of details.stats) {
      const chip = el('span', `birth-stat${s.value > 0 ? ' good' : s.value < 0 ? ' bad' : ''}`);
      chip.append(el('span', 'birth-stat-name', s.name), el('span', 'birth-stat-value', signedStat(s.value)));
      stats.append(chip);
    }
    card.append(stats);
  }
  if (details.facts.length) {
    const facts = el('dl', 'birth-facts');
    for (const f of details.facts) facts.append(el('dt', undefined, f.label), el('dd', f.tone ?? '', f.value));
    card.append(facts);
  }
  if (details.traits.length) {
    const list = el('ul', 'birth-traits');
    for (const t of details.traits) {
      const item = el('li', t.tone);
      item.append(el('span', 'trait-level', t.level > 1 ? `Level ${t.level}` : 'Start'), el('span', 'trait-text', t.text));
      if (t.detail) item.append(el('span', 'trait-detail', t.detail));
      list.append(item);
    }
    card.append(el('h4', undefined, 'Abilities and traits'), list);
  }
  if (details.skills.length) {
    const skills = el('dl', 'birth-skills');
    for (const s of details.skills) skills.append(el('dt', undefined, s.name), el('dd', s.tone, s.value));
    card.append(el('h4', undefined, 'Skills'), skills);
  }
  if (details.choices) {
    card.append(el('h4', undefined, details.choices.label), el('p', 'birth-choices', details.choices.values.join(' · ')));
  }
  return card;
}
