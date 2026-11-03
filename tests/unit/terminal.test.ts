import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDownloadStatus } from '../../web/src/engine.ts';
import { TerminalBuffer, rgbToCss } from '../../web/src/terminal.ts';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('TerminalBuffer', () => {
  it('starts blank', () => {
    const term = new TerminalBuffer(10, 3);
    assert.equal(term.screenText(), '\n\n');
  });

  it('draws text with attributes', () => {
    const term = new TerminalBuffer(10, 3);
    term.drawText(2, 1, 4, bytes('abc'));
    assert.equal(term.rowText(1), '  abc     ');
    assert.equal(term.attrs[1 * 10 + 3], 4);
  });

  it('clips text at the edges', () => {
    const term = new TerminalBuffer(5, 2);
    term.drawText(3, 0, 1, bytes('xyz'));
    term.drawText(-1, 1, 1, bytes('pq'));
    term.drawText(0, 5, 1, bytes('ignored'));
    assert.equal(term.screenText(), '   xy\nq');
  });

  it('clears content and cursor', () => {
    const term = new TerminalBuffer(4, 2);
    term.drawText(0, 0, 3, bytes('abcd'));
    term.setCursor(1, 1);
    term.clear();
    assert.equal(term.screenText(), '\n');
    assert.equal(term.cursorY, -1);
  });

  it('sets palette entries and ignores unknown ones', () => {
    const term = new TerminalBuffer(4, 2);
    term.setColour(1, 250, 250, 250);
    assert.equal(term.palette[1], 'rgb(250, 250, 250)');
    assert.deepEqual(term.paletteRgb[1], [250 / 255, 250 / 255, 250 / 255]);
    term.setColour(999, 1, 2, 3);
    assert.equal(term.palette.length, 256);
  });
});

describe('rgbToCss', () => {
  it('clamps and rounds', () => {
    assert.equal(rgbToCss(-5, 127.6, 300), 'rgb(0, 128, 255)');
  });
});

describe('parseDownloadStatus', () => {
  it('extracts download progress from Emscripten status text', () => {
    assert.equal(parseDownloadStatus('Downloading data... (512/1024)'), 0.5);
    assert.equal(parseDownloadStatus('Running...'), null);
    assert.equal(parseDownloadStatus('Downloading data... (5/0)'), null);
  });
});

describe('soft cursor', () => {
  it('is cleared when text is drawn over it', () => {
    const term = new TerminalBuffer(10, 2);
    term.setCursor(3, 1);
    term.drawText(0, 1, 1, bytes('ab'));
    assert.equal(term.cursorX, 3);
    term.drawText(2, 1, 1, bytes('xyz'));
    assert.equal(term.cursorX, -1);
    assert.equal(term.cursorY, -1);
  });
});
