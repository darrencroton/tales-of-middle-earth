import { readableColour } from '../render/colour.ts';
import { el } from './dom.ts';
import { ListNav, type NavDirection } from './listnav.ts';
import { isInstructionLine } from './prompttext.ts';
import { bufferRows, parseRows, sliceCell, type Block, type Cell, type ChoiceBlock, type OptionBlock, type Run, type TextBlock } from './termparse.ts';

export interface TermViewCallbacks {
  /** A menu choice was tapped or activated. */
  onChoice(key: string, choice: ChoiceBlock): void;
  /** The information button beside a choice was tapped. */
  onDescribe(key: string): void;
  /** An option switch was tapped. */
  onOption(option: OptionBlock, index: number, options: OptionBlock[]): void;
  /** Somewhere other than a choice was tapped. */
  onTapText(): void;
}

export interface TermViewSource {
  cols: number;
  chars: Uint8Array;
  attrs: Uint8Array;
}

export interface TermViewRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TermViewTab {
  label: string;
  active: boolean;
  run(): void;
}

export interface TermViewOptions {
  layout: 'panel' | 'full';
  /** Heading for the panel (a cleaned-up prompt). */
  title?: string;
  /** Small text beside the heading, e.g. gold in a shop. */
  badge?: string;
  /** A line under the heading. */
  subtitle?: string;
  /** Lists to switch between (pack, equipment, floor). */
  tabs?: TermViewTab[];
  /** Terminal rows to leave out (shop command lists, page markers). */
  hideRow?: (row: number) => boolean;
  /** Shown when the screen has nothing to show. */
  empty?: string;
  /** Uppercase key range that shows a description of each choice ("Descs A-F"). */
  describe?: [string, string] | null;
}

const WHITE = 1;
/* Columns shown with a unit instead of a heading. */
const UNITS: Readonly<Record<string, string>> = { weight: ' lb', price: ' gold' };
/* Words that make a row a set of column headings rather than content. */
const HEADING = /^(Name|Item Description.*|Description|School|Level|Lv|Cost|Mana|Fail|Info|Weight|Price|Qty|Skill)$/i;
/* A cell split into one cell per word ("Level Cost Fail" → three cells). */
function words(cell: Cell): Cell[] {
  return [...cell.text.matchAll(/\S+/g)].map((m) => sliceCell(cell, m.index, m.index + m[0].length));
}

/* Cells up to this length are kept on one line when a row wraps. */
const SHORT_CELL = 28;

/**
 * Shows tome2's own screens (menus, lists, help, shops) as a native panel:
 * menu entries are tappable rows with a highlight that arrows and swipes
 * move, column headings label each value, option rows become switches,
 * key instructions are dropped (the toolbar offers those actions), and
 * prose reflows to the screen width.
 */
export class TermView {
  readonly root: HTMLElement;
  private readonly header: HTMLElement;
  private readonly body: HTMLElement;
  private readonly nav: ListNav;
  private readonly palette: () => readonly string[];
  private readonly callbacks: TermViewCallbacks;
  private renderedKey = '';
  private blocks: Block[] = [];
  private tabs: TermViewTab[] = [];
  private customView = '';

  constructor(parent: HTMLElement, palette: () => readonly string[], callbacks: TermViewCallbacks) {
    this.palette = palette;
    this.callbacks = callbacks;
    this.root = el('div', 'termview');
    this.root.hidden = true;
    this.header = el('div', 'tv-header');
    this.body = el('div', 'tv-body');
    this.root.append(this.header, this.body);
    parent.append(this.root);
    this.nav = new ListNav(this.root, this.body);

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tab = target.closest<HTMLElement>('.tv-tab');
      if (tab) {
        this.tabs[Number(tab.dataset.index)]?.run();
        return;
      }
      const info = target.closest<HTMLElement>('.tv-info');
      if (info?.dataset.key) {
        this.callbacks.onDescribe(info.dataset.key);
        return;
      }
      const option = target.closest<HTMLElement>('.tv-option');
      if (option) {
        const options = this.options();
        const index = Number(option.dataset.option);
        if (options[index]) {
          this.nav.setActive(option, false);
          this.callbacks.onOption(options[index], index, options);
        }
        return;
      }
      const button = target.closest<HTMLElement>('.tv-choice');
      const choice = button ? this.choiceFor(button) : null;
      if (button && choice) {
        this.nav.setActive(button, false);
        this.callbacks.onChoice(choice.key, choice);
      } else {
        this.callbacks.onTapText();
      }
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.renderedKey = '';
  }

