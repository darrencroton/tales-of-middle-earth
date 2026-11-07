import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fullPlan, heroChanges, heroOf, heroWinner, keptLeases, playingElsewhere, pushFiles, takenElsewhere, type FileList } from '../../web/src/cloud/plan.ts';
import { mergeAdventurers, mergeChronicle, mergeMapMemory, mergeRecords, mergeSaveIndex, mergeScores, SCORE_RECORD } from '../../web/src/cloud/merge.ts';
import { readManifest } from '../../web/src/cloud/protocol.ts';
import { deviceName } from '../../web/src/cloud/sync.ts';
import { clockTime } from '../../web/src/ui/cloud.ts';

const f = (hash: string): { hash: string; size: number } => ({ hash: hash.repeat(64).slice(0, 64), size: 1 });
const enc = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const json = (bytes: Uint8Array) => JSON.parse(dec(bytes)) as Record<string, unknown>;

describe('cloud plan', () => {
  it('knows which hero a file belongs to', () => {
    assert.equal(heroOf('2.4/save/Elder'), 'Elder');
    assert.equal(heroOf('2.4/save/Elder.lvl4_2'), 'Elder');
    assert.equal(heroOf('2.4/save/Elder.adventure'), 'Elder');
    assert.equal(heroOf('2.4/Elder.nte'), 'Elder');
    assert.equal(heroOf('2.4/save/global.svg'), null);
    assert.equal(heroOf('2.4/scores.raw'), null);
    assert.equal(heroOf('chronicle.json'), null);
  });

  it('tells which side changed each hero, and who wins', () => {
    const base: FileList = { '2.4/save/A': f('1'), '2.4/save/B': f('2'), '2.4/save/C': f('3') };
    const local: FileList = { '2.4/save/A': f('4'), '2.4/save/B': f('2'), '2.4/save/C': f('5') };
    const remote: FileList = { '2.4/save/A': f('1'), '2.4/save/B': f('6'), '2.4/save/C': f('7') };
    const changes = heroChanges(local, remote, base);
    const kept = { localGone: false, remoteGone: false };
    assert.deepEqual(changes, [
      { base: 'A', local: true, remote: false, ...kept },
      { base: 'B', local: false, remote: true, ...kept },
      { base: 'C', local: true, remote: true, ...kept },
    ]);
    const none = new Map<string, 'local' | 'remote'>();
    assert.equal(heroWinner(changes[0], undefined, 'me', none), 'local');
    assert.equal(heroWinner(changes[1], undefined, 'me', none), 'remote');
    assert.equal(heroWinner(changes[2], undefined, 'me', none), null, 'both changed: the player chooses');
    const mine = { device: 'me', name: 'iPhone', playing: true, at: 2 };
    const taken = { device: 'ipad', name: 'iPad', playing: true, at: 5, over: 'me' };
    assert.equal(heroWinner(changes[2], taken, 'me', none, mine), 'remote', 'taken from this device by the player there');
    assert.equal(heroWinner(changes[2], taken, 'me', none, { ...taken, at: 4 }), null, 'a taking this device had already seen asks again');
    assert.equal(heroWinner(changes[2], taken, 'me', none), null, 'with no lease known (a new device, a restore) the player chooses');
    assert.equal(heroWinner(changes[2], { device: 'ipad', name: 'iPad', playing: true, at: 5 }, 'me', none), null);
    assert.equal(heroWinner(changes[2], undefined, 'me', new Map([['C', 'local']])), 'local');
  });

  it('keeps a hero played on one side over its deletion on the other', () => {
    const base: FileList = { 's/save/A': f('1'), 's/save/A.adventure': f('2') };
    const [deletedHere] = heroChanges({}, { 's/save/A': f('3'), 's/save/A.adventure': f('2') }, base);
    assert.equal(heroWinner(deletedHere, undefined, 'me', new Map()), 'remote');
    const [deletedThere] = heroChanges({ 's/save/A': f('3'), 's/save/A.adventure': f('2') }, {}, base);
    assert.equal(heroWinner(deletedThere, undefined, 'me', new Map()), 'local');
  });

  it('takes a hero whole from the copy kept, and merges shared files the other copy changed', () => {
    const base: FileList = { 'x/save/A': f('1'), 'x/save/A.lvl1_1': f('2'), 'x/save/global.svg': f('3'), 'adventurers.json': f('4'), 'notes.txt': f('5') };
    const local: FileList = { 'x/save/A': f('6'), 'x/save/A.lvl1_1': f('2'), 'x/save/A.lvl1_2': f('7'), 'x/save/global.svg': f('8'), 'adventurers.json': f('9'), 'notes.txt': f('a') };
    const remote: FileList = { 'x/save/A': f('b'), 'x/save/A.lvl1_1': f('c'), 'x/save/global.svg': f('3'), 'adventurers.json': f('4'), 'notes.txt': f('d') };
    const changes = heroChanges(local, remote, base);
    const plan = fullPlan(local, remote, base, changes, () => 'remote');
    assert.deepEqual(plan.fetch.sort(), ['x/save/A', 'x/save/A.lvl1_1']);
    assert.deepEqual(plan.remove, ['x/save/A.lvl1_2'], 'a level only the losing copy kept goes');
    assert.deepEqual(plan.merge.sort(), ['adventurers.json', 'x/save/global.svg'], 'changed only here, but by the copy not kept');
    const kept = fullPlan(local, remote, base, changes, () => 'local');
    assert.deepEqual(kept, { fetch: [], remove: [], merge: [] }, 'other files changed on both sides keep this device’s');
    const yielded = heroChanges({ 's/save/A': f('6'), 'chronicle.json': f('7') }, { 's/save/A': f('1'), 'chronicle.json': f('8') }, { 's/save/A': f('1'), 'chronicle.json': f('8') });
    const back = fullPlan({ 's/save/A': f('6'), 'chronicle.json': f('7') }, { 's/save/A': f('1'), 'chronicle.json': f('8') }, { 's/save/A': f('1'), 'chronicle.json': f('8') }, yielded, () => 'remote');
    assert.deepEqual(back, { fetch: ['s/save/A'], remove: [], merge: ['chronicle.json'] }, 'a hero yielded takes back its shared entries too');
  });

  it('pushes from a game only what changed here, leaving heroes changed in the cloud and the one taken elsewhere', () => {
    const base: FileList = { 's/save/A': f('1'), 's/save/B': f('2'), 'chronicle.json': f('3') };
    const local: FileList = { 's/save/A': f('4'), 's/save/B': f('5'), 'chronicle.json': f('6'), 's/save/N': f('7') };
    const remote: FileList = { 's/save/A': f('1'), 's/save/B': f('8'), 'chronicle.json': f('9') };
    const { files, pushed } = pushFiles(local, remote, base, null);
    assert.deepEqual(pushed.sort(), ['s/save/A', 's/save/N']);
    assert.equal(files['s/save/B'].hash, f('8').hash);
    assert.equal(files['chronicle.json'].hash, f('9').hash);
    assert.deepEqual(pushFiles(local, remote, base, 'A').pushed, ['s/save/N']);
  });

  it('keeps leases only for heroes with files, and reads them', () => {
    const lease = { device: 'd', name: 'iPad', playing: true, at: 1000 };
    assert.deepEqual(Object.keys(keptLeases({ A: lease, Gone: lease }, { 's/save/A': f('1') })), ['A']);
    assert.ok(playingElsewhere(lease, 'me', 1000 + 60_000));
    assert.ok(!playingElsewhere(lease, 'me', 1000 + 60 * 60_000), 'a lease left an hour ago is stale');
    assert.ok(!playingElsewhere(lease, 'd', 1000));
    assert.ok(takenElsewhere(lease, 'me', 999));
    assert.ok(!takenElsewhere(lease, 'me', 1000));
  });

  it('refuses a manifest with an unsafe path or a bad hash', () => {
    assert.ok(readManifest({ rev: 1, files: { 'a/b': f('1') }, heroes: {} }));
    assert.equal(readManifest({ rev: 1, files: { '../x': f('1') }, heroes: {} }), null);
    assert.equal(readManifest({ rev: 1, files: { a: { hash: 'zz', size: 1 } }, heroes: {} }), null);
  });

  it('tells a moment by the clock, by day', () => {
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    assert.match(clockTime(new Date(2026, 10, 7, 14, 2).getTime(), now), /^today, /);
    assert.match(clockTime(new Date(2026, 10, 6, 23, 50).getTime(), now), /^yesterday, /);
    assert.doesNotMatch(clockTime(new Date(2026, 10, 1, 9, 0).getTime(), now), /today|yesterday/);
  });

  it('names devices', () => {
    assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), 'iPhone');
    assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'iPad');
    assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'Mac');
    assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile', 5), 'Android phone');
  });
});

