import { el } from './dom.ts';
import { ListNav } from './listnav.ts';
import { defaultItem, renderFooter, type PopAction, type PopTab } from './popup.ts';

/* Downward swipe on a sheet's header (CSS pixels) that dismisses it. */
const SWIPE_CLOSE = 60;

export type SheetAction = PopAction;
export type SheetTab = PopTab;

/**
 * How a sheet is presented (docs/ui-system.md):
 * - `panel`: a screen of its own (lists, tabs, long reading) at the one pop-up height, so its controls never move;
 * - `menu`: a short list of places to go, as tall as its rows;
 * - `card`: details or a question about one thing, as tall as its content, floating over whatever opened it.
 * Panels and menus opened from a panel or menu take its place (Back returns); cards and anything opened from a card float above.
 */
export type SheetKind = 'panel' | 'menu' | 'card';

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
  /** Defaults to `panel`. */
  kind?: SheetKind;
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

/** One layer of pop-ups: a backdrop and a frame showing the newest of its sheets. */
class Frame {
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  readonly nav: ListNav;
  readonly entries: SheetContent[] = [];
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly backButton: HTMLButtonElement;

  constructor(id: string, onBack: () => void, onClose: () => void) {
    this.root = el('div', 'sheet-frame');
    const backdrop = el('div', 'sheet-backdrop');
    this.panel = el('section', 'sheet');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.tabIndex = -1;

    const header = el('header', 'sheet-header');
    this.backButton = el('button', 'sheet-back', '‹');
    this.backButton.type = 'button';
    this.backButton.setAttribute('aria-label', 'Back');
    this.badgeEl = el('span', 'sheet-badge');
    const titles = el('div', 'sheet-titles');
    this.titleEl = el('h2', 'sheet-title');
    this.titleEl.id = id;
    this.panel.setAttribute('aria-labelledby', id);
    this.subtitleEl = el('p', 'sheet-subtitle');
    titles.append(this.titleEl, this.subtitleEl);
    const close = el('button', 'sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    header.append(this.backButton, this.badgeEl, titles, close);

    this.body = el('div', 'sheet-body');
    this.footer = el('footer', 'sheet-actions');
    this.panel.append(header, this.body, this.footer);
    this.root.append(backdrop, this.panel);
    this.nav = new ListNav(this.panel, this.body);

    backdrop.addEventListener('click', onClose);
    close.addEventListener('click', onClose);
    this.backButton.addEventListener('click', onBack);
    let dragStart: number | null = null;
    header.addEventListener(
      'touchstart',
      (e) => {
        dragStart = e.touches.length === 1 ? e.touches[0].clientY : null;
      },
      { passive: true },
    );
    header.addEventListener('touchend', (e) => {
      const start = dragStart;
      dragStart = null;
      const end = e.changedTouches[0]?.clientY;
      if (start !== null && end !== undefined && end - start > SWIPE_CLOSE) onClose();
    });
  }

  get top(): SheetContent | undefined {
    return this.entries[this.entries.length - 1];
  }

  set covered(on: boolean) {
    this.root.inert = on;
    this.root.classList.toggle('covered', on);
  }

  render(top: SheetContent, layered: boolean): void {
    const kind = top.kind ?? 'panel';
    this.root.className = `sheet-frame frame-${kind}${layered ? ' layered' : ''}${this.root.inert ? ' covered' : ''}`;
    this.panel.className = `sheet sheet-${kind} ${top.className ?? ''}`.trim();
    this.titleEl.textContent = top.title;
    this.subtitleEl.textContent = top.subtitle ?? '';
    this.subtitleEl.hidden = !top.subtitle;
    this.badgeEl.replaceChildren(...(top.badge ? [top.badge] : []));
    this.badgeEl.hidden = !top.badge;
    this.backButton.hidden = this.entries.length < 2;
    this.body.replaceChildren(top.body);
    renderFooter(this.footer, top.actions ?? [], top.tabs ?? []);
  }

  /** The first thing to highlight when nothing else is asked for. */
  fallback(): HTMLElement | null {
    return defaultItem(this.body, this.footer);
  }

  place(): SheetPlace {
    const active = this.nav.active;
    return { index: active ? this.nav.items().indexOf(active) : -1, scroll: this.body.scrollTop };
  }
}

/**
 * Native pop-ups (inventory, character, menus, information) shown over the
 * game. A panel or menu opened from another takes its place in the same
 * frame, with a back button; a card floats in a frame of its own above
 * whatever opened it, which stays in view, and closing it returns there.
 * Escape goes back one step; the close button, a tap outside or a swipe
 * down on the header closes the frame it belongs to.
 */
export class Sheets {
  private readonly layer: HTMLElement;
  private readonly frames: Frame[] = [];
  private framesMade = 0;
  /** Where to return to on each sheet below the top of its frame. */
  private readonly remembered = new WeakMap<SheetContent, SheetPlace>();
  private readonly onChange: () => void;
  private restoreFocus: Element | null = null;

