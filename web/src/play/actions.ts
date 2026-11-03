import { KEY_BACKSLASH, keyCodes, typedAnswer } from '../input/keys.ts';
import type { Macro, MacroScreen } from './macro.ts';
import { classifyPrompt, type PromptKind } from './prompts.ts';

export type NativeView =
  | 'inventory'
  | 'look'
  | 'lookDone'
  | 'character'
  | 'skills'
  | 'magic'
  | 'powers'
  | 'recast'
  | 'fire'
  | 'rest'
  | 'talk'
  | 'release'
  | 'creaturePowers'
  | 'overview'
  | 'overviewDone'
  | 'finish'
  | 'fallen'
  | 'explore'
  | 'equip'
  | 'halt'
  | 'pace'
  | 'closeFile';

type ActionEffect =
  | { kind: 'keys'; keys: number[] }
  | { kind: 'keyboard' }
  | { kind: 'menu' }
  | { kind: 'commands' }
  | { kind: 'ctrl' }
  | { kind: 'nav'; direction: 'up' | 'down' | 'select' }
  | { kind: 'native'; view: NativeView }
  | { kind: 'run'; run(): void };

export interface Action {
  id: string;
  label: string;
  icon: string;
  effect: ActionEffect;
  /** Highlighted as the most likely next action. */
  primary?: boolean;
  /** Why it cannot be done now: the button stays, and a tap says so instead. */
  unavailable?: string;
  /** Leaves exploring or travel running. */
  continues?: boolean;
  /** More about the button for assistive technology, such as the pace a switch is at. */
  detail?: string;
}

export interface CommandDef {
  label: string;
  icon: string;
  /** Underlying original-keyset command, sent after '\' so keymaps cannot interfere. */
  command: string;
  /** Opens a native view instead of sending the command. */
  native?: NativeView;
  /** Shows a tome2 screen to read; the Commands sheet reopens when it closes. */
  reading?: boolean;
  /** Why it cannot be done now: the button stays, dimmed, and a tap says so instead. */
  unavailable?: string;
}

/** tome2 picks up with 'g' normally and with ',' when always_pickup is on. */
export function pickupCommand(alwaysPickup: boolean): string {
  return alwaysPickup ? ',' : 'g';
}

/** Stays still for a turn without picking anything up: the other key of the pair. */
export function waitCommand(alwaysPickup: boolean): string {
  return alwaysPickup ? 'g' : ',';
}

export function commandKeys(def: Pick<CommandDef, 'command'>): number[] {
  return [KEY_BACKSLASH, ...keyCodes(def.command)];
}

/* tome2's FEAT_BETWEEN: the one of its two Void Jumpgates that do_cmd_rest refuses. */
const FEAT_BETWEEN = 160;

/** Why tome2 will not let the hero rest on the terrain underfoot (its feature index), or null. */
function restRefusal(feat: number | undefined): string | null {
  return feat === FEAT_BETWEEN ? 'Resting on a Void Jumpgate is too dangerous.' : null;
}

/** Talks to (`Y`) or gives to (`y`) the creature in a direction, giving the direction only when tome2 asks (it ignores both at times). */
export function* converseMacro(command: 'Y' | 'y', digit: string): Macro {
  const s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes(command)];
  if (classifyPrompt(s.prompt) === 'direction') yield keyCodes(digit);
}

/** Rests as long as needed, answering tome2's question of how long only when it asks (it may refuse first). */
export function* restMacro(): Macro {
  const s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes('R')];
  if (/^Rest \(/.test(s.prompt)) yield typedAnswer('&', '&');
}

const text = keyCodes;

/** Where the player is: underground, walking the land (towns and wilderness), or on the world map. */
type Surroundings = 'dungeon' | 'land' | 'worldMap';

