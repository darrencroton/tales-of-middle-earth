import { KEY_ENTER as ENTER, KEY_ESCAPE as ESCAPE, keyCodes as codes, typedAnswer } from '../input/keys.ts';
import { RETURN_KEYS } from '../play/death.ts';
import { bracketChoices, choiceQuestion, type PromptKind } from '../play/prompts.ts';
import { el, iconText, leadIn, stepper, type Stepper } from './dom.ts';
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

/* Where a prompt's question ends: after its colon, else its question mark ("Engrave what? "). */
function questionEnd(text: string): number {
  const colon = text.lastIndexOf(':');
  return colon >= 0 ? colon + 1 : text.indexOf('?') + 1;
}

/** The value tome2 pre-fills after a prompt's question ("Quantity (1-6): 1" → "1"). */
function promptDefault(text: string): string {
  const end = questionEnd(text);
  return end > 0 ? text.slice(end).trim() : '';
}

/** Highest quantity offered by "Quantity (1-6):", or null. */
function quantityLimit(text: string): number | null {
  const m = /\((\d+)\s*-\s*(\d+)\)/.exec(text);
  return m ? Number(m[2]) : null;
}

/** What the card between death and life offers. */
interface ReturnOffer {
  /** What killed the hero. */
  cause: string;
  /** Deaths the hero has returned from before this one. */
  deaths: number;
  /** What returning to the battlefield means from here. */
  battlefield: string;
  /** What returning to safety means, or why it cannot be done. */
  safety: { text: string } | { refusal: string };
  /** Says why a choice cannot be made (a toast and the refusal sound). */
  refuse(why: string): void;
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
  /** The card shows what tome2 said before its question. */
  private leading = false;
  /** The how-many stepper, while the quantity card shows it. */
  private amount: Stepper | null = null;
  /** The stepper has changed the number tome2 shows. */
  private amountMoved = false;

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

  /** Shown with what tome2 said just before asking, which the message log can leave to it. */
  get hasLead(): boolean {
    return this.visible && this.leading;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.renderedKey = '';
    this.showPad = false;
    this.leading = false;
  }

  /** Shows a question; `lead` is what tome2 said just before asking it. */
  show(kind: CardKind, raw: string, canTargetLast = false, lead: readonly string[] = []): void {
    const key = `${kind}\u0000${raw}\u0000${this.showPad}\u0000${lead.join('\n')}`;
    this.root.hidden = false;
    this.leading = lead.length > 0;
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
    if (lead.length) {
      const said = leadIn(lead);
      this.root.prepend(said);
      said.scrollTop = said.scrollHeight;
    }
  }

  /** A question or notice tome2 drew in a box over the screen. */
  showBox(box: MessageBox): void {
    const key = `box\u0000${box.kind}\u0000${box.text}`;
    this.root.hidden = false;
    this.leading = false;
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
    this.leading = false;
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

  /**
   * Between death and life (tome2's question from engine/adventure.cc): the
   * hero may return where they fell or to the last town, or accept death,
   * which is asked once more.
   */
  showReturn(offer: ReturnOffer): void {
    const key = `return\u0000${offer.cause}\u0000${offer.deaths}\u0000${offer.battlefield}\u0000${JSON.stringify(offer.safety)}`;
    this.root.hidden = false;
    this.leading = false;
    if (key === this.renderedKey || `${key}\u0000accept` === this.renderedKey) return;
    this.renderedKey = key;
    this.root.className = 'prompt-card between';
    const count = el('p', 'between-deaths', `Deaths so far: ${offer.deaths}. Returning lowers your score a little.`);
    const battle = this.choiceButton('Return to the battlefield', offer.battlefield, () => this.answer(codes(RETURN_KEYS.battlefield)), 'primary');
    const offered = offer.safety;
    const safety =
      'text' in offered
        ? this.choiceButton('Return to safety', offered.text, () => this.answer(codes(RETURN_KEYS.safety)))
        : this.choiceButton('Return to safety', offered.refusal, () => offer.refuse(offered.refusal), 'unavailable');
    const accept = this.choiceButton('Accept death', 'Let go. Your tale ends here.', () => this.confirmDeath(offer), 'danger');
    const choices = el('div', 'between-choices');
    choices.append(battle, safety, accept);
    this.root.replaceChildren(
      el('p', 'card-title', 'The Halls of Waiting'),
      el('p', 'card-fate', offer.cause ? `Killed by ${offer.cause}.` : 'You have fallen.'),
      el('p', 'between-words', 'Darkness, then a grey hall beyond the walls of the world. A voice like the sea: “Your thread is not yet cut. Will you go back?”'),
      count,
      choices,
    );
    battle.focus({ preventScroll: true });
  }

  /** Accepting death, asked once more: the adventure ends for good. */
  private confirmDeath(offer: ReturnOffer): void {
    this.renderedKey += '\u0000accept';
    const buttons = el('div', 'card-buttons');
    const back = this.button('Go back', () => {
      this.renderedKey = '';
      this.showReturn(offer);
    });
    buttons.append(back, this.button('Accept death', codes(RETURN_KEYS.accept), 'card-button danger'));
    this.root.replaceChildren(
      el('p', 'card-title', 'Accept death?'),
      el('p', 'card-fate', 'Your adventure ends here, and cannot be taken up again.'),
      buttons,
    );
    back.focus({ preventScroll: true });
  }

  private choiceButton(label: string, detail: string, run: () => void, kind = ''): HTMLButtonElement {
    const button = el('button', `between-choice ${kind}`.trim());
    button.type = 'button';
    button.append(el('span', 'between-choice-label', label), el('span', 'between-choice-detail', detail));
    button.addEventListener('click', run);
    return button;
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
    this.amountMoved = false;
    const amount = stepper(quantityLimit(raw) ?? 99, Number(promptDefault(raw)) || 1, () => (this.amountMoved = true));
    this.amount = amount;
    const buttons = el('div', 'card-buttons');
    buttons.append(
      this.button('Cancel', [ESCAPE]),
      this.button('OK', () => this.answerQuantity(), 'card-button primary'),
    );
    this.root.replaceChildren(this.title('How many?'), amount.element, buttons);
  }

  private answerQuantity(): void {
    if (this.amount) this.answer([...codes(String(this.amount.value)), ENTER]);
  }

  /**
   * Keys for the how-many card: ArrowLeft/ArrowRight (or − and +) change the
   * number, and Enter answers with it once they have; other keys go to
   * tome2's prompt, which the card follows.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible || !this.amount?.element.isConnected) return false;
    if (e.key === 'Enter' && this.amountMoved) {
      this.answerQuantity();
      return true;
    }
    return this.amount.handleKey(e);
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
    this.root.replaceChildren(this.title(cleanPrompt(raw.slice(0, questionEnd(raw) || undefined))), form);
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
