/* Names as tome2 writes them, made readable. */

export function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** A name without its leading article ("a Cave spider" → "Cave spider"). */
export function stripArticle(name: string): string {
  return name.replace(/^(a|an|the|some) /i, '');
}

/** A name without its leading article, capitalised, for use as a title. */
export function titleName(name: string): string {
  return capitalise(stripArticle(name));
}
