/**
 * Bubble cards, the pure half (Project Bubble Chat, phase 1). A card is one
 * new line of a chat, from either chat system, shown outside the chat windows
 * until it is popped or read. Pinned by cards.test.ts.
 *
 * The brain is the only store. The one rule:
 *
 *   A card lives while its chat's list row says `unread` is above 0 (and the
 *   chat is not muted), and its key is not in the popped set.
 *
 * So a chat read anywhere (the screen, the window, another device) drops its
 * cards at the next list refresh, with no event of its own. A pinned card
 * stays through a read, for as long as its chat is in the list.
 */
import type { AssistantTimelineRow } from '@mantle/client-types';
import type { MessengerListRow, MessengerMessage } from '@/lib/messenger/dto';
import { noticeText, shouldPop } from '@/lib/messenger/notify';
import { personText, type BubbleText } from './person-text';

export type BubbleCard = {
  /** `<chat>:<order>`. */
  key: string;
  /** The conversation id, or the agent id for an agent thread. */
  chat: string;
  kind: MessengerListRow['kind'];
  /** Where the line stands in its chat: the seq, or for an assistant thread
   *  (which has none) the time in ms. */
  order: number;
  /** When it was sent, ms: the stack's order across chats. */
  at: number;
  title: string;
  text: string;
  cut: boolean;
  note: string | null;
  /** The agent thread's slug: opens the thread, moves its read cursor. */
  agentSlug: string | null;
  author: {
    kind: 'login' | 'agent';
    id: string | null;
    name: string;
    avatar: MessengerListRow['participants'][number]['avatar'] | null;
    photoVersion: string | null;
  };
};

/** The newest lines of one chat a card is made for. */
export const LINES_PER_CHAT = 5;
/** The chats read in one pass. */
export const CHATS_PER_SYNC = 20;
/** The cards held in memory; the oldest go first. */
export const CARDS_MAX = 50;
/** The popped keys kept in the browser; the oldest go first. */
export const POPPED_MAX = 200;
/** The pinned keys kept in the browser; the oldest go first. */
export const PINNED_MAX = 20;

export function cardKey(chat: string, order: number): string {
  return `${chat}:${order}`;
}

/** The chat and the order of a key. A chat id holds no colon. */
export function parseKey(key: string): { chat: string; order: number } | null {
  const at = key.lastIndexOf(':');
  if (at <= 0) return null;
  const order = Number(key.slice(at + 1));
  return Number.isFinite(order) ? { chat: key.slice(0, at), order } : null;
}

/** How many lines to read for a row: what is unread, up to the limit. */
export function linesWanted(unread: number): number {
  return Math.max(0, Math.min(unread, LINES_PER_CHAT));
}

/** What changes when a chat has something new to read: a new line, the count,
 *  or a pending reply that got its text. */
export function rowSignature(row: MessengerListRow): string {
  return [row.lastSeq, row.lastMessageAt, row.unread, row.preview?.text ?? ''].join('|');
}

function rowCounts(row: MessengerListRow): boolean {
  return row.unread > 0 && !row.muted;
}

/** The rows with something new to read since `seen`, newest first (the
 *  brain's order keeps pinned ones first, so sort by time here). */
export function chatsToSync(
  rows: readonly MessengerListRow[],
  seen: ReadonlyMap<string, string>,
): MessengerListRow[] {
  return rows
    .filter((r) => rowCounts(r) && seen.get(r.id) !== rowSignature(r))
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    .slice(0, CHATS_PER_SYNC);
}

/** The card of a person's line, or null where it never pops. */
export function cardFromMessage(
  message: MessengerMessage,
  row: MessengerListRow,
  me: string | null,
): BubbleCard | null {
  if (!shouldPop({ message, me, muted: row.muted, onScreen: false })) return null;
  const words = noticeText(message, row.kind === 'group' ? row.title : null);
  const author = row.participants.find((p) => p.id === message.authorId);
  return {
    key: cardKey(row.id, message.seq),
    chat: row.id,
    kind: row.kind,
    order: message.seq,
    at: Date.parse(message.createdAt) || 0,
    title: words.title,
    ...personText(message.body),
    agentSlug: null,
    author: {
      kind: message.authorKind === 'agent' ? 'agent' : 'login',
      id: message.authorId,
      name: message.authorName ?? 'Someone',
      avatar: author?.avatar ?? null,
      photoVersion: author?.photoVersion ?? null,
    },
  };
}

type ReplyRow = Pick<AssistantTimelineRow, 'direction' | 'status' | 'text' | 'createdAt'> &
  Partial<Pick<AssistantTimelineRow, 'superseded'>>;

/** The finished replies among the newest `count` of a thread, newest first.
 *  `count` comes from the brain's unread, which counts every reply past the
 *  cursor whatever its status. So take those `count` first and filter after:
 *  the other way round reaches past the cursor, to a reply already read. A
 *  pending reply has no text yet and a failed one has its place in the thread. */
