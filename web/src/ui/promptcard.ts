import { KEY_ENTER as ENTER, KEY_ESCAPE as ESCAPE, keyCodes as codes, typedAnswer } from '../input/keys.ts';
import { bracketChoices, choiceQuestion, type PromptKind } from '../play/prompts.ts';
import { el, iconText } from './dom.ts';
import { cleanPrompt } from './prompttext.ts';
import type { MessageBox } from './msgbox.ts';

export type CardKind = Extract<PromptKind, 'yesno' | 'quantity' | 'text' | 'direction' | 'aim' | 'choice'>;

/* Keypad digits in screen order, with their arrows and names; the centre cancels. */
const PAD: [string, string, string][] = [
  ['7', '↖', 'North-west'],
  ['8', '↑', 'North'],
  ['9', '↗', 'North-east'],
  ['4', '←', 'West'],
  ['', '✕', 'Cancel'],
  ['6', '→', 'East'],
  ['1', '↙', 'South-west'],
  ['2', '↓', 'South'],
  ['3', '↘', 'South-east'],
];

/** The value tome2 pre-fills after a prompt's colon ("Quantity (1-6): 1" → "1"). */
export function promptDefault(text: string): string {
  const colon = text.lastIndexOf(':');
  return colon < 0 ? '' : text.slice(colon + 1).trim();
}

/** Highest quantity offered by "Quantity (1-6):", or null. */
export function quantityLimit(text: string): number | null {
  const m = /\((\d+)\s*-\s*(\d+)\)/.exec(text);
  return m ? Number(m[2]) : null;
}

/**
 * Native card for tome2's questions: yes/no, how many, a line of text, a
 * direction, or a target. It sits at the bottom of the map so the map can
 * still be tapped (to aim, or to pick a neighbouring square).
 */
export class PromptCard {
  private readonly root: HTMLElement;
  private readonly send: (keys: number[]) => void;
  private renderedKey = '';
  private showPad = false;

  constructor(parent: HTMLElement, send: (keys: number[]) => void) {
    this.send = send;
    this.root = el('div', 'prompt-card');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.renderedKey = '';
    this.showPad = false;
  }

  show(kind: CardKind, raw: string, canTargetLast = false): void {
    const key = `${kind}\u0000${raw}\u0000${this.showPad}`;
    this.root.hidden = false;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.root.className = `prompt-card ${kind}`;
    switch (kind) {
      case 'yesno':
        this.yesNo(raw);
        break;
      case 'choice':
        this.choice(raw);
        break;
      case 'quantity':
        this.quantity(raw);
        break;
      case 'text':
        this.text(raw);
        break;
      case 'direction':
        this.direction();
        break;
      case 'aim':
        this.aim(canTargetLast);
        break;
    }
  }

  /** A question or notice tome2 drew in a box over the screen. */
  showBox(box: MessageBox): void {
    const key = `box\u0000${box.kind}\u0000${box.text}`;
    this.root.hidden = false;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.root.className = `prompt-card ${box.kind}`;
    const buttons = el('div', 'card-buttons');
    let primary: HTMLButtonElement;
    if (box.kind === 'yesno') {
      primary = this.button('Yes', codes('y'), 'card-button primary');
      buttons.append(this.button('No', codes('n')), primary);
    } else if (box.kind === 'choice') {
      buttons.append(this.button('Cancel', [ESCAPE]));
      for (const choice of box.choices) buttons.append(this.button(choice.label, codes(choice.key)));
      primary = buttons.lastElementChild as HTMLButtonElement;
    } else {
      primary = this.button('OK', codes(' '), 'card-button primary');
      buttons.append(primary);
    }
    this.root.replaceChildren(this.title(box.text), buttons);
    primary.focus({ preventScroll: true });
  }

  /**
   * The hero has died: what killed them and Continue (which declines
   * tome2's screen dump and leads to the end-of-game summary).
   */
  showDeath(cause: string): void {
    const key = `death\u0000${cause}`;
    this.root.hidden = false;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const retired = /^Quitting$/i.test(cause);
    this.root.className = 'prompt-card death';
    const buttons = el('div', 'card-buttons');
    const primary = this.button('Continue', codes('n'), 'card-button primary');
    buttons.append(primary);
    const fate = retired ? 'You have retired from adventuring.' : cause ? `Killed by ${cause}.` : 'Your adventure has ended.';
    this.root.replaceChildren(
      this.title(retired ? 'Your journey ends' : 'You have died'),
      el('p', 'card-fate', fate),
      el('p', 'card-hint', 'Tap your hero, or the creatures still around you, to look back on the last fight.'),
      buttons,
    );
    primary.focus({ preventScroll: true });
  }

