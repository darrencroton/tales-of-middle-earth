import { depthLabel } from '../hud.ts';
import type { PlayerState } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { bar, el, navButton, section } from './dom.ts';
import { openMenu } from './menus.ts';
import type { SheetContent } from './sheet.ts';

function stat(label: string, value: string, className = ''): HTMLElement {
  const node = el('div', `stat ${className}`.trim());
  node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return node;
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

/** Character summary with links to tome2's detailed screens. */
export function openCharacter(api: GameApi): void {
  const content = characterSheet(api);
  if (content) api.sheets.open(content);
}

function characterSheet(api: GameApi): SheetContent | null {
  const player: PlayerState | undefined = api.state()?.player;
  const sheet = api.engine.character();
  if (!player || !sheet) return null;
  const body = el('div', 'character');

  const bars = el('div', 'bars');
  bars.append(bar('hp', 'Health', player.chp, player.mhp));
  if (player.msp > 0) bars.append(bar('sp', 'Mana', player.csp, player.msp));
  if (player.msane > 0) bars.append(bar('sn', 'Sanity', player.csane, player.msane));
  body.append(bars);

  const stats = el('div', 'stat-grid six');
  for (const s of sheet.stats) {
    const use = s.use.trim();
    const top = s.top.trim();
    const node = stat(s.name, use, s.drained ? 'drained' : '');
    if (top !== use) node.title = `Maximum ${top}`;
    if (s.drained) node.append(el('span', 'stat-note', `max ${top}`));
    stats.append(node);
  }
  body.append(section('Attributes', stats));

  const combat = el('div', 'stat-grid');
  combat.append(
    stat('To hit', signed(sheet.toHit)),
    stat('To damage', signed(sheet.toDam)),
    stat('Armour', `${sheet.ac} ${signed(sheet.toAc)}`),
    stat('Blows', String(sheet.blows)),
    stat('Shots', String(sheet.shots)),
    stat('Speed', player.speed === 0 ? 'Normal' : signed(player.speed), player.speed < 0 ? 'bad' : player.speed > 0 ? 'good' : ''),
  );
  body.append(section('Combat', combat));

  const progress = el('div', 'stat-grid');
  progress.append(
    stat('Level', String(player.lev)),
    stat('Experience', String(player.exp)),
    stat('Next level', sheet.nextExp > 0 ? String(sheet.nextExp) : '—'),
    stat('Gold', `${player.au}`),
    stat('Location', depthLabel(player)),
    stat('Deepest', `${sheet.maxDepth * 50} ft`),
    stat('God', sheet.god),
    stat('Infravision', `${sheet.infra} ft`),
  );
  body.append(section('Progress', progress));

  const more = el('div', 'action-grid');
  const screens: [string, string][] = [
    ['Skills', 'G'],
    ['Abilities', 'N'],
    ['Full character sheet', 'C'],
  ];
  for (const [label, command] of screens) {
    more.append(navButton(label, { className: 'action-button', onClick: () => api.command(command) }));
  }
  more.append(navButton('Knowledge', { className: 'action-button', onClick: () => openKnowledge(api) }));
  body.append(section('More', more));

  return {
    title: player.name,
    subtitle: `${player.race} ${player.cls}${player.title ? ` · ${player.title}` : ''} · Level ${player.lev}`,
    body,
    className: 'sheet-character',
    initial: more.querySelector<HTMLElement>('[data-nav]'),
    rebuild: () => characterSheet(api),
  };
}

const KNOWLEDGE: [string, string, string][] = [
  ['Artifacts found', '★', '1'],
  ['Unique creatures', '♛', '2'],
  ['Kills', '⚔', '3'],
  ['Recall depths', '↧', '4'],
  ['Corruptions', '☣', '5'],
  ['Companions', '♥', '6'],
  ['Quests', '!', '7'],
  ['Fates', '☯', '8'],
  ['Dungeon towns', '⌂', '9'],
  ['Notes', '✎', '0'],
];

/** What the character knows: each entry opens tome2's knowledge list. */
export function openKnowledge(api: GameApi): void {
  openMenu(
    api.sheets,
    'Knowledge',
    KNOWLEDGE.map(([label, icon, key]) => ({ label, icon, run: () => api.command(`~${key}`) })),
  );
}
