import { el, iconText } from './dom.ts';

/** A button in a pop-up's footer. */
export interface PopAction {
  /** Stable name for tests and styling (data-action). */
  id?: string;
  label: string;
  icon?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
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

function actionButton(action: PopAction): HTMLButtonElement {
  const button = el('button', `sheet-action${action.primary ? ' primary' : ''}${action.danger ? ' danger' : ''}`);
  button.type = 'button';
  button.dataset.nav = '';
  if (action.id) button.dataset.action = action.id;
  if (action.icon) button.append(el('span', 'pop-icon', iconText(action.icon)));
  button.append(el('span', 'pop-label', action.label));
  if (action.disabled) button.disabled = true;
  button.addEventListener('click', () => action.run());
  return button;
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
  if (tabs.length && actions.length) {
    const sub = el('div', 'pop-row pop-sub');
    sub.append(...actions.map(actionButton));
    rows.push(sub);
  }
  if (tabs.length) {
    const main = el('div', 'pop-row pop-tabs');
    main.setAttribute('role', 'tablist');
    main.append(...tabs.map(tabButton));
    rows.push(main);
  } else if (actions.length) {
    const main = el('div', 'pop-row pop-main');
    main.append(...actions.map(actionButton));
    rows.push(main);
  }
  footer.replaceChildren(...rows);
  footer.hidden = rows.length === 0;
}
