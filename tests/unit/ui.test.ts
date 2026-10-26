import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cursorKeysTo,
  parseBirthChoice,
  parseSaveIndex,
  parseSavefileScreen,
  validCharacterName,
} from '../../web/src/flow/birth.ts';
import { findListedItem, itemActions, itemLetter, itemMacro } from '../../web/src/play/items.ts';
import { MacroRunner, type MacroScreen } from '../../web/src/play/macro.ts';
import { readableColour } from '../../web/src/render/colour.ts';
import type { ItemState } from '../../web/src/render/snapshot.ts';
import { descriptionParagraphs } from '../../web/src/ui/inventory.ts';
import { parseStore, stackSize, storeMacro } from '../../web/src/ui/store.ts';
import { abilityMoveKeys, parseAbilities, parseSkills, skillMoveKeys } from '../../web/src/ui/skills.ts';
import { flagLabel, parseFullSheet, sheetPageKeys } from '../../web/src/ui/charsheet.ts';
import { findMessageBox } from '../../web/src/ui/msgbox.ts';
import { cleanPrompt, isEmptyFile, isFileViewer } from '../../web/src/ui/prompttext.ts';
import { parseRows, type ChoiceBlock, type TermRow } from '../../web/src/ui/termparse.ts';

const codes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const screen = (prompt: string, atCommand = false, text = prompt): MacroScreen => ({ prompt, screen: text, atCommand });

function rows(lines: string[], colours: Record<number, [number, number, number][]> = {}): TermRow[] {
  return Array.from({ length: 24 }, (_, y) => {
    const chars = new Uint8Array(80).fill(0x20);
    const attrs = new Uint8Array(80).fill(1);
    const text = lines[y] ?? '';
    for (let i = 0; i < text.length && i < 80; i++) chars[i] = text.charCodeAt(i);
    for (const [from, to, attr] of colours[y] ?? []) attrs.fill(attr, from, to);
    return { chars, attrs };
  });
}

function item(extra: Partial<ItemState>): ItemState {
  return { i: 0, name: 'a thing', tval: 0, number: 1, weight: 10, ch: 63, attr: 1, wear: 0, activate: 0, ins: '', ...extra };
}

describe('item actions', () => {
  it('offers the use that suits the item first', () => {
    assert.deepEqual(itemActions(item({ tval: 80, number: 3 }), 'pack').map((a) => a.id), ['eat', 'drop', 'dropall', 'throw', 'inscribe', 'destroy']);
    assert.equal(itemActions(item({ tval: 71 }), 'pack')[0].label, 'Quaff');
    assert.equal(itemActions(item({ tval: 23, wear: 1 }), 'pack')[0].label, 'Wield');
    assert.equal(itemActions(item({ tval: 37, wear: 1 }), 'pack')[0].label, 'Wear');
    assert.deepEqual(itemActions(item({ i: 24, tval: 23, wear: 1 }), 'equip').map((a) => a.id), ['takeoff', 'drop', 'inscribe']);
    assert.equal(itemActions(item({ i: -5, tval: 80 }), 'floor')[0].id, 'pickup');
  });

  it('labels pack and equipment slots like tome2', () => {
    assert.equal(itemLetter(0), 'a');
    assert.equal(itemLetter(4), 'e');
    assert.equal(itemLetter(24), 'a');
    assert.equal(itemLetter(28), 'e');
  });

  it('finds a listed item by name', () => {
    const list = ['Floor: a-b', '  a) , 6 Rations of Food      6.0 lb', '  b) ! a Potion of Cure Light Wounds   0.4 lb'].join('\n');
    assert.equal(findListedItem(list, 'a Potion of Cure Light Wounds'), 'b');
    assert.equal(findListedItem(list, 'a Wand of Stinking Cloud'), null);
  });

  it('answers the item prompt, switching lists when needed', () => {
    const runner = new MacroRunner();
    const sword = item({ i: 24, name: 'a Broad Sword', tval: 23, wear: 1 });
    const inspect = { id: 'drop', label: 'Drop', command: 'd', quantity: 'all' as const };
    assert.deepEqual(runner.start(itemMacro(inspect, sword, 'equip')), [92, ...codes('d')]);
    assert.deepEqual(runner.step(screen('(Inven: a-f, / for Equip, ESC) Drop which item?')), codes('/'));
    assert.deepEqual(runner.step(screen('(Equip: a-b, / for Inven, ESC) Drop which item?')), codes('a'));
    assert.deepEqual(runner.step(screen('You drop a Broad Sword.', true)), []);
    assert.equal(runner.running, false);
  });

  it('answers quantity and inscription prompts', () => {
    const runner = new MacroRunner();
    const food = item({ i: 2, name: '6 Rations of Food', tval: 80, number: 6 });
    runner.start(itemMacro({ id: 'dropall', label: 'Drop all', command: 'd', quantity: 'all' }, food, 'pack'));
    assert.deepEqual(runner.step(screen('(Inven: a-f, ESC) Drop which item?')), codes('c'));
    assert.deepEqual(runner.step(screen('Quantity (1-6): 1')), [...codes('6'), 13]);

    runner.start(itemMacro({ id: 'inscribe', label: 'Inscribe', command: '{', needsText: true }, food, 'pack', '@E1'));
    runner.step(screen('(Inven: a-f, ESC) Inscribe which item?'));
    assert.deepEqual(runner.step(screen('Inscription: ')), [...codes('@E1'), 13]);
  });

  it('stops when tome2 says there is nothing to use', () => {
    const runner = new MacroRunner();
    runner.start(itemMacro({ id: 'eat', label: 'Eat', command: 'E' }, item({ tval: 80 }), 'pack'));
    assert.deepEqual(runner.step(screen('You have nothing to eat.', true)), []);
    assert.equal(runner.running, false);
  });

  it('joins wrapped description lines into paragraphs', () => {
    assert.deepEqual(descriptionParagraphs(['It is a fine', 'sword.', '', 'It glows.', ''].join('\n')), ['It is a fine sword.', 'It glows.']);
  });
});