/** What decides which commands the More sheet offers, and which it dims. */
export interface CommandContext {
  where: Surroundings;
  /** Name of the terrain under the player, lower case. */
  underfoot: string;
  /** tome2's feature index of the terrain under the player. */
  feat: number;
  /** A creature the hero can see stands beside them. */
  beside: boolean;
  /** 0 without a god, 1 when the hero may pray, 2 while praying. */
  pray: number;
  /** The hero has learnt runes to engrave. */
  runes: boolean;
  /** The hero has the Stealing skill. */
  steals: boolean;
  /** The hero has spells or a magic art to use. */
  magic: boolean;
  /** The hero has powers or techniques to use. */
  powers: boolean;
  /** The hero controls another creature. */
  controlling: boolean;
}

interface CommandEntry extends CommandDef {
  /** Offered only to a hero for whom this holds. */
  when?: (ctx: CommandContext) => boolean;
  /** Acts for the creature the hero controls, and is offered only then (tome2 gives these keys to the creature). */
  creature?: boolean;
  /** Why it cannot be done here and now, if it cannot. */
  refuse?: (ctx: CommandContext) => string | null;
}

const beside = (c: CommandContext) => (c.beside ? null : 'There is no one beside you.');

/* Commands tome2 ignores while the hero travels the world map (its wild_mode). */
const NOT_ON_WORLD_MAP = new Set(['o', 'c', 'B', 'j', 'T', 'y', 'Y', 'Z', 'P', 'p', 'm', 'U', 'M', '*', 'x', 'O', 'h', 'r', 'u', 'a', 'z', 'A', 'q', 'v', 'f', 'w', 't', 'd', '\u0006']);

/*
 * The hero's own commands while they control another creature
 * (process_command's p_ptr->control): tome2 ignores these, or gives them to
 * the creature (`m` its powers, `d` and `,` its pack; also `i` and the
 * walking keys, which the app never sends for the hero).
 */
const NOT_WHILE_CONTROLLING = new Set(['w', 't', 'd', 'k', 'e', '+', 'T', '.', ',', 'g', 'R', '_', '<', '>', 'o', 'c', 'y', 'Y', 'j', 'B', 'G', 'N', 'b', 'm', 'p', 'P', 'h', 'K', 'Z', '{', '}', 'A', 'E', 'F', 'f', 'v', 'a', 'z', 'q', 'H', 'r', 'u', 'U', 'O', '*', 'x']);

export const CONTROLLING = 'Not while you control another creature.';

/** Where the hero is and what holds them, for the commands tome2 will take. */
interface CommandSituation {
  worldMap: boolean;
  /** The hero controls another creature. */
  controlling: boolean;
}

/** Why tome2 will not take one of the hero's commands now, or null. */
export function commandRefusal(command: string, situation: CommandSituation): string | null {
  if (situation.controlling && NOT_WHILE_CONTROLLING.has(command)) return CONTROLLING;
  return situation.worldMap && NOT_ON_WORLD_MAP.has(command) ? 'Not on the world map.' : null;
}

/** Lets go of the creature the hero controls, for now (tome2's abandon, not for good: control comes back with Fire Golem cast again, a load or a return to its level). */
export function* releaseMacro(): Macro {
  let s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes('m')];
  if (/abandon the creature/.test(s.prompt)) s = yield keyCodes('y');
  if (/permanently/.test(s.prompt)) yield keyCodes('n');
}

/** The powers of the creature the hero controls, listed. */
export function* creaturePowersMacro(): Macro {
  let s: MacroScreen = yield [KEY_BACKSLASH, ...keyCodes('m')];
  if (/abandon the creature/.test(s.prompt)) s = yield keyCodes('n');
  if (/Use which power/.test(s.prompt)) yield keyCodes('*');
}

/**
 * Every command the More sheet can offer, by what the player means to do.
 * Items are also used from their cards (Items); Character, Knowledge,
 * Messages and saving are in the Menu.
 */
