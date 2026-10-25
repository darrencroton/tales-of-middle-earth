import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SAVE_FORMAT,
  base64ToBytes,
  bytesToBase64,
  collectFiles,
  decodeBundle,
  encodeBundle,
  exportFilename,
  isSafeRelativePath,
  writeFiles,
  type EmscriptenFS,
} from '../../web/src/saves.ts';

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
    assert.throws(() => decodeBundle('{"format":"other"}'), /Not a tome2mobile save/);
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
});

describe('exportFilename', () => {
  it('is timestamped and uses the save extension', () => {
    assert.equal(exportFilename(new Date('2026-10-25T09:08:07Z')), 'tome2-saves-2026-10-25-09-08-07.tome2save');
  });
});