describe('character creation screens', () => {
  const raceScreen = rows(
    [
      '',
      '',
      ' Name  : PLAYER',
      ' Race  :',
      ' Class :',
      '',
      '     Please answer the following questions.  Most of the questions',
      '',
      '',
      '',
      '',
      '',
      ' Humans are the second born, the Edain.',
      ' They are the basic race to which all others are compared.',
      '',
      '',
      '',
      '  Choose a race (a-v), * for a random choice, = for options, 8/2/4/6 for movemen',
      ' [a] Human       b) Half-Elf    c) Elf         d) Hobbit      e) Gnome',
      '  n) Petty-Dwarf o) Dark-Elf',
    ],
    { 12: [[0, 80, 11]], 13: [[0, 80, 11]], 19: [[0, 16, 2]] },
  );
  const text = raceScreen.map((r) => String.fromCharCode(...Array.from(r.chars)).trimEnd()).join('\n');

  it('reads options, the cursor and the description', () => {
    const parsed = parseBirthChoice(raceScreen, text)!;
    assert.equal(parsed.step, 'race');
    assert.deepEqual(parsed.options.map((o) => o.label), ['Human', 'Half-Elf', 'Elf', 'Hobbit', 'Gnome', 'Petty-Dwarf', 'Dark-Elf']);
    assert.equal(parsed.options.find((o) => o.current)?.key, 'a');
    assert.equal(parsed.options.find((o) => o.key === 'n')?.unusual, true);
    assert.deepEqual(parsed.description, ['Humans are the second born, the Edain. They are the basic race to which all others are compared.']);
    assert.deepEqual(parsed.summary, [{ label: 'Name', value: 'PLAYER' }]);
  });

  it('moves the cursor the short way round', () => {
    const options = parseBirthChoice(raceScreen, text)!.options;
    assert.equal(cursorKeysTo(options, 'c'), '66');
    assert.equal(cursorKeysTo(options, 'o'), '4');
    assert.equal(cursorKeysTo(options, 'a'), '');
  });

  it('lists saved characters', () => {
    const lines = ['', '          Welcome to ToME!  To play you will need a character.', '', '', '', 'Create a new character', ' a) New Character     b) Load Savefile     [c] Grodon            d) Elendir'];
    const saves = parseSavefileScreen(rows(lines), lines.join('\n'));
    assert.deepEqual(saves, [
      { letter: 'c', name: 'Grodon' },
      { letter: 'd', name: 'Elendir' },
    ]);
    assert.equal(parseSavefileScreen(rows(['nothing']), 'nothing'), null);
  });

  it('reads the savefile index', () => {
    const index = 'ToME@1Grodon@Grodon, the Ent Warrior is alive\nToME@0Bob@Bob, the Human Mage is dead\n';
    assert.deepEqual(parseSaveIndex(index), [
      { module: 'ToME', alive: true, base: 'Grodon', description: 'Grodon, the Ent Warrior is alive' },
      { module: 'ToME', alive: false, base: 'Bob', description: 'Bob, the Human Mage is dead' },
    ]);
  });

  it('validates names', () => {
    assert.equal(validCharacterName('Elendir'), null);
    assert.ok(validCharacterName(''));
    assert.ok(validCharacterName('A name that is far too long'));
    assert.ok(validCharacterName('../etc'));
  });
});

