/** The Books at once field: blank is null (the box's value), a whole number
 *  is itself, and anything else ("2.5", "abc") is undefined, refused. Not
 *  parseInt, which would save "2.5" as 2 without a word. */
export function parseBooksAtOnce(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : undefined;
}
