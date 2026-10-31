import type { Engine } from '../engine.ts';
import { KEY_ENTER as ENTER, KEY_ESCAPE as ESCAPE, KEY_SPACE as SPACE } from '../input/keys.ts';
import type { Action } from '../play/actions.ts';
import { keyCodes } from '../play/macro.ts';
import type { TerminalBuffer } from '../terminal.ts';
import { moduleKey, type ModuleChoice, type SaveInfo, type TitleChoice, type TitleScreen } from '../title.ts';
import { birthCard } from '../ui/birthcard.ts';
import { findSaveIndex } from '../saves.ts';
import { nextRunName, saveBase } from '../play/adventurers.ts';
import { el } from '../ui/dom.ts';
import { ListNav } from '../ui/listnav.ts';
import { askText } from '../ui/menus.ts';
import type { Sheets } from '../ui/sheet.ts';
import { bufferRows } from '../ui/termparse.ts';
import {
  STEP_TITLES,
  cursorKeysTo,
  describesHero,
  parseBirthChoice,
  parseSaveIndex,
  parseSavefileScreen,
  validCharacterName,
  type BirthChoiceScreen,
  type BirthStep,
  type SaveRecord,
} from './birth.ts';
import { birthDetails, findBirthEntry, type BirthDetails } from './birthinfo.ts';
import { DEFAULT_QUESTS, type RunOptions } from './runoptions.ts';
import { runElements } from '../ui/adventure.ts';
import type { BirthData } from '../render/snapshot.ts';

export interface DirectorDeps {
  root: HTMLElement;
  buffer: TerminalBuffer;
  engine: Engine;
  sheets: Sheets;
  palette(): readonly string[];
  send(keys: number[]): void;
  requestRefresh(): void;
}

type Phase = 'boot' | 'title' | 'creating' | 'birth' | 'loading' | 'playing';

const INTRO_LINES = [
  'The world is indeed full of peril,',
  'and in it there are many dark places;',
  'but still there is much that is fair,',
  'and though in all lands love is now mingled with grief,',
  'it grows perhaps the greater.',
];
const INTRO_CITE = 'J.R.R. Tolkien · The Fellowship of the Ring';

const MODULE: ModuleChoice = 'ToME';

/* tome2's own intro and credits screens, replaced by the title screen's intro. */
const INTRO_SCREEN = /Art thou an adventurer|DarkGod|furiosity|\[Press any key to continue\]/;
/* The first screens of character creation. */
const BIRTH_SCREEN = /Choose a race|Please answer the following/;
/* The rolled hero, shown after the last birth choice. */
const HERO_SCREEN = /'r' to reroll|'S' to start over, or ESC to continue/;
/* The last screen of character creation, where the run is set up. */
const READY_SCREEN = /'S' to start over, or ESC to continue/;

interface BirthPick {
  step: BirthStep;
  key: string;
}

const STEP_ORDER: BirthStep[] = ['race', 'modifier', 'class', 'specialisation', 'god'];
const STEP_SHORT: Record<BirthStep, string> = {
  race: 'Race',
  modifier: 'Lineage',
  class: 'Class',
  specialisation: 'Speciality',
  god: 'God',
};

const HERO_STATS = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'];

/**
 * Drives tome2's start-up and character creation behind native screens:
 * it answers the module and news screens itself, offers saved heroes on the
 * title screen, and presents the birth menus as tappable cards.
 */
export class Director {
  private readonly deps: DirectorDeps;
  private readonly view: HTMLElement;
  private readonly nav: ListNav;
  private title: TitleScreen | null = null;
  private phase: Phase = 'boot';
  private heroName = '';
  private saves: SaveInfo[] = [];
  /** Savefiles of fallen heroes, which tome2 can start again with the same race, class and attributes. */
  private fallen: { name: string; description: string }[] = [];
  /** The hero being created is a fallen one begun anew. */
  private anew = false;
  /** The fallen hero's savefile a hero begun anew starts from. */
  private template = '';
  private choice: BirthChoiceScreen | null = null;
  private pendingKey: string | null = null;
  private chooseWhenReady = false;
  private renderedKey = '';
  private nameSent = false;
  private lastAuto = '';
  /** Options chosen so far, in order, for going back a step. */
  private picks: BirthPick[] = [];
  private lastChoice: BirthChoiceScreen | null = null;
  /** Earlier picks re-entered after a restart, while going back. */
  private replay: BirthPick[] | null = null;
  private replayed: BirthStep | null = null;
  /** Option highlighted once going back reaches its step. */
  private returnKey: string | null = null;
  /** Races, modifiers and classes as the engine defines them (read once). */
  private birthData: BirthData | null = null;
  /** The number of random quests the run has, drawn again each time the last screen shows (tome2's prompt takes one digit). */
  private quests = DEFAULT_QUESTS;
  /** The random quests have been drawn for the last screen showing now. */
  private questsDrawn = false;