describe('shops', () => {
  const lines = [
    '',
    '',
    '          Raistlin the Chicken(Human)             General Store (20000)',
    '',
    '   Item Description (Page 1)                                Weight      Price',
    'a) , 28 Strips of Venison                                      0.2          3',
    'b) ~ a Brass Lantern (with 7500 turns of light)                5.0         46',
    '',
    'You may:          s) Sell an item               p) Purchase an item',
    ' ESC) Exit.       x) Examine an item            Z) Steal an item',
    ' SPACE) Next page',
  ];
  const choices = parseRows(rows(lines), 0, 0, 79).filter((b): b is ChoiceBlock => b.kind === 'choice');

  it('recognises the shop and its commands', () => {
    const store = parseStore(lines.join('\n'), choices)!;
    assert.equal(store.commandsRow, 8);
    assert.deepEqual(store.commands.map((c) => [c.key, c.kind]), [
      ['s', 'other'],
      ['p', 'buy'],
      ['x', 'examine'],
      ['Z', 'steal'],
    ]);
    assert.equal(store.hasNextPage, true);
    assert.equal(store.home, false);
    assert.equal(store.page, 1);
    assert.equal(parseStore('just a map', choices), null);
  });

  it('reads stack sizes', () => {
    assert.equal(stackSize('28 Strips of Venison'), 28);
    assert.equal(stackSize('a Brass Lantern'), 1);
  });

  it('buys with the chosen quantity and confirms', () => {
    const runner = new MacroRunner();
    assert.deepEqual(runner.start(storeMacro('p', 'a', 3)), [92, ...codes('p')]);
    assert.deepEqual(runner.step(screen('Which item are you interested in? ')), codes('a'));
    assert.deepEqual(runner.step(screen('Quantity (1-28): 1')), [...codes('3'), 13]);
    assert.deepEqual(runner.step(screen('Buy 3 Strips of Venison? [y/n/RET/ESC]')), codes('y'));
  });
});

describe('text colours', () => {
  it('lightens colours too dark to read on black', () => {
    assert.equal(readableColour('rgb(255, 255, 255)'), 'rgb(255, 255, 255)');
    const blue = readableColour('rgb(0, 64, 255)');
    assert.notEqual(blue, 'rgb(0, 64, 255)');
    assert.equal(readableColour('#123'), '#123');
  });
});

describe('skills screen', () => {
  const lines = [
    '                            ToME Skills Screen',
    'Enter to develop a branch, up/down to move, right/left to modify, ? for help',
    'Skill points left: 2',
    'General ability to fight.',
    '',
    '',
    '',
    '[-]Combat                                                    02.000 [0.800]',
    '     - Weaponmastery                                          01.000 [0.850]',
    '         . Sword-mastery                                      00.000 [0.400]',
    '     + Magic                                                  00.000 [0.000]',
  ];
  const colours: Record<number, [number, number, number][]> = { 3: [[0, 80, 11]], 9: [[0, 80, 3]], 10: [[0, 80, 8]] };
  const screen = parseSkills(rows(lines, colours))!;

  it('reads points, description and the skill tree', () => {
    assert.equal(screen.points, 2);
    assert.equal(screen.description, 'General ability to fight.');
    assert.deepEqual(
      screen.skills.map((s) => [s.name, s.depth, s.branch, s.value, s.mod, s.selected, s.state]),
      [
        ['Combat', 0, 'open', 2, 0.8, true, 'normal'],
        ['Weaponmastery', 1, 'open', 1, 0.85, false, 'normal'],
        ['Sword-mastery', 2, null, 0, 0.4, false, 'learnable'],
        ['Magic', 1, 'closed', 0, 0, false, 'untrained'],
      ],
    );
  });

  it('moves the cursor to a tapped skill', () => {
    assert.equal(skillMoveKeys(screen, screen.skills[2]), '22');
    assert.equal(skillMoveKeys(screen, screen.skills[0]), '');
  });

  it('ignores other screens', () => {
    assert.equal(parseSkills(rows(['Options'])), null);
  });
});

