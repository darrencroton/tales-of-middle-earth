import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KEY_BACKSLASH,
  KEY_BACKSPACE,
  KEY_ENTER,
  KEY_ESCAPE,
  controlCode,
  directionKeys,
  keyCodes,
  translateKey,
  translateText,
  typedAnswer,
  type KeyLike,
} from '../../web/src/input/keys.ts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('translateKey', () => {
  it('passes printable characters through', () => {
    assert.deepEqual(translateKey(key('a')), [97]);
    assert.deepEqual(translateKey(key('Q', { shiftKey: true })), [81]);
    assert.deepEqual(translateKey(key('?')), [63]);
  });

  it('maps arrow and navigation keys to keypad digits', () => {
    assert.deepEqual(translateKey(key('ArrowUp')), [56]);
    assert.deepEqual(translateKey(key('ArrowDown')), [50]);
    assert.deepEqual(translateKey(key('ArrowLeft')), [52]);
    assert.deepEqual(translateKey(key('ArrowRight')), [54]);
    assert.deepEqual(translateKey(key('Home')), [55]);
    assert.deepEqual(translateKey(key('PageDown')), [51]);
  });

  it('runs with shift+arrow using the keymap-bypassing run command', () => {
    assert.deepEqual(translateKey(key('ArrowLeft', { shiftKey: true })), [KEY_BACKSLASH, 46, 52]);
  });

  it('maps special keys', () => {
    assert.deepEqual(translateKey(key('Enter')), [KEY_ENTER]);
    assert.deepEqual(translateKey(key('Escape')), [KEY_ESCAPE]);
    assert.deepEqual(translateKey(key('Backspace')), [KEY_BACKSPACE]);
  });

  it('applies control from the modifier or the latch', () => {
    assert.deepEqual(translateKey(key('s', { ctrlKey: true })), [0x13]);
    assert.deepEqual(translateKey(key('x'), true), [0x18]);
    assert.equal(translateKey(key('1', { ctrlKey: true })), null);
  });

  it('leaves browser shortcuts and unknown keys alone', () => {
    assert.equal(translateKey(key('r', { metaKey: true })), null);
    assert.equal(translateKey(key('a', { altKey: true })), null);
    assert.equal(translateKey(key('F5')), null);
    assert.equal(translateKey(key('Unidentified')), null);
    assert.equal(translateKey(key('€')), null);
  });
});

describe('translateText', () => {
  it('converts text and newlines', () => {
    assert.deepEqual(translateText('ab\n'), [97, 98, KEY_ENTER]);
  });

  it('drops characters outside Latin-1', () => {
    assert.deepEqual(translateText('a😀b'), [97, 98]);
  });

  it('applies the control latch', () => {
    assert.deepEqual(translateText('s', true), [0x13]);
  });
});

describe('helpers', () => {
  it('computes control codes', () => {
    assert.equal(controlCode('a'), 1);
    assert.equal(controlCode('Z'), 26);
    assert.equal(controlCode('['), 27);
    assert.equal(controlCode('1'), null);
  });

  it('builds direction sequences', () => {
    assert.deepEqual(directionKeys('9', false), [57]);
    assert.deepEqual(directionKeys('9', true), [KEY_BACKSLASH, 46, 57]);
  });
});

describe('compositionDelta', async () => {
  const { compositionDelta } = await import('../../web/src/input/keys.ts');

  it('sends only newly composed characters', () => {
    assert.deepEqual(compositionDelta('', 'a'), { backspaces: 0, text: 'a' });
    assert.deepEqual(compositionDelta('a', 'ab'), { backspaces: 0, text: 'b' });
  });

  it('backspaces over replaced or deleted characters', () => {
    assert.deepEqual(compositionDelta('teh', 'the'), { backspaces: 2, text: 'he' });
    assert.deepEqual(compositionDelta('abc', 'ab'), { backspaces: 1, text: '' });
  });

  it('does not backspace over characters that were never sent', () => {
    assert.deepEqual(compositionDelta('a日', 'a'), { backspaces: 0, text: '' });
    assert.deepEqual(compositionDelta('a日b', 'a'), { backspaces: 1, text: '' });
  });
});

describe('text for the engine', () => {
  it('drops characters outside Latin-1 instead of turning them into control keys', () => {
    assert.deepEqual(keyCodes('čR10'), [82, 49, 48]);
    assert.deepEqual(keyCodes('@r1'), [64, 114, 49]);
  });

  it('answers a pre-filled prompt: keep, clear or replace', () => {
    assert.deepEqual(typedAnswer('@r1', '@r1'), [KEY_ENTER]);
    assert.deepEqual(typedAnswer('', '@r1'), [KEY_BACKSPACE, KEY_ENTER]);
    assert.deepEqual(typedAnswer('x', '@r1'), [120, KEY_ENTER]);
  });
});
