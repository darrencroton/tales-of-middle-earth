import { KEY_BACKSLASH, keyCodes } from '../input/keys.ts';
import type { PromptKind } from './prompts.ts';

export type NativeView =
  | 'inventory'
  | 'equipment'
  | 'look'
  | 'lookDone'
  | 'character'
  | 'skills'
  | 'abilities'
  | 'magic'
  | 'recast'
  | 'fire'
  | 'knowledge'
  | 'history'
  | 'overview'
  | 'overviewDone'
  | 'finish'
  | 'fallen'
  | 'explore'
  | 'equip'
  | 'halt'
  | 'pace'
  | 'closeFile';

export type ActionEffect =
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
}

export interface CommandDef {
  label: string;
  icon: string;
  /** Underlying original-keyset command, sent after '\' so keymaps cannot interfere. */
  command: string;
  /** Extra keys sent after the command (e.g. rest duration). */
  then?: string;
  /** Pick-up command, whose key depends on the always_pickup option. */
  pickup?: boolean;
  /** Opens a native view instead of sending the command. */
  native?: NativeView;
  /** Shows a tome2 screen to read; the Commands sheet reopens when it closes. */
  reading?: boolean;
}

/** tome2 picks up with 'g' normally and with ',' when always_pickup is on. */
export function pickupCommand(alwaysPickup: boolean): string {
  return alwaysPickup ? ',' : 'g';
}

/** Stays still for a turn without picking anything up: the other key of the pair. */
export function waitCommand(alwaysPickup: boolean): string {
  return alwaysPickup ? 'g' : ',';
}

export function commandKeys(def: Pick<CommandDef, 'command' | 'then' | 'pickup'>, alwaysPickup = false): number[] {
  const command = def.pickup ? pickupCommand(alwaysPickup) : def.command;
  return [KEY_BACKSLASH, ...keyCodes(command), ...keyCodes(def.then ?? '')];
}

const text = keyCodes;

export const COMMAND_GROUPS: { title: string; commands: CommandDef[] }[] = [
  {
    title: 'Items',
    commands: [
      { label: 'Inventory', icon: '≡', command: 'i', native: 'inventory' },
      { label: 'Equipment', icon: '[', command: 'e', native: 'equipment' },
      { label: 'Wear / wield', icon: '|', command: 'w' },
      { label: 'Take off', icon: '⤴', command: 't' },
      { label: 'Pick up', icon: '⇡', command: 'g', pickup: true },
      { label: 'Drop', icon: '⇣', command: 'd' },
      { label: 'Quaff', icon: '!', command: 'q' },
      { label: 'Read', icon: '?', command: 'r' },
      { label: 'Eat', icon: ',', command: 'E' },
      { label: 'Refuel light', icon: '~', command: 'F' },
      { label: 'Inspect', icon: '⌕', command: 'I', reading: true },
      { label: 'Inscribe', icon: '✎', command: '{' },
      { label: 'Destroy', icon: '✖', command: 'k' },
    ],
  },
  {
    title: 'Combat & magic',
    commands: [
      { label: 'Fire', icon: '}', command: 'f' },
      { label: 'Throw', icon: '↗', command: 'v' },
      { label: 'Magic & powers', icon: '✦', command: 'm', native: 'magic' },
      { label: 'Pray', icon: '☼', command: 'p' },
      { label: 'Aim wand', icon: '-', command: 'a' },
      { label: 'Use staff', icon: '_', command: 'u' },
      { label: 'Zap rod', icon: '⌁', command: 'z' },
      { label: 'Activate', icon: '✧', command: 'A' },
      { label: 'Bonus power', icon: '❂', command: 'U' },
      { label: 'Target', icon: '◎', command: '*' },
    ],
  },
  {
    title: 'Movement & world',
    commands: [
      { label: 'Explore', icon: '⇢', command: '', native: 'explore' },
      { label: 'Rest', icon: '☾', command: 'R', then: '&\r' },
      { label: 'Search', icon: '∴', command: 's' },
      { label: 'Open', icon: '⊐', command: 'o' },
      { label: 'Close', icon: '⊏', command: 'c' },
      { label: 'Bash door', icon: '+', command: 'B' },
      { label: 'Tunnel', icon: '#', command: 'T' },
      { label: 'Go down', icon: '>', command: '>' },
      { label: 'Go up', icon: '<', command: '<' },
      { label: 'Drink (fountain)', icon: '⌂', command: 'H' },
      { label: 'Sacrifice (altar)', icon: '0', command: 'O' },
    ],
  },
  {
    title: 'Knowledge',
    commands: [
      { label: 'Look', icon: '◉', command: 'l', native: 'look' },
      { label: 'Character', icon: '@', command: 'C', native: 'character' },
      { label: 'Skills', icon: '±', command: 'G', native: 'skills' },
      { label: 'Abilities', icon: '✪', command: 'N', native: 'abilities' },
      { label: 'Level map', icon: '▦', command: 'M', native: 'overview' },
      { label: 'Knowledge', icon: '¶', command: '~', native: 'knowledge' },
      { label: 'Messages', icon: '≣', command: '\u0010', native: 'history' },
      { label: 'Help', icon: '?', command: '?', reading: true },
    ],
  },
  {
    title: 'Game',
    commands: [
      { label: 'Save', icon: '⇩', command: '\u0013' },
      { label: 'Options', icon: '=', command: '=', reading: true },
    ],
  },
];

