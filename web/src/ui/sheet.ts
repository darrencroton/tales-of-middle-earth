import { el } from './dom.ts';
import { ListNav } from './listnav.ts';
import { renderFooter, type PopAction, type PopTab } from './popup.ts';

/* Downward swipe on a sheet's header (CSS pixels) that dismisses it. */
const SWIPE_CLOSE = 60;

export type SheetAction = PopAction;
export type SheetTab = PopTab;

export interface SheetContent {
  title: string;
  subtitle?: string;
  /** Glyph shown before the title. */
  badge?: HTMLElement;
  body: HTMLElement;
  /** Buttons at the foot of the sheet (above the tabs, when there are tabs). */
  actions?: SheetAction[];
  /** The sheet's views, as a fixed row at its foot. */
  tabs?: SheetTab[];
  /** Sheets keep one tall size so they do not jump as their content changes; short questions fit their content. */
  size?: 'fit';
  /** Keys for the sheet's own content, before list navigation; true when used. */
  onKey?(e: KeyboardEvent): boolean;
  /** Element to highlight first (defaults to the first navigable item). */
  initial?: HTMLElement | null;
  className?: string;
  onClose?(): void;
  /** Builds the sheet afresh when it is reopened after a tome2 screen. */
  rebuild?(): SheetContent | null;
}

/** Where a sheet was left: its highlighted item (an index into its navigable items) and scroll offset. */
interface SheetPlace {
  index: number;
  scroll: number;
}

/** Open sheets saved while a tome2 screen covers them. */
export interface SheetTrail {
  stack: SheetContent[];
  places: (SheetPlace | undefined)[];
}

/**
 * Native panels (inventory, character, menus, information) shown over the
 * game. Sheets stack: a sheet opened from another gets a back button.
 * Tapping outside, Escape or the close button dismisses them.
 */
export class Sheets {
  private readonly layer: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly header: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly nav: ListNav;
  private stack: SheetContent[] = [];
  /** Where to return to on each sheet below the top. */
  private readonly remembered = new WeakMap<SheetContent, SheetPlace>();
  private readonly onChange: () => void;
  private restoreFocus: Element | null = null;

