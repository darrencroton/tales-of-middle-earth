import { el, iconText } from './dom.ts';

/** A button in a pop-up's footer. */
export interface PopAction {
  /** Stable name for tests and styling (data-action). */
  id?: string;
  label: string;
  icon?: string;
  primary?: boolean;
  danger?: boolean;
  /** Why it cannot be done now: the button is dimmed, never the default, and a tap says why instead of running it. */
  unavailable?: string | null;
  run(): void;
}

/** One of a pop-up's main views, switched with the row of tabs at its foot. */
export interface PopTab {
  id?: string;
  label: string;
  icon?: string;
  active: boolean;
  /** Why its view cannot be shown now: the tab stays, dimmed, and a tap says so instead. */
  unavailable?: string | null;
  run(): void;
}

/** What a pop-up's header shows: back, a badge, the title and a line under it, a note, and close. */
export interface PopHeader {
  title?: string;
  /** The title element's id (for aria-labelledby). */
  titleId?: string;
  subtitle?: string;
  /** A symbol before the title (an item's or creature's glyph). */
  badge?: HTMLElement;
  /** Small text after the title (gold in a shop). */
  note?: string;
  /** Shows a back button. */
  back?: () => void;
  /** Shows a close button. */
  close?: () => void;
}

/** Fills a pop-up's header, one row: back, badge, title and subtitle, note, close. */
export function renderHeader(header: HTMLElement, options: PopHeader): void {
  const button = (className: string, text: string, label: string, run: () => void) => {
    const node = el('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.addEventListener('click', run);
    return node;
  };
  const parts: HTMLElement[] = [];
  if (options.back) parts.push(button('sheet-back', '‹', 'Back', options.back));
  if (options.badge) {
    const badge = el('span', 'sheet-badge');
    badge.append(options.badge);
    parts.push(badge);
  }
  const titles = el('div', 'sheet-titles');
  if (options.title) {
    const title = el('h2', 'sheet-title', options.title);
    if (options.titleId) title.id = options.titleId;
    titles.append(title);
  }
  if (options.subtitle) titles.append(el('p', 'sheet-subtitle', options.subtitle));
  parts.push(titles);
  if (options.note) parts.push(el('span', 'sheet-note', options.note));
  if (options.close) parts.push(button('sheet-close', '✕', 'Close', options.close));
  header.replaceChildren(...parts);
}

let refusal: (reason: string) => void = () => undefined;

/** How a tap on an unavailable action says why (a toast and a sound, in the game). */
export function setRefusal(refuse: (reason: string) => void): void {
  refusal = refuse;
}

function actionButton(action: PopAction, primary: boolean): HTMLButtonElement {
  const unavailable = action.unavailable;
  const button = el('button', `sheet-action${primary ? ' primary' : ''}${action.danger ? ' danger' : ''}${unavailable ? ' unavailable' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  if (action.id) button.dataset.action = action.id;
  if (action.icon) button.append(el('span', 'pop-icon', iconText(action.icon)));
  button.append(el('span', 'pop-label', action.label));
  if (unavailable) button.setAttribute('aria-description', unavailable);
  button.addEventListener('click', () => (unavailable ? refusal(unavailable) : action.run()));
  return button;
}

/**
 * The footer's default action: the one marked primary, or else the only
 * action that can be done (unless it is destructive); never one that cannot.
 */
function defaultAction(actions: readonly PopAction[]): PopAction | null {
  const usable = actions.filter((a) => !a.unavailable);
  const marked = usable.find((a) => a.primary);
  if (marked) return marked;
  return usable.length === 1 && !usable[0].danger ? usable[0] : null;
}

/**
 * What a pop-up highlights when nothing else is asked for: its first row
 * that can be used (a dimmed shop row still opens its card), else the
 * footer's default action, else the tab of the view shown, else its first
 * row, else the footer's first usable button.
 */
export function defaultItem(body: HTMLElement, footer: HTMLElement): HTMLElement | null {
  const rows = [...body.querySelectorAll<HTMLElement>('[data-nav]')];
  return (
    rows.find((row) => !row.matches('.unavailable')) ??
    footer.querySelector<HTMLElement>('.sheet-action.primary') ??
    footer.querySelector<HTMLElement>('.pop-tab.selected') ??
    rows[0] ??
    footer.querySelector<HTMLElement>('[data-nav]:not(.unavailable)')
  );
}

function tabButton(tab: PopTab): HTMLButtonElement {
  const button = el('button', `pop-tab${tab.active ? ' selected' : ''}${tab.unavailable ? ' unavailable' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  if (tab.id) button.dataset.tab = tab.id;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', String(tab.active));
  if (tab.icon) button.append(el('span', 'pop-icon', iconText(tab.icon)));
  button.append(el('span', 'pop-label', tab.label));
  if (tab.unavailable) button.setAttribute('aria-description', tab.unavailable);
  button.addEventListener('click', () => {
    if (tab.unavailable) refusal(tab.unavailable);
    else if (!tab.active) tab.run();
  });
  return button;
}

/**
 * Fills a pop-up's footer. The main row sits at the very bottom and never
 * moves: the tabs when the pop-up has several views, otherwise its actions.
 * With tabs, the current view's own actions sit just above them, smaller.
 */
export function renderFooter(footer: HTMLElement, actions: readonly PopAction[], tabs: readonly PopTab[] = []): void {
  const rows: HTMLElement[] = [];
  const primary = defaultAction(actions);
  const button = (action: PopAction) => actionButton(action, action === primary);
  if (tabs.length && actions.length) {
    const sub = el('div', 'pop-row pop-sub');
    sub.append(...actions.map(button));
    rows.push(sub);
  }
  if (tabs.length) {
    const row = el('div', 'pop-row pop-tabs');
    row.setAttribute('role', 'tablist');
    row.append(...tabs.map(tabButton));
    rows.push(row);
  } else if (actions.length) {
    const row = el('div', 'pop-row pop-main');
    row.append(...actions.map(button));
    rows.push(row);
  }
  footer.replaceChildren(...rows);
  footer.hidden = rows.length === 0;
}