  private answer(keys: number[]): void {
    this.hide();
    this.send(keys);
  }

  private button(label: string, keys: number[] | (() => void), className = 'card-button'): HTMLButtonElement {
    const button = el('button', className, label);
    button.type = 'button';
    button.addEventListener('click', () => (typeof keys === 'function' ? keys() : this.answer(keys)));
    return button;
  }

  private title(text: string): HTMLElement {
    return el('p', 'card-title', text);
  }

  private yesNo(raw: string): void {
    let question = cleanPrompt(raw);
    if (!/[?!.]$/.test(question)) question += '?';
    const buttons = el('div', 'card-buttons');
    const yes = this.button('Yes', codes('y'), 'card-button primary');
    buttons.append(this.button('No', codes('n')), yes);
    this.root.replaceChildren(this.title(question), buttons);
    yes.focus({ preventScroll: true });
  }

  /** tome2's "[S]hots, [A]rrows or [B]olts?" questions, one button per choice. */
  private choice(raw: string): void {
    const buttons = el('div', 'card-buttons choices');
    buttons.append(this.button('Cancel', [ESCAPE]));
    for (const choice of bracketChoices(raw)) {
      const button = this.button(choice.label, codes(choice.key));
      button.dataset.choice = choice.key;
      buttons.append(button);
    }
    this.root.replaceChildren(this.title(choiceQuestion(raw)), buttons);
    (buttons.children[1] as HTMLElement | undefined)?.focus({ preventScroll: true });
  }

  private quantity(raw: string): void {
    const max = quantityLimit(raw) ?? 99;
    let value = Math.max(1, Math.min(max, Number(promptDefault(raw)) || 1));
    const shown = el('span', 'stepper-value', String(value));
    const set = (n: number) => {
      value = Math.max(1, Math.min(max, n));
      shown.textContent = String(value);
    };
    const stepper = el('div', 'stepper');
    stepper.append(
      this.button('−', () => set(value - 1), 'stepper-button'),
      shown,
      this.button('+', () => set(value + 1), 'stepper-button'),
      this.button(`All ${max}`, () => set(max), 'stepper-button wide'),
    );
    const buttons = el('div', 'card-buttons');
    buttons.append(
      this.button('Cancel', [ESCAPE]),
      this.button('OK', () => this.answer([...codes(String(value)), ENTER]), 'card-button primary'),
    );
    this.root.replaceChildren(this.title('How many?'), stepper, buttons);
  }

  private text(raw: string): void {
    const initial = promptDefault(raw);
    const form = el('form', 'card-form');
    const input = el('input');
    input.type = 'text';
    input.value = initial;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'off');
    input.enterKeyHint = 'done';
    input.setAttribute('aria-label', cleanPrompt(raw));
    const buttons = el('div', 'card-buttons');
    buttons.append(this.button('Cancel', [ESCAPE]), this.button('OK', () => form.requestSubmit(), 'card-button primary'));
    form.append(input, buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      input.blur();
      this.answer(typedAnswer(input.value.trim(), initial));
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        input.blur();
        this.answer([ESCAPE]);
      }
    });
    this.root.replaceChildren(this.title(cleanPrompt(raw)), form);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  private pad(): HTMLElement {
    const grid = el('div', 'direction-pad');
    for (const [digit, arrow, name] of PAD) {
      const button = this.button(iconText(arrow), digit ? codes(digit) : [ESCAPE], digit ? 'pad-button' : 'pad-button cancel');
      button.setAttribute('aria-label', name);
      grid.append(button);
    }
    return grid;
  }

  private direction(): void {
    this.root.replaceChildren(this.title('Which direction?'), el('p', 'card-hint', 'Or tap a square next to you.'), this.pad());
  }

  private aim(canTargetLast: boolean): void {
    const buttons = el('div', 'card-buttons');
    buttons.append(this.button('Cancel', [ESCAPE]));
    buttons.append(
      this.button(this.showPad ? 'Hide directions' : 'Direction', () => {
        this.showPad = !this.showPad;
        this.renderedKey = '';
        this.aim(canTargetLast);
      }),
    );
    if (canTargetLast) buttons.append(this.button('Current target', codes('5')));
    buttons.append(this.button('Nearest', codes('*t'), 'card-button primary'));
    const parts: HTMLElement[] = [this.title('Choose a target'), el('p', 'card-hint', 'Tap a creature or a place on the map.')];
    if (this.showPad) parts.push(this.pad());
    parts.push(buttons);
    this.root.replaceChildren(...parts);
  }
}
