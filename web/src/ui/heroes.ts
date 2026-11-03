import type { Engine } from '../engine.ts';
import type { GameFeel } from '../feel.ts';
import type { Director } from '../flow/director.ts';
import { AdventurerStore, deleteHeroSave, heroLine, saveBase } from '../play/adventurers.ts';
import { extendStreak, newChronicle, newDeeds, nextTimeTip, record, type Chronicle, type Slain, type Streak } from '../play/chronicle.ts';
import { SLOT_NAMES } from '../play/items.ts';
import { buildMemorial, memorialKey, type Memorial } from '../play/memorial.ts';
import type { GameState, LevelSnapshot, PlayerState, ScoreEntry } from '../render/snapshot.ts';
import { findSaveIndex, type EmscriptenFS } from '../saves.ts';
import type { SaveInfo } from '../title.ts';
import { titleName } from './api.ts';
import { adventurerSummary, openAdventurers, type AdventurerDetails } from './adventurers.ts';
import { careerElements, ChronicleStore } from './deeds.ts';
import { el, section } from './dom.ts';
import { hallOfFameElements, openFameCard, tombElements, type Tomb } from './gameover.ts';
import { recallLines } from './inspect.ts';
import { openFallen, openFoe, type FallenTab } from './memorial.ts';
import type { RecentStore } from './magic.ts';
import type { SheetContent, Sheets } from './sheet.ts';

interface HeroesDeps {
  engine: Engine;
  sheets: Sheets;
  director: Director;
  feel: GameFeel;
  recents: RecentStore;
  palette(): readonly string[];
  /** The deed sound. */
  cueDeed(): void;
  /** Forgets the map memory of every hero of a name. */
  forgetMemory(name: string): void;
  /** Stops a journey under way, to show a sheet. */
  interrupt(): void;
  /** Moves on from the end of the game to the title (to begin a fallen hero anew there). */
  finishGame(): void;
  showToast(text: string, options: { log?: boolean; read?: boolean }): void;
}

/** A saved hero's own name: tome2's list gives the savefile's ("Old_Tom"), its index the hero's ("Old Tom, the Hobbit Rogue"). */
function heroName(save: SaveInfo): string {
  return save.description.split(', the ')[0] || save.name;
}

/**
 * What the frontend keeps of heroes, alive and fallen: the chronicle of the
 * hero in play (kills, streaks, legends, deeds), the fallen hero's memorial,
 * the saved heroes on the title screen (the Game Roster) and the Hall of
 * Fame. The hero in play is forgotten at the title (`reset`).
 */
export class Heroes {
  readonly chronicles = new ChronicleStore();
  readonly adventurers = new AdventurerStore();
  private readonly deps: HeroesDeps;
  private chronicle: Chronicle | null = null;
  private streak: Streak = { count: 0, lastTurn: 0 };
  /** The fallen hero as they were at the end, once they have died. */
  private memorial: Memorial | null = null;
  /** The title screen's Hall of Fame sheet, kept to be updated in place when a hero is removed. */
  private fameSheet: SheetContent | null = null;
  /** A fallen hero to begin again once the title screen is back. */
  private anew: string | null = null;

  constructor(deps: HeroesDeps) {
    this.deps = deps;
  }

  /** Reads the stores from the engine's storage, once it has been read from the browser. */
  load(fs: EmscriptenFS | null, root: string | null): void {
    if (!this.chronicles.loaded) this.chronicles.load(fs, root);
    if (!this.adventurers.loaded) this.adventurers.load(fs, root);
  }

  /** Forgets the hero in play; the stores are read again with the next game. */
  reset(): void {
    this.chronicle = null;
    this.streak = { count: 0, lastTurn: 0 };
    this.memorial = null;
    this.chronicles.loaded = false;
    this.adventurers.loaded = false;
  }

  /** The fallen hero to begin anew now the title screen is back, once. */
  takeAnew(): string | null {
    const name = this.anew;
    this.anew = null;
    return name;
  }

  /** Records kills, streaks, legends and close calls in the hero's chronicle, and tells the deeds earned. */
  update(player: PlayerState, slain: readonly Slain[], turn: number, hurt: boolean): void {
    if (player.dead) return;
    const { chronicles, deps } = this;
    if (this.chronicle?.name !== player.name) {
      this.chronicle = chronicles.hero(player.name);
      this.streak = { count: 0, lastTurn: 0 };
    }
    const tale = this.chronicle;
    const before = JSON.stringify(tale);
    const careerBefore = JSON.stringify(chronicles.career);
    const next = extendStreak(this.streak, slain.length, turn);
    this.streak = next.streak;
    record(tale, chronicles.career, player, slain, this.streak.count, hurt);
    const legend = slain.find((s) => s.unique);
    if (legend) {
      deps.feel.announce(titleName(legend.name), 'A legend falls', 'legend');
      deps.feel.shake(0.7);
    } else if (next.name) {
      deps.feel.announce(next.name, `${this.streak.count} foes in quick succession`, 'streak');
    }
    const deeds = newDeeds(tale, chronicles.career, chronicles.earned);
    if (deeds.length) {
      chronicles.award(tale, deeds);
      if (deeds.length > 2) deps.feel.showDeed(`${deeds.length} deeds earned`, deeds.map((d) => d.title).join(' · '));
      else for (const deed of deeds) deps.feel.showDeed(deed.title, deed.text);
      for (const deed of deeds) deps.engine.addNotice(`Deed earned: ${deed.title}.`);
      deps.cueDeed();
    }
    if (deeds.length || JSON.stringify(tale) !== before || JSON.stringify(chronicles.career) !== careerBefore) chronicles.save();
  }

