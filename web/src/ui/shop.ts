import { KEY_BACKSLASH as BACKSLASH, KEY_ESCAPE, KEY_SPACE as SPACE } from '../input/keys.ts';
import type { Action } from '../play/actions.ts';
import type { PromptKind } from '../play/prompts.ts';
import { newMessages, type GameState, type StoreCommand, type StoreState } from '../render/snapshot.ts';
import type { TerminalBuffer } from '../terminal.ts';
import type { GameApi } from './api.ts';
import { el, navButton, section } from './dom.ts';
import { viewerHeading } from './filepages.ts';
import { openMessage } from './menus.ts';
import type { PopTab } from './popup.ts';
import { drawnBlocks, offerElements, SERVICE_CLEAR, serviceReply, shelfElements, shelfPage, shopModel, trades, type ShopHandlers, type ShopModel, type ShopTab } from './store.ts';
import type { TermView } from './termview.ts';

/* Messages read to tell what a building's service said. */
const SERVICE_MESSAGES = 30;

/** The toolbar while in a shop (beneath its panel). */
const SHOP_ACTIONS: Action[] = [
  { id: 'keyboard', label: 'Keys', icon: '⌨', effect: { kind: 'keyboard' } },
  { id: 'menu', label: 'Menu', icon: '☰', effect: { kind: 'menu' } },
];

interface ShopDeps {
  api: GameApi;
  buffer: TerminalBuffer;
  termView: TermView;
  /** Sends keys as the player's own. */
  send(keys: number[]): void;
  macroRunning(): boolean;
  prompt(): PromptKind;
  showToast(text: string, options?: { log?: boolean }): void;
  /** The refusal sound. */
  deny(): void;
  /** The hero has the Stealing skill. */
  steals(): boolean;
  redraw(): void;
  /** Applies again the tome2 options a service holds off (messages flowing past). */
  restoreEngineSettings(): void;
}

/** A building's service under way, with what it has drawn so far. */
interface ServiceRun {
  name: string;
  before: string[];
  state: GameState | null;
  pages: string[][][];
}

/**
 * Shops, the home, museums and other buildings, shown natively from the
 * engine's data: the panel, trades and services. Its state belongs to one
 * game (`reset` back at the title).
 */
export class ShopController {
  private readonly deps: ShopDeps;
  private readonly handlers: ShopHandlers;
  /** The shop or home shown in the native panel, and which of its lists is open (kept while the hero stays inside). */
  private shownShop: StoreState | null = null;
  private tab: { name: string; tab: ShopTab } | null = null;
  /** A trade under way: what is said once it has gone through, and how things stood before, to tell whether it did. */
  private trade: { done: string | null; before: string; state: GameState | null } | null = null;
  /**
   * A building's service under way: tome2 answers it by drawing over the
   * building's screen, which the native panel covers, and pages long answers
   * with -more- (held while it runs), so each page is kept as it is shown.
   */
  private service: ServiceRun | null = null;

  constructor(deps: ShopDeps) {
    this.deps = deps;
    this.handlers = {
      trade: (macro, done) => {
        this.trade = { done, before: this.tradeState(), state: deps.api.engine.gameState(20) };
        deps.api.runMacro(macro);
        if (!deps.macroRunning()) this.settle();
      },
      page: () => shelfPage(deps.buffer.screenText()),
      steals: deps.steals,
    };
  }

  /** Forgets the last game's shop, trade and service. */
  reset(): void {
    this.shownShop = null;
    this.tab = null;
    this.trade = null;
    this.service = null;
  }

  /** The shop shown in the native panel, if any. */
  get shown(): StoreState | null {
    return this.shownShop;
  }

  /** A trade is under way in a shop still open (tome2 clears its screen flag when an item prompt ends, before the trade's last question). */
  get trading(): boolean {
    return !!this.trade && !!this.deps.api.engine.store();
  }

  /** The toolbar's actions while a shop is shown, else null. */
  actions(): Action[] | null {
    return this.shownShop ? SHOP_ACTIONS : null;
  }

  /**
   * Looks again at the building tome2 has covering the map: shown natively
   * from the engine's data whatever its kind, while tome2 waits at its own
   * commands or while a trade answers its questions.
   */
  look(): StoreState | null {
    const store = this.deps.api.engine.store();
    this.shownShop = store && (this.trade || this.atCommands()) ? store : null;
    return this.shownShop;
  }

  /** The hero is back on the map. */
  leave(): void {
    this.shownShop = null;
    this.tab = null;
  }

  /** tome2 waits at a building's own commands (row 21 "You may:"), asking nothing else. */
  atCommands(): boolean {
    const prompt = this.deps.prompt();
    return (prompt === 'none' || prompt === 'other') && /^You may:/.test(this.deps.buffer.rowText(21));
  }

  /** Gold, stock and what the hero carries, to tell whether a trade went through. */
  private tradeState(): string {
    const { engine } = this.deps.api;
    const store = engine.store();
    const inventory = engine.inventory();
    return JSON.stringify([store?.gold, store?.stock.map((i) => [i.name, i.number]), inventory?.pack.map((i) => [i.name, i.number]), inventory?.equip.map((i) => i.name)]);
  }

  /** Once a trade's questions are answered: says it went through, or what tome2 said instead (no room, not enough gold). */
  settle(): void {
    if (!this.trade || this.deps.macroRunning()) return;
    const { done, before, state } = this.trade;
    this.trade = null;
    if (this.tradeState() !== before) {
      if (done) this.deps.showToast(done, { log: false });
      return;
    }
    const next = this.deps.api.engine.gameState(20);
    const said = state && next ? newMessages(state, next)[0]?.text : undefined;
    if (!said && !done) return;
    this.deps.showToast(said ? said.replace(/\s*-more-\s*$/, '') : 'Nothing changed.', { log: false });
    this.deps.deny();
  }

