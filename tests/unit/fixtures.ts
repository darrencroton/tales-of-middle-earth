import { LAYER_TERRAIN, NO_EFFECT, type LevelSnapshot, type MonsterState } from '../../web/src/render/snapshot.ts';
import type { EmscriptenFS } from '../../web/src/saves.ts';
import type { TermRow } from '../../web/src/ui/termparse.ts';

/** A level of open floor, all unknown, with the hero at the top left; `over` replaces any field. */
export function snapshot(width: number, height: number, over: Partial<LevelSnapshot> = {}): LevelSnapshot {
  const n = width * height;
  return {
    inDungeon: true,
    icky: false,
    width,
    height,
    py: 0,
    px: 0,
    lightRadius: 2,
    depth: 3,
    wild: false,
    blind: false,
    hallucinating: false,
    panelRow: 0,
    panelCol: 0,
    rowMap: 1,
    colMap: 13,
    atCommand: true,
    turn: 0,
    floorObjects: 0,
    heroActing: false,
    feat: new Uint8Array(n).fill(1),
    info: new Uint16Array(n),
    glyph: new Uint8Array(n).fill('.'.charCodeAt(0)),
    attr: new Uint8Array(n).fill(1),
    layer: new Uint8Array(n).fill(LAYER_TERRAIN),
    effect: new Uint8Array(n).fill(NO_EFFECT),
    ...over,
  };
}

/** A hostile kobold in the hero's sight; `over` replaces any field. */
export function monster(over: Partial<MonsterState> = {}): MonsterState {
  return {
    id: 1,
    name: 'kobold',
    ch: 107,
    attr: 1,
    y: 0,
    x: 0,
    hp: 5,
    maxhp: 5,
    asleep: 0,
    afraid: 0,
    unique: 0,
    status: -2,
    view: 1,
    target: 1,
    level: 5,
    ...over,
  };
}

/** A terminal row of `text` (width 80 unless given) in one colour, with `colours` ([from, to, attr]) painting spans over it. */
export function termRow(text = '', opts: { width?: number; attr?: number; colours?: [number, number, number][] } = {}): TermRow {
  const { width = 80, attr = 1, colours = [] } = opts;
  const chars = new Uint8Array(width).fill(0x20);
  const attrs = new Uint8Array(width).fill(attr);
  for (let i = 0; i < text.length && i < width; i++) chars[i] = text.charCodeAt(i);
  for (const [from, to, a] of colours) attrs.fill(a, from, to);
  return { chars, attrs };
}

/** An in-memory Emscripten file system: files and directories by absolute path. */
export class MemoryFS implements EmscriptenFS {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/']);

  readdir(path: string): string[] {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>(['.', '..']);
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p.startsWith(prefix) && p !== prefix) names.add(p.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  }

  stat(path: string): { mode: number } {
    if (this.dirs.has(path)) return { mode: 0o040000 };
    if (this.files.has(path)) return { mode: 0o100000 };
    throw new Error(`ENOENT ${path}`);
  }

  isDir(mode: number): boolean {
    return (mode & 0o170000) === 0o040000;
  }

  readFile(path: string): Uint8Array {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT ${path}`);
    return data;
  }

  writeFile(path: string, data: Uint8Array): void {
    this.files.set(path, data);
  }

  unlink(path: string): void {
    if (!this.files.delete(path)) throw new Error(`ENOENT ${path}`);
  }

  rmdir(path: string): void {
    if (this.readdir(path).length > 2 || !this.dirs.delete(path)) throw new Error(`ENOTEMPTY ${path}`);
  }

  mkdirTree(path: string): void {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current += `/${part}`;
      this.dirs.add(current);
    }
  }

  syncfs(_populate: boolean, callback: (err: unknown) => void): void {
    callback(null);
  }
}
