import { KEY_ENTER, KEY_ESCAPE } from '../input/keys.ts';
import { commandGroups, commandKeys, GAME_OPTIONS, type CommandContext, type CommandDef, type NativeView } from '../play/actions.ts';
import type { GameApi } from './api.ts';
import { el, iconText } from './dom.ts';

interface CommandsDeps {
  api: GameApi;
  openNative(view: NativeView): void;
  /** Shows a tome2 screen to read (sent as the player's keys); the sheets it covers reopen once it closes. */
  read(keys: number[]): void;
  /** Opens the on-screen keyboard. */
  keyboard(): void;
  /** Holds Ctrl for the next key, or lets it go. */
  toggleCtrl(): void;
}

/** A button of the More sheet; one that cannot be done now is dimmed and says why. */
function commandButton(api: GameApi, icon: string, label: string, onClick: () => void, unavailable?: string): HTMLButtonElement {
  const button = el('button', unavailable ? 'command unavailable' : 'command');
  button.type = 'button';
  button.dataset.nav = '';
  button.append(el('span', 'command-icon', iconText(icon)), el('span', undefined, label));
  if (unavailable) button.setAttribute('aria-description', unavailable);
  button.addEventListener('click', () => (unavailable ? api.refuse(unavailable) : onClick()));
  return button;
}

/** More: every player-facing tome2 command not reached more naturally, grouped by intent (`commandGroups`), then the keyboard and options. */
export function openCommands(deps: CommandsDeps, context: CommandContext): void {
  const { api } = deps;
  const body = el('div', 'commands');
  const run = (def: CommandDef) => {
    if (def.native === 'magic' || def.native === 'powers' || def.native === 'altar' || def.native === 'companions' || def.native === 'target') {
      /* Over the Commands sheet, so Back (or closing a card) returns to it. */
      deps.openNative(def.native);
    } else if (def.native) {
      api.sheets.closeAll();
      deps.openNative(def.native);
    } else if (def.reading && api.snapshot()?.atCommand) {
      deps.read(commandKeys(def));
    } else {
      api.send(commandKeys(def));
    }
  };
  const group = (title: string, buttons: HTMLButtonElement[]) => {
    const grid = el('div', 'command-grid');
    grid.append(...buttons);
    const sectionEl = el('section', 'sheet-section');
    sectionEl.append(el('h3', undefined, title), grid);
    body.append(sectionEl);
  };
  for (const { title, commands } of commandGroups(context)) {
    group(title, commands.map((def) => commandButton(api, def.icon, def.label, () => run(def), def.unavailable)));
  }
  group('Keyboard and options', [
    commandButton(api, GAME_OPTIONS.icon, GAME_OPTIONS.label, () => run(GAME_OPTIONS)),
    commandButton(api, '⌨', 'Keyboard', () => {
      api.sheets.closeAll();
      deps.keyboard();
    }),
    commandButton(api, '^', 'Ctrl + next key', () => {
      api.sheets.closeAll();
      deps.toggleCtrl();
    }),
    commandButton(api, '⎋', 'Escape', () => api.send([KEY_ESCAPE])),
    commandButton(api, '⏎', 'Enter', () => api.send([KEY_ENTER])),
  ]);
  api.sheets.open({ title: 'Commands', body, className: 'sheet-commands' });
}
