export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Symbol text forced to plain text presentation, so iOS does not draw
 * arrows, gears and ticks as colour emoji.
 */
export function iconText(symbol: string): string {
  return `${symbol}\uFE0E`;
}

interface ButtonOptions {
  className?: string;
  icon?: string;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** A navigable button: list navigation picks up anything with data-nav. */
export function navButton(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const button = el('button', options.className ?? 'row-button');
  button.type = 'button';
  button.dataset.nav = '';
  if (options.icon !== undefined) button.append(el('span', 'row-icon', iconText(options.icon)));
  button.append(el('span', 'row-label', label));
  if (options.hint) button.append(el('span', 'row-hint', options.hint));
  if (options.disabled) button.disabled = true;
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}

export function glyph(ch: number, colour: string): HTMLElement {
  const g = el('span', 'glyph', String.fromCharCode(ch));
  g.style.color = colour;
  return g;
}

/** What tome2 said before a question, as a block above it. */
export function leadIn(lines: readonly string[]): HTMLElement {
  const node = el('div', 'lead-in');
  for (const line of lines) node.append(el('p', undefined, line));
  return node;
}

export function section(title: string, ...children: Node[]): HTMLElement {
  const node = el('section', 'sheet-section');
  node.append(el('h3', undefined, title), ...children);
  return node;
}

/** A labelled value in a stat grid (`className` adds a tone such as good or bad). */
export function stat(label: string, value: string, className = ''): HTMLElement {
  const node = el('div', `stat ${className}`.trim());
  node.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return node;
}

/** A bonus with its sign: +3, -2, +0. */
export function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

/** A whole number with thousands separators: 12,345. */
export function count(n: number): string {
  return n.toLocaleString('en-GB');
}

export function fraction(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

/** A labelled progress bar (`kind` selects the colour class). */
export function bar(kind: string, label: string, value: number, max: number): HTMLElement {
  const node = el('div', `bar bar-${kind}`);
  node.style.setProperty('--fill', `${(fraction(value, max) * 100).toFixed(1)}%`);
  node.append(el('span', 'bar-label', label), el('span', 'bar-value', `${value}/${max}`));
  return node;
}

/** A how-many stepper: −, the number, + and All. */
export interface Stepper {
  element: HTMLElement;
  readonly value: number;
  /** ArrowLeft or − takes one, ArrowRight or + adds one; true when the key was used. */
  handleKey(e: KeyboardEvent): boolean;
}

/**
 * A stepper choosing a number from one to `max`, starting at `initial`;
 * `onChange` gets each new number. Its buttons are not list rows, so arrows
 * up and down keep moving through the pop-up's rows.
 */
export function stepper(max: number, initial: number, onChange: (n: number) => void = () => undefined): Stepper {
  const most = Math.max(1, max);
  const clamp = (n: number) => Math.max(1, Math.min(most, n));
  let value = clamp(initial);
  const shown = el('span', 'stepper-value', String(value));
  shown.setAttribute('aria-live', 'polite');
  const set = (n: number) => {
    const next = clamp(n);
    if (next === value) return;
    value = next;
    shown.textContent = String(value);
    onChange(value);
  };
  const button = (label: string, to: () => number, className = 'stepper-button') => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', () => set(to()));
    return b;
  };
  const element = el('div', 'stepper');
  element.append(button('−', () => value - 1), shown, button('+', () => value + 1), button(`All ${most}`, () => most, 'stepper-button wide'));
  return {
    element,
    get value() {
      return value;
    },
    handleKey(e) {
      const step = e.key === 'ArrowLeft' || e.key === '-' ? -1 : e.key === 'ArrowRight' || e.key === '+' ? 1 : 0;
      if (!step) return false;
      set(value + step);
      return true;
    },
  };
}