export function newestReplies<T extends ReplyRow>(rows: readonly T[], count: number): T[] {
  return rows
    .filter((r) => r.direction === 'outbound')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, count)
    .filter((r) => r.status === 'complete' && r.text.trim() && !r.superseded);
}

/** The card of an assistant's reply. */
export function cardFromReply(
  reply: Pick<AssistantTimelineRow, 'createdAt'>,
  row: MessengerListRow,
  words: BubbleText,
): BubbleCard {
  const at = Date.parse(reply.createdAt) || 0;
  return {
    key: cardKey(row.id, at),
    chat: row.id,
    kind: row.kind,
    order: at,
    at,
    title: row.title,
    ...words,
    agentSlug: row.agentSlug ?? null,
    author: { kind: 'agent', id: row.id, name: row.title, avatar: null, photoVersion: null },
  };
}

/** Cards with one chat's replaced by `fresh`, what its last read returned: so
 *  a line read, edited or deleted goes with no rule of its own. A pinned card
 *  of the chat stays. None that was popped, newest first, at most CARDS_MAX
 *  besides the pinned ones (at most PINNED_MAX). */
export function setChatCards(
  cards: readonly BubbleCard[],
  chat: string,
  fresh: readonly BubbleCard[],
  popped: readonly string[],
  pinned: readonly string[] = [],
): BubbleCard[] {
  const byKey = new Map<string, BubbleCard>();
  for (const c of cards) {
    if (c.chat !== chat || pinned.includes(c.key)) byKey.set(c.key, c);
  }
  for (const c of fresh) {
    if (!popped.includes(c.key)) byKey.set(c.key, c);
  }
  return [...byKey.values()]
    .sort((a, b) => b.at - a.at)
    .filter((c, i) => i < CARDS_MAX || pinned.includes(c.key));
}

/** The one rule (above), over the list as it stands. */
export function liveCards(
  cards: readonly BubbleCard[],
  rows: readonly MessengerListRow[],
  popped: readonly string[],
  pinned: readonly string[] = [],
): BubbleCard[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return cards.filter((c) => {
    const row = byId.get(c.chat);
    if (!row) return false;
    return pinned.includes(c.key) || (rowCounts(row) && !popped.includes(c.key));
  });
}

/**
 * Where the read cursor moves after a pop. The stack runs newest to oldest and
 * a cursor only moves forward, so moving it at the first pop would mark the
 * older cards read. So it moves when the LAST card of the chat goes, to the
 * highest line popped; until then, null. `popped` includes the key just popped.
 * A pinned card does not wait for this: it stays through a read.
 */
export function readAfterPop(
  chat: string,
  remaining: readonly BubbleCard[],
  popped: readonly string[],
  pinned: readonly string[] = [],
): number | null {
  if (remaining.some((c) => c.chat === chat && !pinned.includes(c.key))) return null;
  let top: number | null = null;
  for (const key of popped) {
    const k = parseKey(key);
    if (k?.chat === chat && (top === null || k.order > top)) top = k.order;
  }
  return top;
}

/**
 * Whether closing a chat's last card may move its read cursor, by a list read
 * just now. Not when the row says nothing is unread: the chat was read in
 * another place, and an assistant thread's cursor would move back. Not when
 * more is unread than a chat ever shows as cards: that would mark lines read
 * that nobody saw, so the row stays highlighted.
 */
export function cursorMayMove(row: Pick<MessengerListRow, 'unread'> | undefined): boolean {
  return !!row && row.unread > 0 && row.unread <= LINES_PER_CHAT;
}

/** The popped set with one more key: the oldest go first. */
export function addPopped(popped: readonly string[], key: string): string[] {
  if (popped.includes(key)) return [...popped];
  return [...popped, key].slice(-POPPED_MAX);
}

/** The pinned set with a key added, or taken out if it was there. */
export function togglePinned(pinned: readonly string[], key: string): string[] {
  if (pinned.includes(key)) return pinned.filter((k) => k !== key);
  return [...pinned, key].slice(-PINNED_MAX);
}

/** A stored set of keys (popped or pinned): anything unreadable reads as empty. */
export function parsePopped(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

const ON_CHAT_SCREEN = /^\/(chats|assistant)(\/|$)/;

/** Whether a chat window is open: the chat or assistant screen, or the side
 *  window in any shape. A minimised window is not open. */
export function chatWindowOpen(s: {
  panel: 'open' | 'min' | 'closed';
  pathname: string | null | undefined;
}): boolean {
  return s.panel === 'open' || ON_CHAT_SCREEN.test(s.pathname ?? '');
}

/**
 * Whether a person's new line also pops a toast. With bubbles off, always, as
 * it did. With bubbles on, the card or the row's highlight says it instead.
 * One case stays until the window has a chat list (phase 5): with only the
 * window open there is nothing yet to highlight, so the toast keeps the line
 * from being missed.
 */
export function toastWanted(s: {
  bubbles: boolean;
  panel: 'open' | 'min' | 'closed';
  pathname: string | null | undefined;
}): boolean {
  if (!s.bubbles) return true;
  return s.panel === 'open' && !ON_CHAT_SCREEN.test(s.pathname ?? '');
}
