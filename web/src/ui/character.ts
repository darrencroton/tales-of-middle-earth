import { depthLabel } from '../hud.ts';
import type { PlayerState, SkillEntry } from '../render/snapshot.ts';
import type { GameApi } from './api.ts';
import { KEY_BACKSLASH, KEY_ENTER, KEY_ESCAPE, keyCodes } from '../input/keys.ts';
import { fullSheetElements, sheetPageKeys, SHEET_PAGES, type FullSheet } from './charsheet.ts';
import { bar, el, section } from './dom.ts';
import { openMenu } from './menus.ts';
import type { MessageBox } from './msgbox.ts';
import type { SheetAction, SheetContent, SheetTab } from './sheet.ts';
import { abilityTableElements, cursorKeys, raiseRefusal, selectedAbility, selectedSkill, skillTableElements, type AbilitiesScreen, type SkillsScreen } from './skills.ts';

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
  /** Says why something cannot be done now. */
  refuse(text: string): void;
  /** Asks for `step` to run now if tome2 is already waiting for a key. */
  poke(): void;
}

function points(n: number): string {
  return `${n} point${n === 1 ? '' : 's'}`;
}

/* tome2's question once points have been moved and the skills screen is left. */
const SAVE_QUESTION = /Save and use these skill values/;

/**
 * Points moved on tome2's skills screen since it opened, which tome2 keeps
 * apart until its screen is left and its question answered: where each
 * Raise or Lower went (a skill can be lowered only by points put in here),
 * and the points there were to begin with.
 */