  /** Keeps the hero as they were when they fell: sheet, gear, skills, the foe and the last messages. */
  remember(player: PlayerState, state: GameState, snap: LevelSnapshot): void {
    const key = memorialKey({ name: player.name, turn: snap.turn });
    if (this.memorial && memorialKey(this.memorial) === key) return;
    const kept = this.chronicles.memorial(key);
    if (kept) {
      this.memorial = kept;
      return;
    }
    const { engine } = this.deps;
    const palette = this.deps.palette();
    const built = buildMemorial({
      player,
      character: engine.character(),
      inventory: engine.inventory(),
      messages: engine.gameState(60)?.messages ?? state.messages ?? [],
      monsters: state.monsters ?? [],
      px: snap.px,
      py: snap.py,
      turn: snap.turn,
      palette,
      slotName: (part) => SLOT_NAMES[part] ?? 'Slot',
      describe: (item) => engine.itemInfo(item),
      recall: (m) => recallLines(engine, palette, m.id),
    });
    const tale = this.chronicles.peek(player.name);
    if (tale) built.tale = structuredClone(tale);
    this.memorial = built;
    this.chronicles.remember(key, built);
    this.chronicles.save();
  }

  /** The fallen hero in play, in full (from the HUD, Menu and end-of-game summary). */
  openFallen(tab: FallenTab = 'hero'): void {
    const memorial = this.memorial;
    if (!memorial) return;
    this.deps.interrupt();
    const scores = this.deps.engine.scores();
    openFallen(this.deps.sheets, { memorial, entry: scores.find((e) => memorialKey({ name: e.name, turn: e.turns }) === memorialKey(memorial)) ?? null }, tab);
  }

  /** tome2's end-of-game summary of a hero, with what was kept of them: a key for what it shows, and its elements. */
  tomb(tomb: Tomb): { key: string; build: () => HTMLElement[] } {
    const tale = this.chronicles.peek(tomb.name);
    const fallen = this.memorial?.name === tomb.name ? this.memorial : null;
    return {
      key: `${JSON.stringify(tomb)}:${!!fallen}`,
      build: () =>
        tombElements(tomb, {
          memorial: fallen,
          tale,
          tip: nextTimeTip(fallen?.tale ?? tale ?? newChronicle(tomb.name), tomb.cause, tomb.depth),
          onHero: (tab) => this.openFallen(tab),
          onFoe: (foe) => openFoe(this.deps.sheets, foe),
        }),
    };
  }

  /**
   * A hero in the Hall of Fame, as a card: one whose adventure ended on this
   * device can be looked back on in full, some begun anew, and on the title
   * screen any can be removed.
   */
  private openFame(entry: ScoreEntry, inGame: boolean): void {
    const { director, sheets } = this.deps;
    const kept = this.memorialOf(entry);
    const anew = inGame ? this.fallenSaveFor(entry) : director.canBeginAnew(entry);
    openFameCard(sheets, { memorial: kept, entry }, {
      lookBack: kept ? () => openFallen(sheets, { memorial: kept, entry }) : undefined,
      anew: anew
        ? () => {
            sheets.closeAll();
            if (inGame) {
              this.anew = entry.name;
              this.deps.finishGame();
            } else {
              director.beginAnew(entry.name);
            }
          }
        : undefined,
      remove: inGame ? undefined : () => this.removeFame(entry),
      removeEndsAnew: anew && this.deps.engine.scores().filter((e) => saveBase(e.name) === saveBase(entry.name)).length === 1,
    });
  }

  /** In the game the savefile list is not at hand; a fallen hero's own savefile is the one just written. */
  private fallenSaveFor(entry: ScoreEntry): boolean {
    return !!this.memorial && this.memorial.name === entry.name && memorialKey({ name: entry.name, turn: entry.turns }) === memorialKey(this.memorial);
  }

