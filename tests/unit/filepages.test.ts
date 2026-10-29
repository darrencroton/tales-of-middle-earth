import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FilePages, isHelpCaption, linkRuns, selectedLinkCols, viewerHeading } from '../../web/src/ui/filepages.ts';
import type { TermRow } from '../../web/src/ui/termparse.ts';

const WIDTH = 40;
const ORANGE = 3;
const YELLOW = 11;

function row(text: string, colours: [number, number, number][] = []): TermRow {
  const chars = new Uint8Array(WIDTH).fill(0x20);
  const attrs = new Uint8Array(WIDTH).fill(1);
  for (let i = 0; i < text.length && i < WIDTH; i++) chars[i] = text.charCodeAt(i);
  for (const [from, to, a] of colours) attrs.fill(a, from, to);
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
    assert.ok(isHelpCaption("Help file 'general.txt'"));
    assert.ok(!isHelpCaption('Known Uniques'));
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
    assert.equal(file.rowOf(file.start), 37);
  });

  it('stops when a page comes round again (help files hide their colour line)', () => {
    const file = new FilePages({ caption: "Help file 'b.txt'", line: 1, size: 30 }, 20);
    assert.equal(file.add(1, page(1, 20, 30)), true);
    assert.equal(file.add(21, page(21, 20, 30)), true);
    assert.equal(file.add(1, page(1, 20, 30)), false);
    assert.ok(file.complete);
    assert.equal(file.rows.length, 29);
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

  it('finds help links and the selected one', () => {
    const rows = [
      row('(a) About this help     (b) New players', [[0, 19, ORANGE], [24, 39, YELLOW]]),
      row('See the skills help file for details.', [[8, 14, ORANGE]]),
    ];
    const links = linkRuns(rows);
    assert.deepEqual(links.map((l) => [l.index, l.row, l.col, l.text]), [
      [0, 0, 0, '(a) About this help'],
      [1, 0, 24, '(b) New players'],
      [2, 1, 8, 'skills'],
    ]);
    assert.deepEqual(selectedLinkCols(rows[0]), [24]);
    const file = new FilePages({ caption: "Help file 'help.hlp'", line: 0, size: 2 }, 20);
    file.add(0, rows);
    assert.equal(file.linkAt(1, 8), 2);
    assert.equal(file.linkAt(1, 9), null);
  });
});