const COMMAND_GROUPS: { title: string; commands: CommandEntry[] }[] = [
  {
    title: 'Get around',
    commands: [
      { label: 'Explore', icon: '⇢', command: '', native: 'explore', refuse: (c) => (c.controlling ? CONTROLLING : null) },
      { label: 'Rest', icon: '☾', command: 'R', native: 'rest', refuse: (c) => restRefusal(c.feat) },
      { label: 'Look', icon: '◉', command: 'l', native: 'look' },
      { label: 'Level map', icon: '▦', command: 'M', native: 'overview' },
      { label: 'Go down', icon: '>', command: '>' },
      { label: 'Go up', icon: '<', command: '<' },
      { label: 'Drink from fountain', icon: '⌂', command: 'H', refuse: (c) => (/fountain/.test(c.underfoot) ? null : 'There is no fountain here.') },
      { label: 'Sacrifice at altar', icon: '0', command: 'O', refuse: (c) => (/altar/.test(c.underfoot) ? null : 'There is no altar here.') },
      { label: 'Engrave a rune', icon: 'ᚱ', command: 'x', when: (c) => c.runes },
    ],
  },
  {
    title: 'Fight and magic',
    commands: [
      { label: 'Magic', icon: '✦', command: 'm', native: 'magic', refuse: (c) => (c.magic ? null : 'You know no magic yet.') },
      { label: 'Powers', icon: '❂', command: 'U', native: 'powers', refuse: (c) => (c.powers ? null : 'You have no powers yet.') },
      { label: 'Fire', icon: '➶', command: 'f' },
      { label: 'Throw', icon: '↗', command: 'v' },
      { label: 'Choose target', icon: '◎', command: '*' },
      { label: 'Pray', icon: '☼', command: 'p', when: (c) => c.pray === 1 },
      { label: 'Stop praying', icon: '☼', command: 'p', when: (c) => c.pray === 2 },
    ],
  },
  {
    title: 'Use an item',
    commands: [
      { label: 'Drink potion', icon: '!', command: 'q' },
      { label: 'Read scroll', icon: '?', command: 'r' },
      { label: 'Eat', icon: '◓', command: 'E' },
      { label: 'Aim wand', icon: '-', command: 'a' },
      { label: 'Use staff', icon: '_', command: 'u' },
      { label: 'Zap rod', icon: '⌁', command: 'z' },
      { label: 'Activate', icon: '✧', command: 'A' },
      { label: 'Refuel light', icon: '~', command: 'F' },
    ],
  },
  {
    title: 'People and creatures',
    commands: [
      { label: 'Release creature', icon: '↺', command: 'm', native: 'release', creature: true },
      { label: 'Creature powers', icon: '❂', command: 'm', native: 'creaturePowers', creature: true },
      { label: 'Creature’s pack', icon: '≡', command: 'i', reading: true, creature: true },
      { label: 'Creature picks up', icon: '⇡', command: ',', creature: true },
      { label: 'Creature drops all', icon: '⇣', command: 'd', creature: true },
      { label: 'Talk', icon: '❝', command: 'Y', refuse: beside },
      { label: 'Give', icon: '⇄', command: 'y', refuse: beside },
      { label: 'Steal', icon: '☚', command: 'Z', refuse: beside, when: (c) => c.steals },
      { label: 'Command allies', icon: '♥', command: 'P' },
    ],
  },
  {
    title: 'Doors and walls',
    commands: [
      { label: 'Open', icon: '⊐', command: 'o' },
      { label: 'Close', icon: '⊏', command: 'c' },
      { label: 'Bash door', icon: '+', command: 'B' },
      { label: 'Jam door', icon: '⊣', command: 'j' },
      { label: 'Tunnel', icon: '#', command: 'T' },
    ],
  },
  {
    title: 'Journal',
    commands: [
      { label: 'Level feeling', icon: '≈', command: '\u0006' },
      { label: 'Time of day', icon: '◷', command: '\u0014' },
      { label: 'Add a note', icon: '✎', command: ':' },
    ],
  },
];

