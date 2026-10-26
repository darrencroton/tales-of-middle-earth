import { KEY_BACKSPACE, KEY_ENTER, compositionDelta, translateText } from './keys.ts';

/* A hidden text field never left empty, so Backspace is seen as a deletion. */
const SENTINEL = ' ';

/**
 * Turns typing in the hidden text field (the phone's on-screen keyboard)
 * into engine keys, including text composed through an IME.
 */
export function attachSoftKeyboard(input: HTMLInputElement, send: (codes: number[]) => void, ctrlLatched: () => boolean): void {
  let composing = false;
  let composed = '';
  input.value = SENTINEL;

  const typed = () => (input.value.startsWith(SENTINEL) ? input.value.slice(SENTINEL.length) : input.value);

  input.addEventListener('compositionstart', () => {
    composing = true;
    composed = '';
  });

  input.addEventListener('compositionend', () => {
    composing = false;
    composed = '';
    input.value = SENTINEL;
  });

  input.addEventListener('beforeinput', (e) => {
    if (composing || e.isComposing) return;
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      send(translateText(e.data, ctrlLatched()));
    } else if (e.inputType === 'insertLineBreak') {
      e.preventDefault();
      send([KEY_ENTER]);
    } else if (e.inputType.startsWith('delete')) {
      e.preventDefault();
      send([KEY_BACKSPACE]);
    }
  });

  input.addEventListener('input', () => {
    if (composing) {
      const current = typed();
      const delta = compositionDelta(composed, current);
      composed = current;
      send([...Array<number>(delta.backspaces).fill(KEY_BACKSPACE), ...translateText(delta.text, ctrlLatched())]);
      return;
    }
    const value = input.value;
    if (value === SENTINEL) return;
    send(value === '' ? [KEY_BACKSPACE] : translateText(typed(), ctrlLatched()));
    input.value = SENTINEL;
  });
}