  constructor(deps: DirectorDeps) {
    this.deps = deps;
    this.view = el('div', 'director');
    this.view.hidden = true;
    deps.root.append(this.view);
    this.nav = new ListNav(this.view);
  }

  attachTitle(title: TitleScreen): void {
    this.title = title;
  }

  /** The title screen is showing its choices and nothing is loading or being created. */
  get atTitle(): boolean {
    return this.phase === 'title';
  }

  private screen(): string {
    return this.deps.buffer.screenText();
  }

  /** Called whenever the engine waits for a key, before the screen is drawn. */
  idle(): void {
    if (this.deps.engine.pendingKeys > 0) return;
    const screen = this.screen();
    const rowZero = this.deps.buffer.rowText(0).trim();
    const snap = this.deps.engine.snapshot();

    if (snap?.inDungeon) {
      if (this.phase !== 'playing') {
        this.phase = 'playing';
        if (this.title?.isVisible && !this.title.showingIntro) this.title.leave();
      }
      return;
    }

    switch (this.phase) {
      case 'boot':
        this.boot(screen, rowZero);
        break;
      case 'creating':
        this.creating(screen, rowZero);
        break;
      case 'birth':
        this.birth(screen, rowZero);
        break;
      case 'loading':
        if (BIRTH_SCREEN.test(screen)) {
          this.startBirth(screen, rowZero);
        } else if (/-more-/.test(rowZero) || /Press any key/.test(screen)) {
          this.deps.send([SPACE]);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Called while the engine pauses mid-animation. The only animation while a
   * character is being created is tome2's own sliding intro, which never
   * waits for a key, so the key that cuts it short is sent from here.
   */
  effectFrame(): void {
    if (this.phase !== 'creating' || this.deps.engine.pendingKeys > 0) return;
    this.deps.send([SPACE]);
  }

  private boot(screen: string, rowZero: string): void {
    if (/select a module to play/.test(screen)) {
      const key = moduleKey(screen, MODULE) ?? 'a';
      this.deps.send(keyCodes(key));
    } else if (/\[Press any key to continue\]/.test(screen) || /-more-/.test(rowZero)) {
      this.deps.send([SPACE]);
    } else {
      const entries = parseSavefileScreen(bufferRows(this.deps.buffer, 0, this.deps.buffer.rows - 1), screen);
      if (!entries) return;
      const records = this.readSaveIndex();
      this.fallen = entries
        .map((entry) => ({ entry, record: records.find((r) => r.base === entry.name || r.base === `_${entry.name}`) }))
        .filter(({ record }) => record && !record.alive && record.module === MODULE)
        .map(({ entry, record }) => ({ name: entry.name, description: record!.description }));
      this.saves = entries
        .map((entry) => {
          const matches = (r: SaveRecord) => r.base === entry.name || r.base === `_${entry.name}`;
          const record = records.find((r) => matches(r) && r.module === MODULE) ?? records.find(matches);
          return {
            letter: entry.letter,
            name: entry.name,
            description: (record?.description ?? '').replace(/ is alive$/, ''),
            alive: record?.alive ?? true,
          };
        })
        .filter((s) => s.alive)
        .map(({ letter, name, description }) => ({ letter, name, description }));
      this.phase = 'title';
      this.title?.setChoices(this.saves);
    }
  }

  private readSaveIndex(): SaveRecord[] {
    const fs = this.deps.engine.fs;
    const root = this.deps.engine.savePath;
    const path = fs && root ? findSaveIndex(fs, root) : null;
    if (!fs || !path) return [];
    try {
      return parseSaveIndex(new TextDecoder().decode(fs.readFile(path)));
    } catch {
      return [];
    }
  }

  /** Back to the start, for a fresh engine in the same page. */
  reset(): void {
    this.phase = 'boot';
    this.heroName = '';
    this.saves = [];
    this.fallen = [];
    this.anew = false;
    this.template = '';
    this.choice = null;
    this.pendingKey = null;
    this.chooseWhenReady = false;
    this.nameSent = false;
    this.lastAuto = '';
    this.picks = [];
    this.lastChoice = null;
    this.replay = null;
    this.replayed = null;
    this.returnKey = null;
    this.quests = DEFAULT_QUESTS;
    this.questsDrawn = false;
    this.hide();
  }

  /** A fallen hero's savefile, by the hero's name. */
  private fallenSave(name: string): { name: string; description: string } | undefined {
    const base = saveBase(name);
    return this.fallen.find((f) => f.name === base);
  }

  /** True when a fallen hero's savefile can start them again (same name, race and class, no living hero by that name). */
  canBeginAnew(hero: { name: string; race: string; cls: string }): boolean {
    if (this.phase !== 'title') return false;
    const save = this.fallenSave(hero.name);
    return !!save && describesHero(save.description, hero.race, hero.cls);
  }

  /**
   * Starts a fallen hero again from their beginning, under a name of its own
   * ("Elder II", asked first) so the run has its own savefile and the fallen
   * one's stays to begin anew from; false when there is no savefile to start from.
   */
  beginAnew(name: string): boolean {
    const save = this.fallenSave(name);
    if (this.phase !== 'title' || !save) return false;
    const taken = new Set([...this.saves, ...this.fallen].map((s) => s.name.toLowerCase()));
    for (const entry of this.deps.engine.scores()) taken.add(saveBase(entry.name).toLowerCase());
    this.title?.setBusy('');
    this.askAnewName(save.name, name, nextRunName(name, taken));
    return true;
  }

  private askAnewName(template: string, fallen: string, suggested: string, error = ''): void {
    const living = new Set(this.saves.map((s) => s.name.toLowerCase()));
    askText(this.deps.sheets, 'Begin anew', `${fallen}'s race, class and attributes in a new adventure. What shall this hero be called?`, suggested, 15, error).then(
      (name) => {
        if (name === null) {
          this.title?.restoreChoices();
          return;
        }
        const problem = validCharacterName(name) ?? (living.has(saveBase(name).toLowerCase()) ? `${name} already has a saved game.` : null);
        if (problem) {
          this.askAnewName(template, fallen, name, problem);
          return;
        }
        this.template = template;
        this.heroName = name;
        this.startCreating(true);
      },
    );
  }

  /** Takes a fallen hero's savefile off the list (it is about to be deleted); false when there was none. */
  forgetFallen(name: string): boolean {
    const save = this.fallenSave(name);
    if (!save) return false;
    this.fallen = this.fallen.filter((f) => f !== save);
    return true;
  }

  /** Takes a deleted hero off the title screen; tome2's own list still holds them, so the other heroes' letters stay right. */
  forgetSave(name: string): void {
    if (this.phase !== 'title') return;
    this.saves = this.saves.filter((s) => s.name !== name);
    this.title?.setChoices(this.saves);
  }

  /** The player chose on the title screen. */
  choose(choice: TitleChoice): void {
    if (this.phase !== 'title') return;
    if (choice.kind === 'continue') {
      this.phase = 'loading';
      this.title?.setBusy(`Loading ${choice.save.description.split(', the ')[0] || choice.save.name}…`);
      this.deps.send(keyCodes(choice.save.letter));
      return;
    }
    this.askName();
  }

  private askName(error = ''): void {
    this.title?.setBusy('');
    const taken = new Set(this.saves.map((s) => s.name.toLowerCase()));
    /* The list holds savefile names, which several hero names can share ("Old Tom" and "Old_Tom"). */
    askText(this.deps.sheets, 'Name your hero', 'What shall you be called?', this.heroName, 15, error).then((name) => {
      if (name === null) {
        this.title?.restoreChoices();
        return;
      }
      const problem = validCharacterName(name) ?? (taken.has(saveBase(name).toLowerCase()) ? `${name} already has a saved game.` : null);
      if (problem) {
        this.heroName = name;
        this.askName(problem);
        return;
      }
      this.heroName = name;
      this.startCreating(false);
    });
  }

  private startCreating(anew: boolean): void {
    this.anew = anew;
    this.phase = 'creating';
    this.nameSent = false;
    this.picks = [];
    this.lastChoice = null;
    this.deps.send(keyCodes('a'));
    this.title?.setBusy('');
    this.title?.showIntro(INTRO_LINES, INTRO_CITE, () => {
      this.title?.leave();
      this.deps.requestRefresh();
    });
  }

  private creating(screen: string, rowZero: string): void {
    if (/Enter the name of the savefile/.test(screen) && !this.nameSent) {
      this.nameSent = true;
      this.deps.send([...keyCodes(this.anew ? this.template : this.heroName), ENTER]);
    } else if (/already exists! Press any key to load/.test(screen)) {
      // A fallen hero's savefile: tome2 loads it and starts a new character.
      this.deps.send([SPACE]);
    } else if (/Savefile does not exist/.test(rowZero) || /-more-/.test(rowZero)) {
      // The extra key cuts tome2's sliding intro short; ours is on the title screen.
      this.deps.send([SPACE, SPACE]);
    } else if (INTRO_SCREEN.test(screen)) {
      this.deps.send([SPACE]);
    } else if (BIRTH_SCREEN.test(screen)) {
      this.startBirth(screen, rowZero);
    }
  }

  private startBirth(screen: string, rowZero: string): void {
    this.phase = 'birth';
    this.birth(screen, rowZero);
  }

  /** Answers the birth questions the native screens skip. */
  private birth(screen: string, rowZero: string): void {
    const answer = (pattern: RegExp, keys: number[]) => {
      if (!pattern.test(screen)) return false;
      this.deps.send(keys);
      return true;
    };
    if (/-more-/.test(rowZero)) {
      this.deps.send([SPACE]);
      return;
    }
    if (answer(/modify the options\s*\[y\/n\]/, keyCodes('n'))) return;
    if (/Use same character as last time/.test(screen) && this.anew && !this.deps.engine.setHeroName(this.heroName)) {
      console.warn(`${this.heroName} could not be named; the run keeps the fallen hero's savefile`);
    }
    if (answer(/Use same character as last time/, keyCodes(this.anew ? 'y' : 'n'))) return;
    if (answer(/Number of quests\?/, [...keyCodes('0'), ENTER])) return;
    if (answer(/Enter minimum attribute for/, [ENTER])) return;
    if (/Enter your player's name above/.test(screen)) {
      const key = `name:${screen}`;
      if (this.lastAuto === key) return;
      this.lastAuto = key;
      this.deps.send([...keyCodes(this.heroName), ENTER]);
      return;
    }
    const ready = READY_SCREEN.test(screen);
    if (ready && !this.questsDrawn) this.questsDrawn = this.deps.engine.setRandomQuests(this.quests);
    if (!ready) this.questsDrawn = false;
    const current = parseBirthChoice(bufferRows(this.deps.buffer, 0, this.deps.buffer.rows - 1), screen);
    if (current || HERO_SCREEN.test(screen)) this.track(current);
    if (current && this.continueReplay(current)) return;
    if (this.pendingKey) {
      const arrived = current?.options.find((o) => o.current)?.key === this.pendingKey;
      const choose = arrived && this.chooseWhenReady;
      this.pendingKey = null;
      this.chooseWhenReady = false;
      if (choose) this.deps.send([ENTER]);
    }
  }

  /** Records the option chosen on each step as tome2 moves past it (or back, on a restart). */
  private track(choice: BirthChoiceScreen | null): void {
    const previous = this.lastChoice;
    this.lastChoice = choice;
    if (previous && choice && previous.step === choice.step) return;
    const at = choice ? STEP_ORDER.indexOf(choice.step) : STEP_ORDER.length;
    this.picks = this.picks.filter((p) => STEP_ORDER.indexOf(p.step) < at);
    if (!previous || STEP_ORDER.indexOf(previous.step) >= at) return;
    if (this.replayed === previous.step) {
      this.replayed = null;
      return;
    }
    const pick = previous.options.find((o) => o.current);
    if (pick) this.picks.push({ step: previous.step, key: pick.key });
  }

  /** Re-enters the next earlier pick while going back; false once there is nothing left to replay. */
  private continueReplay(choice: BirthChoiceScreen): boolean {
    if (!this.replay) return false;
    const next = this.replay[0];
    if (!next || next.step !== choice.step) {
      const key = next ? null : this.returnKey;
      this.replay = null;
      this.returnKey = null;
      this.choice = choice;
      if (key) this.preview(key);
      this.deps.requestRefresh();
      return !!key;
    }
    this.replay.shift();
    this.picks.push(next);
    this.replayed = next.step;
    this.deps.send(keyCodes(next.key));
    return true;
  }

  /** Returns to the previous birth step: tome2 starts over and the earlier picks are made again. */
  back(): void {
    if (this.replay || this.picks.length === 0) return;
    this.returnKey = this.picks[this.picks.length - 1].key;
    this.replay = this.picks.slice(0, -1);
    this.replayed = null;
    this.pendingKey = null;
    this.chooseWhenReady = false;
    this.deps.send(keyCodes('S'));
  }

  /** Highlights a random option so its description shows; Choose confirms it. */
  private randomOption(): void {
    const options = this.choice?.options.filter((o) => !o.current) ?? [];
    const usual = options.filter((o) => !o.unusual);
    const pool = usual.length ? usual : options;
    if (pool.length) this.preview(pool[Math.floor(Math.random() * pool.length)].key);
  }

  hide(): void {
    if (this.view.hidden) return;
    this.view.hidden = true;
    this.renderedKey = '';
  }

  /** Draws a native view for the current pre-game screen; false lets the generic view show it. */
  render(): boolean {
    if (this.promptShowing()) return false;
    if (this.phase === 'boot' || this.phase === 'title' || this.phase === 'creating' || this.phase === 'loading') {
      this.showWaiting(this.phase === 'loading' ? 'Loading…' : '');
      return true;
    }
    if (this.phase !== 'birth') return false;
    if (this.replay) {
      this.showWaiting('');
      return true;
    }
    const screen = this.screen();
    const rows = bufferRows(this.deps.buffer, 0, this.deps.buffer.rows - 1);
    const choice = parseBirthChoice(rows, screen);
    if (choice) {
      this.choice = choice;
      this.showChoice(choice);
      return true;
    }
    this.choice = null;
    if (/'r' to reroll/.test(screen)) {
      this.showHero('reroll');
      return true;
    }
    if (READY_SCREEN.test(screen)) {
      this.showHero('confirm');
      return true;
    }
    if (/modify the options|Number of quests|Enter minimum attribute|Enter your player's name|Please answer the following/.test(screen)) {
      this.showWaiting('Forging your hero…');
      return true;
    }
    return false;
  }

  /** A -more- on the prompt line that the native views would hide (yes/no questions show as a card). */
  private promptShowing(): boolean {
    if (this.phase !== 'birth' && this.phase !== 'loading') return false;
    return /-more-/.test(this.deps.buffer.rowText(0).trim());
  }

  /** Toolbar actions for the native screens, or null for the defaults. */
  actions(): Action[] | null {
    if (this.view.hidden || this.promptShowing()) return null;
    const menu: Action = { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } };
    if (this.replay) return [menu];
    const back: Action[] = this.picks.length
      ? [{ id: 'back', label: 'Back', icon: '‹', effect: { kind: 'run', run: () => this.back() } }]
      : [];
    if (this.choice) {
      return [
        ...back,
        { id: 'random', label: 'Random', icon: '⚄', effect: { kind: 'run', run: () => this.randomOption() } },
        { id: 'choose', label: 'Choose', icon: '✔', effect: { kind: 'keys', keys: [ENTER] }, primary: true },
        menu,
      ];
    }
    const screen = this.screen();
    if (/'r' to reroll/.test(screen)) {
      return [
        ...back,
        { id: 'reroll', label: 'Reroll', icon: '⚄', effect: { kind: 'keys', keys: keyCodes('r') } },
        { id: 'accept', label: 'Accept', icon: '✔', effect: { kind: 'keys', keys: [ESCAPE] }, primary: true },
        menu,
      ];
    }
    if (READY_SCREEN.test(screen)) {
      return [
        ...back,
        { id: 'restart', label: 'Start over', icon: '↺', effect: { kind: 'keys', keys: keyCodes('S') } },
        { id: 'begin', label: 'Begin adventure', icon: '▸', effect: { kind: 'keys', keys: [ESCAPE] }, primary: true },
        menu,
      ];
    }
    return [menu];
  }

  /** The last creation screen is showing, where any key but S and Q would begin the game in tome2. */
  get readyShowing(): boolean {
    return !this.view.hidden && this.phase === 'birth' && READY_SCREEN.test(this.screen());
  }

  /** Handles a key on the native screens: true when used, 'browser' when it is left to the browser, false for tome2. */
  handleKey(e: KeyboardEvent): boolean | 'browser' {
    if (this.view.hidden) return false;
    const back = e.key === 'Backspace' || (e.key === 'Escape' && this.choice);
    if (back && this.phase === 'birth' && this.picks.length && !this.replay) {
      this.back();
      return true;
    }
    /* On the last screen arrows and Enter move through the run, Escape begins, and other keys do nothing. */
    if (this.readyShowing) {
      if (e.key === 'Escape') return false;
      if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key)) return 'browser';
      this.nav.handleKey(e);
      return true;
    }
    if (!this.choice) return false;
    const options = this.choice.options;
    const index = options.findIndex((o) => o.current);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        this.preview(options[(index + 1) % options.length].key);
        return true;
      case 'ArrowUp':
      case 'ArrowLeft':
        this.preview(options[(index - 1 + options.length) % options.length].key);
        return true;
      case 'Enter':
      case ' ':
        this.deps.send([ENTER]);
        return true;
      default:
        return false;
    }
  }

  /** Moves tome2's cursor to an option so its description shows. */
  private preview(key: string): void {
    if (!this.choice || this.pendingKey) return;
    const keys = cursorKeysTo(this.choice.options, key);
    if (!keys) return;
    this.pendingKey = key;
    this.deps.send(keyCodes(keys));
  }

  private tapOption(key: string): void {
    if (!this.choice) return;
    if (this.pendingKey) {
      if (this.pendingKey === key) this.chooseWhenReady = true;
      return;
    }
    const current = this.choice.options.find((o) => o.current);
    if (current?.key === key) this.deps.send([ENTER]);
    else this.preview(key);
  }

  private show(key: string, build: () => HTMLElement[], className: string): void {
    this.view.hidden = false;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.view.className = `director ${className}`;
    this.view.replaceChildren(...build());
  }

  private showWaiting(text: string): void {
    this.show(`wait:${text}`, () => [el('p', 'director-wait', text)], 'waiting');
  }

  private steps(current: BirthStep): HTMLElement {
    const list = el('ol', 'birth-steps');
    const at = STEP_ORDER.indexOf(current);
    STEP_ORDER.forEach((step, i) => {
      if (step === 'modifier' || step === 'specialisation') {
        if (step !== current) return;
      }
      const item = el('li', i < at ? 'done' : step === current ? 'current' : '', STEP_SHORT[step]);
      list.append(item);
    });
    return list;
  }

  private details(choice: BirthChoiceScreen, label: string): BirthDetails | null {
    this.birthData ??= this.deps.engine.birthData();
    const entry = this.birthData ? findBirthEntry(this.birthData, choice.step, label) : null;
    return entry ? birthDetails(entry, choice.step) : null;
  }

  private showChoice(choice: BirthChoiceScreen): void {
    const key = JSON.stringify(choice);
    this.show(
      `choice:${key}`,
      () => {
        const header = el('header', 'birth-header');
        header.append(this.steps(choice.step), el('h2', undefined, STEP_TITLES[choice.step]));
        const summary = choice.summary.filter((s) => s.label !== 'Name');
        if (this.heroName || summary.length) {
          const line = [this.heroName, ...summary.map((s) => s.value)].filter(Boolean).join(' · ');
          header.append(el('p', 'birth-summary', line));
        }

        const current = choice.options.find((o) => o.current);
        const details = current ? this.details(choice, current.label) : null;
        const tag = details?.experimental
          ? 'Experimental: an unfinished choice that may be unbalanced. Greyed out, but you can still pick it.'
          : current?.unusual
            ? 'Not a natural fit for your race: playable, but expect a harder road.'
            : null;
        const card = birthCard(current?.label ?? '', details, choice.description.filter((d) => d !== 'EXPERIMENTAL'), tag);

        const list = el('div', 'birth-options');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', STEP_TITLES[choice.step]);
        for (const option of choice.options) {
          const button = el('button', `birth-option${option.current ? ' current' : ''}${option.unusual ? ' unusual' : ''}`, option.label);
          button.type = 'button';
          button.dataset.nav = '';
          button.setAttribute('role', 'option');
          button.setAttribute('aria-selected', String(option.current));
          button.addEventListener('click', () => this.tapOption(option.key));
          list.append(button);
        }

        const body = el('div', 'birth-body');
        body.append(list, card);
        requestAnimationFrame(() => {
          const active = list.querySelector<HTMLElement>('.current');
          if (active) this.nav.setActive(active);
        });
        return [header, body];
      },
      'birth',
    );
  }

  private showHero(kind: 'reroll' | 'confirm'): void {
    const screen = this.screen();
    const lines = screen.split('\n');
    const field = (label: string) => {
      for (const line of lines.slice(0, 8)) {
        const m = new RegExp(`^\\s*${label}\\s*:\\s*(.*?)\\s*$`).exec(line.slice(0, 40));
        if (m) return m[1];
      }
      return '';
    };
    const stats = HERO_STATS.map((name) => {
      const m = new RegExp(`${name}:\\s+(\\S+)`).exec(screen);
      return { name, value: m?.[1] ?? '?' };
    });
    const pair = (label: string) => {
      const m = new RegExp(`${label}\\s+(\\d+)/\\s*(\\d+)`).exec(screen);
      return m ? `${m[1]}/${m[2]}` : '';
    };
    const ratings = ['Fighting', 'Bows/Throw', 'Saving Throw', 'Stealth', 'Magic Device'].map((label) => {
      const escaped = label.replace('/', '\\/');
      const m = new RegExp(`${escaped}\\s*:\\s*(\\S+(?: \\S+)?)`).exec(screen);
      return { label, value: m?.[1] ?? '' };
    });
    const run = kind === 'confirm' ? this.deps.engine.runOptions() : null;
    const key = JSON.stringify([kind, stats, ratings, field('Race'), field('Class'), run, this.quests]);
    const arriving = !this.renderedKey.startsWith('hero:');
    this.show(
      `hero:${key}`,
      () => {
        const header = el('header', 'birth-header');
        header.append(el('h2', undefined, kind === 'reroll' ? 'Your hero' : 'Ready to begin?'));
        const subtitle = [this.heroName || field('Name'), `${field('Race')} ${field('Class')}`.trim(), field('God') && field('God') !== 'Nobody' ? `follower of ${field('God')}` : '']
          .filter(Boolean)
          .join(' · ');
        header.append(el('p', 'birth-summary', subtitle));

        const card = el('article', 'birth-card hero');
        const grid = el('div', 'stat-grid six');
        for (const s of stats) {
          const node = el('div', 'stat');
          node.append(el('span', 'stat-label', s.name), el('span', 'stat-value', s.value));
          grid.append(node);
        }
        card.append(grid);
        const vitals = el('div', 'stat-grid');
        for (const [label, pattern] of [
          ['Health', 'Hit Points'],
          ['Mana', 'Spell Points'],
          ['Sanity', 'Sanity'],
        ] as const) {
          const value = pair(pattern);
          if (!value) continue;
          const node = el('div', 'stat');
          node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
          vitals.append(node);
        }
        card.append(vitals);
        const skills = el('dl', 'ratings');
        for (const r of ratings) {
          if (!r.value) continue;
          skills.append(el('dt', undefined, r.label), el('dd', `rating-${r.value.toLowerCase().replace(/\W+/g, '-')}`, r.value));
        }
        card.append(skills);
        card.append(
          el(
            'p',
            'muted',
            kind === 'reroll'
              ? 'Reroll for different attributes, or accept them.'
              : 'Set up your adventure below, then begin, or start over.',
          ),
        );
        const body = el('div', 'birth-body single');
        body.append(card);
        if (run) body.append(this.runCard(run));
        requestAnimationFrame(() => (arriving ? this.nav.setActive(-1) : this.nav.refresh()));
        return [header, body];
      },
      'birth hero',
    );
  }

  /** The run's options under the hero about to begin: random quests and tome2's birth options, set as they are tapped. */
  private runCard(run: RunOptions): HTMLElement {
    const card = el('article', 'birth-card run');
    card.append(
      el('h3', undefined, 'Your adventure'),
      ...runElements(run, this.quests, {
        quests: (count) => {
          this.quests = count;
          this.deps.engine.setRandomQuests(count);
          this.deps.requestRefresh();
        },
        option: (index, on) => {
          this.deps.engine.setRunOption(index, on);
          if (run.options[index]?.name === 'unusualRooms' && !on) this.deps.engine.setRandomQuests(this.quests);
          this.deps.requestRefresh();
        },
      }),
    );
    return card;
  }
}


