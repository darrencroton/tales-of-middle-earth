import { readableColour } from '../render/colour.ts';
import { el } from './dom.ts';
import { ListNav, type NavDirection } from './listnav.ts';
import { isInstructionLine } from './prompttext.ts';
import { bufferRows, parseRows, type Block, type ChoiceBlock, type OptionBlock, type Run, type TextBlock } from './termparse.ts';

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
  /** Lists to switch between (pack, equipment, floor). */
  tabs?: TermViewTab[];
  /** Terminal rows to leave out (shop command lists, page markers). */
  hideRow?: (row: number) => boolean;
  /** Uppercase key range that shows a description of each choice ("Descs A-F"). */
  describe?: [string, string] | null;
}

const WHITE = 1;
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
    const key = JSON.stringify([options.layout, options.title, options.badge, options.tabs?.map((t) => [t.label, t.active]), options.describe, blocks]);
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
    this.fitPreformatted();

    const items = [...this.body.querySelectorAll<HTMLElement>('.tv-choice, .tv-option')];
    const current = items.find((c) => c.classList.contains('current'));
    const previous = activeKey ? items.find((c) => c.dataset.key === activeKey || c.dataset.option === activeKey) : undefined;
    this.nav.setActive(current ?? previous ?? items[0] ?? null, true);
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
      if (options.title) line.append(el('h2', 'tv-title', options.title));
      if (options.badge) line.append(el('span', 'tv-badge', options.badge));
      parts.push(line);
    }
    if (this.tabs.length) {
      const bar = el('div', 'segmented tv-tabs');
      this.tabs.forEach((tab, i) => {
        const button = el('button', `segment tv-tab${tab.active ? ' selected' : ''}`, tab.label);
        button.type = 'button';
        button.dataset.index = String(i);
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
   * A text row just above the first choice whose cells line up with the
   * choices' columns ("Name  School  Level  Cost  Fail  Info") labels each
   * value instead of being shown.
   */
  private columnHeadings(blocks: Block[]): { index: number; labels: string[] } | null {
    const first = blocks.findIndex((b) => b.kind === 'choice');
    if (first < 1) return null;
    const metaCount = Math.max(...blocks.filter((b): b is ChoiceBlock => b.kind === 'choice').map((c) => c.meta.length));
    if (metaCount < 1) return null;
    for (let i = first - 1; i >= 0 && i >= first - 2; i--) {
      const block = blocks[i];
      if (block.kind === 'gap') continue;
      if (block.kind !== 'text') return null;
      if (block.cells.length === metaCount + 1) return { index: i, labels: block.cells.slice(1).map((c) => c.text.trim()) };
      return null;
    }
    return null;
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
          if (isInstructionLine(this.textOf(block))) return;
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
          out.push(this.choiceRow(block, index, headings?.labels ?? null, describe));
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

  private choiceRow(block: ChoiceBlock, index: number, labels: string[] | null, describe: [string, string] | null): HTMLElement {
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

    if (block.meta.some((cell) => cell.text.trim())) {
      const metas = el('span', 'tv-metas');
      block.meta.forEach((cell, i) => {
        if (!cell.text.trim()) return;
        const chip = el('span', 'tv-meta');
        const heading = labels?.[i];
        if (heading) chip.append(el('span', 'tv-meta-label', heading));
        for (const run of cell.runs) chip.append(this.span(run));
        metas.append(chip);
      });
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