describe('cloud merges', () => {
  it('merges records three ways, the picked side deciding its keys', () => {
    const out = mergeRecords({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 3, d: 4 }, { a: 9, b: 2, e: 6 }, () => undefined);
    assert.deepEqual({ ...out }, { a: 9, b: 5, d: 4, e: 6 }, 'c removed in the cloud');
    const picked = mergeRecords({ h: 1 }, { h: 2 }, { h: 1 }, () => undefined, () => 'remote');
    assert.deepEqual({ ...picked }, { h: 1 });
  });

  it('combines the career and deeds, and keeps heroes’ tales by the copy kept', () => {
    const career = (kills: number, deepestFeet: number, heroes: number) => ({ heroes, fallen: 0, kills, uniques: 0, deepestFeet, bestLevel: 1, bestStreak: 0, worldMap: false, closeCalls: 0 });
    const base = enc({ version: 1, career: career(10, 100, 1), deeds: {}, heroes: { Elder: { kills: 10 } }, memorials: {} });
    const local = enc({ version: 1, career: career(15, 150, 1), deeds: { hunter: '2026-02-01' }, heroes: { Elder: { kills: 15 } }, memorials: { 'Old@5': { name: 'Old' } } });
    const remote = enc({ version: 1, career: { ...career(30, 500, 2), worldMap: true }, deeds: { hunter: '2026-01-01', 'first-blood': '2026-01-02' }, heroes: { Elder: { kills: 20 }, Bob: { kills: 10 } }, memorials: {} });
    const out = json(mergeChronicle(base, local, remote, (hero) => (hero === 'Elder' ? 'remote' : null))) as {
      career: Record<string, unknown>;
      deeds: Record<string, string>;
      heroes: Record<string, { kills: number }>;
      memorials: Record<string, unknown>;
    };
    assert.equal(out.career.kills, 35);
    const fresh = json(mergeChronicle(null, local, remote, () => null)) as { career: Record<string, unknown> };
    assert.equal(fresh.career.kills, 30, 'with no copy in common, counts are not added twice');
    assert.equal(out.career.heroes, 2);
    assert.equal(out.career.deepestFeet, 500);
    assert.equal(out.career.worldMap, true);
    assert.deepEqual(out.deeds, { hunter: '2026-01-01', 'first-blood': '2026-01-02' });
    assert.equal(out.heroes.Elder.kills, 20);
    assert.equal(out.heroes.Bob.kills, 10);
    assert.ok(out.memorials['Old@5']);
  });

  it('keeps a hero’s title details and map memory by the copy kept, else the latest', () => {
    const entry = (level: number, saved: string) => ({ name: 'Old Tom', level, race: 'Hobbit', cls: 'Rogue', place: 'Bree', saved });
    const base = enc({ version: 1, heroes: { 'Old Tom': entry(1, '2026-01-01') } });
    const local = enc({ version: 1, heroes: { 'Old Tom': entry(3, '2026-01-03') } });
    const remote = enc({ version: 1, heroes: { 'Old Tom': entry(2, '2026-01-04') } });
    const heroes = (bytes: Uint8Array) => (json(bytes).heroes as Record<string, { level: number }>)['Old Tom'].level;
    assert.equal(heroes(mergeAdventurers(base, local, remote, () => null)), 2, 'saved last');
    assert.equal(heroes(mergeAdventurers(base, local, remote, (b) => (b === 'Old_Tom' ? 'local' : null))), 3);
    const memory = (heading: string) => enc({ version: 1, heroes: { 'Old Tom#42': { heading } } });
    const merged = json(mergeMapMemory(memory('down'), memory('up'), memory('down'), (b) => (b === 'Old_Tom' ? 'remote' : null)));
    assert.equal((merged.heroes as Record<string, { heading: string }>)['Old Tom#42'].heading, 'down');
  });

  it('orders the savefile index by when each hero was last played', () => {
    const base = enc('ToME@1A@A, the Human Warrior is alive\n');
    const local = enc('ToME@1A@A, the Human Warrior is alive\nToME@1B@B, the Elf Mage is alive\n');
    const remote = enc('ToME@1C@C, the Dwarf Priest is alive\nToME@0A@A, the Human Warrior is dead\n');
    const times: Record<string, number> = { A: 1, B: 3, C: 2 };
    const out = dec(mergeSaveIndex(base, local, remote, () => null, (b) => times[b] ?? 0));
    assert.equal(out, 'ToME@1B@B, the Elf Mage is alive\nToME@1C@C, the Dwarf Priest is alive\nToME@0A@A, the Human Warrior is dead\n');
  });

  it('merges the Hall of Fame by entry, best first, an entry removed on either side gone', () => {
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
    const a = record(500, 'A');
    const b = record(100, 'B');
    const c = record(900, 'C');
    const d = record(300, 'D');
    const out = mergeScores(join(a, b), join(a, d), join(a, b, c));
    assert.deepEqual(out, join(c, a, d), 'B removed here, C added there, D added here');
  });
});
