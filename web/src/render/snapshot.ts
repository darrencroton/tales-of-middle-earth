/* Cave info flags (tome2 defines.hpp). */
export const CAVE_MARK = 0x0001;
export const CAVE_GLOW = 0x0002;
export const CAVE_SEEN = 0x0010;
export const CAVE_PLIT = 0x2000;
export const CAVE_MLIT = 0x4000;

/* Layer byte (engine/snapshot.cc). */
export const LAYER_UNKNOWN = 0;
export const LAYER_TERRAIN = 1;
export const LAYER_OBJECT = 2;
export const LAYER_MONSTER = 3;
export const LAYER_PLAYER = 4;
export const LAYER_MASK = 0x7f;
export const LAYER_MULTI_HUED = 0x80;

export const NO_EFFECT = 0xff;

export const SNAPSHOT_VERSION = 3;

/* Header slot indices, matching HeaderSlot in engine/snapshot.cc. */
const H = {
  VERSION: 0,
  IN_DUNGEON: 1,
  ICKY: 2,
  WIDTH: 3,
  HEIGHT: 4,
  PY: 5,
  PX: 6,
  LIGHT_RADIUS: 7,
  DEPTH: 8,
  WILD_MODE: 9,
  BLIND: 10,
  HALLUCINATING: 11,
  PANEL_ROW: 12,
  PANEL_COL: 13,
  ROW_MAP: 14,
  COL_MAP: 15,
  PTR_FEAT: 16,
  PTR_INFO: 17,
  PTR_GLYPH: 18,
  PTR_ATTR: 19,
  PTR_LAYER: 20,
  PTR_EFFECT: 21,
  AT_COMMAND: 22,
  TURN: 23,
  FLOOR_OBJECTS: 24,
  HERO_ACTING: 25,
  COUNT: 26,
} as const;

export interface LevelSnapshot {
  inDungeon: boolean;
  icky: boolean;
  width: number;
  height: number;
  py: number;
  px: number;
  lightRadius: number;
  depth: number;
  wild: boolean;
  blind: boolean;
  hallucinating: boolean;
  panelRow: number;
  panelCol: number;
  rowMap: number;
  colMap: number;
  /** Engine is waiting for a command (not a prompt or menu). */
  atCommand: boolean;
  turn: number;
  floorObjects: number;
  /** The hero's own command is under way (before creatures act in the same turn). */
  heroActing: boolean;
  feat: Uint8Array;
  info: Uint16Array;
  glyph: Uint8Array;
  attr: Uint8Array;
  layer: Uint8Array;
  effect: Uint8Array;
}

export interface SnapshotMemory {
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
}

/**
 * Copies the engine snapshot out of WebAssembly memory. Copies stay valid
 * if the engine later grows its heap.
 */
