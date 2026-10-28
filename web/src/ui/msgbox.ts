import { bracketChoices } from '../play/prompts.ts';
import { rowText, type TermRow } from './termparse.ts';

export interface BoxChoice {
  label: string;
  key: string;
}

/** A question or notice tome2 draws in a box in the middle of the screen. */
export interface MessageBox {
  kind: 'yesno' | 'choice' | 'notice';
  text: string;
  choices: BoxChoice[];
  /** First and last terminal rows the box covers. */
  top: number;
  bottom: number;
}

const char = (row: TermRow, x: number) => (x >= 0 && x < row.chars.length ? String.fromCharCode(row.chars[x] || 32) : ' ');

/** Finds a "/----\ |text| \----/" box, or null. */
export function findMessageBox(rows: readonly TermRow[]): MessageBox | null {
  for (let y = 1; y + 1 < rows.length; y++) {
    const top = rowText(rows[y - 1]);
    const match = /\/-{3,}\\/.exec(top);
    if (!match) continue;
    const x0 = match.index;
    const x1 = x0 + match[0].length - 1;
    const bottom = rows[y + 1];
    if (char(bottom, x0) !== '\\' || char(bottom, x1) !== '/') continue;
    if (char(rows[y], x0) !== '|' || char(rows[y], x1) !== '|') continue;
    const text = rowText(rows[y]).slice(x0 + 1, x1).trim();
    if (!text) continue;
    return { ...classifyBox(text), top: y - 1, bottom: y + 1 };
  }
  return null;
}

function classifyBox(text: string): Pick<MessageBox, 'kind' | 'text' | 'choices'> {
  if (/\(y\/n\)\s*$/i.test(text)) {
    const question = text.replace(/\s*\(y\/n\)\s*$/i, '').replace(/\s*\(this is permanent\)/i, '');
    return { kind: 'yesno', text: /[?!.]$/.test(question) ? question : `${question}?`, choices: [] };
  }
  const choices = bracketChoices(text);
  if (choices.length > 1) return { kind: 'choice', text: 'Choose one', choices };
  return { kind: 'notice', text, choices: [] };
}
