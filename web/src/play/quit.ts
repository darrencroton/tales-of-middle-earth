import { KEY_BACKSLASH as BACKSLASH, KEY_ENTER, KEY_ESCAPE, keyCodes } from '../input/keys.ts';
import type { Macro } from './macro.ts';

const CTRL_X = 0x18;

/** Leaves the end-of-game summary; stops at the Hall of Fame, which has its own Continue (the game ends at once when there are no scores to show). */
export function* leaveTombMacro(): Macro {
  let s = yield [KEY_ESCAPE];
  for (let i = 0; i < 8 && /-more-/.test(s.prompt); i++) s = yield [KEY_ESCAPE];
}

/** Leaves the Hall of Fame at the end of a game, which ends it. */
export function* finishMacro(): Macro {
  let s = yield [KEY_ESCAPE];
  for (let i = 0; i < 8; i++) {
    if (/Press ESC to quit/.test(s.screen) || /-more-/.test(s.prompt)) s = yield [KEY_ESCAPE];
    else return;
  }
}

/** Ends the adventure through tome2's own quit (`Q`), confirming it. */
export function* abandonMacro(): Macro {
  let s = yield [KEY_ESCAPE, KEY_ESCAPE, KEY_ESCAPE];
  for (let i = 0; i < 6 && !s.atCommand; i++) s = yield [KEY_ESCAPE];
  s = yield [BACKSLASH, ...keyCodes('Q')];
  if (/really want to quit|want to retire/.test(s.prompt)) s = yield keyCodes('y');
  if (/verify QUITTING/.test(s.prompt)) s = yield keyCodes('@');
  for (let i = 0; i < 12; i++) {
    if (s.atCommand) return;
    s = yield [KEY_ESCAPE];
  }
}

/** Saves and quits (`^X`), passing the screens that follow. */
export function* quitMacro(): Macro {
  let s = yield [KEY_ESCAPE, KEY_ESCAPE, KEY_ESCAPE];
  for (let i = 0; i < 6 && !s.atCommand; i++) s = yield [KEY_ESCAPE];
  s = yield [BACKSLASH, CTRL_X];
  for (let i = 0; i < 8; i++) {
    if (/Press ESC to quit/.test(s.screen)) s = yield [KEY_ESCAPE];
    else if (/Press Return|-more-/.test(s.prompt)) s = yield [KEY_ENTER];
    else return;
  }
}
