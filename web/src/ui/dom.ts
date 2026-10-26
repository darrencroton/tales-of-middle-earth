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

export function section(title: string, ...children: Node[]): HTMLElement {
  const node = el('section', 'sheet-section');
  node.append(el('h3', undefined, title), ...children);
  return node;
}
