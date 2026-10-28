import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  castSpellMacro,
  CastWatcher,
  fireMacro,
  itemBaseName,
  itemRecent,
  listedNames,
  recentItem,
  rememberRecent,
  skillMenu,
  usePowerMacro,
  type RecentAction,
} from '../../web/src/play/recent.ts';
import type { MacroScreen } from '../../web/src/play/macro.ts';

const keys = (text: string) => [...text].map((c) => c.charCodeAt(0));
const screen = (prompt: string, rest = ''): MacroScreen => ({ prompt, screen: `${prompt}\n${rest}`, atCommand: false });

const SKILL_MENU = [
  'Select a skill (a-b), @ to select by name, +/- to scroll:',
  '#####.....          Name',
  '..#..........         a - 17) Cast a spell',
  '....                  b - 2) Use Mindcraft',
].join('\n');

describe('recent actions', () => {
  it('keeps the newest first, without repeats, and at most five of each group', () => {
    let list: RecentAction[] = [];
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) list = rememberRecent(list, { kind: 'spell', name });
    list = rememberRecent(list, { kind: 'item', command: 'q', verb: 'Quaff', tval: 71, sval: 1, name: 'Potion' });
    list = rememberRecent(list, { kind: 'spell', name: 'D' });
    assert.deepEqual(
      list.map((e) => (e.kind === 'item' ? 'item' : e.kind === 'spell' ? e.name : '')),
      ['D', 'item', 'F', 'E', 'C', 'B'],
    );
  });

  it('names items without their count and finds them again by kind', () => {
    assert.equal(itemBaseName('3 Potions of Cure Light Wounds'), 'Potions of Cure Light Wounds');
    const entry = itemRecent('q', 'Quaff', { tval: 71, sval: 4, name: 'a Potion of Cure Light Wounds' });
    assert.ok(entry.kind === 'item');
    const pack = [
      { i: 0, name: 'a Ration', tval: 80, sval: 1, number: 1, weight: 1, ch: 44, attr: 1, wear: 0, activate: 0, ins: '' },
      { i: 1, name: '2 Potions of Cure Light Wounds', tval: 71, sval: 4, number: 2, weight: 4, ch: 33, attr: 1, wear: 0, activate: 0, ins: '' },
    ];
    assert.equal(recentItem(entry, pack)?.i, 1);
    assert.equal(recentItem({ ...entry, sval: 9 }, pack), null);
  });

  it('reads tome2 skill menus and lettered lists drawn over the map', () => {
    assert.deepEqual(skillMenu(SKILL_MENU), [
      { letter: 'a', mkey: 17, label: 'Cast a spell' },
      { letter: 'b', mkey: 2, label: 'Use Mindcraft' },
    ]);
    const spells = listedNames('##..a) Manathrust          Mana               1    1   6% dam 4d2\n b) Globe of Light      Fire', 20);
    assert.equal(spells.get('a'), 'Manathrust');
    assert.equal(spells.get('b'), 'Globe of Light');
  });

  it('casts a spell by name through the skill menu and the book prompt', () => {
    const macro = castSpellMacro('Manathrust', true);
    assert.deepEqual(macro.next().value, [92, ...keys('m')]);
    assert.deepEqual(macro.next(screen('Select a skill (a-b), @ to select by name, +/- to scroll:', SKILL_MENU)).value, keys('a'));
    assert.deepEqual(macro.next(screen('(Inven: a, @ for spell name, ESC) cast from which book?')).value, keys('@'));
    assert.deepEqual(macro.next(screen('Spell name? Manathrust')).value, [...keys('Manathrust'), 13]);
    assert.deepEqual(macro.next(screen("Direction ('*' to choose a target, Escape to cancel)?")).value, keys('*t'));
    assert.equal(macro.next(screen('')).done, true);
  });

  it('uses a skill power by name and fires at the nearest foe', () => {
    const macro = usePowerMacro('Use Mindcraft', 'Neural Blast');
    macro.next();
    assert.deepEqual(macro.next(screen('Select a skill (a-b), @ to select by name, +/- to scroll:', SKILL_MENU)).value, keys('b'));
    const list = '(Powers a-b, ESC=exit, A-B=Info) Use which power?\n                    a) Precognition                  1    1   5%\n                    b) Neural Blast                  2    1  10%';
    assert.deepEqual(macro.next(screen('(Powers a-b, ESC=exit, A-B=Info) Use which power?', list)).value, keys('b'));
    const fire = fireMacro();
    assert.deepEqual(fire.next().value, [92, ...keys('f')]);
    assert.deepEqual(fire.next(screen("Direction ('*' to choose a target, Escape to cancel)?")).value, keys('*t'));
  });

  it('notices what the player casts through tome2 menus', () => {
    const watcher = new CastWatcher();
    const skillPrompt = 'Select a skill (a-b), @ to select by name, +/- to scroll:';
    assert.equal(watcher.note(skillPrompt, SKILL_MENU, keys('a')[0]), null);
    const spellPrompt = '(Spells a-b, Descs A-B, ESC=exit) Cast which spell?';
    assert.deepEqual(watcher.note(spellPrompt, `${spellPrompt}\n  a) Manathrust          Mana`, keys('a')[0]), { kind: 'spell', name: 'Manathrust' });
    assert.equal(watcher.note(skillPrompt, SKILL_MENU, keys('b')[0]), null);
    const powerPrompt = '(Powers a-a, ESC=exit, A-A=Info) Use which power?';
    assert.deepEqual(watcher.note(powerPrompt, `${powerPrompt}\n      a) Precognition                  1`, keys('a')[0]), {
      kind: 'power',
      skill: 'Use Mindcraft',
      power: 'Precognition',
    });
  });
});