  /** Choices on screen, in order. */
  choices(): ChoiceBlock[] {
    return this.blocks.filter((b): b is ChoiceBlock => b.kind === 'choice');
  }

  options(): OptionBlock[] {
    return this.blocks.filter((b): b is OptionBlock => b.kind === 'option');
  }

  /** True when tome2 draws its own cursor on the menu (bracketed key). */
  get hasCursor(): boolean {
    return this.choices().some((c) => c.current);
  }

  render(source: TermViewSource, region: TermViewRegion, options: TermViewOptions): void {
    const parsed = parseRows(bufferRows(source, region.y0, region.y1), region.y0, region.x0, region.x1);
    const hide = options.hideRow;
    const blocks = hide ? parsed.filter((b) => b.kind === 'gap' || b.kind === 'pre' || !hide(b.row)) : parsed;
    const key = JSON.stringify([options.layout, options.empty, options.title, options.subtitle, options.badge, options.tabs?.map((t) => [t.label, t.active]), options.describe, blocks]);
    this.root.hidden = false;
    this.tabs = options.tabs ?? [];
    if (key === this.renderedKey) return;
    const active = this.nav.active;
    const activeKey = active?.dataset.key ?? active?.dataset.option;
    this.renderedKey = key;
    this.blocks = blocks;
    this.root.className = `termview ${options.layout}`;

    this.renderHeader(options);
    this.body.replaceChildren(...this.renderBlocks(blocks, options.describe ?? null));
    if (options.empty && !this.body.textContent?.trim()) this.body.replaceChildren(el('p', 'tv-empty', options.empty));
    this.fitPreformatted();

    const items = [...this.body.querySelectorAll<HTMLElement>('.tv-choice, .tv-option')];
    const current = items.find((c) => c.classList.contains('current'));
    const previous = activeKey ? items.find((c) => c.dataset.key === activeKey || c.dataset.option === activeKey) : undefined;
    this.nav.setActive(current ?? previous ?? items[0] ?? null, true);
  }

