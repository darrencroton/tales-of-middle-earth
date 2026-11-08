import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChronicle, mergeSaveIndex, mergeScores, SCORE_RECORD } from '../../web/src/play/merge.ts';
import { arrival, decodeHeroBundle, deviceName, encodeHeroBundle, heroBundle, heroMark, journeyChoice } from '../../web/src/play/transfer.ts';
import type { SaveFile } from '../../web/src/saves.ts';
import { clockTime } from '../../web/src/ui/transfer.ts';

const enc = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const file = (path: string, value: unknown): SaveFile => ({ path, data: enc(value) });
const read = (files: readonly SaveFile[], path: string) => JSON.parse(dec(files.find((f) => f.path === path)!.data)) as Record<string, Record<string, unknown>>;
const entry = (name: string, level: number, saved: string) => ({ name, level, race: 'Hobbit', cls: 'Rogue', place: 'Bree', saved });

/** A device with Old Tom and another hero, Bob. */
function device(tom: { save: string; level: number; saved: string }, extra: SaveFile[] = []): SaveFile[] {
  return [
    file('2.4/save/Old_Tom', tom.save),
    file('2.4/save/Old_Tom.adventure', '1 0 1'),
    file('2.4/save/Bob', 'bob'),
    file('2.4/Old_Tom.nte', 'notes'),
    file('2.4/save/global.svg', 'ToME@1Old_Tom@Old Tom, the Hobbit Rogue is alive\nToME@1Bob@Bob, the Human Warrior is alive\n'),
    file('adventurers.json', { version: 1, heroes: { 'Old Tom': entry('Old Tom', tom.level, tom.saved), Bob: entry('Bob', 1, '2026-01-01T00:00:00Z') } }),
    file('mapmemory.json', { version: 1, heroes: { 'Old Tom#7': { heading: tom.level > 1 ? 'up' : 'down' }, 'Bob#1': { heading: 'down' } } }),
    ...extra,
  ];
}

