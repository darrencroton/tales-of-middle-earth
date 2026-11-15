import { NUMBER_RANGE } from '../play/prompts.ts';

/**
 * Turns tome2's prompts, full of keyboard hints, into plain questions:
 * "(Spells a-f, Descs A-F, ESC=exit) Cast which spell?" → "Cast which spell?".
 */
export function cleanPrompt(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (/Help file '[^']+'/.test(t)) return 'Help';
  if (/Use which power of your golem\?/.test(t)) return 'Creature powers';
  if (/^Reset recall depth\?/.test(t)) return 'Next time, recall to this level instead of the deepest?';
  if (/, (Info file|File) '[^']+', Line \d+\/\d+\]$/.test(t)) return 'Reading';
  const viewer = /^\[[^\]]*?\),\s*(.+?),\s*Line \d+\/\d+\]$/.exec(t);
  if (viewer) return viewer[1];
  t = t.replace(/\[[^\]]*\]/g, ' ');
  t = t.replace(/\(([^()]*)\)/g, (group, inner: string) => (isKeyHint(inner) ? ' ' : group));
  const parts = t.split(',').map((p) => p.trim());
  t = parts.filter((part, i) => i === 0 || !isKeyHint(part)).join(', ');
  t = t.replace(/\s*-more-\s*$/, '').replace(/[\s:]+$/, '').replace(/\s+([?.!])/g, '$1').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

const HINT_WORDS = /\bESC\b|\bRET\b|\bEsc\b|Escape|\bto (exit|scroll|cancel|quit|select|move|accept|advance|continue|restart|set)\b|for (Equip|Inven|floor|options|random|help)|\bselect by name\b|=exit|^\s*[a-zA-Z@*+=/\-]{1,2}\s*-\s*[a-zA-Z]\s*$|^\s*[a-zA-Z]-[a-zA-Z0-9]+\s*$|^(Inven|Equip|Floor|Spells|Descs)\b/;

/** True for a phrase that only tells the player which keys to press. */
function isKeyHint(text: string): boolean {
  return HINT_WORDS.test(text.trim());
}

const KEY_TOKENS = /'[^']{1,3}'|\bESC\b|\bRET\b|\bEnter\b|\bup\/down\b|\bright\/left\b|\d\/\d|\b[2468], |\bbackspace\b|SPACE\)/g;

/**
 * True for an instruction line such as "[Press 2, 8, 4, 6 ... or ESC to exit.]"
 * or "['c' to change name, 'f' to file, ... or ESC]", which the toolbar
 * replaces.
 */
export function isInstructionLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const tokens = t.match(KEY_TOKENS)?.length ?? 0;
  if (/^\[.*\]$/.test(t) && tokens >= 1) return true;
  if (/^(Hit|Press) any key/i.test(t) || /-more-$/.test(t)) return true;
  return tokens >= 2;
}

/** Item letters tome2 offers descriptions for, from "Descs A-F" in a prompt. */
export function describableRange(prompt: string): [string, string] | null {
  const m = /Descs ([A-Z])-([A-Z])/.exec(prompt);
  return m ? [m[1], m[2]] : null;
}

/** A question answered with a number: its heading, a line saying what the number means, the range offered and the label of the button for the most. */
export interface NumberQuestion {
  title: string;
  hint?: string;
  min: number;
  max: number;
  most: string;
}

/* tome2 asks how many without saying the most (fireproofing a stack); the stepper offers up to this. */
const UNSTATED_MOST = 99;

/** Reads a quantity prompt: "Quantity (1-6): 1", "How many would you like fireproofed? 1", "Which level in Mirkwood(11-14)? 14". */
export function numberQuestion(text: string): NumberQuestion {
  const range = NUMBER_RANGE.exec(text);
  const min = range ? Number(range[1]) : 1;
  const max = Math.max(min, range ? Number(range[2]) : UNSTATED_MOST);
  const recall = /^Which level in (.+?)\s*\(/.exec(text);
  if (recall) {
    return {
      title: `How deep in ${recall[1]}?`,
      hint: min === max ? `Word of Recall takes you to level ${min}.` : `Level ${min} to ${max}. Word of Recall takes you to the level you choose.`,
      min,
      max,
      most: 'Deepest',
    };
  }
  const question = text.slice(0, text.search(/[?:]/) + 1 || undefined).replace(NUMBER_RANGE, '');
  const title = /^Quantity\b/i.test(question) ? 'How many?' : `${cleanPrompt(question).replace(/[?:]$/, '')}?`;
  return { title, min, max, most: `All ${max}` };
}
