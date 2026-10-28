import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChronicleStore } from '../../web/src/ui/deeds.ts';
import type { Memorial } from '../../web/src/play/memorial.ts';
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

  it('remembers fallen heroes by name and final turn, keeping the most recent', () => {
    const fs = memoryFs();
    const store = new ChronicleStore();
    store.load(fs, '/save');
    const hero = (name: string, day: number) => ({ name, date: new Date(Date.UTC(2026, 0, day)).toISOString() }) as Memorial;
    assert.equal(store.remember('Frodo@90', hero('Frodo', 1)), true);
    assert.equal(store.remember('Frodo@90', hero('Frodo', 2)), false);
    store.save();
    const again = new ChronicleStore();
    again.load(fs, '/save');
    assert.equal(again.memorial('Frodo@90')?.date, hero('Frodo', 1).date);
    assert.equal(again.memorial('__proto__'), null);
    for (let i = 0; i < 70; i++) again.remember(`Sam@${i}`, hero('Sam', i + 2));
    assert.equal(again.memorial('Frodo@90'), null);
    assert.ok(again.memorial('Sam@69'));
  });
});