describe('abilities screen', () => {
  const lines = [
    '                            ToME Abilities Screen',
    'up/down to move, right to buy, ? for help',
    'Skill points left: 3',
    'Increases your max possible blows number by 1',
    'Prereq: Combat@20',
    '',
    '',
    ' . Ammo creation                                            8',
    '[.]Extra Max Blow(1)                                        Known',
    ' . Spread blows                                             5',
  ];
  const screen = parseAbilities(rows(lines, { 7: [[0, 61, 8]], 8: [[0, 66, 13]], 9: [[0, 61, 1]] }))!;

  it('reads points, description and abilities', () => {
    assert.equal(screen.points, 3);
    assert.equal(screen.description, 'Increases your max possible blows number by 1 Prereq: Combat@20');
    assert.deepEqual(
      screen.abilities.map((a) => [a.name, a.cost, a.selected, a.state]),
      [
        ['Ammo creation', 8, false, 'locked'],
        ['Extra Max Blow(1)', null, true, 'known'],
        ['Spread blows', 5, false, 'learnable'],
      ],
    );
  });

  it('moves the cursor to a tapped ability', () => {
    assert.equal(abilityMoveKeys(screen, screen.abilities[2]), '2');
    assert.equal(abilityMoveKeys(screen, screen.abilities[0]), '8');
  });

  it('ignores other screens', () => {
    assert.equal(parseAbilities(rows(['ToME Skills Screen'])), null);
  });
});

describe('message boxes', () => {
  const box = (text: string) => {
    const w = text.length + 1;
    const x = 40 - Math.floor((text.length + 1) / 2);
    const lines: string[] = [];
    lines[11] = ' '.repeat(x) + '/' + '-'.repeat(w - 1) + '\\';
    lines[12] = ' '.repeat(x) + '|' + text + '|';
    lines[13] = ' '.repeat(x) + '\\' + '-'.repeat(w - 1) + '/';
    return rows(lines);
  };

  it('reads a yes/no question', () => {
    const found = findMessageBox(box('Learn this ability (this is permanent)? (y/n)'));
    assert.equal(found?.kind, 'yesno');
    assert.equal(found?.text, 'Learn this ability?');
    assert.deepEqual([found?.top, found?.bottom], [11, 13]);
  });

  it('reads lettered choices', () => {
    const found = findMessageBox(box('[D]estroy, [P]ickup, [I]nscribe?'));
    assert.equal(found?.kind, 'choice');
    assert.deepEqual(found?.choices, [
      { label: 'Destroy', key: 'D' },
      { label: 'Pickup', key: 'P' },
      { label: 'Inscribe', key: 'I' },
    ]);
  });

  it('reads a notice and ignores screens without a box', () => {
    assert.equal(findMessageBox(box('You cannot learn this ability.'))?.kind, 'notice');
    assert.equal(findMessageBox(rows(['Hello', '/---- not a box'])), null);
  });
});

