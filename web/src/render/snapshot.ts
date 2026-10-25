/* Cave info flags (tome2 defines.hpp). */
export const CAVE_MARK = 0x0001;
export const CAVE_GLOW = 0x0002;
export const CAVE_ROOM = 0x0008;
export const CAVE_SEEN = 0x0010;
export const CAVE_VIEW = 0x0020;
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

export const SNAPSHOT_VERSION = 1;

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
  COUNT: 22,
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
  status: Record<string, number>;
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
}

export interface ObjectState {
  id: number;
  name: string;
  ch: number;
  attr: number;
  y: number;
  x: number;
}

export interface MessageState {
  text: string;
  color: number;
}

export interface GameState {
  ready: number;
  player?: PlayerState;
  monsters?: MonsterState[];
  objects?: ObjectState[];
  messageTotal?: number;
  messages?: MessageState[];
}