  constructor(root: HTMLElement, onChange: () => void = () => undefined) {
    this.onChange = onChange;
    this.layer = el('div', 'sheet-layer');
    this.layer.hidden = true;
    root.append(this.layer);
  }

  get isOpen(): boolean {
    return this.frames.length > 0;
  }

  /** Number of sheets open, in all frames. */
  get depth(): number {
    return this.frames.reduce((n, f) => n + f.entries.length, 0);
  }

  private get topFrame(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** The sheet on top is this one. */
  isTop(content: SheetContent): boolean {
    return this.topFrame?.top === content;
  }

  /** Opens a sheet on top of any already open. */
  open(content: SheetContent): void {
    this.push(content);
    this.onChange();
  }

  /** The open sheets, to reopen with `restore` (null when none are open). */
  snapshot(): SheetTrail | null {
    if (!this.isOpen) return null;
    const stack: SheetContent[] = [];
    const places: (SheetPlace | undefined)[] = [];
    for (const frame of this.frames) {
      for (const content of frame.entries) {
        stack.push(content);
        places.push(content === frame.top ? frame.place() : this.remembered.get(content));
      }
    }
    return { stack, places };
  }

  /** Reopens saved sheets over whatever is open, rebuilding those that can be. */
  restore(trail: SheetTrail): void {
    const frames = new Set<Frame>();
    trail.stack.forEach((saved, i) => {
      const content = saved.rebuild ? saved.rebuild() : saved;
      if (!content) return;
      const place = trail.places[i];
      if (place) this.remembered.set(content, place);
      frames.add(this.attach(content));
    });
    if (frames.size === 0) return;
    for (const frame of frames) this.show(frame, this.remembered.get(frame.top!) ?? null);
    this.topFrame?.panel.focus({ preventScroll: true });
    this.onChange();
  }

  /** Replaces the top sheet (or opens one). */
  replace(content: SheetContent): void {
    const frame = this.topFrame;
    if (!frame) {
      this.open(content);
      return;
    }
    frame.entries[frame.entries.length - 1] = content;
    this.show(frame, null);
    this.onChange();
  }

  /** Goes back one step: the previous sheet in the frame, or closes the frame when it holds one sheet. */
  back(): void {
    const frame = this.topFrame;
    if (!frame) return;
    if (frame.entries.length < 2) {
      this.closeFrame(frame);
      return;
    }
    frame.entries.pop()?.onClose?.();
    const top = frame.top;
    if (top) this.show(frame, this.remembered.get(top) ?? null);
    this.onChange();
  }

  closeAll(): void {
    const first = this.frames[0];
    if (first) this.closeFrame(first);
  }

  /** Keyboard handling while a sheet is open; always consumes the key. */
  handleKey(e: KeyboardEvent): void {
    const frame = this.topFrame;
    if (!frame) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.back();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select')) return;
    const top = frame.top;
    const onControl = (e.key === 'Enter' || e.key === ' ') && !!target?.closest('button') && target !== frame.panel;
    if (!onControl && top?.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    /* A focused button activates itself on Enter or Space. */
    if ((e.key === 'Enter' || e.key === ' ') && target?.closest('button, a') && target !== frame.panel) return;
    if (e.key === 'Backspace' && frame.entries.length > 1) {
      e.preventDefault();
      this.back();
      return;
    }
    if (frame.nav.handleKey(e)) {
      e.preventDefault();
      frame.nav.active?.focus({ preventScroll: true });
    }
  }

  /**
   * Swaps a sheet's content in place, keeping its scroll position and,
   * within the same view, its highlight (for views that update as the game
   * answers). `previous` defaults to the top sheet.
   */
  update(content: SheetContent, previous?: SheetContent): void {
    const frame = previous ? this.frames.find((f) => f.entries.includes(previous)) : this.topFrame;
    if (!frame) return;
    const at = previous ? frame.entries.indexOf(previous) : frame.entries.length - 1;
    const view = (c: SheetContent | undefined) => c?.tabs?.find((t) => t.active)?.label;
    const sameView = view(frame.entries[at]) === view(content);
    frame.entries[at] = content;
    if (at < frame.entries.length - 1) return;
    /* The same view rebuilt keeps its highlight's place; another tab starts afresh. */
    const mark = sameView ? frame.nav.mark() : null;
    const scroll = frame.body.scrollTop;
    frame.render(content, this.frames.indexOf(frame) > 0);
    frame.body.scrollTop = scroll;
    frame.nav.setActive(content.initial ?? frame.nav.find(mark) ?? frame.fallback(), !!content.initial);
  }

  /** Highlights an item of an open sheet (its list was rebuilt in place), scrolling it into view. */
  highlight(item: HTMLElement): void {
    this.frames.find((f) => f.body.contains(item))?.nav.setActive(item);
  }

  /** Opens a sheet and shows it, remembering where the one it covers was left. */
  private push(content: SheetContent): void {
    const frame = this.topFrame;
    if (frame?.top) this.remembered.set(frame.top, frame.place());
    const target = this.attach(content);
    this.show(target, this.remembered.get(content) ?? null);
    if (target !== frame) target.panel.focus({ preventScroll: true });
  }

  /** Puts a sheet in the top frame, or in a new frame above it for cards and for anything opened from a card; returns its frame. */
  private attach(content: SheetContent): Frame {
    const frame = this.topFrame;
    if (!frame) this.restoreFocus = document.activeElement;
    if (frame && content.kind !== 'card' && frame.top?.kind !== 'card') {
      frame.entries.push(content);
      return frame;
    }
    const next: Frame = new Frame(
      `sheet-title-${++this.framesMade}`,
      () => this.back(),
      () => this.closeFrame(next),
    );
    next.entries.push(content);
    if (frame) frame.covered = true;
    this.frames.push(next);
    this.layer.append(next.root);
    this.layer.hidden = false;
    return next;
  }

  /** Closes a frame and every frame above it, top first. */
  private closeFrame(frame: Frame): void {
    const at = this.frames.indexOf(frame);
    if (at < 0) return;
    const closing = this.frames.splice(at);
    for (const f of closing.reverse()) {
      for (const content of f.entries.reverse()) content.onClose?.();
      f.entries.length = 0;
      f.root.remove();
    }
    const below = this.topFrame;
    if (below) {
      below.covered = false;
      below.panel.focus({ preventScroll: true });
      below.nav.active?.focus({ preventScroll: true });
    } else {
      this.hide();
    }
    this.onChange();
  }

  private show(frame: Frame, place: SheetPlace | null): void {
    const top = frame.top;
    if (!top) return;
    frame.render(top, this.frames.indexOf(frame) > 0);
    frame.body.scrollTop = place?.scroll ?? 0;
    const previous = place ? frame.nav.items()[place.index] : null;
    frame.nav.setActive(previous ?? top.initial ?? frame.fallback(), false);
  }

  private hide(): void {
    this.layer.hidden = true;
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true });
  }
}
