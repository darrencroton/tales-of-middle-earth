import { depthLabel } from '../hud.ts';
import type { PlayerState } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { KEY_BACKSLASH, KEY_ENTER, KEY_ESCAPE, keyCodes } from '../input/keys.ts';
import { fullSheetElements, sheetPageKeys, SHEET_PAGES, type FullSheet } from './charsheet.ts';
import { bar, el, section } from './dom.ts';
import { openMenu } from './menus.ts';
import type { MessageBox } from './msgbox.ts';
import type { SheetAction, SheetContent, SheetTab } from './sheet.ts';
import {
  abilitiesElements,
  abilityMoveKeys,
  abilityTableElements,
  cursorKeys,
  selectedAbility,
  selectedSkill,
  skillMoveKeys,
  skillsElements,
  skillTableElements,
  type AbilitiesScreen,
  type SkillsScreen,
} from './skills.ts';

function stat(label: string, value: string, className = ''): HTMLElement {
  const node = el('div', `stat ${className}`.trim());
  node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return node;
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

/** The character sheet's views: the summary, and tome2's skills, abilities and full sheet. */
export type CharacterTab = 'summary' | 'skills' | 'abilities' | 'sheet';

const TABS: [CharacterTab, string, string][] = [
  ['summary', 'Summary', '@'],
  ['skills', 'Skills', '±'],
  ['abilities', 'Abilities', '✪'],
  ['sheet', 'Full sheet', '▤'],
];

/* tome2 commands that show each screen. */
const COMMANDS: Readonly<Record<Exclude<CharacterTab, 'summary'>, string>> = { skills: 'G', abilities: 'N', sheet: 'C' };

/** What tome2 shows while the character sheet is open. */
export interface CharacterScreen {
  skills: SkillsScreen | null;
  abilities: AbilitiesScreen | null;
  sheet: FullSheet | null;
  /** A question tome2 asks in a message box ("Save and use these skill values?"). */
  box: MessageBox | null;
  atCommand: boolean;
}

export interface CharacterDeps {
  /** Sends keys to tome2 without closing any sheet. */
  sendKeys(keys: number[]): void;
  /** Name of an equipment letter on the full sheet. */
  source(letter: string): string;
  toast(text: string): void;
  /** Asks for `step` to run now if tome2 is already waiting for a key. */
  poke(): void;
}

function points(n: number): string {
  return `${n} point${n === 1 ? '' : 's'} to spend`;
}

function screenTab(screen: CharacterScreen): CharacterTab | null {
  return screen.skills ? 'skills' : screen.abilities ? 'abilities' : screen.sheet ? 'sheet' : null;
}

/**
 * The character sheet: a summary built from engine data, and tome2's
 * skills, abilities and full sheet screens shown in the same sheet. The
 * tabs at its foot never move; a tab backed by a tome2 screen opens that
 * screen underneath and the sheet shows it natively.
 */
export class CharacterPanel {
  private readonly api: GameApi;
  private readonly deps: CharacterDeps;
  private content: SheetContent | null = null;
  private want: CharacterTab = 'summary';
  /** The tome2 screen open underneath, as last seen. */
  private shown: CharacterTab | null = null;
  /** The command already sent for `want`, so a refused one is not repeated. */
  private requested: CharacterTab | null = null;
  private asked = '';
  /** Closes the sheet asking tome2's current message box, without answering it. */
  private dismissAsk: (() => void) | null = null;
  /** The sheet was closed while a tome2 screen was open: its last questions are asked on the map, not in a reopened sheet. */
  private leaving = false;
  private renderedKey = '';

  constructor(api: GameApi, deps: CharacterDeps) {
    this.api = api;
    this.deps = deps;
  }

  get isOpen(): boolean {
    return this.content !== null;
  }

  /** A tome2 screen is open beneath the sheet. */
  get hosting(): boolean {
    return this.content !== null && this.shown !== null;
  }

  /** Opens the sheet on a tab (or switches to it when already open). */
  open(tab: CharacterTab = 'summary'): void {
    if (this.content) {
      this.select(tab);
      return;
    }
    if (!this.api.state()?.player) return;
    this.want = tab;
    this.requested = null;
    this.renderedKey = '';
    const content = this.build(null);
    if (!content) return;
    this.content = content;
    this.api.sheets.open(content);
    this.deps.poke();
  }

  /** tome2 showed one of the sheet's screens by itself (a typed command): the sheet opens on it. */
  adopt(screen: CharacterScreen): void {
    const tab = screenTab(screen);
    if (!tab) this.leaving = false;
    if (!tab || this.content || this.leaving) return;
    this.shown = tab;
    this.open(tab);
    this.render(screen);
  }

  private select(tab: CharacterTab): void {
    if (tab === this.want) return;
    if (tab !== 'summary' && !this.shown && !this.api.snapshot()?.atCommand) {
      this.deps.toast('Finish what you are doing first.');
      return;
    }
    this.want = tab;
    this.requested = null;
    this.renderedKey = '';
    this.replace(this.build(null));
    this.deps.poke();
  }

  private replace(content: SheetContent | null): void {
    if (!content) return;
    const previous = this.content;
    this.content = content;
    if (previous) this.api.sheets.update(content, previous);
  }

  /**
   * Moves tome2 towards the screen for the chosen tab, one step per idle:
   * leaves the screen that is open, then gives the command for the next.
   * True when keys were sent.
   */
  step(screen: CharacterScreen): boolean {
    const current = screenTab(screen);
    if (current) this.shown = current;
    else if (screen.atCommand) this.shown = null;
    if (!this.content || screen.box) return false;
    if (current && current !== this.want) {
      this.deps.sendKeys([KEY_ESCAPE]);
      return true;
    }
    if (current || this.want === 'summary' || !screen.atCommand) return false;
    if (this.requested === this.want) {
      this.want = 'summary';
      this.renderedKey = '';
      this.replace(this.build(null));
      return false;
    }
    this.requested = this.want;
    this.deps.sendKeys([KEY_BACKSLASH, ...keyCodes(COMMANDS[this.want])]);
    return true;
  }

  /** Shows tome2's screen in the sheet; true when the sheet is handling the screen. */
  render(screen: CharacterScreen): boolean {
    if (!this.content) return false;
    const current = screenTab(screen);
    if (screen.box && (current || this.shown)) {
      this.ask(screen.box);
      return true;
    }
    this.asked = '';
    this.dismissAsk?.();
    if (!current) return false;
    if (current !== this.want) return true;
    const table = current === 'skills' ? this.api.engine.skillTable() : current === 'abilities' ? this.api.engine.abilityTable() : null;
    const key = JSON.stringify([current, screen.skills, screen.abilities, screen.sheet, table]);
    if (key === this.renderedKey) return true;
    this.renderedKey = key;
    this.replace(this.build(screen));
    return true;
  }

  private ask(box: MessageBox): void {
    if (this.asked === box.text) return;
    this.asked = box.text;
    this.dismissAsk?.();
    let answered = false;
    const close = () => {
      answered = true;
      if (this.dismissAsk === close) this.dismissAsk = null;
      if (this.api.sheets.isTop(content)) this.api.sheets.back();
    };
    const answer = (keys: number[]) => {
      close();
      this.deps.sendKeys(keys);
    };
    const actions: SheetAction[] =
      box.kind === 'yesno'
        ? [
            { id: 'no', label: 'No', run: () => answer(keyCodes('n')) },
            { id: 'yes', label: 'Yes', primary: true, run: () => answer(keyCodes('y')) },
          ]
        : box.kind === 'choice'
          ? box.choices.map((c, i) => ({ id: `choice-${c.key}`, label: c.label, primary: i === 0, run: () => answer(keyCodes(c.key)) }))
          : [{ id: 'ok', label: 'OK', primary: true, run: () => answer([KEY_ESCAPE]) }];
    const body = el('div', 'prose');
    body.append(el('p', undefined, box.text));
    const content: SheetContent = {
      title: 'Character',
      body,
      size: 'fit',
      actions,
      onClose: () => {
        if (this.dismissAsk === close) this.dismissAsk = null;
        if (!answered) this.deps.sendKeys(box.kind === 'yesno' ? keyCodes('n') : [KEY_ESCAPE]);
        answered = true;
      },
    };
    this.dismissAsk = close;
    this.api.sheets.open(content);
  }

  private tabs(): SheetTab[] {
    return TABS.map(([tab, label, icon]) => ({ id: tab, label, icon, active: tab === this.want, run: () => this.select(tab) }));
  }

  private onClose(): void {
    this.content = null;
    this.want = 'summary';
    this.requested = null;
    this.asked = '';
    this.dismissAsk = null;
    if (this.shown) {
      this.leaving = true;
      this.deps.sendKeys([KEY_ESCAPE]);
    }
    this.shown = null;
  }

  private build(screen: CharacterScreen | null): SheetContent | null {
    const player = this.api.state()?.player;
    if (!player) return null;
    const base = {
      title: player.name,
      tabs: this.tabs(),
      className: 'sheet-character',
      onClose: () => this.onClose(),
    };
    const identity = `${player.race} ${player.cls}${player.title ? ` · ${player.title}` : ''} · Level ${player.lev}`;
    if (this.want === 'summary') {
      const body = summaryBody(this.api);
      return body ? { ...base, subtitle: identity, body } : null;
    }
    const send = (keys: string) => this.deps.sendKeys(keyCodes(keys));
    const body = el('div', 'character-screen');
    if (this.want === 'skills' && screen?.skills) {
      const skills = screen.skills;
      const table = this.api.engine.skillTable();
      const selected = table ? selectedSkill(table, skills) : -1;
      if (table && selected >= 0) {
        body.classList.add('with-detail');
        body.append(
          ...skillTableElements(table, selected, (index) => {
            if (index === selected) {
              if (table.skills[index].branch) this.deps.sendKeys([KEY_ENTER]);
            } else {
              send(cursorKeys(selected, index));
            }
          }),
        );
      } else {
        body.append(
          ...skillsElements(skills, (skill) => {
            if (skill.selected) {
              if (skill.branch) this.deps.sendKeys([KEY_ENTER]);
            } else {
              const keys = skillMoveKeys(skills, skill);
              if (keys) send(keys);
            }
          }),
        );
      }
      return {
        ...base,
        subtitle: points(skills.points),
        body,
        initial: body.querySelector<HTMLElement>('.current'),
        actions: [
          { id: 'lower', label: 'Lower', icon: '−', run: () => send('4') },
          { id: 'raise', label: 'Raise', icon: '+', primary: skills.points > 0, run: () => send('6') },
        ],
        onKey: (e) => this.skillKey(e, true),
      };
    }
    if (this.want === 'abilities' && screen?.abilities) {
      const abilities = screen.abilities;
      const table = this.api.engine.abilityTable();
      const index = table ? selectedAbility(table, abilities) : -1;
      if (table && index >= 0) {
        body.classList.add('with-detail');
        body.append(...abilityTableElements(table, index, (i) => i !== index && send(cursorKeys(index, i))));
      } else {
        body.append(
          ...abilitiesElements(abilities, (ability) => {
            const keys = abilityMoveKeys(abilities, ability);
            if (keys) send(keys);
          }),
        );
      }
      const selected = table && index >= 0 ? { state: table.abilities[index].learnable ? 'learnable' : 'locked' } : abilities.abilities.find((a) => a.selected);
      return {
        ...base,
        subtitle: points(abilities.points),
        body,
        initial: body.querySelector<HTMLElement>('.current'),
        actions: [{ id: 'learn', label: 'Learn', icon: '+', primary: selected?.state === 'learnable', run: () => send('6') }],
        onKey: (e) => this.skillKey(e, false),
      };
    }
    if (this.want === 'sheet' && screen?.sheet) {
      const sheet = screen.sheet;
      body.append(...fullSheetElements(sheet, { send, source: (letter) => this.deps.source(letter) }));
      return {
        ...base,
        subtitle: SHEET_PAGES[sheet.page],
        body,
        actions: SHEET_PAGES.map((label, page) => ({
          id: `page-${page}`,
          label,
          primary: page === sheet.page,
          run: () => page !== sheet.page && send(sheetPageKeys(sheet.page, page)),
        })),
      };
    }
    body.append(el('p', 'muted', 'Opening…'));
    return { ...base, subtitle: identity, body };
  }

  /** Arrow keys move tome2's cursor on the skills and abilities screens; right raises or learns. */
  private skillKey(e: KeyboardEvent, skills: boolean): boolean {
    const keys: Record<string, number[]> = {
      ArrowUp: keyCodes('8'),
      ArrowDown: keyCodes('2'),
      ArrowRight: keyCodes('6'),
      ...(skills ? { ArrowLeft: keyCodes('4'), Enter: [KEY_ENTER] } : {}),
    };
    const send = keys[e.key];
    if (!send) return false;
    this.deps.sendKeys(send);
    return true;
  }
}

function summaryBody(api: GameApi): HTMLElement | null {
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
  return body;
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
