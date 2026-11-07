/**
 * What a bubble card says for a person's message: the text in full when it
 * fits, else a clean cut with the size of the message. Pure; pinned by
 * person-text.test.ts. The card is plain text: nothing here is rendered as
 * markup.
 */

/** Over this many characters the card shows a cut. */
export const BUBBLE_TEXT_MAX = 240;
/** Over this many lines the card shows a cut. */
export const BUBBLE_LINES_MAX = 6;
/** The first line of a long message, at most. */
const FIRST_LINE_MAX = 120;

export type BubbleText = {
  text: string;
  /** The card does not hold the whole message. */
  cut: boolean;
  /** Says what kind of cut it is ("sent a long message, 42 lines"). */
  note: string | null;
};

/** At most `max` characters, cut at a word when one is near the end. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

export function personText(body: string): BubbleText {
  const text = body.trim();
  const lines = text.split('\n');
  if (text.length <= BUBBLE_TEXT_MAX && lines.length <= BUBBLE_LINES_MAX) {
    return { text, cut: false, note: null };
  }
  const first = lines.find((l) => l.trim())?.trim() ?? '';
  return {
    text: clampText(first, FIRST_LINE_MAX),
    cut: true,
    note: lines.length > 1 ? `sent a long message, ${lines.length} lines` : 'sent a long message',
  };
}
