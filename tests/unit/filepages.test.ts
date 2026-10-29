import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilePages, fileLines, parseHelpFile, viewerHeading, viewerSource } from '../../web/src/ui/filepages.ts';
import type { TermRow } from '../../web/src/ui/termparse.ts';

const WIDTH = 40;

function row(text: string): TermRow {
  const chars = new Uint8Array(WIDTH).fill(0x20);
  const attrs = new Uint8Array(WIDTH).fill(1);
  for (let i = 0; i < text.length && i < WIDTH; i++) chars[i] = text.charCodeAt(i);
  return { chars, attrs };
}

const text = (r: TermRow) => String.fromCharCode(...Array.from(r.chars)).trimEnd();

/** A page of `height` rows showing lines from `top` of a file whose line n reads "line n". */
function page(top: number, height: number, size: number): TermRow[] {
  return Array.from({ length: height }, (_, i) => row(top + i < size ? `line ${top + i}` : ''));
}

describe('file viewer pages', () => {
  it('reads the heading of knowledge and help files', () => {
    assert.deepEqual(viewerHeading('[ToME 2.4.1 (ah, git), Known Uniques, Line 20/45]'), { caption: 'Known Uniques', line: 20, size: 45 });
    assert.deepEqual(viewerHeading("[ToME 2.4.0, Help file 'help.hlp', Line 1/33]"), { caption: "Help file 'help.hlp'", line: 1, size: 33 });
    assert.equal(viewerHeading('Inventory: carrying 20.7 lb'), null);
  });

  it('gathers every page from the top into the whole file', () => {
    const file = new FilePages({ caption: 'Kills', line: 0, size: 45 }, 20);
    assert.equal(file.add(0, page(0, 20, 45)), true);
    assert.equal(file.add(20, page(20, 20, 45)), true);
    assert.equal(file.add(40, page(40, 20, 45)), false);
    assert.ok(file.complete);
    assert.equal(file.rows.length, 45);
    assert.equal(text(file.rows[44]), 'line 44');
    assert.equal(file.rowOf(37), 37);
  });

  it('wraps round to the lines above a file opened part-way down', () => {
    const file = new FilePages({ caption: "Help file 'a.txt'", line: 37, size: 70 }, 20);
    assert.equal(file.add(37, page(37, 20, 70)), true);
    assert.equal(file.add(57, page(57, 20, 70)), true);
    assert.equal(file.add(0, page(0, 20, 70)), true);
    assert.equal(file.add(20, page(20, 20, 70)), false);
    assert.equal(file.rows.length, 70);
    assert.deepEqual(file.rows.map(text), Array.from({ length: 70 }, (_, i) => `line ${i}`));
    assert.equal(file.rowOf(37), 37);
  });

  it('stops when a page comes round again (help files hide their colour line)', () => {
    const file = new FilePages({ caption: "Help file 'b.txt'", line: 1, size: 30 }, 20);
    assert.equal(file.add(1, page(1, 20, 30)), true);
    assert.equal(file.add(21, page(21, 20, 30)), true);
    assert.equal(file.add(1, page(1, 20, 30)), false);
    assert.ok(file.complete);
    assert.equal(file.rows.length, 29);
  });

  it('goes back for the top of a short file opened part-way down', () => {
    const file = new FilePages({ caption: "Help file 'c.txt'", line: 10, size: 15 }, 20);
    assert.equal(file.add(10, page(10, 20, 15)), true);
    assert.equal(file.add(0, page(0, 20, 15)), false);
    assert.deepEqual(file.rows.map(text), Array.from({ length: 15 }, (_, i) => `line ${i}`));
    assert.equal(file.rowOf(10), 10);
  });

  it('is whole at once when empty', () => {
    const file = new FilePages({ caption: 'Fate status', line: 0, size: 0 }, 20);
    assert.equal(file.add(0, page(0, 20, 0)), false);
    assert.ok(file.complete);
    assert.equal(file.rows.length, 0);
  });

  it('needs no more pages for a short file and keeps its own copy of the rows', () => {
    const rows = page(0, 20, 5);
    const file = new FilePages({ caption: 'Quest status', line: 0, size: 5 }, 20);
    assert.equal(file.add(0, rows), false);
    (rows[0].chars as Uint8Array).fill(0x41);
    assert.equal(text(file.rows[0]), 'line 0');
    assert.equal(file.rows.length, 5);
    const source = file.source(WIDTH);
    assert.equal(source.chars.length, WIDTH * 5);
  });

  it('reads help links, tags and colours as tome2 does', () => {
    const source = [
      '|||||oy',
      '~~~~~01|Help',
      '#####RWelcome to the help.',
      '    *****/ageneral.txt*0[(a) About this help]  and *****skills.txt*12[skills]',
      '\tSee [[[[[gthe \\] map]{{{{{hidden}*****birth.txt*0[AC]',
    ].join('\r\n');
    const help = parseHelpFile(new TextEncoder().encode(source));
    assert.deepEqual(
      help.links.map((l) => [l.index, l.line, l.col, l.length, l.file, l.anchor, l.key]),
      [
        [0, 3, 4, 19, 'general.txt', 0, 'a'],
        [1, 3, 29, 6, 'skills.txt', 12, ''],
        [2, 4, 21, 2, 'birth.txt', 0, ''],
      ],
    );
    assert.equal(help.tags.get(1), 2);
    assert.equal(help.selected, 11);
    assert.deepEqual(help.lines.get(3)?.map((l) => l.index), [0, 1]);
    assert.deepEqual(viewerSource("Help file 'index.txt'"), { dir: 'help', name: 'index.txt' });
    assert.deepEqual(viewerSource("File 'book-20.txt'"), { dir: 'file', name: 'book-20.txt' });
    assert.equal(viewerSource('Known Uniques'), null);
  });

  it('reads lines with tome2\'s endings and tab stops', () => {
    const bytes = new TextEncoder().encode('a\tb\r\nc\n\rd\re\x01f');
    assert.deepEqual(fileLines(bytes), ['a       b', 'c', 'd', 'ef']);
  });

  it('finds every link of the game\'s help files', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../external/tome2/lib/help');
    for (const name of ['index.txt', 'command.txt', 'dungeon.txt']) {
      const bytes = readFileSync(join(dir, name));
      const help = parseHelpFile(bytes);
      assert.equal(help.links.length, bytes.toString('latin1').split('*****').length - 1, name);
    }
    const commands = parseHelpFile(readFileSync(join(dir, 'command.txt')));
    assert.ok(commands.links.some((l) => l.length === 'a  Aim a wand'.length && l.file === 'command.txt'));
  });
});
