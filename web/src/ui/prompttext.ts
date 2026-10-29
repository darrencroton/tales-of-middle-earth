/**
 * Turns tome2's prompts, full of keyboard hints, into plain questions:
 * "(Spells a-f, Descs A-F, ESC=exit) Cast which spell?" → "Cast which spell?".
 */
export function cleanPrompt(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  const help = /Help file '[^']+'/.exec(t);
  if (help) return 'Help';
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
export function isKeyHint(text: string): boolean {
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