/** tome2's own option screens, offered with the keys at the foot of the More sheet. */
export const GAME_OPTIONS: CommandDef = { label: 'Game options', icon: '=', command: '=', reading: true };

const WORLD_MAP: CommandDef = { label: 'World map', icon: '⇱', command: '<' };
const WALK_HERE: CommandDef = { label: 'Walk here', icon: '⇲', command: '>' };

/** A stairs command named for where the player is: the land's way up is the world map, and the world map's way down is Walk here. */
function stairs(c: CommandDef, where: Surroundings): CommandDef[] {
  if (where === 'dungeon' || c.native) return [c];
  if (c.command === '<') return where === 'land' ? [WORLD_MAP] : [];
  if (c.command === '>') return where === 'worldMap' ? [WALK_HERE] : [c];
  return [c];
}

/** The More sheet's groups for the hero: the commands open to them, dimmed with a reason when they cannot be done here and now. */
export function commandGroups(ctx: CommandContext): { title: string; commands: CommandDef[] }[] {
  return COMMAND_GROUPS.map((group) => ({
    title: group.title,
    commands: group.commands
      .filter((c) => (c.creature ? ctx.controlling : !c.when || c.when(ctx)))
      .map(({ when: _when, refuse, creature, ...c }): CommandDef => {
        const situation = { worldMap: ctx.where === 'worldMap' && !c.native, controlling: ctx.controlling && !creature };
        const why = commandRefusal(c.command, situation) || refuse?.(ctx);
        return why ? { ...c, unavailable: why } : c;
      })
      .flatMap((c) => stairs(c, ctx.where)),
  }));
}

/** What Explore does next: explore the level, go to the way on, take the way on underfoot, leave the land for the world map, or nothing. */
export type ExploreNext = 'explore' | 'down' | 'up' | 'here' | 'worldMap' | 'none';

/** How fast exploring and travel walk on screen. */
export type ExplorePace = 'normal' | 'relaxed';

/** One of the hero's own buttons, with why it cannot be done now (it stays in place either way). */
export interface Slot {
  label?: string;
  unavailable?: string | null;
}

export interface ActionContext {
  mode: 'title' | 'screen' | 'map' | 'overlay';
  prompt: PromptKind;
  /** Text of the prompt line, for item prompts that offer other lists. */
  promptText?: string;
  /** Native look mode is on. */
  looking?: boolean;
  /** The whole-level map is showing. */
  overview?: boolean;
  /** The panel shows tappable choices or switches, so no cursor buttons are needed. */
  listShown?: boolean;
  /** A native card is answering the current question. */
  cardShown?: boolean;
  /** The hero has died; their sheet can still be looked at. */
  fallen?: boolean;
  /** Which special tome2 screen is open. */
  screen?: 'options' | 'file' | 'gameover' | null;
  atCommand: boolean;
  /** Name of the terrain under the player, lower case. */
  underfoot: string;
  /** tome2's feature index of the terrain under the player. */
  feat?: number;
  floorObjects: number;
  alwaysPickup: boolean;
  /** On the world map, travelling between places. */
  worldMap?: boolean;
  /** Exploring is under way, at this pace. */
  exploring?: ExplorePace | null;
  /** What Explore would do. */
  exploreNext?: ExploreNext;
  /** Gear the hero needs to go on: a light below the town, a weapon for a fighter, food when hungry. */
  gear?: 'weapon' | 'light' | 'eat' | null;
  /** The hero stands at a building's door: the button that goes in ('Enter shop', 'Enter home'…). */
  entrance?: string | null;
  /** Direction digit of the weakest hostile creature next to the player. */
  foe?: string | null;
  /** A neutral creature stands next to the player (someone to talk to). */
  talk?: boolean;
  /** The hero controls another creature: walking moves it, and the hero's own actions wait. */
  controlling?: boolean;
  /** The hero's one-tap repeat: their last (or first) spell or power, or the last aimed thing they used. */
  quick?: Slot | null;
  /** Label for the magic button ('Powers' without spell books), or null when the hero has no magic or powers to use. */
  magic?: string | null;
  /** A launcher is wielded. */
  fire?: Slot | null;
}

