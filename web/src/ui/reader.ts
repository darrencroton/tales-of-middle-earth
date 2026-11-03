import type { Engine } from '../engine.ts';
import { KEY_BACKSPACE, KEY_ENTER, KEY_ESCAPE, KEY_SPACE, keyCodes } from '../input/keys.ts';
import type { TerminalBuffer } from '../terminal.ts';
import { FilePages, parseHelpFile, viewerHeading, viewerSource, type HelpFile, type HelpLink, type ViewerHeading } from './filepages.ts';
import { bufferRows } from './termparse.ts';
import type { TermView, TermViewOptions } from './termview.ts';

/* Escapes allowed for leaving the viewer, or one more than the files known to be open. */
const VIEWER_DEPTH = 12;

export interface ReaderDeps {
  engine: Engine;
  buffer: TerminalBuffer;
  termView: TermView;
  /** Sends keys as the player's own (stopping whatever runs). */
  send(keys: number[]): void;
  /** How a tome2 screen is presented in the panel (heading, lead lines, hidden rows). */
  panelOptions(layout: 'panel' | 'full'): TermViewOptions;
  /** Opens our own Help, in place of tome2's help index. */
  openHelp(): void;
}

/** A file open in the viewer, once all of it has been gathered, with its links when it is a help file. */
export interface ShownFile {
  key: string;
  file: FilePages;
  help: HelpFile | null;
}

function viewerKey(heading: ViewerHeading): string {
  return `${heading.caption}\u0000${heading.size}`;
}

/** tome2's file viewer (knowledge lists, help, notes), read as whole files by scrolling (docs/ui-system.md). */
export class Reader {
  private readonly deps: ReaderDeps;
  /** Files gathered while the viewer is open, by caption and length. */
  private readonly files = new Map<string, FilePages>();
  /** Game files read while the viewer is open, by path. */
  private readonly helpFiles = new Map<string, HelpFile>();
  /** Files open in tome2's viewer, outermost first: the line each opened at, and where it was scrolled when another covered it. */
  private levels: { key: string; line: number; scrollTop: number | null }[] = [];
  /** What the keys just sent to the viewer do: open a file over this one, or go back to the one below. */
  private move: 'open' | 'back' | null = null;
  /** A tapped help link: tome2 is asked to show its line, then its link cursor is stepped onto it. */
  private linkWanted: { key: string; link: HelpLink; tries: number } | null = null;
  /** Escapes still to send to leave the viewer, one per idle. */
  private closing = 0;
  /* The original ToME manual was asked for from Help; otherwise tome2's help index (the ? key) gives way to Help. */
  private manualWanted = false;

  constructor(deps: ReaderDeps) {
    this.deps = deps;
  }

  /** Forgets the files of the last game's viewer, and a manual asked for. */
  reset(): void {
    this.forget();
    this.manualWanted = false;
  }

  /** Forgets the files gathered once the viewer has closed. */
  private forget(): void {
    this.files.clear();
    this.helpFiles.clear();
    this.levels = [];
    this.move = null;
    this.linkWanted = null;
    this.closing = 0;
  }

  /** The viewer's heading on row 0, while tome2's viewer is open. */
  heading(): ViewerHeading | null {
    return viewerHeading(this.deps.buffer.rowText(0).trim());
  }

  /** Lets the next help index tome2 opens show (the original manual), rather than giving way to Help. */
  wantManual(wanted: boolean): void {
    this.manualWanted = wanted;
  }

  /** The file on screen, once all of it has been gathered. */
  file(): ShownFile | null {
    const heading = this.heading();
    if (!heading) return null;
    const key = viewerKey(heading);
    const file = this.files.get(key);
    return file?.complete ? { key, file, help: this.helpFile(heading.caption) } : null;
  }

  /** Links and tags of the game file (help, a parchment) a caption names, read as tome2 reads them. */
  private helpFile(caption: string): HelpFile | null {
    const source = viewerSource(caption);
    if (!source) return null;
    const path = `/lib/${source.dir}/${source.name}`;
    let help = this.helpFiles.get(path);
    if (!help) {
      let bytes: Uint8Array = new Uint8Array();
      try {
        bytes = this.deps.engine.fs?.readFile(path) ?? bytes;
      } catch (err) {
        console.warn(`${path} could not be read`, err);
      }
      help = parseHelpFile(bytes);
      this.helpFiles.set(path, help);
    }
    return help;
  }

  /** Notes the file on screen as opened over the last one, or as the one below it come back to. */
  private noteLevel(key: string, line: number): void {
    const move = this.move;
    this.move = null;
    const top = this.levels.at(-1);
    if (top?.key === key) return;
    if (move === 'back' || (move === null && this.levels.at(-2)?.key === key)) {
      this.levels.pop();
      return;
    }
    if (top && this.deps.termView.visible) top.scrollTop = this.deps.termView.scrollTop;
    this.levels.push({ key, line, scrollTop: null });
  }