describe('hero transfer', () => {
  it('bundles one hero with only their entries in the shared files, and reads it back', () => {
    const files = device({ save: 'tom', level: 3, saved: '2026-02-01T00:00:00Z' });
    const bundle = heroBundle(files.filter((f) => f.path !== '2.4/save/Bob'), { save: 'Old_Tom', name: 'Old Tom' }, 'iPhone', null, new Date('2026-02-02T00:00:00Z'));
    assert.deepEqual(bundle.files.map((f) => f.path).sort(), ['2.4/Old_Tom.nte', '2.4/save/Old_Tom', '2.4/save/Old_Tom.adventure', '2.4/save/global.svg', 'adventurers.json', 'mapmemory.json']);
    assert.deepEqual(Object.keys(read(bundle.files, 'adventurers.json').heroes), ['Old Tom']);
    assert.deepEqual(Object.keys(read(bundle.files, 'mapmemory.json').heroes), ['Old Tom#7']);
    assert.equal(dec(bundle.files.find((f) => f.path.endsWith('global.svg'))!.data), 'ToME@1Old_Tom@Old Tom, the Hobbit Rogue is alive\n');
    const back = decodeHeroBundle(encodeHeroBundle(bundle));
    assert.equal(back.name, 'Old Tom');
    assert.equal(back.device, 'iPhone');
    assert.deepEqual(back.files, bundle.files);
  });

  it('refuses a file that is not a hero, holds another hero, or would write outside storage', () => {
    assert.throws(() => decodeHeroBundle('{"format":"tome2mobile-saves"}'), /not a hero/);
    const bundle = heroBundle(device({ save: 'tom', level: 3, saved: '' }), { save: 'Old_Tom', name: 'Old Tom' }, 'iPhone', null);
    const other = JSON.parse(encodeHeroBundle(bundle)) as { files: { path: string; data: string }[] };
    other.files.push({ path: '2.4/save/Bob', data: 'Ym9i' });
    assert.throws(() => decodeHeroBundle(JSON.stringify(other)), /more than one hero/);
    other.files[other.files.length - 1].path = '../escape';
    assert.throws(() => decodeHeroBundle(JSON.stringify(other)), /damaged/);
  });

  it('adds a new hero to a device with none, taking only their entries', () => {
    const bundle = heroBundle(device({ save: 'tom', level: 3, saved: '2026-02-01T00:00:00Z' }), { save: 'Old_Tom', name: 'Old Tom' }, 'iPhone', null);
    const plan = arrival([], bundle);
    assert.equal(plan.conflict, false);
    assert.deepEqual(read(plan.write, 'adventurers.json').heroes, { 'Old Tom': entry('Old Tom', 3, '2026-02-01T00:00:00Z') });
    assert.deepEqual(Object.keys(read(plan.write, 'mapmemory.json').heroes), ['Old Tom#7']);
    assert.equal(dec(plan.write.find((f) => f.path === '2.4/save/global.svg')!.data), 'ToME@1Old_Tom@Old Tom, the Hobbit Rogue is alive\n');
  });

  it('replaces this device’s copy of the hero, keeping every other hero, after asking', () => {
    const here = device({ save: 'tom here', level: 2, saved: '2026-01-05T00:00:00Z' }, [file('2.4/save/Old_Tom.lvl1_3', 'level')]);
    const there = heroBundle(device({ save: 'tom there', level: 5, saved: '2026-01-06T00:00:00Z' }), { save: 'Old_Tom', name: 'Old Tom' }, 'iPad', null);
    const plan = arrival(here, there);
    assert.equal(plan.conflict, true);
    assert.deepEqual(plan.remove, ['2.4/save/Old_Tom.lvl1_3'], 'a level only this copy kept goes');
    assert.equal(dec(plan.write.find((f) => f.path === '2.4/save/Old_Tom')!.data), 'tom there');
    const heroes = read(plan.write, 'adventurers.json').heroes as Record<string, { level: number }>;
    assert.equal(heroes['Old Tom'].level, 5);
    assert.ok(heroes.Bob);
    const choice = journeyChoice(here, there, 'iPhone');
    assert.equal(choice.local.where, 'This iPhone');
    assert.equal(choice.remote.where, 'Your iPad');
    assert.equal(choice.suggested, 'remote', 'the copy played further');
    assert.equal(arrival(there.files, there).same, true, 'the same copy again changes nothing');
    const onward = { ...there, since: heroMark(here, 'Old_Tom')! };
    assert.equal(arrival(here, onward).conflict, false, 'a copy taken from this one, untouched here since, is taken without asking');
  });

  it('combines the Hall of Fame and deeds, a hero’s tale following the copy taken', () => {
    const record = (points: number, who: string) => {
      const r = new Uint8Array(SCORE_RECORD);
      r.set(enc(String(points).padStart(9, ' ')), 8);
      r.set(enc(who), 48);
      return r;
    };
    const join = (...records: Uint8Array[]) => {
      const out = new Uint8Array(records.length * SCORE_RECORD);
      records.forEach((r, i) => out.set(r, i * SCORE_RECORD));
      return out;
    };
    const [a, b, c] = [record(500, 'A'), record(100, 'B'), record(900, 'C')];
    assert.deepEqual(mergeScores(join(a, b), join(a, c)), join(c, a, b));

    const career = (kills: number, worldMap: boolean) => ({ heroes: 2, fallen: 0, kills, uniques: 0, deepestFeet: 50, bestLevel: 1, bestStreak: 0, worldMap, closeCalls: 0 });
    const local = enc({ version: 1, career: career(40, false), deeds: { hunter: '2026-02-01' }, heroes: { 'Old Tom': { kills: 4 }, Bob: { kills: 9 } }, memorials: {} });
    const remote = enc({ version: 1, career: career(30, true), deeds: { hunter: '2026-01-01', rampage: '2026-01-03' }, heroes: { 'Old Tom': { kills: 20 }, Zed: { kills: 1 } }, memorials: { 'Zed@9': { name: 'Zed' } } });
    const out = JSON.parse(dec(mergeChronicle(local, remote, 'Old_Tom'))) as {
      career: Record<string, unknown>;
      deeds: Record<string, string>;
      heroes: Record<string, { kills: number }>;
      memorials: Record<string, unknown>;
    };
    assert.equal(out.career.kills, 40, 'counts take the higher: both may hold the same history');
    assert.equal(out.career.worldMap, true);
    assert.deepEqual(out.deeds, { hunter: '2026-01-01', rampage: '2026-01-03' });
    assert.deepEqual(out.heroes, { 'Old Tom': { kills: 20 }, Bob: { kills: 9 } }, 'heroes not sent stay as they are here');
    assert.ok(out.memorials['Zed@9']);
  });

  it('orders the savefile index by when each hero was last saved', () => {
    const local = enc('ToME@1A@A, the Human Warrior is alive\nToME@1B@B, the Elf Mage is alive\n');
    const remote = enc('ToME@1C@C, the Dwarf Priest is alive\n');
    const times: Record<string, number> = { A: 1, B: 3, C: 2 };
    const out = dec(mergeSaveIndex(local, remote, 'C', (h) => times[h] ?? 0));
    assert.equal(out, 'ToME@1B@B, the Elf Mage is alive\nToME@1C@C, the Dwarf Priest is alive\nToME@1A@A, the Human Warrior is alive\n');
  });

  it('names devices and tells a moment by the clock', () => {
    assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'iPhone');
    assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'iPad');
    assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'Mac');
    assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile', 5), 'Android phone');
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    assert.match(clockTime(new Date(2026, 10, 7, 14, 2).getTime(), now), /^today, /);
    assert.match(clockTime(new Date(2026, 10, 6, 23, 50).getTime(), now), /^yesterday, /);
    assert.doesNotMatch(clockTime(new Date(2026, 10, 1, 9, 0).getTime(), now), /today|yesterday/);
  });
});