/* More buttons than this crowd a phone's toolbar. */
const MAX_MAP_ACTIONS = 7;
/* The hero's buttons that give way, in order, when the toolbar is full; both are also under More. */
const OVERFLOW_ORDER = ['rest', 'fire'];
/* The hero's buttons that act for the hero, by the tome2 command each stands for (the quick repeat's is a spell's). */
const HERO_ACTS: Readonly<Record<string, string>> = { recast: 'm', cast: 'm', fire: 'f', rest: 'R' };

const FALLEN: Action = { id: 'fallen', label: 'Your hero', icon: '@', effect: { kind: 'native', view: 'fallen' } };
const KEYBOARD: Action = { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } };
const MENU: Action = { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } };
const COMMANDS: Action = { id: 'commands', label: 'More', icon: '⋯', effect: { kind: 'commands' } };
const ESCAPE: Action = { id: 'escape', label: 'Back', icon: '‹', effect: { kind: 'keys', keys: [27] } };
const CANCEL: Action = { id: 'escape', label: 'Cancel', icon: '✕', effect: { kind: 'keys', keys: [27] } };
const STOP: Action = { id: 'stop', label: 'Stop', icon: '■', effect: { kind: 'keys', keys: [27] }, primary: true };
const HALT: Action = { id: 'stop', label: 'Stop', icon: '■', effect: { kind: 'native', view: 'halt' }, primary: true };
const ENTER: Action = { id: 'enter', label: 'Enter', icon: '⏎', effect: { kind: 'keys', keys: [13] } };
const UP: Action = { id: 'up', label: 'Up', icon: '▲', effect: { kind: 'nav', direction: 'up' } };
const DOWN: Action = { id: 'down', label: 'Down', icon: '▼', effect: { kind: 'nav', direction: 'down' } };

function command(id: string, label: string, icon: string, def: Pick<CommandDef, 'command'>, primary = false): Action {
  return { id, label, icon, effect: { kind: 'keys', keys: commandKeys(def) }, primary };
}

/** The Speed button shown while exploring: it switches between the paces, its icon showing the one walked at. */
export function speedAction(pace: ExplorePace): Action {
  return {
    id: 'pace',
    label: 'Speed',
    icon: pace === 'relaxed' ? '›' : '»',
    detail: pace === 'relaxed' ? 'Relaxed pace' : 'Normal pace',
    effect: { kind: 'native', view: 'pace' },
    continues: true,
  };
}

/** A way to somewhere else from the terrain underfoot: its button and the command that takes it. */
interface Transition {
  id: 'descend' | 'ascend' | 'enter' | 'leave' | 'rift';
  label: string;
  icon: string;
  command: '>' | '<';
}

const TRANSITIONS: readonly [RegExp, Transition][] = [
  [/void jumpgate/, { id: 'rift', label: 'Enter rift', icon: '◌', command: '>' }],
  [/quest entrance/, { id: 'enter', label: 'Enter', icon: '>', command: '>' }],
  [/quest exit/, { id: 'leave', label: 'Leave', icon: '<', command: '<' }],
  [/down staircase|shaft down|quest down|town exit|path to the next/, { id: 'descend', label: 'Descend', icon: '>', command: '>' }],
  [/up staircase|shaft up|quest up|path to the previous/, { id: 'ascend', label: 'Ascend', icon: '<', command: '<' }],
];

/** The way on (or back) under the hero, if the terrain is one. */
export function transitionUnderfoot(underfoot: string): Transition | null {
  return TRANSITIONS.find(([pattern]) => pattern.test(underfoot))?.[1] ?? null;
}

