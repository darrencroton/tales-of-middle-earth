import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extendStreak,
  newCareer,
  newChronicle,
  newDeeds,
  newMessages,
  nextTimeTip,
  record,
  slainMonsters,
  STREAK_TURNS,
} from '../../web/src/play/chronicle.ts';
import type { MonsterState } from '../../web/src/render/snapshot.ts';

const monster = (id: number, name: string, extra: Partial<MonsterState> = {}): MonsterState =>
  ({ id, name, ch: 99, attr: 2, x: id, y: 1, hp: 5, maxhp: 5, asleep: 0, afraid: 0, unique: 0, status: -1, ridx: id, ego: 0, level: 3, ...extra }) as MonsterState;
const hero = { lev: 1, au: 100, chp: 20, mhp: 20, depth: 0, dungeon: 'Barrow-Downs', wild: 0 };

describe('chronicle', () => {
  it('finds creatures that vanished with a kill message', () => {
    const before = [monster(1, 'Cave spider'), monster(2, 'Grip, Farmer Maggot\'s Dog', { unique: 1, level: 5 }), monster(3, 'Jackal')];
    const after = [before[2]];
    const slain = slainMonsters(before, after, [
      { text: 'You have slain the Cave spider.', color: 1 },
      { text: "You have slain Grip, Farmer Maggot's Dog.", color: 1 },
    ]);
    assert.deepEqual(slain.map((s) => [s.name, s.unique]), [['Cave spider', false], ["Grip, Farmer Maggot's Dog", true]]);
    assert.deepEqual(slainMonsters(before, [], [{ text: 'You feel something roll beneath your feet.', color: 1 }]), []);
  });

  it('counts a repeated message merged into the newest one', () => {
    const slain = { text: 'You have slain the Jackal.', color: 1 };
    const prev = { messageTotal: 5, messages: [slain] };
    assert.deepEqual(newMessages(prev, { messageTotal: 5, messages: [{ ...slain, text: 'You have slain the Jackal. <2x>' }] }).length, 1);
    assert.deepEqual(newMessages(prev, prev), []);
    assert.deepEqual(newMessages(prev, { messageTotal: 7, messages: [{ text: 'b', color: 1 }, { text: 'a', color: 1 }, slain] }).map((m) => m.text), ['b', 'a']);
    const before = [monster(1, 'Jackal'), monster(2, 'Jackal')];
    const merged = newMessages(prev, { messageTotal: 5, messages: [{ ...slain, text: 'You have slain the Jackal. <2x>' }] });
    assert.equal(slainMonsters(before, [before[1]], merged).length, 1);
  });

  it('names kill streaks once each', () => {
    let streak = { count: 0, lastTurn: 0 };
    const step = (kills: number, turn: number) => {
      const next = extendStreak(streak, kills, turn);
      streak = next.streak;
      return next.name;
    };
    assert.equal(step(1, 100), null);
    assert.equal(step(1, 110), 'Double kill');
    assert.equal(step(1, 120), 'Triple kill');
    assert.equal(step(0, 125), null);
    assert.equal(step(2, 130), 'Rampage');
    assert.equal(step(1, 130 + STREAK_TURNS + 1), null);
    assert.equal(streak.count, 1);
    assert.equal(step(3, 1000), 'Triple kill');
  });

  it('records kills, depth, level and legends, and awards deeds once', () => {
    const c = newChronicle('Frodo');
    const career = newCareer();
    record(c, career, { ...hero, depth: 10, lev: 10 }, [{ name: 'Grip', level: 5, unique: true, ch: 67, attr: 3, x: 1, y: 1 }]);
    assert.equal(c.kills, 1);
    assert.deepEqual(c.uniques, ['Grip']);
    assert.equal(c.deepestFeet, 500);
    assert.equal(c.deepestPlace, 'Barrow-Downs');
    assert.deepEqual(c.mightiest, { name: 'Grip', level: 5 });
    const earned = newDeeds(c, career, new Set()).map((d) => d.id);
    assert.deepEqual(earned, ['first-blood', 'giant-slayer', 'delver', 'seasoned']);
    assert.deepEqual(newDeeds(c, career, new Set(earned)), []);
  });

  it('counts a close call once health recovers', () => {
    const c = newChronicle('Sam');
    const career = newCareer();
    record(c, career, { ...hero, chp: 1, mhp: 300 }, []);
    assert.equal(c.nearDeath, false);
    record(c, career, { ...hero, chp: 1 }, [], 0, true);
    assert.equal(c.nearDeath, true);
    assert.equal(career.closeCalls, 0);
    record(c, career, { ...hero, chp: 12 }, []);
    assert.equal(career.closeCalls, 1);
    assert.ok(newDeeds(c, career, new Set()).some((d) => d.id === 'close-call'));
  });

  it('gives a tip for the next hero', () => {
    const c = newChronicle('Pippin');
    assert.match(nextTimeTip(c, 'poison', 3), /Poison/);
    assert.match(nextTimeTip(c, 'a Cave spider', 6), /first levels slowly/);
    assert.match(nextTimeTip({ ...c, peakLevel: 20 }, "Grip, Farmer Maggot's Dog", 0), /legend/);
    assert.match(nextTimeTip({ ...c, peakLevel: 20 }, 'a Jackal', 0), /town/);
  });
});