/** Where the player is: underground, walking the land (towns and wilderness), or on the world map. */
export type Surroundings = 'dungeon' | 'land' | 'worldMap';

const WORLD_MAP: CommandDef = { label: 'World map', icon: '⇱', command: '<' };
const WALK_HERE: CommandDef = { label: 'Walk here', icon: '⇲', command: '>' };

/** The command sheet's groups, with the stairs commands named for where the player is. */
export function commandGroups(where: Surroundings): { title: string; commands: CommandDef[] }[] {
  if (where === 'dungeon') return COMMAND_GROUPS;
  return COMMAND_GROUPS.map((group) => ({
    title: group.title,
    commands: group.commands.flatMap((c) => {
      if (c.command === '<' && !c.native) return where === 'land' ? [WORLD_MAP] : [];
      if (c.command === '>' && !c.native) return where === 'worldMap' ? [WALK_HERE] : [c];
      return [c];
    }),
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
  floorObjects: number;
  alwaysPickup: boolean;
  /** On the world map, travelling between places. */
  worldMap?: boolean;
  /** Exploring is under way, at this pace. */
  exploring?: ExplorePace | null;
  /** The hero stands where they arrived on this level (or landed after a jump) and has not stepped off. */
  arrived?: boolean;
  /** An awake hostile creature is in view. */
  danger?: boolean;
  /** What Explore would do. */
  exploreNext?: ExploreNext;
  /** Gear the hero needs to go on: a light below the town, a weapon for a fighter, food when hungry. */
  gear?: 'weapon' | 'light' | 'eat' | null;
  /** Direction digit of the weakest hostile creature next to the player. */
  foe?: string | null;
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

function command(id: string, label: string, icon: string, def: Pick<CommandDef, 'command' | 'then'>, primary = false): Action {
  return { id, label, icon, effect: { kind: 'keys', keys: commandKeys(def) }, primary };
}

/** The Speed button shown while exploring: it switches between the paces, its icon showing the one walked at. */
export function speedAction(pace: ExplorePace): Action {
  return {
    id: 'pace',
    label: 'Speed',
    icon: pace === 'relaxed' ? '›' : '»',
    effect: { kind: 'native', view: 'pace' },
    continues: true,
  };
}

/** A way to somewhere else from the terrain underfoot: its button and the command that takes it. */
export interface Transition {
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
 * world map's Walk here; the way on underfoot; Attack a foe alongside; the
 * way the hero arrived by, to get away from a foe in view; what lies
 * underfoot to pick up or use; gear the hero needs to go on; the way the
 * hero arrived by once Explore has nothing else to do; and Explore, named
 * for what it will do.
 */
export function contextualAction(ctx: ActionContext): Action {
  if (ctx.worldMap) return command('walkhere', WALK_HERE.label, WALK_HERE.icon, WALK_HERE, true);
  const next = ctx.exploreNext ?? 'explore';
  const transition = transitionUnderfoot(ctx.underfoot);
  const take = transition ? command(transition.id, transition.label, transition.icon, { command: transition.command }, true) : null;
  if (take && !ctx.arrived) return take;
  if (ctx.foe) return { id: 'attack', label: 'Attack', icon: '⚔', effect: { kind: 'keys', keys: [92, 59, ctx.foe.charCodeAt(0)] }, primary: true };
  if (take && ctx.danger) return take;
  if (ctx.floorObjects > 0) return command('pickup', 'Pick up', '⇡', { command: pickupCommand(ctx.alwaysPickup) }, true);
  if (/fountain/.test(ctx.underfoot)) return command('drink', 'Drink', '⌂', { command: 'H' }, true);
  if (/altar/.test(ctx.underfoot)) return command('sacrifice', 'Sacrifice', '0', { command: 'O' }, true);
  if (ctx.gear) {
    const [label, icon] = GEAR_ACTIONS[ctx.gear];
    return { id: 'equip', label, icon, effect: { kind: 'native', view: 'equip' }, primary: true };
  }
  if (take && (next === 'here' || next === 'none')) return take;
  const [label, icon] = EXPLORE_LABELS[next];
  return { id: 'explore', label, icon, effect: { kind: 'native', view: 'explore' }, primary: true };
}

function slotAction(id: string, slot: Slot, label: string, icon: string, effect: ActionEffect): Action {
  return { id, label: slot.label ?? label, icon, effect, ...(slot.unavailable ? { unavailable: slot.unavailable } : {}) };
}

/** The hero's own buttons, which keep their places: quick repeat, magic, Fire, Items, Rest, More and Menu. */
function heroActions(ctx: ActionContext): Action[] {
  const actions: Action[] = [
    ...(ctx.quick ? [slotAction('recast', ctx.quick, 'Again', '✺', { kind: 'native', view: 'recast' })] : []),
    ...(ctx.magic ? [{ id: 'cast', label: ctx.magic, icon: '✦', effect: { kind: 'native', view: 'magic' } } as Action] : []),
    ...(ctx.fire ? [slotAction('fire', ctx.fire, 'Fire', '➶', { kind: 'native', view: 'fire' })] : []),
    { id: 'inventory', label: 'Items', icon: '≡', effect: { kind: 'native', view: 'inventory' } },
    command('rest', 'Rest', '☾', { command: 'R', then: '&\r' }),
    COMMANDS,
    MENU,
  ];
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
