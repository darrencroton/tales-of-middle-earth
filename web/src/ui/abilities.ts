import type { GameAudio } from '../audio/audio.ts';
import { launcherKind, spellTone, weaponKind, type SpellTone } from '../audio/cues.ts';
import { keyCodes } from '../input/keys.ts';
import type { Slot } from '../play/actions.ts';
import { fightingStyle, INVEN_AMMO, INVEN_BOW, INVEN_WIELD, itemMacro, type FightingStyle } from '../play/items.ts';
import type { Macro } from '../play/macro.ts';
import { hasActivePowers, hasMagic, NO_TARGET, quickRecent, recentBlocked, recentItem, recentItemAction, recentMagicMacro, thenAim, type CastWatcher, type RecentAction } from '../play/recent.ts';
import { isHostile, type SpellState } from '../render/snapshot.ts';
import { NOT_NOW, type GameApi } from './api.ts';
import { openSpellCard } from './inspect.ts';

interface AbilitiesDeps {
  api: GameApi;
  audio: GameAudio;
  castWatcher: CastWatcher;
  runMacro(macro: Macro): void;
  /** Watches an action begun from a button, so a refusal or failure is told. */
  watchAttempt(): void;
  /** Sends keys as the player's own. */
  send(keys: number[]): void;
  showToast(text: string): void;
  alwaysPickup(): boolean;
}

/**
 * What the hero can do and how they fight: their spells and powers, the
 * quick repeat, how they fight (weapons, magic, stealing) and what they
 * wield, read again as the hero changes. Its state belongs to one hero
 * (`reset` back at the title).
 */
export class Abilities {
  private readonly deps: AbilitiesDeps;
  /* How the hero fights (`style`), by name, level and skill points. */
  private styleKey = '';
  private fighting: FightingStyle = { weapons: true, magic: true };
  private stealing = false;
  /* Spells, powers and skill actions, read again each game turn and whenever skill points are spent (a skill raised or an ability learnt takes no turn). */
  private spellsCache: { key: string; spells: SpellState | null } | null = null;
  /* The game turn the audio last heard the hero's gear. */
  private gearTurn = -1;

  constructor(deps: AbilitiesDeps) {
    this.deps = deps;
  }

  reset(): void {
    this.styleKey = '';
    this.fighting = { weapons: true, magic: true };
    this.stealing = false;
    this.spellsCache = null;
    this.gearTurn = -1;
  }

  /** The hero's spells, powers and skill actions (`web_spells_json`). */
  spells(): SpellState | null {
    const { api } = this.deps;
    const key = `${api.snapshot()?.turn ?? -1}:${api.state()?.player?.skillPoints ?? 0}`;
    if (this.spellsCache?.key !== key) this.spellsCache = { key, spells: api.engine.spells() };
    return this.spellsCache.spells;
  }

  /** How the hero fights, read again when their level or skill points change. */
  style(): FightingStyle {
    const player = this.deps.api.state()?.player;
    if (!player) return this.fighting;
    const key = `${player.name}:${player.lev}:${player.skillPoints}`;
    if (key === this.styleKey) return this.fighting;
    const sheet = this.deps.api.engine.character();
    if (!sheet) return this.fighting;
    this.styleKey = key;
    this.fighting = fightingStyle(sheet.skills);
    this.stealing = !!sheet.skills?.some((skill) => skill.name === 'Stealing' && skill.value > 0);
    return this.fighting;
  }

  /** The hero has the Stealing skill, read with how they fight. */
  steals(): boolean {
    this.style();
    return this.stealing;
  }

  /** The casting sound for a spell in the books carried, by its school. */
  castingTone(name: string): SpellTone | null {
    const school = this.spells()?.books.flatMap((b) => b.spells).find((s) => s.name === name)?.school;
    return school ? spellTone(school) : null;
  }

  /** Tells the audio what the hero fights and shoots with, once a game turn. */
  hearGear(turn: number): void {
    if (turn === this.gearTurn) return;
    const equip = this.deps.api.engine.inventory()?.equip;
    if (!equip) return;
    this.gearTurn = turn;
    const held = (part: number) => equip.find((slot) => slot.part === part && !slot.empty && !!slot.name);
    const launcher = held(INVEN_BOW);
    this.deps.audio.setGear(weaponKind(held(INVEN_WIELD)?.tval), launcherKind(launcher?.tval, launcher?.sval));
  }

