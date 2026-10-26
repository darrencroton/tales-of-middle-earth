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
