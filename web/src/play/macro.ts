/** What a macro sees each time the engine waits for input. */
export interface MacroScreen {
  /** Terminal row 0 (prompts and messages), trimmed. */
  prompt: string;
  /** Whole screen text. */
  screen: string;
  /** Engine is at the command prompt. */
  atCommand: boolean;
}

/**
 * A scripted exchange with tome2: yields the keys to send and receives the
 * screen once the engine next waits for input. Returning ends it.
 */
export type Macro = Generator<number[], void, MacroScreen>;

const MAX_STEPS = 24;

export class MacroRunner {
  private macro: Macro | null = null;
  private steps = 0;

  get running(): boolean {
    return this.macro !== null;
  }

  /** Starts a macro and returns its first keys (empty when it ends at once). */
  start(macro: Macro): number[] {
    this.macro = macro;
    this.steps = 0;
    return this.advance(undefined);
  }

  /** Feeds the current screen and returns the next keys, or [] once finished. */
  step(screen: MacroScreen): number[] {
    if (!this.macro) return [];
    return this.advance(screen);
  }

  cancel(): void {
    this.macro?.return();
    this.macro = null;
  }

  private advance(screen: MacroScreen | undefined): number[] {
    const macro = this.macro;
    if (!macro) return [];
    if (++this.steps > MAX_STEPS) {
      this.cancel();
      return [];
    }
    const result = macro.next(screen as MacroScreen);
    if (result.done) {
      this.macro = null;
      return [];
    }
    return result.value;
  }
}

export const keyCodes = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
