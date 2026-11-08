/**
 * What a bubble card says for an assistant's reply: the words in full when
 * they fit, else the reply's lead paragraph, cut at a sentence. The brain asks
 * the assistant to open a long reply with one sentence that says what it did
 * (the writing_style skill, Project Bubble Chat D1), so that paragraph is the
 * assistant's own summary. Pure; pinned by reply-text.test.ts.
 *
 * Kept apart from person-text.ts because the markdown reader brings `marked`:
 * the sync imports this file only when a reply arrives, so it does not ride
 * on every route.
 */
import type { ToolOutcomeStatsRow } from '@mantle/client-types';
import { markdownToPlainText } from '@mantle/content-core/markdown-to-text';
import { clampText, type BubbleText } from './person-text';

/** An assistant's card has more room than a person's: its lead paragraph. */
export const REPLY_TEXT_MAX = 360;

/** A line that opens something other than a sentence. */
const NOT_PROSE = /^(#{1,6}\s|\||:::|>|!\[|\$\$|-{3,}$|\*{3,}$|[-*+]\s|\d+[.)]\s)/;
const FENCE = /^(```|~~~)/;
/** Where a sentence ends: the floor keeps "Hi." from being the whole line. */
const SENTENCE_END = /[.!?](?=\s|$)/g;
const SENTENCE_FLOOR = 20;

/** The reply's first paragraph that is written as prose, or null. */
function leadParagraph(markdown: string): string | null {
  let inFence = false;
  const lines: string[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (FENCE.test(line)) {
      if (lines.length) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line || NOT_PROSE.test(line)) {
      if (lines.length) break;
      continue;
    }
    lines.push(line);
  }
  return lines.length ? lines.join(' ') : null;
}

/** The words up to the last sentence end that fits, else a clean cut. */
function upToSentence(words: string, max: number): string {
  if (words.length <= max) return words;
  let end = -1;
  for (const m of words.matchAll(SENTENCE_END)) {
    const at = (m.index ?? 0) + 1;
    if (at > max) break;
    if (at >= SENTENCE_FLOOR) end = at;
  }
  return end > 0 ? words.slice(0, end) : clampText(words, max);
}

export function replyText(markdown: string): BubbleText {
  const plain = markdownToPlainText(markdown);
  if (plain.length <= REPLY_TEXT_MAX) return { text: plain, cut: false, note: null };
  const lead = leadParagraph(markdown);
  const words = lead ? markdownToPlainText(lead) : plain;
  return { text: upToSentence(words, REPLY_TEXT_MAX), cut: true, note: null };
}

/** What the turn did, from the brain's own tally (never the reply's claims):
 *  "Used 6 tools, 1 failed". Null for a reply that used no tool. */
export function factsLine(
  stats: Pick<ToolOutcomeStatsRow, 'calls' | 'failed' | 'queued'> | null | undefined,
): string | null {
  if (!stats || !(stats.calls > 0)) return null;
  const parts = [`Used ${stats.calls} ${stats.calls === 1 ? 'tool' : 'tools'}`];
  if (stats.failed > 0) parts.push(`${stats.failed} failed`);
  if (stats.queued > 0) parts.push(`${stats.queued} waiting for approval`);
  return parts.join(', ');
}

export type ItemLink = { label: string; href: string };

/** All a reply's card says: its words, the facts line and the item links. */
export function replyWords(reply: {
  text: string;
  toolStats?: Pick<ToolOutcomeStatsRow, 'calls' | 'failed' | 'queued'> | null;
}): BubbleText & { facts: string | null; links: ItemLink[] } {
  return {
    ...replyText(reply.text),
    facts: factsLine(reply.toolStats),
    links: itemLinks(reply.text),
  };
}

/** The most items a card offers to open. */
export const ITEM_LINKS_MAX = 2;
const LINK = /(!?)\[([^\]\n]{1,120})\]\(([^)\s]+)\)/g;
const NODE_ID = '[0-9a-fA-F-]{36}';
const NODE_PATH = new RegExp(`^/n/(${NODE_ID})$`);
const PAGE_CARD = new RegExp(`^page:(${NODE_ID})$`);

/**
 * The items a reply links to, as paths in the app: a node link (`/n/<id>`,
 * the form the brain's skills write) or a page card (`page:<id>`). Nothing
 * else, so a card never offers a link out of the app. The item opens with the
 * person's own rights, as a click in the chat would.
 */
export function itemLinks(markdown: string): ItemLink[] {
  const out: ItemLink[] = [];
  for (const m of markdown.matchAll(LINK)) {
    if (m[1]) continue;
    const id = NODE_PATH.exec(m[3]!)?.[1] ?? PAGE_CARD.exec(m[3]!)?.[1];
    if (!id) continue;
    const href = `/n/${id.toLowerCase()}`;
    if (out.some((l) => l.href === href)) continue;
    const label = clampText(markdownToPlainText(m[2]!).trim(), 40);
    if (!label) continue;
    out.push({ label, href });
    if (out.length === ITEM_LINKS_MAX) break;
  }
  return out;
}
