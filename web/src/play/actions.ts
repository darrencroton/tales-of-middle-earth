import type { PromptKind } from './prompts.ts';

export type ActionEffect =
  | { kind: 'keys'; keys: number[] }
  | { kind: 'keyboard' }
  | { kind: 'menu' }
  | { kind: 'commands' }
  | { kind: 'ctrl' };

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
}

const BACKSLASH = 92;

export function commandKeys(def: Pick<CommandDef, 'command' | 'then'>): number[] {
  const keys = [BACKSLASH, ...[...def.command].map((c) => c.charCodeAt(0))];
  if (def.then) keys.push(...[...def.then].map((c) => c.charCodeAt(0)));
  return keys;
}

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const COMMAND_GROUPS: { title: string; commands: CommandDef[] }[] = [
  {
    title: 'Items',
    commands: [
      { label: 'Inventory', icon: '≡', command: 'i' },
      { label: 'Equipment', icon: '[', command: 'e' },
      { label: 'Wear / wield', icon: '|', command: 'w' },
      { label: 'Take off', icon: '⤴', command: 't' },
      { label: 'Pick up', icon: '⇡', command: 'g' },
      { label: 'Drop', icon: '⇣', command: 'd' },
      { label: 'Quaff', icon: '!', command: 'q' },
      { label: 'Read', icon: '?', command: 'r' },
      { label: 'Eat', icon: ',', command: 'E' },
      { label: 'Refuel light', icon: '~', command: 'F' },
      { label: 'Inspect', icon: '⌕', command: 'I' },
      { label: 'Inscribe', icon: '✎', command: '{' },
      { label: 'Destroy', icon: '✖', command: 'k' },
    ],
  },
  {
    title: 'Combat & magic',
    commands: [
      { label: 'Fire', icon: '}', command: 'f' },
      { label: 'Throw', icon: '↗', command: 'v' },
      { label: 'Cast / power', icon: '✦', command: 'm' },
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
      { label: 'Look', icon: '◉', command: 'l' },
      { label: 'Character', icon: '@', command: 'C' },
      { label: 'Skills', icon: '±', command: 'G' },
      { label: 'Abilities', icon: '✪', command: 'N' },
      { label: 'Full map', icon: '▦', command: 'M' },
      { label: 'Knowledge', icon: '¶', command: '~' },
      { label: 'Messages', icon: '≣', command: '\u0010' },
      { label: 'Help', icon: '?', command: '?' },
    ],
  },
  {
    title: 'Game',
    commands: [
      { label: 'Save', icon: '⇩', command: '\u0013' },
      { label: 'Options', icon: '=', command: '=' },
    ],
  },
];

export interface ActionContext {
  mode: 'title' | 'map' | 'overlay';
  prompt: PromptKind;
  atCommand: boolean;
  /** Name of the terrain under the player, lower case. */
  underfoot: string;
  floorObjects: number;
}

const KEYBOARD: Action = { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } };
const MENU: Action = { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } };
const ESCAPE: Action = { id: 'escape', label: 'Esc', icon: '⎋', effect: { kind: 'keys', keys: [27] } };
const ENTER: Action = { id: 'enter', label: 'Enter', icon: '⏎', effect: { kind: 'keys', keys: [13] } };

function command(id: string, label: string, icon: string, def: Pick<CommandDef, 'command' | 'then'>, primary = false): Action {
  return { id, label, icon, effect: { kind: 'keys', keys: commandKeys(def) }, primary };
}

/** Situational actions for the terrain and items under the player. */
export function situationalActions(underfoot: string, floorObjects: number): Action[] {
  const actions: Action[] = [];
  if (floorObjects > 0) actions.push(command('pickup', 'Pick up', '⇡', { command: 'g' }, true));
  if (/down staircase|shaft down|quest down|quest entrance|town exit|path to the next/.test(underfoot)) {
    actions.push(command('descend', 'Descend', '>', { command: '>' }, true));
  }
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
        KEYBOARD,
        MENU,
      ];
    case 'aim':
      return [
        { id: 'nearest', label: 'Nearest', icon: '◎', effect: { kind: 'keys', keys: text('*t') }, primary: true },
        { id: 'target', label: 'Target', icon: '⌖', effect: { kind: 'keys', keys: text('5') } },
        ESCAPE,
        MENU,
      ];
    case 'direction':
      return [ESCAPE, KEYBOARD, MENU];
    case 'item':
      return [ESCAPE, { id: 'floor', label: 'Floor', icon: '⤓', effect: { kind: 'keys', keys: text('-') } }, KEYBOARD, MENU];
    default:
      break;
  }

  if (ctx.mode === 'map' && ctx.atCommand) {
    return [
      ...situationalActions(ctx.underfoot, ctx.floorObjects),
      command('inventory', 'Items', '≡', { command: 'i' }),
      command('rest', 'Rest', '☾', { command: 'R', then: '&\r' }),
      command('cast', 'Cast', '✦', { command: 'm' }),
      command('look', 'Look', '◉', { command: 'l' }),
      { id: 'commands', label: 'More', icon: '⋯', effect: { kind: 'commands' } },
      MENU,
    ];
  }

  return [ESCAPE, ENTER, KEYBOARD, MENU];
}
