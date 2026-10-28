import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { choiceKey, parseRows, splitCells, type ChoiceBlock, type TermRow, type TextBlock } from '../../web/src/ui/termparse.ts';

const WIDTH = 80;

function row(text: string, attr = 1, colours: [number, number, number][] = []): TermRow {
  const chars = new Uint8Array(WIDTH).fill(0x20);
  const attrs = new Uint8Array(WIDTH).fill(attr);
  for (let i = 0; i < text.length && i < WIDTH; i++) chars[i] = text.charCodeAt(i);
  for (const [from, to, a] of colours) attrs.fill(a, from, to);
  return { chars, attrs };
}

describe('terminal parsing', () => {
  it('splits cells on wide gaps but keeps sentences together', () => {
    const cells = splitCells(row('Name  : Grodon          STR:  28'), 0, WIDTH - 1);
    assert.deepEqual(cells.map((c) => c.text), ['Name', ': Grodon', 'STR:', '28']);
    const prose = splitCells(row('Please answer the following questions.  Most of the questions'), 0, WIDTH - 1);
    assert.equal(prose.length, 1);
  });

  it('recognises menu keys', () => {
    assert.deepEqual(choiceKey('[a] Human'), { key: 'a', current: true, length: 3 });
    assert.deepEqual(choiceKey('b) Half-Elf'), { key: 'b', current: false, length: 2 });
    assert.deepEqual(choiceKey('a - 19) Copy a spell'), { key: 'a', current: false, length: 3 });
    assert.equal(choiceKey('Name : Grodon'), null);
    assert.equal(choiceKey('ab) nope'), null);
  });

  it('splits a row of columns into separate choices', () => {
    const blocks = parseRows([row(' [a] Human       b) Half-Elf    c) Elf')], 18, 0, WIDTH - 1);
    const choices = blocks as ChoiceBlock[];
    assert.deepEqual(choices.map((c) => [c.key, c.label.text, c.current]), [
      ['a', 'Human', true],
      ['b', 'Half-Elf', false],
      ['c', 'Elf', false],
    ]);
  });

  it('splits choices packed into one column', () => {
    const blocks = parseRows([row('  k) Half-Ogre   l) Beorning    m) Kobold      n) Petty-Dwarf o) Dark-Elf')], 18, 0, WIDTH - 1);
    assert.deepEqual((blocks as ChoiceBlock[]).map((c) => [c.key, c.label.text]), [
      ['k', 'Half-Ogre'],
      ['l', 'Beorning'],
      ['m', 'Kobold'],
      ['n', 'Petty-Dwarf'],
      ['o', 'Dark-Elf'],
    ]);
  });

  it('splits a highlighted choice drawn straight after a full column', () => {
    const blocks = parseRows([row('  k) Half-Ogre   l) Beorning    m) Kobold      n) Petty-Dwarf[o] Dark-Elf')], 18, 0, WIDTH - 1);
    assert.deepEqual((blocks as ChoiceBlock[]).map((c) => [c.key, c.label.text, c.current]), [
      ['k', 'Half-Ogre', false],
      ['l', 'Beorning', false],
      ['m', 'Kobold', false],
      ['n', 'Petty-Dwarf', false],
      ['o', 'Dark-Elf', true],
    ]);
    const tail = parseRows([row('  p) Ent         q) RohanKnight[r] Thunderlord s) DeathMold   t) Yeek')], 21, 0, WIDTH - 1);
    assert.deepEqual((tail as ChoiceBlock[]).map((c) => c.label.text), ['Ent', 'RohanKnight', 'Thunderlord', 'DeathMold', 'Yeek']);
  });

  it('keeps item symbols and trailing columns as metadata', () => {
    const blocks = parseRows([row('a) , 7 Rations of Food                      7.0 lb', 1, [[3, 4, 15]])], 1, 0, WIDTH - 1);
    const [choice] = blocks as ChoiceBlock[];
    assert.equal(choice.key, 'a');
    assert.deepEqual(choice.symbol, { text: ',', attr: 15 });
    assert.equal(choice.label.text, '7 Rations of Food');
    assert.deepEqual(choice.meta.map((m) => m.text), ['7.0 lb']);
  });

  it('joins wrapped prose into one paragraph', () => {
    const lines = [
      row('You carry a long sword, which is a fine weapon forged by the elves of old,'),
      row('and it gleams in the light.'),
      row(''),
      row('Short line.'),
    ];
    const blocks = parseRows(lines, 1, 0, WIDTH - 1);
    assert.equal(blocks.length, 3);
    assert.match((blocks[0] as TextBlock).cells[0].text, /old, and it gleams/);
    assert.equal(blocks[1].kind, 'gap');
  });

  it('reads option rows as on/off settings', () => {
    const blocks = parseRows([row('Preserve artifacts                    : yes   (preserve)'), row('Always make small levels              : no    (always_small_level)')], 2, 0, WIDTH - 1);
    assert.deepEqual(blocks, [
      { kind: 'option', row: 2, label: 'Preserve artifacts', value: true, name: 'preserve' },
      { kind: 'option', row: 3, label: 'Always make small levels', value: false, name: 'always_small_level' },
    ]);
  });

  it('treats ASCII art as preformatted', () => {
    const art = [row('   ======/   =====     ~ ~~~   ~~~    ('), row("  /  //     /  __ \\    )~ ,.~ (   (")];
    const blocks = parseRows(art, 1, 0, WIDTH - 1);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'pre');
  });
});
