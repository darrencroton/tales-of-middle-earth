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
  /** Something worth using from the pack. */
  gear?: 'weapon' | 'light' | 'heal' | 'eat' | null;
  /** Direction digit of the weakest hostile creature next to the player. */
  foe?: string | null;
  /** A hostile creature is in view. */
  foeInView?: boolean;
  /** Name of what to offer again: a magic user's last spell or power, or another hero's last aimed action while a foe is in view. */
  recast?: string | null;
  /** A launcher and ammunition are ready. */
  canFire?: boolean;
  /** 'Way down' or 'Way up' when exploring has nothing left but the way on. */
  wayOn?: string | null;
  /** Label for the magic button ('Powers' without spell books), or null when the hero has no magic or powers or does not use them. */
  magic?: string | null;
}

/* More buttons than this crowd a phone's toolbar. */
const MAX_MAP_ACTIONS = 7;
/* Buttons that give way, in order, when the toolbar is full; all are also under More. */
const OVERFLOW_ORDER = ['look', 'rest', 'explore', 'fire', 'recast', 'cast'];

const FALLEN: Action = { id: 'fallen', label: 'Your hero', icon: '@', effect: { kind: 'native', view: 'fallen' } };
const KEYBOARD: Action = { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } };
const MENU: Action = { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } };
const ESCAPE: Action = { id: 'escape', label: 'Back', icon: '‹', effect: { kind: 'keys', keys: [27] } };
const CANCEL: Action = { id: 'escape', label: 'Cancel', icon: '✕', effect: { kind: 'keys', keys: [27] } };
const STOP: Action = { id: 'stop', label: 'Stop', icon: '■', effect: { kind: 'keys', keys: [27] }, primary: true };
const ENTER: Action = { id: 'enter', label: 'Enter', icon: '⏎', effect: { kind: 'keys', keys: [13] } };
const UP: Action = { id: 'up', label: 'Up', icon: '▲', effect: { kind: 'nav', direction: 'up' } };
const DOWN: Action = { id: 'down', label: 'Down', icon: '▼', effect: { kind: 'nav', direction: 'down' } };

function command(id: string, label: string, icon: string, def: Pick<CommandDef, 'command' | 'then'>, primary = false): Action {
  return { id, label, icon, effect: { kind: 'keys', keys: commandKeys(def) }, primary };
}

const GEAR_ACTIONS: Readonly<Record<'weapon' | 'light' | 'heal' | 'eat', [string, string]>> = {
  weapon: ['Wield', '†'],
  light: ['Light', '☀'],
  heal: ['Heal', '✚'],
  eat: ['Eat', '◓'],
};

function gearAction(kind: keyof typeof GEAR_ACTIONS): Action {
  const [label, icon] = GEAR_ACTIONS[kind];
  return { id: 'equip', label, icon, effect: { kind: 'native', view: 'equip' }, primary: true };
}

/** Situational actions for the terrain and items under the player. */
export function situationalActions(underfoot: string, floorObjects: number, alwaysPickup = false): Action[] {
  const actions: Action[] = [];
  if (floorObjects > 0) actions.push(command('pickup', 'Pick up', '⇡', { command: pickupCommand(alwaysPickup) }, true));
  if (/down staircase|shaft down|quest down|quest entrance|town exit|path to the next/.test(underfoot)) {
    actions.push(command('descend', 'Descend', '>', { command: '>' }, true));
  }
  if (/void jumpgate/.test(underfoot)) actions.push(command('rift', 'Enter rift', '◌', { command: '>' }, true));
  if (/up staircase|shaft up|quest up|quest exit|path to the previous/.test(underfoot)) {
    actions.push(command('ascend', 'Ascend', '<', { command: '<' }, true));
  }
  if (/fountain/.test(underfoot)) actions.push(command('drink', 'Drink', '⌂', { command: 'H' }));
  if (/altar/.test(underfoot)) actions.push(command('sacrifice', 'Sacrifice', '0', { command: 'O' }));
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

  if (ctx.mode === 'map' && ctx.atCommand) {
    const situational = situationalActions(ctx.underfoot, ctx.floorObjects, ctx.alwaysPickup);
    const actions: Action[] = [
      ...(ctx.foe ? [{ id: 'attack', label: 'Attack', icon: '⚔', effect: { kind: 'keys', keys: [92, 59, ctx.foe.charCodeAt(0)] }, primary: true } as Action] : []),
      ...(ctx.recast
        ? [{ id: 'recast', label: ctx.recast, icon: '✺', effect: { kind: 'native', view: 'recast' }, primary: !ctx.foe && !!ctx.foeInView } as Action]
        : []),
      ...(ctx.foeInView && ctx.canFire
        ? [{ id: 'fire', label: 'Fire', icon: '➶', effect: { kind: 'native', view: 'fire' }, primary: !ctx.foe && !ctx.recast } as Action]
        : []),
      ...(ctx.gear ? [gearAction(ctx.gear)] : []),
      ...situational,
      ...(ctx.worldMap
        ? [command('walkhere', WALK_HERE.label, WALK_HERE.icon, WALK_HERE, true)]
        : [{ id: 'explore', label: ctx.wayOn ?? 'Explore', icon: ctx.wayOn === 'Way up' ? '↑' : ctx.wayOn ? '↓' : '⇢', effect: { kind: 'native', view: 'explore' } } as Action]),
      { id: 'inventory', label: 'Items', icon: '≡', effect: { kind: 'native', view: 'inventory' } },
      ...(ctx.foe ? [] : [command('rest', 'Rest', '☾', { command: 'R', then: '&\r' })]),
      ...(ctx.magic === null ? [] : [{ id: 'cast', label: ctx.magic ?? 'Cast', icon: '✦', effect: { kind: 'native', view: 'magic' } } as Action]),
      { id: 'look', label: 'Look', icon: '◉', effect: { kind: 'native', view: 'look' } },
      { id: 'commands', label: 'More', icon: '⋯', effect: { kind: 'commands' } },
      MENU,
    ];
    for (const id of OVERFLOW_ORDER) {
      if (actions.length <= MAX_MAP_ACTIONS) break;
      const index = actions.findIndex((a) => a.id === id);
      if (index >= 0) actions.splice(index, 1);
    }
    return actions;
  }

  if (ctx.mode === 'overlay' || ctx.mode === 'screen') return ctx.listShown ? [ESCAPE, MENU] : [ESCAPE, UP, DOWN, MENU];

  /* Resting, running or repeating a command on the map. */
  if (ctx.mode === 'map' && ctx.prompt === 'none') return [STOP, MENU];

  return [ESCAPE, ENTER, KEYBOARD, MENU];
}
