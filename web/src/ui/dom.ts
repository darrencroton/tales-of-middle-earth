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

export interface ButtonOptions {
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