  /** The toolbar's quick repeat (`quickRecent`), while the game waits for a command. */
  quick(): RecentAction | null {
    const { api } = this.deps;
    if (!api.snapshot()?.atCommand) return null;
    return quickRecent(api.recent(), this.spells(), api.engine.inventory()?.pack ?? [], this.style().magic, api.state()?.player?.lev ?? 0);
  }

  /** Why a recent action cannot be done now (`recentBlocked`). */
  unavailable(entry: RecentAction, needTarget: boolean): string | null {
    return recentBlocked(entry, this.spells(), this.deps.api.engine.inventory()?.pack ?? [], needTarget, this.targetInSight());
  }

  /** A hostile creature a spell or missile can be aimed at, as tome2's "nearest target" needs. */
  targetInSight(): boolean {
    return (this.deps.api.state()?.monsters ?? []).some((m) => isHostile(m) && !!m.target);
  }

  /** Casts a spell or uses a power again (aiming at the nearest foe when `aim`); it is remembered once tome2 has taken it. */
  run(entry: RecentAction, aim = false, anyway = false): void {
    const { api, castWatcher } = this.deps;
    const command = entry.kind === 'spell' ? 'm' : entry.kind === 'path' ? entry.command : null;
    const why = (command && api.refusal(command)) || (anyway ? null : this.unavailable(entry, false));
    if (why) {
      api.refuse(why);
      return;
    }
    api.sheets.closeAll();
    if (!api.snapshot()?.atCommand) {
      this.deps.showToast(NOT_NOW);
      return;
    }
    if (entry.kind === 'item') {
      const item = recentItem(entry, api.engine.inventory()?.pack ?? []);
      const action = item ? recentItemAction(entry, item) : null;
      if (!item || !action) return;
      api.remember(entry);
      this.deps.watchAttempt();
      this.deps.runMacro(thenAim(itemMacro(action, item, 'pack', '', this.deps.alwaysPickup()), aim));
      return;
    }
    const macro = recentMagicMacro(entry, aim);
    if (!macro) return;
    if (entry.kind === 'spell') castWatcher.begin('m', [], entry.name);
    else castWatcher.begin(entry.command, entry.steps);
    this.deps.audio.castingTone(entry.kind === 'spell' ? this.castingTone(entry.name) : null);
    this.deps.watchAttempt();
    this.deps.runMacro(macro);
  }

  /** Shows a spell's description from tome2's spell list ("i" beside it), with Cast; false when the spell is not known. */
  describeSpell(name: string, key: string): boolean {
    const { api } = this.deps;
    const spell = this.spells()?.books.flatMap((b) => b.spells).find((s) => s.name === name);
    if (!spell) return false;
    openSpellCard(api, spell, () => {
      api.sheets.closeAll();
      this.deps.send(keyCodes(key));
    });
    return true;
  }

  /**
   * The toolbar's magic button, which opens the Magic panel as More does (its
   * other tab a tap away): for a hero who uses magic, Cast with spells or a
   * magic art; otherwise Powers with a power or a technique that acts (a
   * dodge check alone does not earn a button). None without any.
   */
  magicLabel(): string | null {
    const spells = this.spells();
    if (this.style().magic && (!spells || hasMagic(spells))) return 'Cast';
    return hasActivePowers(spells) ? 'Powers' : null;
  }

  /** The Fire button, for a hero with a launcher wielded; it says why it cannot shoot now. */
  fireSlot(): Slot | null {
    const equip = this.deps.api.engine.inventory()?.equip ?? [];
    const ready = (part: number) => equip.some((slot) => slot.part === part && !slot.empty && !!slot.name);
    if (!ready(INVEN_BOW)) return null;
    return { unavailable: !ready(INVEN_AMMO) ? 'Your quiver is empty.' : !this.targetInSight() ? NO_TARGET : null };
  }
}