  private setTab(tab: ShopTab): void {
    if (!this.tab) return;
    this.tab.tab = tab;
    this.deps.redraw();
  }

  /** The shop as a panel: its shelf (its services first) and what the hero can offer it as tabs, Exit beside them; a building that does not trade lists its services. */
  render(): void {
    const store = this.shownShop;
    if (!store) return;
    const { api, termView } = this.deps;
    const exit = () => this.deps.send([KEY_ESCAPE]);
    const model = shopModel(store);
    if (this.tab?.name !== store.name) this.tab = { name: store.name, tab: 'shelf' };
    const subtitle = store.owner.replace(/\s*\(/, ' (') || undefined;
    if (!trades(store)) {
      termView.renderCustom({ layout: 'panel', title: store.name, subtitle, actions: [{ id: 'exit', label: 'Exit', run: exit }] }, JSON.stringify(model.extras), () => [this.servicesElement(model)]);
      return;
    }
    const tab = model.offer ? this.tab.tab : 'shelf';
    const inventory = api.engine.inventory();
    const tabs: PopTab[] = [
      { id: 'shelf', label: model.shelf.label, active: tab === 'shelf', run: () => this.setTab('shelf') },
      ...(model.offer ? [{ id: 'offer', label: model.offer.label, active: tab === 'offer', run: () => this.setTab('offer') }] : []),
      { id: 'exit', label: 'Exit', active: false, run: exit },
    ];
    const key = JSON.stringify([tab, store, inventory?.pack, inventory?.equip]);
    const shop = !store.home && !store.museum;
    termView.renderCustom({ layout: 'panel', title: store.name, subtitle, badge: shop ? `${store.gold} gold` : undefined, tabs }, key, () =>
      tab === 'offer' && inventory
        ? offerElements(api, store, model, inventory, this.handlers)
        : model.extras.length
          ? [section('Services', this.servicesElement(model)), section('For sale', ...shelfElements(api, store, model, this.handlers))]
          : shelfElements(api, store, model, this.handlers),
    );
  }

  /** A building's services (a quest to take, the town's history), each sent to tome2 as its own command. */
  private servicesElement(model: ShopModel): HTMLElement {
    const list = el('div', 'menu-list');
    for (const extra of model.extras) {
      const row = navButton(extra.name, {
        hint: serviceHint(extra),
        className: `row-button${extra.closed ? ' unavailable' : ''}`,
        onClick: () => this.runService(extra),
      });
      row.dataset.key = extra.key;
      list.append(row);
    }
    if (!model.extras.length) list.append(el('p', 'empty', 'There is nothing to do here.'));
    return list;
  }

  /** Asks for a service, or says why it cannot be had (no gold spent either way when it cannot); only while tome2 waits at the building's commands. */
  runService(command: StoreCommand): void {
    const { api } = this.deps;
    if (this.service || this.trade || this.deps.macroRunning() || api.engine.pendingKeys > 0 || !this.atCommands()) return;
    if (command.closed) api.refuse('The keeper will not do that for you.');
    else if (command.cost > (api.state()?.player?.au ?? 0)) api.refuse(`That costs ${command.cost} gold, more than you have.`);
    else {
      /* The rows a service draws on are blanked first, so an answer the same as the last one still shows. */
      api.engine.clearRows(SERVICE_CLEAR.first, SERVICE_CLEAR.last);
      this.service = { name: command.name, before: this.screenLines(), state: api.engine.gameState(SERVICE_MESSAGES), pages: [] };
      api.engine.setAutoMore(false);
      this.deps.send([BACKSLASH, command.key.charCodeAt(0)]);
    }
  }

  private screenLines(): string[] {
    return this.deps.buffer.screenText().split('\n');
  }

  /** Keeps what a service has drawn so far, leaving out blocks kept from an earlier page. */
  private keepPage(run: ServiceRun): void {
    const kept = new Set(run.pages.flat().map((block) => block.join('\n')));
    run.pages.push(drawnBlocks(run.before, this.screenLines()).filter((block) => !kept.has(block.join('\n'))));
  }

  /** Follows a service at each idle: keeps a page and turns it at -more-; once back at the building's commands (or out of it), shows what it said. True when a key was sent. */
  idle(): boolean {
    const run = this.service;
    const { engine, sheets } = this.deps.api;
    if (!run || this.deps.macroRunning() || engine.pendingKeys > 0 || viewerHeading(this.deps.buffer.rowText(0).trim())) return false;
    if (this.deps.prompt() === 'more') {
      this.keepPage(run);
      engine.sendKeys([SPACE]);
      return true;
    }
    const inside = !!engine.store() && this.atCommands();
    const snap = engine.snapshot();
    if (!inside && snap?.inDungeon && !(snap.atCommand && !snap.icky)) return false;
    this.service = null;
    this.deps.restoreEngineSettings();
    if (inside) this.keepPage(run);
    const state = engine.gameState(SERVICE_MESSAGES);
    /* Oldest first, without tome2's count of a repeated message ("… <2x>"). */
    const said = run.state && state ? newMessages(run.state, state).map((m) => m.text.replace(/\s*<\d+x>$/, '')).reverse() : [];
    const reply = serviceReply(run.pages.filter((page) => page.length), said);
    if (reply.length) openMessage(sheets, run.name, reply, 'sheet-service');
    return false;
  }
}

/** What a service costs, or that the keeper will not do it for this hero. */
function serviceHint(command: StoreCommand): string | undefined {
  if (command.closed) return 'Not for you';
  return command.cost > 0 ? `${command.cost} gold` : undefined;
}