  constructor(root: HTMLElement, onChange: () => void = () => undefined) {
    this.onChange = onChange;
    this.layer = el('div', 'sheet-layer');
    this.layer.hidden = true;
    const backdrop = el('div', 'sheet-backdrop');
    this.panel = el('section', 'sheet');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.tabIndex = -1;

    this.header = el('header', 'sheet-header');
    this.backButton = el('button', 'sheet-back', '‹');
    this.backButton.type = 'button';
    this.backButton.setAttribute('aria-label', 'Back');
    this.badgeEl = el('span', 'sheet-badge');
    const titles = el('div', 'sheet-titles');
    this.titleEl = el('h2', 'sheet-title');
    this.titleEl.id = 'sheet-title';
    this.panel.setAttribute('aria-labelledby', this.titleEl.id);
    this.subtitleEl = el('p', 'sheet-subtitle');
    titles.append(this.titleEl, this.subtitleEl);
    const close = el('button', 'sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    this.header.append(this.backButton, this.badgeEl, titles, close);

    this.body = el('div', 'sheet-body');
    this.footer = el('footer', 'sheet-actions');
    this.panel.append(this.header, this.body, this.footer);
    this.layer.append(backdrop, this.panel);
    root.append(this.layer);
    this.nav = new ListNav(this.panel, this.body);

    backdrop.addEventListener('click', () => this.closeAll());
    let dragStart: number | null = null;
    this.header.addEventListener(
      'touchstart',
      (e) => {
        dragStart = e.touches.length === 1 ? e.touches[0].clientY : null;
      },
      { passive: true },
    );
    this.header.addEventListener('touchend', (e) => {
      const start = dragStart;
      dragStart = null;
      const end = e.changedTouches[0]?.clientY;
      if (start !== null && end !== undefined && end - start > SWIPE_CLOSE) this.closeAll();
    });
    close.addEventListener('click', () => this.closeAll());
    this.backButton.addEventListener('click', () => this.back());
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** The sheet on top is this one. */
  isTop(content: SheetContent): boolean {
    return this.stack[this.stack.length - 1] === content;
  }

  /** Opens a sheet on top of any already open. */
  open(content: SheetContent): void {
    if (this.stack.length === 0) this.restoreFocus = document.activeElement;
    else this.rememberActive();
    this.stack.push(content);
    this.show();
  }

  /** The open sheets, to reopen with `restore` (null when none are open). */
  snapshot(): SheetTrail | null {
    if (this.stack.length === 0) return null;
    this.rememberActive();
    return { stack: [...this.stack], places: this.stack.map((c) => this.remembered.get(c)) };
  }

  /** Reopens saved sheets over whatever is open, rebuilding those that can be. */
  restore(trail: SheetTrail): void {
    const stack: SheetContent[] = [];
    trail.stack.forEach((saved, i) => {
      const content = saved.rebuild ? saved.rebuild() : saved;
      if (!content) return;
      const place = trail.places[i];
      if (place) this.remembered.set(content, place);
      stack.push(content);
    });
    if (stack.length === 0) return;
    if (this.stack.length === 0) this.restoreFocus = document.activeElement;
    else this.rememberActive();
    this.stack.push(...stack);
    this.show();
  }

  /** Replaces the top sheet (or opens one). */
  replace(content: SheetContent): void {
    if (this.stack.length === 0) {
      this.open(content);
      return;
    }
    this.stack[this.stack.length - 1] = content;
    this.show();
  }

  back(): void {
    const top = this.stack.pop();
    top?.onClose?.();
    if (this.stack.length > 0) this.show();
    else this.hide();
  }

  closeAll(): void {
    const closing = this.stack.reverse();
    this.stack = [];
    for (const sheet of closing) sheet.onClose?.();
    this.hide();
  }

  /** Keyboard handling while a sheet is open; always consumes the key. */
  handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.back();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select')) return;
    const top = this.stack[this.stack.length - 1];
    const onControl = (e.key === 'Enter' || e.key === ' ') && !!target?.closest('button') && target !== this.panel;
    if (!onControl && top?.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    /* A focused button activates itself on Enter or Space. */
    if ((e.key === 'Enter' || e.key === ' ') && target?.closest('button, a') && target !== this.panel) return;
    if (e.key === 'Backspace' && this.stack.length > 1) {
      e.preventDefault();
      this.back();
      return;
    }
    if (this.nav.handleKey(e)) {
      e.preventDefault();
      this.nav.active?.focus({ preventScroll: true });
    }
  }

  /**
   * Swaps the top sheet's content in place, keeping its scroll position and
   * highlight (for views that update as the game answers).
   */
  update(content: SheetContent, previous?: SheetContent): void {
    const at = previous ? this.stack.indexOf(previous) : this.stack.length - 1;
    if (at < 0) return;
    if (at < this.stack.length - 1) {
      this.stack[at] = content;
      return;
    }
    const activeKey = this.nav.active?.dataset.key;
    const scroll = this.body.scrollTop;
    this.stack[this.stack.length - 1] = content;
    this.render(content);
    this.body.scrollTop = scroll;
    const same = activeKey ? this.nav.items().find((item) => item.dataset.key === activeKey) : undefined;
    const fallback = this.body.querySelector<HTMLElement>('[data-nav]') ?? this.footer.querySelector<HTMLElement>('.pop-tab.selected, .primary');
    this.nav.setActive(content.initial ?? same ?? fallback, !!content.initial);
  }

  private render(top: SheetContent): void {
    this.panel.className = `sheet ${top.size === 'fit' ? 'sheet-fit' : 'sheet-tall'} ${top.className ?? ''}`.trim();
    this.titleEl.textContent = top.title;
    this.subtitleEl.textContent = top.subtitle ?? '';
    this.subtitleEl.hidden = !top.subtitle;
    this.badgeEl.replaceChildren(...(top.badge ? [top.badge] : []));
    this.badgeEl.hidden = !top.badge;
    this.backButton.hidden = this.stack.length < 2;
    this.body.replaceChildren(top.body);
    renderFooter(this.footer, top.actions ?? [], top.tabs ?? []);
  }

  private show(): void {
    const top = this.stack[this.stack.length - 1];
    this.render(top);
    this.body.scrollTop = 0;
    const wasHidden = this.layer.hidden;
    this.layer.hidden = false;
    if (wasHidden) this.panel.focus({ preventScroll: true });
    const fallback =
      this.body.querySelector<HTMLElement>('[data-nav]') ??
      this.footer.querySelector<HTMLElement>('.primary, .pop-tab.selected') ??
      null;
    const place = this.remembered.get(top);
    if (place) this.body.scrollTop = place.scroll;
    const previous = place ? this.nav.items()[place.index] : null;
    this.nav.setActive(previous ?? top.initial ?? fallback, false);
    this.onChange();
  }

  private rememberActive(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    const active = this.nav.active;
    this.remembered.set(top, { index: active ? this.nav.items().indexOf(active) : -1, scroll: this.body.scrollTop });
  }

  private hide(): void {
    this.layer.hidden = true;
    this.body.replaceChildren();
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
    this.onChange();
  }
}