  /**
   * Takes a hero out of the Hall of Fame with what was remembered of them;
   * the last of a name also takes the fallen hero's savefile, which only
   * Begin anew used.
   */
  private removeFame(entry: ScoreEntry): void {
    const { engine, sheets, director, showToast } = this.deps;
    /* The confirmation and the hero's card close back to the Hall of Fame. */
    sheets.back();
    sheets.back();
    const same = (e: ScoreEntry) => memorialKey({ name: e.name, turn: e.turns }) === memorialKey({ name: entry.name, turn: entry.turns }) && e.points === entry.points && e.day === entry.day;
    const index = engine.scores().findIndex(same);
    if (index < 0 || !engine.removeScore(index)) {
      showToast('The Hall of Fame could not be changed.', { log: false, read: true });
      return;
    }
    if (this.chronicles.forgetMemorial(memorialKey({ name: entry.name, turn: entry.turns }))) this.chronicles.save();
    if (!engine.scores().some((e) => saveBase(e.name) === saveBase(entry.name)) && director.forgetFallen(entry.name)) this.deleteSavefile(entry.name);
    const shown = this.fameSheet;
    if (shown) sheets.update(this.hallOfFameSheet(), shown);
    this.synced(`${entry.name} was removed from the Hall of Fame.`);
  }

  /** Syncs storage after a change, saying `done` once it is written. */
  private synced(done: string): void {
    const { showToast } = this.deps;
    this.deps.engine.syncNow().then(
      () => showToast(done, { log: false }),
      (err) => {
        console.error('Saving to browser storage failed', err);
        showToast('Browser storage could not be updated.', { log: false, read: true });
      },
    );
  }

  /** The Hall of Fame's rows, best first, with what was remembered of each hero on this device; a tap opens the hero. */
  fameRows(entries: readonly ScoreEntry[], highlight: number, inGame: boolean): HTMLElement[] {
    return hallOfFameElements(
      entries,
      highlight,
      (entry) => this.memorialOf(entry),
      (entry) => this.openFame(entry, inGame),
    );
  }

  private memorialOf(entry: ScoreEntry): Memorial | null {
    return this.chronicles.memorial(memorialKey({ name: entry.name, turn: entry.turns }));
  }

  /** The Hall of Fame from the title screen. */
  openHallOfFame(): void {
    this.deps.sheets.open(this.hallOfFameSheet());
  }

  private hallOfFameSheet(): SheetContent {
    const body = el('div', 'fame');
    body.append(section('Heroes remembered', ...this.fameRows(this.deps.engine.scores(), -1, false)), ...careerElements(this.chronicles));
    this.fameSheet = { title: 'Hall of Fame', subtitle: 'Heroes of Middle-earth, remembered', body, className: 'sheet-fame' };
    return this.fameSheet;
  }

  /** What is known of a saved hero: the details noted when they were last saved, their tale so far, else tome2's own description. */
  details(save: SaveInfo): AdventurerDetails {
    const name = heroName(save);
    const noted = this.adventurers.get(name);
    const tale = this.chronicles.peek(name);
    const alive = tale && !tale.fallen ? tale : null;
    return {
      name,
      line: noted ? heroLine(noted) : save.description.replace(/^.*?, the /, ''),
      place: noted?.place,
      saved: noted?.saved,
      kills: alive?.kills,
      deepestFeet: alive?.deepestFeet,
    };
  }

  /** A saved hero's name and line on the title screen. */
  describe(save: SaveInfo): { name: string; line: string } {
    const details = this.details(save);
    return { name: details.name, line: adventurerSummary(details) };
  }

  /** The Game Roster: every saved hero, each with Play and Delete. */
  openRoster(saves: readonly SaveInfo[]): void {
    const { director } = this.deps;
    openAdventurers(this.deps.sheets, saves, {
      details: (save) => this.details(save),
      play: (save) => director.choose({ kind: 'continue', save }),
      remove: (save) => {
        const name = heroName(save);
        this.deleteSavefile(name);
        this.forget(name);
        director.forgetSave(save.name);
        this.synced(`${name}'s adventure was deleted.`);
      },
    });
  }

  /** Deletes a hero's savefile and kept levels, and their line in tome2's savefile index. */
  private deleteSavefile(name: string): void {
    const { engine } = this.deps;
    const fs = engine.fs;
    const root = engine.savePath;
    const index = fs && root ? findSaveIndex(fs, root) : null;
    try {
      if (fs && index) deleteHeroSave(fs, index, name);
    } catch (err) {
      console.error(`Deleting ${name}'s save failed`, err);
    }
  }

  /**
   * Forgets what the frontend keeps of a hero whose adventure is over: map
   * memory (the hero's in play too, when it is theirs), title details and,
   * unless they `fell` (their tale is closed and kept, with their recents),
   * their tale and recents.
   */
  forget(name: string, fell?: { abandoned: boolean }): void {
    const { chronicles, adventurers } = this;
    if (fell) {
      if (chronicles.fall(name, fell.abandoned)) chronicles.save();
    } else {
      chronicles.forget(name);
      chronicles.save();
      this.deps.recents.forget(name);
    }
    if (adventurers.forget(name)) adventurers.save();
    this.deps.forgetMemory(name);
  }
}