describe('full character sheet', () => {
  const footer = "    ['c' to change name, 'f' to file, 'p' for previous, 'n' for next, or ESC]";
  it('reads the summary page', () => {
    const lines = [
      '',
      '',
      ' Name  : Pages                                               STR:     22',
      ' Race  : Human                                               INT:      9',
      ' Class : Warrior                                             WIS:      7',
      ' Body  : Player                                              DEX:     15',
      ' God   : Nobody                                              CON:     14',
      '                                                             CHR:     10',
      ' + To Melee Hit           1 Level              1    Hit Points       19/    19',
      ' + To Melee Damage        3 Experience         0    Spell Points      5/     5',
      ' + To Ranged Hit          1 Max Exp            0    Sanity           10/    10',
      ' + To Ranged Damage       0 Exp to Adv.       10',
      '   AC                   0+1 Gold             100    Speed               Normal',
      '',
      '                         (Miscellaneous Abilities)',
      ' Fighting    : Bad                                     Blows/Round:  1',
      ' Bows/Throw  : Very Bad                                Shots/Round:  1',
      ' Saving Throw: Bad                                     Mel.dmg/Rnd:  3',
      ' Stealth     : Bad                                     Infra-Vision: 0 feet',
      ' Magic Device: Bad                                     Tactic:       normal',
      '                                                       Explor:       normal',
      "              ['t/T' to change tactics, 'e/E' to change movement]",
      footer,
    ];
    const sheet = parseFullSheet(rows(lines, { 15: [[15, 18, 4]] }));
    assert.ok(sheet && 'groups' in sheet);
    const find = (title: string) => sheet.groups.find((g) => g.title === title)!.stats;
    assert.deepEqual(find('Character').map((s) => s.value), ['Pages', 'Human', 'Warrior', 'Player', 'Nobody']);
    assert.deepEqual(find('Attributes').map((s) => `${s.label} ${s.value}`), ['STR 22', 'INT 9', 'WIS 7', 'DEX 15', 'CON 14', 'CHR 10']);
    assert.ok(find('Combat').some((s) => s.label === 'Melee damage per round' && s.value === '3'));
    assert.ok(find('Progress').some((s) => s.label === 'Health' && s.value === '19 / 19'));
    const fighting = find('Skills').find((s) => s.label === 'Fighting');
    assert.deepEqual([fighting?.value, fighting?.tone], ['Bad', 'bad']);
    assert.equal(find('Skills').find((s) => s.label === 'Shooting')?.value, 'Very Bad');
    assert.equal(sheet.tactic, 'normal');
    assert.equal(sheet.movement, 'normal');
  });

  it('reads active flags with their sources', () => {
    const lines: string[] = ['', '', ''];
    lines[3] = '           adefz@                                  adefz@';
    lines[4] = 'Sust Str  :......                       Res Acid  :+...+.';
    lines[5] = 'Sust Int  :......                       Imm Fire  :*.....';
    lines[22] = footer;
    const sheet = parseFullSheet(rows(lines));
    assert.ok(sheet && 'flags' in sheet);
    assert.equal(sheet.page, 2);
    assert.deepEqual(
      sheet.flags.map((f) => [f.label, f.value, f.sources.join('')]),
      [
        ['Resist acid', 'Yes', 'az'],
        ['Immune to fire', 'Immune', 'a'],
      ],
    );
  });

  it('names flags and pages', () => {
    assert.equal(flagLabel('Res Pois'), 'Resist poison');
    assert.equal(flagLabel('Sust Con'), 'Sustain constitution');
    assert.equal(flagLabel('Add Str'), 'Strength');
    assert.equal(flagLabel('Orc.ESP'), 'Sense orcs');
    assert.equal(flagLabel('Free Act'), 'Free action');
    assert.equal(sheetPageKeys(0, 2), 'nn');
    assert.equal(sheetPageKeys(3, 0), 'nn');
  });
});

describe('file viewer headings', () => {
  it('titles knowledge and help files', () => {
    assert.equal(cleanPrompt('[ToME 2.4.1 (ah, git), Artifacts Seen, Line 0/0]'), 'Artifacts Seen');
    assert.equal(cleanPrompt("[ToME 2.4.1 (ah, git), Help file 'help.hlp', Line 1/33]"), 'Help');
    assert.equal(cleanPrompt("[ToME 2.4.1 (ah, git), Help file 'ability.txt', Line 68/113]"), 'Help · Ability');
    assert.ok(isFileViewer('[ToME 2.4.1 (ah, git), Quest status, Line 0/5]'));
    assert.ok(isEmptyFile('[ToME 2.4.1 (ah, git), Fate status, Line 0/0]'));
    assert.ok(!isEmptyFile('[ToME 2.4.1 (ah, git), Quest status, Line 0/5]'));
  });
});
