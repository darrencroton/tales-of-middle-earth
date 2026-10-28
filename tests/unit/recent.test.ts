import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  castSpellMacro,
  CastWatcher,
  fireMacro,
  itemBaseName,
  itemRecent,
  listedChoices,
  numberedMenu,
  pathMacro,
  recentItem,
  recentItemAction,
  recentLabel,
  rememberRecent,
  screenChoices,
  thenAim,
  validRecent,
  type RecentAction,
} from '../../web/src/play/recent.ts';
import { bracketChoices, choiceQuestion, classifyPrompt } from '../../web/src/play/prompts.ts';
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

  it('reads tome2 skill menus, power menus and lettered lists drawn over the map', () => {
    assert.deepEqual(numberedMenu(SKILL_MENU), [
      { key: 'a', mkey: 17, label: 'Cast a spell' },
      { key: 'b', mkey: 2, label: 'Use Mindcraft' },
    ]);
    const powers = '                     a -   7) Bear form                         1    5 CON@10';
    assert.deepEqual(numberedMenu(powers), [{ key: 'a', mkey: 7, label: 'Bear form' }]);
    const spells = listedChoices('##..a) Manathrust          Mana               1    1   6% dam 4d2\n b) Globe of Light      Fire', 20);
    assert.deepEqual(spells.map((c) => c.label), ['Manathrust', 'Globe of Light']);
    const body = listedChoices(' a) 12 Fire bolt                          r) 20 Ball of cold', 30, true);
    assert.deepEqual(body.map((c) => [c.key, c.label]), [
      ['a', 'Fire bolt'],
      ['r', 'Ball of cold'],
    ]);
  });

  it('turns lettered prompts into choices and plain questions', () => {
    const prompt = 'Create [S]hots, [A]rrows or [B]olts? ';
    assert.equal(classifyPrompt(prompt), 'choice');
    assert.deepEqual(bracketChoices(prompt), [
      { key: 'S', label: 'Shots' },
      { key: 'A', label: 'Arrows' },
      { key: 'B', label: 'Bolts' },
    ]);
    assert.equal(choiceQuestion(prompt), 'Create shots, arrows or bolts?');
    assert.deepEqual(bracketChoices('Use your [R]ace powers or your [I]ncarnating powers?').map((c) => c.label), ['Race powers', 'Incarnating powers']);
    assert.deepEqual(bracketChoices('Trigger at [a]75% hp [b]50% hp?').map((c) => c.label), ['75% hp', '50% hp']);
    assert.equal(classifyPrompt('Really quit? [y/n]'), 'yesno');
    assert.deepEqual(screenChoices(prompt, '').map((c) => c.key), ['S', 'A', 'B']);
    assert.deepEqual(screenChoices('(a-b) Select batch of powers: ', '').map((c) => c.label), ['#a', '#b']);
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

  it('follows a menu path by labels, and fires at the nearest foe', () => {
    const macro = pathMacro('m', ['Use Mindcraft', 'Neural Blast']);
    macro.next();
    assert.deepEqual(macro.next(screen('Select a skill (a-b), @ to select by name, +/- to scroll:', SKILL_MENU)).value, keys('b'));
    const list = '(Powers a-b, ESC=exit, A-B=Info) Use which power?\n                    a) Precognition                  1    1   5%\n                    b) Neural Blast                  2    1  10%';
    assert.deepEqual(macro.next(screen('(Powers a-b, ESC=exit, A-B=Info) Use which power?', list)).value, keys('b'));
    const forge = pathMacro('m', ['Forge ammo', 'Arrows']);
    forge.next();
    assert.deepEqual(forge.next(screen('Select a skill (a-a), @ to select by name, +/- to scroll:', '  a - 10) Forge ammo')).value, keys('a'));
    assert.deepEqual(forge.next(screen('Create [S]hots or [A]rrows? ')).value, keys('A'));
    const fire = fireMacro();
    assert.deepEqual(fire.next().value, [92, ...keys('f')]);
    assert.deepEqual(fire.next(screen("Direction ('*' to choose a target, Escape to cancel)?")).value, keys('*t'));
    const aimed = thenAim(pathMacro('m', []), true);
    assert.deepEqual(aimed.next().value, [92, ...keys('m')]);
    assert.deepEqual(aimed.next(screen("Direction ('*' to choose a target, Escape to cancel)?")).value, keys('*t'));
  });

  it('notices what the player does through tome2 menus, and whether it was aimed', () => {
    const watcher = new CastWatcher();
    const skillPrompt = 'Select a skill (a-b), @ to select by name, +/- to scroll:';
    const aim = "Direction ('*' to choose a target, Escape to cancel)?";
    watcher.note('', '', keys('m')[0], true);
    watcher.note(skillPrompt, SKILL_MENU, keys('a')[0], false);
    const spellPrompt = '(Spells a-b, Descs A-B, ESC=exit) Cast which spell?';
    watcher.note(spellPrompt, `${spellPrompt}\n  a) Manathrust          Mana`, keys('a')[0], false);
    assert.equal(watcher.idle('Spell name?', false), null);
    assert.deepEqual(watcher.idle(aim, false), { kind: 'spell', name: 'Manathrust', aimed: true });

    watcher.note('', '', keys('m')[0], true);
    watcher.note(skillPrompt, SKILL_MENU, keys('b')[0], false);
    const powerPrompt = '(Powers a-a, ESC=exit, A-A=Info) Use which power?';
    watcher.note(powerPrompt, `${powerPrompt}\n      a) Precognition                  1`, keys('a')[0], false);
    assert.deepEqual(watcher.idle('', true), { kind: 'path', command: 'm', steps: ['Use Mindcraft', 'Precognition'], aimed: false });

    watcher.note('', '', keys('U')[0], true);
    watcher.note('Select a power (a-a), +/- to scroll:', '  a -  12) Thunderlord\'s Powers', keys('a')[0], false);
    watcher.note('Use [T]hunder strike, [R]ide the straight road? ', '', keys('t')[0], false);
    assert.deepEqual(watcher.idle(aim, false), { kind: 'path', command: 'U', steps: ["Thunderlord's Powers", 'Thunder strike'], aimed: true });

    watcher.note('', '', keys('m')[0], true);
    watcher.note(skillPrompt, SKILL_MENU, 27, false);
    assert.equal(watcher.idle('', true), null);
  });

  it('labels recents, keeps throws and wands aimed, and drops entries it does not know', () => {
    assert.equal(recentLabel({ kind: 'path', command: 'U', steps: ["Thunderlord's Powers", 'Thunder strike'] }), 'Thunder strike');
    assert.equal(recentLabel({ kind: 'path', command: 'm', steps: ['Cast a thaumaturgy spell', '#a', 'Fire bolt'] }), 'Fire bolt');
    const oil = itemRecent('v', 'Throw', { tval: 77, sval: 0, name: '5 Flasks of oil' });
    assert.ok(oil.aimed);
    assert.equal(oil.kind === 'item' && recentItemAction(oil, { tval: 77 })?.command, 'v');
    assert.ok(!validRecent({ kind: 'power', skill: 'x', power: 'y' }));
    assert.ok(validRecent({ kind: 'spell', name: 'Manathrust' }));
  });
});