const GEAR_ACTIONS: Readonly<Record<'weapon' | 'light' | 'eat', [string, string]>> = {
  weapon: ['Wield', '†'],
  light: ['Light', '☀'],
  eat: ['Eat', '◓'],
};

const EXPLORE_LABELS: Readonly<Record<ExploreNext, [string, string]>> = {
  explore: ['Explore', '⇢'],
  none: ['Explore', '⇢'],
  here: ['Explore', '⇢'],
  down: ['Way down', '↓'],
  up: ['Way up', '↑'],
  worldMap: ['World map', '⇱'],
};

/**
 * The toolbar's one changing button, the first of these that applies: the
 * world map's Walk here; Release the creature the hero controls; the way on
 * underfoot (a staircase is always what it does); the door of a shop or
 * other building underfoot; Attack a foe alongside; what lies underfoot to
 * pick up or use; gear the hero needs to go on; Talk to someone alongside;
 * and Explore, named for what it will do.
 */
export function contextualAction(ctx: ActionContext): Action {
  if (ctx.worldMap) return command('walkhere', WALK_HERE.label, WALK_HERE.icon, WALK_HERE, true);
  if (ctx.controlling) return { id: 'release', label: 'Release', icon: '↺', effect: { kind: 'native', view: 'release' }, primary: true };
  const transition = transitionUnderfoot(ctx.underfoot);
  if (transition) return command(transition.id, transition.label, transition.icon, { command: transition.command }, true);
  if (ctx.entrance) return command('shop', ctx.entrance, '⌂', { command: '_' }, true);
  if (ctx.foe) return { id: 'attack', label: 'Attack', icon: '⚔', effect: { kind: 'keys', keys: [92, 59, ctx.foe.charCodeAt(0)] }, primary: true };
  if (ctx.floorObjects > 0) return command('pickup', 'Pick up', '⇡', { command: pickupCommand(ctx.alwaysPickup) }, true);
  if (/fountain/.test(ctx.underfoot)) return command('drink', 'Drink', '⌂', { command: 'H' }, true);
  if (/altar/.test(ctx.underfoot)) return command('sacrifice', 'Sacrifice', '0', { command: 'O' }, true);
  if (ctx.gear) {
    const [label, icon] = GEAR_ACTIONS[ctx.gear];
    return { id: 'equip', label, icon, effect: { kind: 'native', view: 'equip' }, primary: true };
  }
  if (ctx.talk) return { id: 'talk', label: 'Talk', icon: '❝', effect: { kind: 'native', view: 'talk' }, primary: true };
  const [label, icon] = EXPLORE_LABELS[ctx.exploreNext ?? 'explore'];
  return { id: 'explore', label, icon, effect: { kind: 'native', view: 'explore' }, primary: true };
}

function unavailable(why: string | null | undefined): Pick<Action, 'unavailable'> {
  return why ? { unavailable: why } : {};
}

function slotAction(id: string, slot: Slot, label: string, icon: string, effect: ActionEffect): Action {
  return { id, label: slot.label ?? label, icon, effect, ...unavailable(slot.unavailable) };
}

