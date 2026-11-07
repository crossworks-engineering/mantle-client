/**
 * What a bubble card says for an assistant's reply: the words in full when
 * they fit, else the reply's first sentence. Pure; pinned by reply-text.test.ts.
 *
 * Kept apart from person-text.ts because the markdown reader brings `marked`:
 * the sync imports this file only when a reply arrives, so it does not ride
 * on every route.
 */
import { markdownToPlainText } from '@mantle/content-core/markdown-to-text';
import { BUBBLE_TEXT_MAX, clampText, type BubbleText } from './person-text';

/** A line that opens something other than a sentence. */
const NOT_PROSE = /^(#{1,6}\s|\||:::|>|!\[|\$\$|-{3,}$|\*{3,}$)/;
const FENCE = /^(```|~~~)/;
/** A sentence ends here; the floor keeps "Hi." from being the whole line. */
const FIRST_SENTENCE = /^(.{20,}?[.!?])(?:\s|$)/s;

/** The first line of the reply that is written as prose, or null. */
function firstProseLine(markdown: string): string | null {
  let inFence = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || NOT_PROSE.test(line)) continue;
    return line;
  }
  return null;
}

export function replyText(markdown: string): BubbleText {
  const plain = markdownToPlainText(markdown);
  if (plain.length <= BUBBLE_TEXT_MAX) return { text: plain, cut: false, note: null };
  const line = firstProseLine(markdown);
  const words = line ? markdownToPlainText(line) : plain;
  const sentence = FIRST_SENTENCE.exec(words)?.[1] ?? words;
  return { text: clampText(sentence, BUBBLE_TEXT_MAX), cut: true, note: null };
}
