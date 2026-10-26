export const KEY_BACKSPACE = 8;
export const KEY_TAB = 9;
export const KEY_ENTER = 13;
export const KEY_ESCAPE = 27;
export const KEY_BACKSLASH = 92;
export const KEY_DELETE = 127;

const RUN_COMMAND = 46; // '.' in the original keyset, reached via '\' to bypass keymaps

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DIRECTION_KEYS: Readonly<Record<string, string>> = {
  ArrowUp: '8',
  ArrowDown: '2',
  ArrowLeft: '4',
  ArrowRight: '6',
  Home: '7',
  End: '1',
  PageUp: '9',
  PageDown: '3',
  Clear: '5',
};

const SPECIAL_KEYS: Readonly<Record<string, number>> = {
  Enter: KEY_ENTER,
  Escape: KEY_ESCAPE,
  Backspace: KEY_BACKSPACE,
  Tab: KEY_TAB,
  Delete: KEY_DELETE,
};

export function directionKeys(digit: string, run: boolean): number[] {
  const code = digit.charCodeAt(0);
  return run ? [KEY_BACKSLASH, RUN_COMMAND, code] : [code];
}

export function controlCode(ch: string): number | null {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return code & 0x1f;
  return null;
}

/**
 * Translates a keyboard event into the byte sequence the engine expects.
 * Returns null when the event should be left to the browser.
 */
export function translateKey(event: KeyLike, ctrlLatched = false): number[] | null {
  if (event.metaKey || (event.altKey && !event.ctrlKey)) return null;

  const direction = DIRECTION_KEYS[event.key];
  if (direction) return directionKeys(direction, event.shiftKey);

  const special = SPECIAL_KEYS[event.key];
  if (special !== undefined) return [special];

  if (event.key.length !== 1) return null;

  const code = event.key.charCodeAt(0);
  if (code > 0xff) return null;

  if (event.ctrlKey || ctrlLatched) {
    const ctrl = controlCode(event.key);
    return ctrl === null ? null : [ctrl];
  }

  return [code];
}

/**
 * Translates text from a soft keyboard (input events) into engine bytes.
 */
export function translateText(text: string, ctrlLatched = false): number[] {
  const codes: number[] = [];
  for (const ch of text) {
    if (ctrlLatched) {
      const ctrl = controlCode(ch);
      if (ctrl !== null) codes.push(ctrl);
      continue;
    }
    if (ch === '\n') {
      codes.push(KEY_ENTER);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (ch.length === 1 && code <= 0xff) codes.push(code);
  }
  return codes;
}

/**
 * Difference between successive IME composition strings, as backspaces to
 * undo and new text to send, so composed text reaches the game exactly once.
 * Backspaces cover only characters that were actually sent.
 */
export function compositionDelta(previous: string, next: string): { backspaces: number; text: string } {
  let common = 0;
  while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
  return { backspaces: translateText(previous.slice(common)).length, text: next.slice(common) };
}
