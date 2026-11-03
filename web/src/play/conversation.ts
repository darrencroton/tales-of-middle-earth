import { attemptOutcome, freshMessages } from '../audio/cues.ts';
import type { Engine } from '../engine.ts';
import { KEY_BACKSLASH as BACKSLASH } from '../input/keys.ts';
import type { GameState, LevelSnapshot, MonsterState } from '../render/snapshot.ts';
import { converseMacro } from './actions.ts';
import type { Macro } from './macro.ts';
import type { PromptKind } from './prompts.ts';
import { titleName } from './text.ts';

/* tome2's Talk and Give: a word with a creature. */
const TALK = 'Y'.charCodeAt(0);
const GIVE = 'y'.charCodeAt(0);

interface ConversationDeps {
  engine: Engine;
  snapshot(): LevelSnapshot | null;
  state(): GameState | null;
  macroRunning(): boolean;
  prompt(): PromptKind;
  /** The hero controls another creature, so their own commands are refused (a toast says why). */
  held(): boolean;
  runMacro(macro: Macro): void;
  hideToast(): void;
  showToast(text: string, options: { log?: boolean; read?: boolean }): void;
  /** Shows what was said in a card. */
  openMessage(title: string, text: string): void;
  /** What was said has been shown (in a card or a toast). */
  told(): void;
}

/**
 * What tome2 says after an exchange begun by the player, gathered until it
 * is back at the command prompt: a word with a creature (Talk and Give),
 * shown in a card so a long answer is not lost as messages flow past; and a
 * spell, power, item or shot begun from a button, whose refusal or failure
 * is told. Its state belongs to one game (`reset` back at the title).
 */
export class Conversation {
  private readonly deps: ConversationDeps;
  /* A word with a creature: what tome2 says until it is back at the command prompt. */
  private conversation: { title: string; named: boolean; messages: string[] } | null = null;
  /** An action begun from a button, from the turn it began. */
  private attempt: { turn: number; messages: string[] } | null = null;

  constructor(deps: ConversationDeps) {
    this.deps = deps;
  }

  reset(): void {
    this.conversation = null;
    this.attempt = null;
  }

  /** A word with a creature is under way: what it says is still being gathered, to be shown once tome2 is back at the command prompt. */
  get talking(): boolean {
    return !!this.conversation;
  }

  /** Starts watching an action begun from a button, so a refusal or failure is told once tome2 is back at the command prompt. */
  watchAttempt(): void {
    const snap = this.deps.snapshot();
    this.attempt = snap ? { turn: snap.turn, messages: [] } : null;
  }

  /** Gathers the messages of a watched action, and of a conversation. */
  follow(previous: GameState | null, state: GameState): void {
    if (!previous) return;
    if (this.attempt) this.attempt.messages.push(...freshMessages(previous, state));
    if (this.conversation) this.conversation.messages.push(...freshMessages(previous, state));
  }

  /** The creature one step from the hero in a keypad direction, by its digit's key code. */
  private creatureTowards(code: number | undefined): MonsterState | undefined {
    const snap = this.deps.snapshot();
    const digit = (code ?? 0) - 48;
    if (!snap || digit < 1 || digit > 9 || digit === 5) return undefined;
    const dx = ((digit - 1) % 3) - 1;
    const dy = 1 - Math.floor((digit - 1) / 3);
    return this.deps.state()?.monsters?.find((m) => m.x === snap.px + dx && m.y === snap.py + dy);
  }

  /** Begins gathering what tome2 says to Talk (`Y`) or Give (`y`), named for the creature when it is known. */
  private begin(command: number, creature: MonsterState | undefined): void {
    this.conversation = { title: creature ? titleName(creature.name) : command === TALK ? 'Talk' : 'Give', named: !!creature, messages: [] };
  }

  /**
   * Talks to (`Y`) or gives to (`y`) the creature in a keypad direction from a
   * button or tap, giving the direction only once tome2 asks for it.
   */
  converse(command: 'Y' | 'y', digit: string): void {
    if (!this.deps.snapshot()?.atCommand || this.deps.held()) return;
    this.deps.hideToast();
    this.begin(command.charCodeAt(0), this.creatureTowards(digit.charCodeAt(0)));
    this.deps.runMacro(converseMacro(command, digit));
  }

  /**
   * Begins a conversation when Talk or Give is typed at the command prompt, or
   * sent from More, named for the creature in the direction answered next.
   */
  note(codes: readonly number[]): void {
    if (this.conversation && !this.conversation.named && codes.length === 1 && this.deps.prompt() === 'direction') {
      const creature = this.creatureTowards(codes[0]);
      if (creature) this.conversation = { ...this.conversation, title: titleName(creature.name), named: true };
      return;
    }
    const command = codes[0] === BACKSLASH ? codes.slice(1) : codes;
    if ((command[0] !== TALK && command[0] !== GIVE) || !this.deps.snapshot()?.atCommand) return;
    this.begin(command[0], undefined);
  }

  /**
   * Once tome2 is back at the command prompt: tells the player when a watched
   * action was refused or failed; shows what a creature said in a card, or a
   * single line as a toast.
   */
  settle(): void {
    this.settleAttempt();
    this.settleConversation();
  }

  private settleAttempt(): void {
    const snap = this.deps.snapshot();
    if (!this.attempt || !snap?.atCommand || snap.icky || this.deps.macroRunning()) return;
    const outcome = attemptOutcome(snap.turn !== this.attempt.turn, this.attempt.messages);
    this.attempt = null;
    if (outcome) this.deps.showToast(outcome.message, { log: false });
  }

  private settleConversation(): void {
    const snap = this.deps.snapshot();
    if (this.conversation && this.deps.state()?.player?.dead) this.conversation = null;
    if (!this.conversation || !snap?.atCommand || snap.icky || this.deps.macroRunning() || this.deps.engine.pendingKeys > 0) return;
    const { title, messages } = this.conversation;
    this.conversation = null;
    if (messages.length > 1) this.deps.openMessage(title, messages.join(' '));
    else if (messages.length === 1) this.deps.showToast(messages[0], { log: false, read: true });
    if (messages.length) this.deps.told();
  }
}
