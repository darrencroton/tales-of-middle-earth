import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChronicleStore } from '../../web/src/ui/deeds.ts';
import type { EmscriptenFS } from '../../web/src/saves.ts';

function memoryFs(files: Record<string, string> = {}): EmscriptenFS {
  const data = new Map<string, Uint8Array>(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  return {
    readdir: () => [],
    stat: () => ({ mode: 0 }),
    isDir: () => false,
    readFile: (path) => {
      const bytes = data.get(path);
      if (!bytes) throw new Error('ENOENT');
      return bytes;
    },
    writeFile: (path, bytes) => void data.set(path, bytes),
    mkdirTree: () => undefined,
    syncfs: (_populate, done) => done(null),
  };
}

describe('chronicle store', () => {
  it('treats any name as a plain key, even ones Object.prototype uses', () => {
    const store = new ChronicleStore();
    store.load(memoryFs(), '/save');
    for (const name of ['constructor', 'toString', '__proto__']) {
      const hero = store.hero(name);
      assert.equal(hero.name, name);
      assert.deepEqual(hero.uniques, []);
      assert.equal(store.peek(name), hero);
    }
    assert.equal(store.career.heroes, 3);
    assert.equal(store.peek('hasOwnProperty'), null);
  });

  it('saves and reads back the chronicle, starting a new one when a fallen name returns', () => {
    const fs = memoryFs();
    const store = new ChronicleStore();
    store.load(fs, '/save');
    store.hero('Frodo').kills = 4;
    assert.equal(store.fall('Frodo'), true);
    assert.equal(store.fall('Frodo'), false);
    store.save();
    const again = new ChronicleStore();
    again.load(fs, '/save');
    assert.equal(again.peek('Frodo')?.kills, 4);
    assert.equal(again.career.fallen, 1);
    assert.equal(again.hero('Frodo').kills, 0);
    assert.equal(again.career.heroes, 2);
  });
});