/** The hero's own buttons, which keep their places: quick repeat, magic, Fire, Items, Rest, More and Menu. */
function heroActions(ctx: ActionContext): Action[] {
  const actions: Action[] = [
    ...(ctx.quick ? [slotAction('recast', ctx.quick, 'Again', '✺', { kind: 'native', view: 'recast' })] : []),
    ...(ctx.magic ? [{ id: 'cast', label: ctx.magic, icon: '✦', effect: { kind: 'native', view: ctx.magic === 'Powers' ? 'powers' : 'magic' } } as Action] : []),
    ...(ctx.fire ? [slotAction('fire', ctx.fire, 'Fire', '➶', { kind: 'native', view: 'fire' })] : []),
    { id: 'inventory', label: 'Items', icon: '≡', effect: { kind: 'native', view: 'inventory' } },
    { id: 'rest', label: 'Rest', icon: '☾', effect: { kind: 'native', view: 'rest' }, ...unavailable(restRefusal(ctx.feat)) },
    COMMANDS,
    MENU,
  ];
  for (const action of actions) {
    const why = action.id in HERO_ACTS ? commandRefusal(HERO_ACTS[action.id], { worldMap: false, controlling: !!ctx.controlling }) : null;
    if (why) action.unavailable = why;
  }
  for (const id of OVERFLOW_ORDER) {
    if (actions.length < MAX_MAP_ACTIONS) break;
    const index = actions.findIndex((a) => a.id === id);
    if (index >= 0) actions.splice(index, 1);
  }
  return actions;
}

/**
 * Buttons for the action bar, chosen from what tome2 is waiting for.
 */
export function contextActions(ctx: ActionContext): Action[] {
  if (ctx.overview && ctx.mode === 'map') {
    return [{ id: 'overviewdone', label: 'Close map', icon: '✕', effect: { kind: 'native', view: 'overviewDone' }, primary: true }];
  }
  if (ctx.looking && ctx.mode === 'map') {
    return [{ id: 'lookdone', label: 'Done looking', icon: '✓', effect: { kind: 'native', view: 'lookDone' }, primary: true }];
  }

  if (ctx.cardShown) return [MENU];

  switch (ctx.prompt) {
    case 'more':
      return [
        { id: 'continue', label: 'Continue', icon: '▸', effect: { kind: 'keys', keys: [32] }, primary: true },
        { id: 'skip', label: 'Skip all', icon: '»', effect: { kind: 'keys', keys: [27] } },
        MENU,
      ];
    case 'yesno':
      return [
        { id: 'yes', label: 'Yes', icon: '✔', effect: { kind: 'keys', keys: text('y') }, primary: true },
        { id: 'no', label: 'No', icon: '✘', effect: { kind: 'keys', keys: text('n') } },
        MENU,
      ];
    case 'aim':
      return [
        { id: 'nearest', label: 'Nearest', icon: '◎', effect: { kind: 'keys', keys: text('*t') }, primary: true },
        CANCEL,
        MENU,
      ];
    case 'direction':
      return [CANCEL, MENU];
    case 'item':
      return [CANCEL, MENU];
    default:
      break;
  }

  /* Files are read by scrolling; the panel's close button leaves them, as Done does on a full screen. */
  if (ctx.screen === 'file') return [{ id: 'escape', label: 'Done', icon: '✓', effect: { kind: 'native', view: 'closeFile' } }, MENU];
  if (ctx.screen === 'gameover') {
    return [
      ...(ctx.fallen ? [FALLEN] : []),
      { id: 'finish', label: 'Continue', icon: '›', effect: { kind: 'native', view: 'finish' }, primary: true },
    ];
  }
  if (ctx.screen === 'options') {
    return [{ id: 'done', label: 'Done', icon: '✓', effect: { kind: 'keys', keys: [27] }, primary: true }, MENU];
  }

  /* Exploring keeps its buttons between steps too, while tome2 is busy with the last one. */
  if (ctx.mode === 'map' && ctx.exploring) return [HALT, speedAction(ctx.exploring), MENU];
  if (ctx.mode === 'map' && ctx.atCommand) return [contextualAction(ctx), ...heroActions(ctx)];

  if (ctx.mode === 'overlay' || ctx.mode === 'screen') return ctx.listShown ? [ESCAPE, MENU] : [ESCAPE, UP, DOWN, MENU];

  /* Resting, running or repeating a command on the map. */
  if (ctx.mode === 'map' && ctx.prompt === 'none') return [STOP, MENU];

  return [ESCAPE, ENTER, KEYBOARD, MENU];
}
