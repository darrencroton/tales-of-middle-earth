import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  castSpellMacro,
  CastWatcher,
  fireMacro,
  isAbility,
  itemRecent,
  listedChoices,
  magicItemRefusal,
  numberedMenu,
  pathMacro,
  NO_TARGET,
  quickRecent,
  recentBlocked,
  recentItem,
  recentItemAction,
  hasActivePowers,
  magicArts,
  recentLabel,
  recentSource,
  rememberRecent,
  techniques,
  screenChoices,
  thenAim,
  usableRecents,
  validRecent,
  type RecentAction,
} from '../../web/src/play/recent.ts';
import { bracketChoices, choiceQuestion, classifyPrompt } from '../../web/src/play/prompts.ts';
import type { MacroScreen } from '../../web/src/play/macro.ts';
import type { EquipSlot, ItemState, MagicItem, SpellState } from '../../web/src/render/snapshot.ts';

const keys = (text: string) => [...text].map((c) => c.charCodeAt(0));
const screen = (prompt: string, rest = ''): MacroScreen => ({ prompt, screen: `${prompt}\n${rest}`, atCommand: false });

const SKILL_MENU = [
  'Select a skill (a-b), @ to select by name, +/- to scroll:',
  '#####.....          Name',
  '..#..........         a - 17) Cast a spell',
  '....                  b - 2) Use Mindcraft',
].join('\n');