interface SkillSession {
  start: number;
  invested: Map<string, number>;
  /** A Raise or Lower sent, and the skill's value and the points left then, to tell once tome2 has answered whether it took. */
  sent: { name: string; value: number; points: number; step: 1 | -1 } | null;
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
  /** What tome2 showed when last looked at. */
  private lastScreen: CharacterScreen | null = null;
  /** Points being moved on tome2's skills screen, while it is open. */
  private session: SkillSession | null = null;
  /** The answer to give tome2's question about moved points when it asks (Save or Discard tapped). */
  private answer: number[] | null = null;

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
    if (this.pending()) {
      this.confirmSkills(() => this.select(tab));
      return;
    }
    if (tab !== 'summary' && !this.shown && !this.api.snapshot()?.atCommand) {
      this.deps.refuse('Finish what you are doing first.');
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
    this.lastScreen = screen;
    const current = screenTab(screen);
    /* A Raise or Lower that took shows at once, though tome2's screen may look the same. */
    if (this.follow(current, screen.atCommand)) this.render(screen);
    if (current) this.shown = current;
    else if (screen.atCommand) this.shown = null;
    if (screen.box && this.answer && SAVE_QUESTION.test(screen.box.text)) {
      this.deps.sendKeys(this.answer);
      this.answer = null;
      return true;
    }
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
    this.lastScreen = screen;
    if (!this.content) return false;
    const current = screenTab(screen);
    if (screen.box && this.answer && SAVE_QUESTION.test(screen.box.text)) return true;
    if (screen.box && (current || this.shown)) {
      this.ask(screen.box);
      return true;
    }
    this.asked = '';
    this.dismissAsk?.();
    if (!current) return false;
    if (current !== this.want) return true;
    const table = current === 'skills' ? this.api.engine.skillTable() : current === 'abilities' ? this.api.engine.abilityTable() : null;
    const key = JSON.stringify([current, screen.skills, screen.abilities, screen.sheet, table, [...(this.session?.invested ?? [])]]);
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
      kind: 'card',
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
    const skillTable = this.want === 'skills' && screen?.skills ? this.api.engine.skillTable() : null;
    const skillIndex = skillTable && screen?.skills ? selectedSkill(skillTable, screen.skills) : -1;
    if (skillTable && skillIndex >= 0) {
      const invested = this.session?.invested ?? new Map<string, number>();
      body.classList.add('with-detail');
      body.append(
        ...skillTableElements(skillTable, skillIndex, invested, (index) => {
          if (index === skillIndex) {
            if (skillTable.skills[index].branch) this.deps.sendKeys([KEY_ENTER]);
          } else {
            send(cursorKeys(skillIndex, index));
          }
        }),
      );
      const unsaved = [...invested.values()].reduce((n, c) => n + c, 0);
      const pending = this.pending();
      return {
        ...base,
        subtitle: `${points(skillTable.points)} to spend${unsaved ? ` · ${points(unsaved)} not saved` : ''}`,
        body,
        initial: body.querySelector<HTMLElement>('.current'),
        actions: [
          { id: 'lower', label: 'Lower', icon: '−', unavailable: this.lowerRefusal(), run: () => this.move(-1) },
          { id: 'raise', label: 'Raise', icon: '+', primary: !pending, unavailable: this.raiseRefusal(), run: () => this.move(1) },
          { id: 'save', label: 'Save', icon: '✓', primary: pending, unavailable: pending ? null : 'Nothing to save: raise a skill first.', run: () => this.confirmSkills() },
        ],
        onKey: (e) => this.skillKey(e, true),
      };
    }
    const abilityTable = this.want === 'abilities' && screen?.abilities ? this.api.engine.abilityTable() : null;
    const abilityIndex = abilityTable && screen?.abilities ? selectedAbility(abilityTable, screen.abilities) : -1;
    if (abilityTable && abilityIndex >= 0) {
      body.classList.add('with-detail');
      body.append(...abilityTableElements(abilityTable, abilityIndex, (i) => i !== abilityIndex && send(cursorKeys(abilityIndex, i))));
      return {
        ...base,
        subtitle: `${points(abilityTable.points)} to spend`,
        body,
        initial: body.querySelector<HTMLElement>('.current'),
        actions: [{ id: 'learn', label: 'Learn', icon: '+', unavailable: this.learnRefusal(), run: () => send('6') }],
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

  /** Arrow keys move tome2's cursor on the skills and abilities screens; right raises or learns, left lowers. */
  private skillKey(e: KeyboardEvent, skills: boolean): boolean {
    const moves: Record<string, string> = { ArrowUp: '8', ArrowDown: '2' };
    if (moves[e.key]) {
      this.deps.sendKeys(keyCodes(moves[e.key]));
      return true;
    }
    if (skills && e.key === 'Enter') {
      this.deps.sendKeys([KEY_ENTER]);
      return true;
    }
    if (e.key === 'ArrowRight' || (skills && e.key === 'ArrowLeft')) {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const why = !skills ? this.learnRefusal() : step > 0 ? this.raiseRefusal() : this.lowerRefusal();
      if (why) this.deps.refuse(why);
      else if (skills) this.move(step);
      else this.deps.sendKeys(keyCodes('6'));
      return true;
    }
    return false;
  }

  /** The skill tome2's cursor is on. */
  private currentSkill(): SkillEntry | null {
    const screen = this.lastScreen?.skills;
    const table = screen ? this.api.engine.skillTable() : null;
    const index = table && screen ? selectedSkill(table, screen) : -1;
    return table && index >= 0 ? table.skills[index] : null;
  }

  private raiseRefusal(): string | null {
    const skill = this.currentSkill();
    const table = this.api.engine.skillTable();
    if (!skill || !table) return 'Choose a skill first.';
    return raiseRefusal(skill, table.most, this.api.state()?.player?.lev ?? 1);
  }

  private lowerRefusal(): string | null {
    const skill = this.currentSkill();
    return skill && (this.session?.invested.get(skill.name) ?? 0) > 0 ? null : 'Lower takes back points not yet saved.';
  }

  private learnRefusal(): string | null {
    const screen = this.lastScreen?.abilities;
    const table = screen ? this.api.engine.abilityTable() : null;
    const index = table && screen ? selectedAbility(table, screen) : -1;
    const ability = table && index >= 0 ? table.abilities[index] : null;
    if (!table || !ability) return 'Choose an ability first.';
    if (ability.known) return 'You know this ability already.';
    if (!ability.met) return `Needs ${ability.needs.join(', ')}.`;
    if (table.points < ability.cost) return `It costs ${points(ability.cost)}; you have ${table.points}.`;
    return null;
  }

  /** tome2 has every key sent and waits for the next, so the screen last seen is the one keys act on. */
  private get settled(): boolean {
    return this.api.engine.awaitingInput && this.api.engine.pendingKeys === 0;
  }

  /** Puts a point into the current skill, or takes one back; one at a time, so each is known to have taken or not. */
  private move(step: 1 | -1): void {
    const session = this.session;
    const skill = this.currentSkill();
    if (!session || session.sent || !skill || !this.settled) return;
    session.sent = { name: skill.name, value: skill.value, points: this.api.engine.skillTable()?.points ?? 0, step };
    this.deps.sendKeys(keyCodes(step > 0 ? '6' : '4'));
  }

  /** Points have been moved and not yet saved: tome2 will ask whether to keep them as its screen is left. */
  private pending(): boolean {
    const session = this.session;
    return !!session && (this.api.engine.skillTable()?.points ?? session.start) !== session.start;
  }

  /**
   * Keeps the skill session in step with tome2: begun as its skills screen
   * opens, ended once it has gone, and each Raise or Lower settled once
   * tome2 has answered it (true then). A skill another one shuts out drops
   * to nothing, and tome2 gives back the points put into it.
   */
  private follow(current: CharacterTab | null, atCommand: boolean): boolean {
    if (current !== 'skills') {
      if (current || atCommand) {
        this.session = null;
        this.answer = null;
      }
      return false;
    }
    const table = this.api.engine.skillTable();
    if (!table?.ready) return false;
    if (!this.session) {
      this.session = { start: table.points, invested: new Map(), sent: null };
      return false;
    }
    const { invested, sent } = this.session;
    if (!sent) return false;
    /* tome2 changes nothing when it refuses; a point that took moves the points left, or at least the skill (a raise that shuts other skills out can give back as many as it took). */
    const skill = table.skills.find((s) => s.name === sent.name);
    if (skill && (table.points !== sent.points || skill.value !== sent.value)) {
      const count = (invested.get(sent.name) ?? 0) + sent.step;
      if (count > 0) invested.set(sent.name, count);
      else invested.delete(sent.name);
    }
    this.session.sent = null;
    for (const skill of table.skills) if (skill.value === 0) invested.delete(skill.name);
    return true;
  }

  /** Asks whether to save the points moved: Save keeps them, Discard gives them back, closing the card goes on moving them; `then` follows either answer. */
  private confirmSkills(then?: () => void): void {
    if (!this.settled) return;
    const moved = [...(this.session?.invested ?? [])];
    const body = el('div', 'prose');
    body.append(el('p', undefined, 'Points spent on skills cannot be taken back once saved.'));
    if (moved.length) {
      const list = el('ul', 'skill-moves');
      for (const [name, count] of moved) list.append(el('li', undefined, `${name} +${points(count)}`));
      body.append(list);
    }
    const answer = (key: string) => {
      if (this.api.sheets.isTop(card)) this.api.sheets.back();
      this.answer = keyCodes(key);
      this.session = null;
      /* tome2's skills screen is opened again once its question is answered, unless another tab is chosen. */
      this.requested = null;
      this.renderedKey = '';
      this.deps.sendKeys([KEY_ESCAPE]);
      then?.();
    };
    const card: SheetContent = {
      title: 'Save skill points?',
      body,
      kind: 'card',
      actions: [
        { id: 'discard', label: 'Discard', run: () => answer('n') },
        { id: 'save', label: 'Save', primary: true, run: () => answer('y') },
      ],
    };
    this.api.sheets.open(card);
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
