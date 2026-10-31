import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SAVE_FORMAT,
  base64ToBytes,
  bytesToBase64,
  bundleConflict,
  collectFiles,
  decodeBundle,
  encodeBundle,
  exportFilename,
  findSaveIndex,
  isSafeRelativePath,
  writeFiles,
  type EmscriptenFS,
} from '../../web/src/saves.ts';
import { deleteHeroSave, heroLine, nextRunName, placeLine, saveBase } from '../../web/src/play/adventurers.ts';

class MemoryFS implements EmscriptenFS {
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

describe('base64', () => {
  it('round-trips arbitrary bytes, including large buffers', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  });
});

describe('isSafeRelativePath', () => {
  it('accepts ordinary relative paths', () => {
    assert.ok(isSafeRelativePath('2.4/save/PLAYER'));
    assert.ok(isSafeRelativePath('scores.raw'));
  });

  it('rejects traversal and absolute paths', () => {
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../b', 'a//b', './a', 'a\\b', 'a\0b']) {
      assert.equal(isSafeRelativePath(bad), false, bad);
    }
  });
});

describe('bundle encoding', () => {
  it('round-trips files', () => {
    const files = [
      { path: '2.4/save/Frodo', data: new Uint8Array([0, 1, 2, 255]) },
      { path: '2.4/scores.raw', data: new Uint8Array([]) },
    ];
    const text = encodeBundle(files, new Date('2026-01-02T03:04:05Z'));
    const parsed = JSON.parse(text);
    assert.equal(parsed.format, SAVE_FORMAT);
    assert.equal(parsed.exported, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(decodeBundle(text), files);
  });

  it('rejects foreign or malicious bundles', () => {
    assert.throws(() => decodeBundle('not json'), /invalid JSON/);
    assert.throws(() => decodeBundle('{"format":"other"}'), /Not a ToME save/);
    assert.throws(() => decodeBundle(JSON.stringify({ format: SAVE_FORMAT, version: 99, files: [] })), /newer version/);
    assert.throws(
      () => decodeBundle(JSON.stringify({ format: SAVE_FORMAT, version: 1, files: [{ path: '../x', data: '' }] })),
      /unsafe path/,
    );
    assert.throws(
      () => decodeBundle(JSON.stringify({ format: SAVE_FORMAT, version: 1, files: [{ path: 'x', data: '***' }] })),
      /corrupt/,
    );
  });
});

describe('filesystem helpers', () => {
  it('collects and writes files beneath a root', () => {
    const source = new MemoryFS();
    source.mkdirTree('/home/web_user/.tome/2.4/save');
    source.writeFile('/home/web_user/.tome/2.4/save/Frodo', new Uint8Array([1, 2, 3]));
    source.writeFile('/home/web_user/.tome/2.4/scores.raw', new Uint8Array([9]));

    const files = collectFiles(source, '/home/web_user/.tome');
    assert.deepEqual(files.map((f) => f.path).sort(), ['2.4/save/Frodo', '2.4/scores.raw']);

    const target = new MemoryFS();
    writeFiles(target, '/home/web_user/.tome', files);
    assert.deepEqual(target.readFile('/home/web_user/.tome/2.4/save/Frodo'), new Uint8Array([1, 2, 3]));
    assert.ok(target.dirs.has('/home/web_user/.tome/2.4/save'));
  });

  it('refuses to write unsafe paths', () => {
    assert.throws(() => writeFiles(new MemoryFS(), '/root', [{ path: '../evil', data: new Uint8Array() }]), /Unsafe/);
  });

  it('rejects a bundle that cannot be written whole, before touching anything', () => {
    const fs = new MemoryFS();
    fs.mkdirTree('/root/2.4/save');
    fs.writeFile('/root/2.4/save/Hero', new Uint8Array([1]));
    const data = new Uint8Array([2]);
    assert.match(bundleConflict(fs, '/root', [{ path: '2.4/save/Hero', data }, { path: '2.4/save/Hero/child', data }])!, /file and a directory/);
    assert.match(bundleConflict(fs, '/root', [{ path: '2.4/save/Hero/child', data }])!, /exists as a file/);
    assert.match(bundleConflict(fs, '/root', [{ path: '2.4/save', data }])!, /as a directory/);
    assert.match(bundleConflict(fs, '/root', [{ path: 'a', data }, { path: 'a', data }])!, /twice/);
    assert.equal(bundleConflict(fs, '/root', [{ path: '2.4/save/Hero', data }, { path: '2.4/save/Sam', data }]), null);
    assert.throws(() => writeFiles(fs, '/root', [{ path: '2.4/save/Hero', data }, { path: '2.4/save/Hero/child', data }]));
    assert.deepEqual(fs.readFile('/root/2.4/save/Hero'), new Uint8Array([1]));
  });
});

describe('exportFilename', () => {
  it('is timestamped and uses the save extension', () => {
    assert.equal(exportFilename(new Date('2026-10-25T09:08:07Z')), 'tome2-saves-2026-10-25-09-08-07.tome2save');
  });
});

describe('a hero begun anew', () => {
  it('takes the next free numeral of the line', () => {
    assert.equal(nextRunName('Elder', new Set(['elder'])), 'Elder II');
    assert.equal(nextRunName('Elder II', new Set(['elder', 'elder_ii'])), 'Elder III');
    assert.equal(nextRunName('Elder', new Set(['elder', 'elder_ii', 'elder_iii'])), 'Elder IV');
    assert.equal(nextRunName('Elder VIII', new Set(['elder_ix'])), 'Elder X');
  });

  it('stays within fifteen characters', () => {
    assert.equal(nextRunName('Thranduilionnn', new Set()), 'Thranduilion II');
    assert.equal(nextRunName('Thranduilion II', new Set(['thranduilion_ii'])), 'Thranduilio III');
  });
});

describe('deleting a saved hero', () => {
  const text = (fs: MemoryFS, path: string) => new TextDecoder().decode(fs.readFile(path));
  const write = (fs: MemoryFS, path: string, value: string) => fs.writeFile(path, new TextEncoder().encode(value));

  it('names savefiles as tome2 does', () => {
    assert.equal(saveBase('Bilbo'), 'Bilbo');
    assert.equal(saveBase('Old Tom'), 'Old_Tom');
    assert.equal(saveBase("Fili-Kili's"), 'FiliKilis');
    assert.equal(saveBase('--'), 'PLAYER');
  });

  it('removes only that hero: savefile, kept levels and index line', () => {
    const fs = new MemoryFS();
    fs.mkdirTree('/root/2.4/save');
    for (const file of ['Bob', 'Bob.lvl4_2', 'Bob.lvl1_1', 'Bobby', 'Bobby.lvl4_2', 'global.svg', 'chronicle.json']) write(fs, `/root/2.4/save/${file}`, 'x');
    write(fs, '/root/2.4/Bob.nte', 'x');
    write(fs, '/root/2.4/Bobby.nte', 'x');
    write(fs, '/root/2.4/save/global.svg', 'ToME@1Bob@Bob, the Hobbit Rogue is alive\nToME@1Bobby@Bobby, the Ent Warrior is alive\nToME@0Sam@Sam, the Human Priest is dead\n');
    assert.equal(findSaveIndex(fs, '/root'), '/root/2.4/save/global.svg');
    const removed = deleteHeroSave(fs, '/root/2.4/save/global.svg', 'Bob');
    assert.deepEqual(removed.sort(), ['/root/2.4/Bob.nte', '/root/2.4/save/Bob', '/root/2.4/save/Bob.lvl1_1', '/root/2.4/save/Bob.lvl4_2']);
    assert.deepEqual(fs.readdir('/root/2.4').filter((n) => n.endsWith('.nte')), ['Bobby.nte']);
    assert.deepEqual(fs.readdir('/root/2.4/save').filter((n) => !n.startsWith('.')).sort(), ['Bobby', 'Bobby.lvl4_2', 'chronicle.json', 'global.svg']);
    assert.equal(text(fs, '/root/2.4/save/global.svg'), 'ToME@1Bobby@Bobby, the Ent Warrior is alive\nToME@0Sam@Sam, the Human Priest is dead\n');
  });

  it('keeps the index whatever the hero is called', () => {
    const fs = new MemoryFS();
    fs.mkdirTree('/root/2.4/save');
    write(fs, '/root/2.4/save/global', 'x');
    write(fs, '/root/2.4/save/global.svg', 'ToME@1global@global, the Hobbit Rogue is alive\n');
    assert.deepEqual(deleteHeroSave(fs, '/root/2.4/save/global.svg', 'global'), ['/root/2.4/save/global']);
    assert.equal(text(fs, '/root/2.4/save/global.svg'), '');
  });

  it('shows a hero in a line: level, race and class, and where they are', () => {
    assert.equal(heroLine({ level: 12, race: 'High-Elf', cls: 'Sorcerer' }), 'Level 12 High-Elf Sorcerer');
    assert.equal(placeLine({ depth: 8, dungeon: 'Barrow-downs', wild: 0, area: undefined }), 'Barrow-downs, level 8');
    assert.equal(placeLine({ depth: 0, dungeon: '', wild: 0, area: 'Bree' }), 'Bree');
    assert.equal(placeLine({ depth: 0, dungeon: '', wild: 1, area: undefined }), 'World map');
  });
});