export function readSnapshot(memory: SnapshotMemory, headerPtr: number): LevelSnapshot {
  const header = memory.HEAP32.subarray(headerPtr >> 2, (headerPtr >> 2) + H.COUNT);
  if (header[H.VERSION] !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version ${header[H.VERSION]}`);
  }
  const width = header[H.WIDTH];
  const height = header[H.HEIGHT];
  const n = width * height;
  const bytes = (p: number) => memory.HEAPU8.slice(p, p + n);

  return {
    inDungeon: header[H.IN_DUNGEON] !== 0,
    icky: header[H.ICKY] !== 0,
    width,
    height,
    py: header[H.PY],
    px: header[H.PX],
    lightRadius: header[H.LIGHT_RADIUS],
    depth: header[H.DEPTH],
    wild: header[H.WILD_MODE] !== 0,
    blind: header[H.BLIND] !== 0,
    hallucinating: header[H.HALLUCINATING] !== 0,
    panelRow: header[H.PANEL_ROW],
    panelCol: header[H.PANEL_COL],
    rowMap: header[H.ROW_MAP],
    colMap: header[H.COL_MAP],
    atCommand: header[H.AT_COMMAND] !== 0,
    turn: header[H.TURN],
    floorObjects: header[H.FLOOR_OBJECTS],
    heroActing: header[H.HERO_ACTING] !== 0,
    feat: bytes(header[H.PTR_FEAT]),
    info: memory.HEAPU16.slice(header[H.PTR_INFO] >> 1, (header[H.PTR_INFO] >> 1) + n),
    glyph: bytes(header[H.PTR_GLYPH]),
    attr: bytes(header[H.PTR_ATTR]),
    layer: bytes(header[H.PTR_LAYER]),
    effect: bytes(header[H.PTR_EFFECT]),
  };
}

export interface PlayerState {
  name: string;
  race: string;
  cls: string;
  title?: string;
  lev: number;
  exp: number;
  au: number;
  chp: number;
  mhp: number;
  csp: number;
  msp: number;
  csane: number;
  msane: number;
  speed: number;
  food: number;
  depth: number;
  dungeon: string;
  wild: number;
  /** 1 when the always_pickup option is on. */
  alwaysPickup: number;
  /** Skill points waiting to be spent. */
  skillPoints?: number;
  /** 1 once the hero has died. */
  dead?: number;
  /** What killed the hero. */
  diedFrom?: string;
  /** Name of the town or land walked on the surface (set by the frontend from the place). */
  area?: string;
  /** The surface area is a town (set by the frontend from the place). */
  inTown?: boolean;
  status: Record<string, number>;
}

/** One entry of the Hall of Fame (tome2's scores file). */
export interface ScoreEntry {
  name: string;
  race: string;
  cls: string;
  points: number;
  gold: number;
  turns: number;
  /** Date as tome2 writes it: mm/dd/yy. */
  day: string;
  level: number;
  maxLevel: number;
  depth: number;
  maxDepth: number;
  /** 1 when the hero died on a quest level. */
  quest: number;
  how: string;
}

export interface MonsterState {
  id: number;
  name: string;
  ch: number;
  attr: number;
  y: number;
  x: number;
  hp: number;
  maxhp: number;
  asleep: number;
  afraid: number;
  unique: number;
  status: number;
  /** In the hero's line of sight (not only sensed by telepathy or detection). */
  view?: number;
  /** A spell or missile can be aimed at it (in line of fire, as tome2's targeting needs). */
  target?: number;
  ridx?: number;
  ego?: number;
  level?: number;
}

/** tome2 monster status: below 0 attacks the player, 0 is neutral, above 0 fights for the player. */
export function isHostile(m: Pick<MonsterState, 'status'>): boolean {
  return m.status < 0;
}

export function isAlly(m: Pick<MonsterState, 'status'>): boolean {
  return m.status > 0;
}

export interface ObjectState {
  id: number;
  name: string;
  ch: number;
  attr: number;
  /** Money, which the hero takes up just by stepping on it. */
  gold?: number;
  y: number;
  x: number;
}

export interface MessageState {
  text: string;
  color: number;
}

/** The colour of our own messages in tome2's log (engine `NOTICE_COLOUR`): stop reasons, refusals, deeds. */
export const NOTICE_COLOUR = 16;

export function isNotice(m: Pick<MessageState, 'color'>): boolean {
  return m.color === NOTICE_COLOUR;
}

/**
 * tome2's messages that arrived between two states, newest first, leaving
 * out our own. A message that repeats the newest one is merged into it with
 * a count ("… (x2)") without raising the total, so a changed newest message
 * counts as one new message.
 */
export function newMessages(
  prev: Pick<GameState, 'messageTotal' | 'messages'>,
  next: Pick<GameState, 'messageTotal' | 'messages'>,
): MessageState[] {
  const messages = next.messages ?? [];
  let count = Math.min(messages.length, Math.max(0, (next.messageTotal ?? 0) - (prev.messageTotal ?? 0)));
  if (count === 0 && messages[0] && prev.messages?.[0] && messages[0].text !== prev.messages[0].text) count = 1;
  return messages.slice(0, count).filter((m) => !isNotice(m));
}

export interface GameState {
  ready: number;
  player?: PlayerState;
  monsters?: MonsterState[];
  objects?: ObjectState[];
  messageTotal?: number;
  messages?: MessageState[];
}

export interface ItemState {
  /** Inventory index (equipment from 24), or minus the floor object index. */
  i: number;
  name: string;
  tval: number;
  /** Sub-type within the tval: with it, identifies the kind of item whatever the stack size. */
  sval?: number;
  number: number;
  /** Weight of one item in tenths of a pound. */
  weight: number;
  ch: number;
  attr: number;
  wear: number;
  activate: number;
  /** Turns of light left, for a light that burns fuel. */
  fuel?: number;
  ins: string;
}

export interface EquipSlot extends Partial<ItemState> {
  i: number;
  empty?: number;
  /** Body part kind: the INVEN_* index of the slot group. */
  part: number;
}

export interface InventoryState {
  ready: number;
  weight: number;
  limit: number;
  pack: ItemState[];
  equip: EquipSlot[];
  floor: ItemState[];
}

/** One of a shop's (or the home's) commands: the key tome2 takes and what it does (`STORE_ACTION`). */
export interface StoreCommand {
  key: string;
  action: number;
  /** Gold it costs (a night's rest, an enchantment); 0 for most. */
  cost: number;
  /** The keeper will not do it for this hero. */
  closed: number;
  name: string;
}

/** tome2's building action codes (BACT_*) for trading. */
export const STORE_ACTION = { sell: 43, buy: 44, examine: 45, steal: 46 } as const;

/** An item on a shop's shelf (or in the home), by its place in the stock. */
export interface StockItem {
  i: number;
  name: string;
  tval: number;
  number: number;
  /** Weight of one, in tenths of a pound. */
  weight: number;
  ch: number;
  attr: number;
  /** Price of one; 0 in the home. */
  price: number;
}

/** Whether the shop takes something carried (by inventory index) and what it pays for one. */
export interface StoreOffer {
  i: number;
  /** Why it does not: not the kind of thing it deals in, worthless, or cursed (worn, or stuck to the hand). */
  why: '' | 'kind' | 'worthless' | 'cursed';
  price: number;
}

/** The shop or home on the hero's grid (`web_store_json`). */
export interface StoreState {
  here: number;
  name: string;
  /** The shopkeeper; empty in the home and in museums. */
  owner: string;
  home: number;
  museum: number;
  /** It buys something (shops of some kinds buy nothing at all). */
  buys: number;
  /** The no-selling birth option: shops pay nothing. */
  noSelling: number;
  gold: number;
  /** How many different items it can hold. */
  capacity: number;
  actions: StoreCommand[];
  stock: StockItem[];
  sell: StoreOffer[];
}

export interface StatState {
  name: string;
  use: string;
  top: string;
  drained: number;
}

export interface CharacterState {
  ready: number;
  stats: StatState[];
  god: string;
  exp: number;
  maxExp: number;
  nextExp: number;
  toHit: number;
  toDam: number;
  ac: number;
  toAc: number;
  blows: number;
  shots: number;
  infra: number;
  maxDepth: number;
  /** Skills with points in them; value and gain per point in thousandths, as tome2 shows them (12.345). */
  skills?: { name: string; value: number; mod?: number }[];
  abilities?: string[];
  turn: number;
}

/** One row of the skills screen's whole list; values in thousandths. */
export interface SkillEntry {
  name: string;
  depth: number;
  /** 0 without sub-skills, 1 closed, 2 open. */
  branch: number;
  value: number;
  mod: number;
  state: 'normal' | 'untrained' | 'learnable' | 'max';
  /** The Miscellaneous group, which cannot be raised itself. */
  misc: number;
  desc: string;
}

export interface SkillTable {
  ready: number;
  points: number;
  skills: SkillEntry[];
}

/** One row of the abilities screen's whole list. */
export interface AbilityEntry {
  name: string;
  cost: number;
  known: number;
  /** Every prerequisite is met (points aside). */
  met: number;
  learnable: number;
  desc: string;
  /** Prerequisites: skills with levels, abilities, stats. */
  needs: string[];
}

export interface AbilityTable {
  ready: number;
  points: number;
  abilities: AbilityEntry[];
}

/** A skill adjustment from a race, race modifier, class or specialisation; values in thousandths. */
export interface BirthSkill {
  name: string;
  /** '+', '-', '=' (set to) or '%' (percent). */
  op: string;
  base: number;
  modOp: string;
  mod: number;
}

export interface BirthAbility {
  name: string;
  desc: string;
  level: number;
}

/** Object flags (tome2 edit-file names) gained at a character level. */
export interface BirthLevelFlags {
  level: number;
  pval: number;
  flags: string[];
}

export interface BirthEntry {
  index: number;
  title: string;
  desc: string;
  /** STR, INT, WIS, DEX, CON, CHR adjustments. */
  stats?: number[];
  hitDie?: number;
  /** Experience penalty, percent. */
  exp?: number;
  luck?: number;
  infra?: number;
  /** Mana percent (race modifiers and classes). */
  mana?: number;
  blows?: number;
  extraBlows?: number;
  /** tome2 player race flags (EXPERIMENTAL, NO_GOD...). */
  flags: string[];
  levelFlags?: BirthLevelFlags[];
  skills: BirthSkill[];
  abilities: BirthAbility[];
  powers?: { name: string; desc: string }[];
  /** Classes a race can take. */
  classes?: string[];
  /** Gods a specialisation can follow. */
  gods?: string[];
  specs?: BirthEntry[];
}

export interface BirthData {
  races: BirthEntry[];
  mods: BirthEntry[];
  classes: BirthEntry[];
}

export interface SpellInfo {
  name: string;
  school: string;
  /** Spell level, or -1 when it cannot be cast at all. */
  level: number;
  mana: number;
  fail: number;
  info: string;
  ok: number;
  /** Castable but costs more mana than the player has. */
  short: number;
  desc: string;
}

export interface SpellBook {
  /** Inventory index. */
  i: number;
  name: string;
  spells: SpellInfo[];
}

export interface SpellState {
  ready: number;
  books: SpellBook[];
  /** Entries of tome2's "use a skill" menu, in order. */
  powers: { label: string; mkey: number }[];
  /** Race, class and corruption powers (tome2's "use a power" menu), in order. */
  bonus: { name: string; desc: string; level: number; cost: number }[];
}

export interface MonsterRecall {
  name: string;
  text: [number, string][];
}
