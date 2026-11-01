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
  run(): void;
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
export function defaultAction(actions: readonly PopAction[]): PopAction | null {
  const usable = actions.filter((a) => !a.unavailable);
  const marked = usable.find((a) => a.primary);
  if (marked) return marked;
  return usable.length === 1 && !usable[0].danger ? usable[0] : null;
}

/**
 * What a pop-up highlights when nothing else is asked for: its first row
 * that can be used (else its first row), else the footer's default action,
 * else the tab of the view shown, else the footer's first usable button.
 */
export function defaultItem(body: HTMLElement, footer: HTMLElement): HTMLElement | null {
  const rows = [...body.querySelectorAll<HTMLElement>('[data-nav]')];
  return (
    rows.find((row) => !row.matches('.unavailable, .dim')) ??
    rows[0] ??
    footer.querySelector<HTMLElement>('.sheet-action.primary') ??
    footer.querySelector<HTMLElement>('.pop-tab.selected') ??
    footer.querySelector<HTMLElement>('[data-nav]:not(.unavailable)')
  );
}

function tabButton(tab: PopTab): HTMLButtonElement {
  const button = el('button', `pop-tab${tab.active ? ' selected' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  if (tab.id) button.dataset.tab = tab.id;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', String(tab.active));
  if (tab.icon) button.append(el('span', 'pop-icon', iconText(tab.icon)));
  button.append(el('span', 'pop-label', tab.label));
  button.addEventListener('click', () => {
    if (!tab.active) tab.run();
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