describe('recent actions', () => {
  it('keeps the newest first, without repeats, and at most five of each group (items used as magic count with spells)', () => {
    let list: RecentAction[] = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) list = rememberRecent(list, { kind: 'spell', name });
    list = rememberRecent(list, { kind: 'item', command: 'q', verb: 'Quaff', tval: 71, sval: 1, name: 'Potion' });
    list = rememberRecent(list, { kind: 'item', command: 'A', verb: 'Activate', tval: 39, sval: 4, name: 'Phial' });
    list = rememberRecent(list, { kind: 'spell', name: 'D' });
    assert.deepEqual(
      list.map((e) => (e.kind === 'item' ? e.verb : e.kind === 'spell' ? e.name : '')),
      ['D', 'Activate', 'Quaff', 'E', 'C', 'B'],
    );
    assert.ok(isAbility({ kind: 'item', command: 'z', verb: 'Zap', tval: 67, sval: 10, name: 'Wooden Rod of Detection' }));
    const wand: RecentAction = { kind: 'item', command: 'a', verb: 'Aim', tval: 65, sval: 1, name: 'Wand of Fire Bolt', aimed: true };
    const failed = rememberRecent([wand], { ...wand, aimed: false });
    assert.deepEqual(failed, [wand]);
    assert.equal(rememberRecent(failed, { ...wand, name: 'Wand of Stone to Mud', aimed: false }).length, 2);
    assert.ok(!isAbility({ kind: 'item', command: 'q', verb: 'Quaff', tval: 71, sval: 1, name: 'Potion' }));
  });

  it('finds an item again by kind, at its last place first, and an activation or rod only by its name', () => {
    const item = (i: number, base: string, tval: number, sval: number, number = 1): ItemState => ({ i, name: base, base, tval, sval, number, weight: 1, ch: 33, attr: 1, wear: 0, activate: 0, ins: '' });
    const potions = [item(0, 'Ration', 80, 1), item(1, 'Potion of Cure Light Wounds', 71, 4, 2), item(2, 'Potion of Cure Light Wounds', 71, 4)];
    const quaff = itemRecent('q', 'Quaff', potions[2]);
    assert.equal(quaff.name, 'Potion of Cure Light Wounds');
    assert.deepEqual(recentItem(quaff, { pack: potions, equip: [] }), { item: potions[2], place: 'pack' });
    assert.equal(recentItem({ ...quaff, i: 7 }, { pack: potions, equip: [] })?.item.i, 1);
    assert.equal(recentItem({ ...quaff, sval: 9 }, { pack: potions, equip: [] }), null);

    const rods = [item(3, 'Wooden Rod of Detection', 67, 10), item(4, 'Wooden Rod of Lightning Bolts', 67, 10)];
    assert.equal(recentItem(itemRecent('z', 'Zap', rods[1]), { pack: rods, equip: [] })?.item.i, 4);
    assert.equal(recentItem({ ...itemRecent('z', 'Zap', rods[1]), name: 'Wooden Rod of Light' }, { pack: rods, equip: [] }), null);

    const ring = item(5, 'Ring of Speed', 45, 30);
    const worn: EquipSlot = { ...item(28, 'Ring of Speed', 45, 30), part: 28 };
    const activate = itemRecent('A', 'Activate', ring);
    assert.deepEqual(recentItem({ ...activate, i: undefined }, { pack: [ring], equip: [{ i: 24, part: 24, empty: 1 }, worn] })?.place, 'equip');
    assert.equal(recentItem(activate, { pack: [ring], equip: [worn] })?.item.i, 5);
    assert.equal(recentItemAction(activate, ring)?.command, 'A');
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

  it('follows a menu path by labels, and fires at the target, else the nearest foe', () => {
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
    const atTarget = fireMacro();
    atTarget.next();
    assert.deepEqual(atTarget.next(screen("Direction ('5' for target, '*' to re-target, Escape to cancel)? ")).value, keys('5'));
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

    const phial = itemRecent('A', 'Activate', { i: 36, tval: 39, sval: 4, base: 'Phial of Galadriel' });
    watcher.useItem(phial);
    assert.equal(watcher.idle('(Equip: a-l, / for Inven, ESC) Activate which item? ', false), null);
    assert.deepEqual(watcher.idle('', true), { ...phial, aimed: false });
    watcher.useItem(phial);
    assert.deepEqual(watcher.idle(aim, false), { ...phial, aimed: true });
    watcher.useItem(phial);
    watcher.note('(Equip: a-l, / for Inven, ESC) Activate which item? ', '', 27, false);
    assert.equal(watcher.idle('', true), null);
  });

  it('splits tome2\'s skill actions into magic arts and techniques, leaving school spells and stealing out', () => {
    const spells = {
      ready: 1,
      books: [],
      bonus: [],
      items: [],
      powers: [
        { label: 'Cast a spell', mkey: 17 },
        { label: 'Use Necromancy', mkey: 7 },
        { label: 'Copy a spell', mkey: 19 },
        { label: 'Fire piercing shots', mkey: 23 },
        { label: 'Steal object', mkey: 15 },
        { label: 'Change melee mode', mkey: 0 },
      ],
    };
    assert.deepEqual(magicArts(spells).map((p) => p.label), ['Use Necromancy', 'Copy a spell']);
    assert.deepEqual(techniques(spells).map((p) => p.label), ['Fire piercing shots', 'Change melee mode']);
    const dodger: SpellState = { ready: 1, books: [], bonus: [], items: [], powers: [{ label: 'Check dodge chance', mkey: 16 }] };
    assert.equal(hasActivePowers(dodger), false);
    assert.equal(hasActivePowers(spells), true);
    assert.equal(hasActivePowers({ ...dodger, items: [{ i: 28, base: 'Ring of Speed', tval: 45, sval: 30, command: 'A' }] }), true);
  });

  it('labels recents, and drops entries it does not know', () => {
    assert.equal(recentLabel({ kind: 'path', command: 'U', steps: ["Thunderlord's Powers", 'Thunder strike'] }), 'Thunder strike');
    assert.equal(recentLabel({ kind: 'path', command: 'm', steps: ['Cast a thaumaturgy spell', '#a', 'Fire bolt'] }), 'Fire bolt');
    assert.equal(recentSource({ kind: 'path', command: 'm', steps: ['Cast a thaumaturgy spell', '#a', 'Fire bolt'] }), 'Thaumaturgy');
    assert.equal(recentLabel({ kind: 'path', command: 'U', steps: ['blink'] }), 'Blink');
    assert.equal(recentLabel({ kind: 'path', command: 'm', steps: ['Use Necromancy'] }), 'Necromancy');
    assert.equal(recentSource({ kind: 'path', command: 'm', steps: ['Use Mimicry'] }), 'Technique');
    assert.equal(recentSource({ kind: 'path', command: 'm', steps: ['Copy a spell'] }), 'Magic');
    const oil = itemRecent('v', 'Throw', { i: 0, tval: 77, sval: 0, base: 'Flask of oil' });
    assert.equal(recentItemAction(oil, { tval: 77 })?.command, 'v');
    assert.ok(!validRecent({ kind: 'power', skill: 'x', power: 'y' }));
    assert.ok(!validRecent({ kind: 'item', command: 'q', tval: 71 }));
    assert.ok(validRecent({ kind: 'spell', name: 'Manathrust' }));
  });

  describe('quick repeat', () => {
    const spell = (name: string, extra = {}) => ({ name, school: 'arcane', level: 1, mana: 2, fail: 10, info: '', ok: 1, short: 0, desc: '', skill: 1, blind: 0, confused: 0, stat: 1, manaMin: 1, manaMax: 2, piety: 0, instrument: 0, ...extra });
    const spells: SpellState = {
      ready: 1,
      books: [{ i: 0, name: 'Magic Book', spells: [spell('Manathrust'), spell('Phase Door', { short: 1 })] }],
      powers: [{ label: 'Use Mindcraft', mkey: 2 }],
      bonus: [{ name: 'Spit', desc: '', source: 'race', from: 'Dragon', level: 5, cost: 1, stat: 4, diff: 10 }],
      items: [],
    };
    const wand: ItemState = { i: 2, name: 'a Wand of Magic Missile (5 charges)', base: 'Wand of Magic Missile', tval: 65, sval: 1, number: 1, weight: 1, ch: 45, attr: 1, wear: 0, activate: 0, ins: '' };
    const carrying = (charges: number) => ({ ...spells, items: [{ i: 2, base: 'Wand of Magic Missile', tval: 65, sval: 1, command: 'a', charges, fail: 10 } as MagicItem] });
    const carried = { pack: [wand], equip: [] };
    const nothing = { pack: [], equip: [] };
    const bolt: RecentAction = { kind: 'spell', name: 'Manathrust' };
    const aimedWand: RecentAction = { ...itemRecent('a', 'Aim', wand), aimed: true };

    it('keeps spells, powers and items used as magic still had, and drops those not', () => {
      const spit: RecentAction = { kind: 'path', command: 'U', steps: ['Spit'] };
      const potion = itemRecent('q', 'Quaff', { i: 3, tval: 71, sval: 4, base: 'Potion of Cure Light Wounds' });
      assert.deepEqual(usableRecents([bolt, { kind: 'spell', name: 'Gone' }, spit, aimedWand, potion], carrying(5), carried), [bolt, spit, aimedWand]);
      assert.deepEqual(usableRecents([aimedWand], spells, carried), []);
    });

    it('repeats the last usable spell or device of a caster, else their first spell, else a power', () => {
      const gone: RecentAction = { kind: 'spell', name: 'Gone' };
      assert.deepEqual(quickRecent([gone, aimedWand, bolt], carrying(5), carried, true, 1), aimedWand);
      assert.deepEqual(quickRecent([gone, aimedWand, bolt], spells, carried, true, 1), bolt);
      assert.deepEqual(quickRecent([gone], spells, nothing, true, 1), { kind: 'spell', name: 'Manathrust' });
      const noBooks = { ...spells, books: [] };
      assert.deepEqual(quickRecent([], noBooks, nothing, true, 5), { kind: 'path', command: 'U', steps: ['Spit'] });
      assert.equal(quickRecent([], noBooks, nothing, true, 4), null);
    });

    it('repeats only the last aimed thing still carried for a hero who does not cast', () => {
      assert.deepEqual(quickRecent([bolt, aimedWand], carrying(5), carried, false, 1), aimedWand);
      assert.equal(quickRecent([bolt, aimedWand], carrying(5), nothing, false, 1), null);
      assert.equal(quickRecent([bolt, { ...aimedWand, aimed: false }], carrying(5), carried, false, 1), null);
    });

    it('says why a recent action cannot be done', () => {
      assert.equal(recentBlocked({ kind: 'spell', name: 'Phase Door' }, spells, nothing, false, true), 'Not enough mana for Phase Door.');
      assert.equal(recentBlocked(aimedWand, carrying(0), carried, false, true), 'The Wand of Magic Missile has no charges left.');
      assert.equal(recentBlocked(aimedWand, carrying(3), carried, true, false), NO_TARGET);
      assert.equal(recentBlocked(aimedWand, carrying(3), carried, false, false), null);
      assert.equal(recentBlocked(bolt, spells, nothing, true, true), null);
    });

    it('says why an item cannot be used as magic now', () => {
      const ring: MagicItem = { i: 5, base: 'Ring of Speed', tval: 45, sval: 30, command: 'A', effect: 'haste self (20+d20 turns) every 100+d100 turns', fail: 4 };
      assert.equal(magicItemRefusal(ring, 'Ring of Speed'), null);
      assert.equal(magicItemRefusal({ ...ring, wear: 1 }, 'Ring of Speed'), 'Wear the Ring of Speed to activate it.');
      assert.equal(magicItemRefusal({ ...ring, charging: 1 }, 'Ring of Speed'), 'The Ring of Speed is still recharging.');
      assert.equal(magicItemRefusal({ ...ring, command: 'z', charging: 1 }, 'Rod of Light'), 'The Rod of Light is still charging.');
    });
  });
});