  /**
   * Shows a native view in the same panel (headings, highlight, keys),
   * rebuilt only when `key` changes.
   */
  renderCustom(options: TermViewOptions, key: string, build: () => HTMLElement[]): void {
    this.root.hidden = false;
    this.tabs = options.tabs ?? [];
    const fullKey = `custom\u0000${options.layout}\u0000${options.title}\u0000${options.badge}\u0000${key}`;
    if (fullKey === this.renderedKey) return;
    const activeKey = this.nav.active?.dataset.key;
    const view = `${options.title}\u0000${this.tabs.find((t) => t.active)?.label ?? ''}`;
    this.renderedKey = fullKey;
    this.blocks = [];
    this.root.className = `termview ${options.layout}`;
    this.renderHeader(options);
    this.body.replaceChildren(...build());
    if (view !== this.customView) this.body.scrollTop = 0;
    this.customView = view;
    const current = this.body.querySelector<HTMLElement>('.current');
    const previous = activeKey ? this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`) : null;
    const tab = this.header.querySelector<HTMLElement>('.tv-tabs .selected');
    this.nav.setActive(current ?? previous ?? tab ?? this.body.querySelector<HTMLElement>('[data-nav]'), true);
  }

  move(direction: NavDirection): void {
    this.nav.move(direction);
  }

  activate(): boolean {
    return this.nav.activate();
  }

  /**
   * Keys for the highlight: used when tome2 has no cursor of its own on a
   * menu (with a cursor, keys go to tome2, which redraws the highlight).
   */
  handleKey(e: KeyboardEvent): boolean {
    if (this.root.hidden || this.choices().length === 0 || this.hasCursor) return false;
    if (e.key === 'Enter') return this.nav.activate();
    if (/^Arrow(Up|Down)$|^Home$|^End$/.test(e.key)) return this.nav.handleKey(e);
    return false;
  }

  private renderHeader(options: TermViewOptions): void {
    const parts: HTMLElement[] = [];
    if (options.title || options.badge) {
      const line = el('div', 'tv-title-line');
      const titles = el('div', 'tv-titles');
      if (options.title) titles.append(el('h2', 'tv-title', options.title));
      if (options.subtitle) titles.append(el('p', 'tv-subtitle', options.subtitle));
      line.append(titles);
      if (options.badge) line.append(el('span', 'tv-badge', options.badge));
      parts.push(line);
    }
    if (this.tabs.length) {
      const bar = el('div', 'segmented tv-tabs');
      this.tabs.forEach((tab, i) => {
        const button = el('button', `segment tv-tab${tab.active ? ' selected' : ''}`, tab.label);
        button.type = 'button';
        button.dataset.index = String(i);
        button.dataset.nav = '';
        bar.append(button);
      });
      parts.push(bar);
    }
    this.header.replaceChildren(...parts);
    this.header.hidden = parts.length === 0;
  }

  private choiceFor(button: HTMLElement): ChoiceBlock | null {
    const index = Number(button.dataset.index);
    const block = this.blocks[index];
    return block?.kind === 'choice' ? block : null;
  }

  private colour(attr: number): string {
    return attr === WHITE || attr === 0 ? '' : readableColour(this.palette()[attr] ?? '');
  }

  private span(run: Run, className?: string): HTMLElement {
    const node = el('span', className, run.text);
    const colour = this.colour(run.attr);
    if (colour) node.style.color = colour;
    return node;
  }

  /**
   * A text row just above the first choice that holds column headings
   * ("Name  School  Level  Cost  Fail  Info") is not shown; each value in
   * the choices is labelled with the heading above its column instead.
   */
  private columnHeadings(blocks: Block[]): { index: number; cells: Cell[] } | null {
    const first = blocks.findIndex((b) => b.kind === 'choice');
    for (let i = first - 1; i >= 0 && i >= first - 2; i--) {
      const block = blocks[i];
      if (block.kind === 'gap') continue;
      if (block.kind !== 'text') return null;
      const cells = block.cells.flatMap((c) => (HEADING.test(c.text.trim()) ? [c] : words(c)));
      return cells.length > 0 && cells.every((c) => HEADING.test(c.text.trim())) ? { index: i, cells } : null;
    }
    return null;
  }

  /** Values of a choice paired with the heading of the column each starts under. */
  private labelledMeta(meta: Cell[], headings: Cell[] | null): { label: string; cell: Cell }[] {
    if (!headings || headings.length < 2) return meta.map((cell) => ({ label: '', cell }));
    const starts = headings.slice(1).map((h) => h.col);
    const out: { label: string; cell: Cell }[] = [];
    for (const cell of meta) {
      let pieces = [cell];
      for (const start of starts) {
        pieces = pieces.flatMap((piece) => {
          const at = start - piece.col;
          if (at <= 0 || at >= piece.text.length || piece.text[at - 1] !== ' ') return [piece];
          return [sliceCell(piece, 0, at - 1), sliceCell(piece, at, piece.text.length)];
        });
      }
      for (const piece of pieces) {
        const end = piece.col + piece.text.length - 1;
        let label = '';
        headings.slice(1).forEach((h, i) => {
          const next = i + 2 < headings.length ? headings[i + 2].col : Infinity;
          if (end >= h.col && piece.col < next) label = label || h.text.trim();
        });
        out.push({ label, cell: piece });
      }
    }
    return out;
  }

  private renderBlocks(blocks: Block[], describe: [string, string] | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    const headings = this.columnHeadings(blocks);
    let optionIndex = 0;
    blocks.forEach((block, index) => {
      if (headings && index === headings.index) return;
      switch (block.kind) {
        case 'gap':
          if (out.length && !out[out.length - 1].classList.contains('tv-gap')) out.push(el('div', 'tv-gap'));
          break;
        case 'pre': {
          const pre = el('pre', 'tv-pre');
          block.rows.forEach((runs, i) => {
            if (i) pre.append('\n');
            for (const run of runs) pre.append(this.span(run));
          });
          out.push(pre);
          break;
        }
        case 'text': {
          const text = this.textOf(block);
          if (isInstructionLine(text)) return;
          if (/^[=\-_~*#+]{5,}$/.test(text.trim())) {
            out.push(el('hr', 'tv-rule'));
            return;
          }
          const line = el('p', block.cells.length > 1 ? 'tv-text cells' : 'tv-text');
          block.cells.forEach((cell) => {
            const part = el('span', cell.text.length <= SHORT_CELL ? 'tv-cell short' : 'tv-cell');
            for (const run of cell.runs) part.append(this.span(run));
            line.append(part);
          });
          out.push(line);
          break;
        }
        case 'option': {
          const row = el('button', `tv-option${block.value ? ' on' : ''}`);
          row.type = 'button';
          row.dataset.nav = '';
          row.dataset.option = String(optionIndex++);
          row.setAttribute('role', 'switch');
          row.setAttribute('aria-checked', String(block.value));
          row.append(el('span', 'tv-option-label', block.label), el('span', 'switch'));
          out.push(row);
          break;
        }
        case 'choice':
          out.push(this.choiceRow(block, index, headings?.cells ?? null, describe));
          break;
      }
    });
    while (out.length && out[out.length - 1].classList.contains('tv-gap')) out.pop();
    while (out.length && out[0].classList.contains('tv-gap')) out.shift();
    return out;
  }

  private textOf(block: TextBlock): string {
    return block.cells.map((c) => c.text).join('  ');
  }

  private choiceRow(block: ChoiceBlock, index: number, headings: Cell[] | null, describe: [string, string] | null): HTMLElement {
    const button = el('button', `tv-choice${block.current ? ' current' : ''}`);
    button.type = 'button';
    button.dataset.nav = '';
    button.dataset.key = block.key;
    button.dataset.index = String(index);

    const main = el('span', 'tv-main');
    if (block.symbol) main.append(this.span(block.symbol, 'tv-symbol'));
    const label = el('span', 'tv-label');
    for (const run of block.label.runs) label.append(this.span(run));
    main.append(label);
    button.append(main);

    const meta = this.labelledMeta(block.meta, headings).filter((m) => m.cell.text.trim());
    if (meta.length) {
      const metas = el('span', 'tv-metas');
      for (const { label, cell } of meta) {
        const chip = el('span', 'tv-meta');
        const unit = UNITS[label.toLowerCase()];
        if (label && !unit) chip.append(el('span', 'tv-meta-label', label));
        for (const run of cell.runs) chip.append(this.span(run));
        if (unit) chip.append(el('span', 'tv-meta-unit', unit));
        metas.append(chip);
      }
      button.append(metas);
    }

    const upper = block.key.toUpperCase();
    if (!describe || !/[a-z]/.test(block.key) || upper < describe[0] || upper > describe[1]) return button;
    const row = el('div', 'tv-row');
    const info = el('button', 'tv-info', 'i');
    info.type = 'button';
    info.dataset.key = upper;
    info.setAttribute('aria-label', `About ${block.label.text.trim()}`);
    row.append(button, info);
    return row;
  }

  /** Shrinks ASCII art and maps (only) so they fit the width. */
  private fitPreformatted(): void {
    for (const pre of this.body.querySelectorAll<HTMLElement>('.tv-pre')) {
      pre.style.removeProperty('--pre-scale');
      const available = this.body.clientWidth - 4;
      if (pre.scrollWidth > available && available > 0) {
        pre.style.setProperty('--pre-scale', String(Math.max(0.45, available / pre.scrollWidth)));
      }
    }
  }
}