  /**
   * Runs the viewer at each idle: gathers the file tome2 is showing a page at
   * a time (each Space is read at once, so only the whole file is ever
   * shown), steps tome2's link cursor onto a tapped help link, and sends the
   * Escapes that leave it. True when keys were sent.
   */
  idle(): boolean {
    const { engine, buffer } = this.deps;
    const heading = this.heading();
    if (!heading) {
      this.forget();
      return false;
    }
    if (engine.pendingKeys > 0) return false;
    if (!this.manualWanted && this.levels.length === 0 && heading.caption === "Help file 'help.hlp'") {
      engine.sendKeys([KEY_ESCAPE]);
      this.deps.openHelp();
      return true;
    }
    this.manualWanted = false;
    if (this.closing > 0) {
      this.closing--;
      engine.sendKeys([KEY_ESCAPE]);
      return true;
    }
    const key = viewerKey(heading);
    this.noteLevel(key, heading.line);
    let file = this.files.get(key);
    if (!file) {
      file = new FilePages(heading, buffer.rows - 4);
      this.files.set(key, file);
    }
    const page = bufferRows(buffer, 2, buffer.rows - 3);
    if (!file.complete) {
      if (!file.add(heading.line, page)) return false;
      engine.sendKeys([KEY_SPACE]);
      return true;
    }
    const wanted = this.linkWanted;
    this.linkWanted = null;
    const help = this.helpFile(heading.caption);
    if (!wanted || wanted.key !== key || !help) return false;
    let current: number | null = null;
    page.forEach((row, i) => {
      for (const link of help.lines.get(heading.line + i) ?? []) {
        if (current === null && row.attrs[link.col] === help.selected) current = link.index;
      }
    });
    if (current === null) {
      /* Paging past the last link leaves tome2's cursor beyond it, on no link: one step back puts it on a link, in view. */
      if (wanted.tries <= 0) return false;
      this.linkWanted = { ...wanted, tries: wanted.tries - 1 };
      engine.sendKeys(keyCodes('4'));
      return true;
    }
    const delta = wanted.link.index - current;
    this.move = 'open';
    engine.sendKeys([...keyCodes((delta > 0 ? '6' : '4').repeat(Math.abs(delta))), KEY_ENTER]);
    return true;
  }

  /**
   * Follows a help link: one to another place in the same file only scrolls;
   * otherwise tome2 goes to the link's line, and `idle` then selects and
   * opens it.
   */
  followLink(index: number): void {
    const shown = this.file();
    const link = shown?.help?.links[index];
    if (!shown?.help || !link) return;
    if (link.file === viewerSource(shown.file.caption)?.name) {
      this.deps.termView.scrollToRow(shown.file.rowOf(shown.help.tags.get(link.anchor) ?? 0));
      return;
    }
    this.linkWanted = { key: shown.key, link, tries: 1 };
    this.deps.send([...keyCodes(`#${link.line}`), KEY_ENTER]);
  }

  /** Follows the link a key letter names in the file on screen; false when none does. */
  followKey(key: string): boolean {
    const link = this.file()?.help?.links.find((l) => l.key === key);
    if (!link) return false;
    this.followLink(link.index);
    return true;
  }

  /** Leaves the viewer, however many files are open in it. */
  close(): void {
    this.closing = Math.max(VIEWER_DEPTH, this.levels.length + 1) - 1;
    this.deps.send([KEY_ESCAPE]);
  }

  /**
   * Shows the whole file on screen in the panel; true whenever tome2's
   * viewer is open (while a file is still being gathered the panel stays as
   * it was).
   */
  render(layout: 'panel' | 'full'): boolean {
    if (!this.heading()) return false;
    const shown = this.file();
    if (!shown) return true;
    const { key, file, help } = shown;
    const { buffer, termView } = this.deps;
    const open = this.levels.at(-1);
    termView.render(file.source(buffer.cols), { x0: 0, y0: 0, x1: buffer.cols - 1, y1: Math.max(0, file.rows.length - 1) }, {
      ...this.deps.panelOptions(layout),
      describe: null,
      cursorRow: undefined,
      back:
        this.levels.length > 1
          ? () => {
              this.move = 'back';
              this.deps.send([KEY_BACKSPACE]);
            }
          : undefined,
      links: help ? (row) => help.lines.get(file.lineAt(row)) ?? [] : undefined,
      scroll: { key: `${this.levels.length}\u0000${key}`, top: open?.scrollTop ?? null, row: file.rowOf(open?.line ?? 0) },
    });
    return true;
  }
}
