/**
 * One chat's transcript in the browser (Messenger V1 Phase 2), the pure half.
 * Pinned by transcript.test.ts.
 *
 * Seq is the order (docs/messenger.md "Seq: the one order"): the window held
 * is a run of messages sorted by seq, pages merge by seq (a later copy of a
 * seq wins: an edit, a delete, a reaction), and the catch-up after a stream
 * event asks for what is above the highest seq held. Clocks only label.
 */
import type { MessengerMessage, MessengerMessagesResponse } from './dto';

/** A send of mine the brain has not answered yet (or refused). */
export type OutboxLine = {
  clientMsgId: string;
  body: string;
  createdAt: string;
  state: 'sending' | 'failed';
  /** Why it failed, for the retry line. */
  error?: string;
};

export type Transcript = {
  /** Sorted by seq, one per seq. */
  messages: MessengerMessage[];
  /** More messages exist below the lowest seq held (scroll up loads them). */
  hasOlder: boolean;
  /** My sends in flight or refused, in the order sent. */
  outbox: OutboxLine[];
};

export const EMPTY_TRANSCRIPT: Transcript = { messages: [], hasOlder: false, outbox: [] };

/** How many messages a page asks for: the brain's own default. */
export const PAGE_SIZE = 20;

/** Merge by seq: one message per seq, `incoming` wins, sorted ascending. */
export function mergeMessages(
  existing: readonly MessengerMessage[],
  incoming: readonly MessengerMessage[],
): MessengerMessage[] {
  if (incoming.length === 0) return existing as MessengerMessage[];
  const bySeq = new Map<number, MessengerMessage>();
  for (const m of existing) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest seq held (0 with none). */
export function highestSeq(messages: readonly MessengerMessage[]): number {
  return messages.length ? messages[messages.length - 1]!.seq : 0;
}

/**
 * The top of the unbroken run of seqs from the lowest held: the next
 * catch-up's `after_seq` (0 with none). Seqs have no gaps inside what a
 * login may read (a history delete and a clear cut from the bottom), so a
 * seq held above this top was merged early (my own send answered before the
 * message under it arrived) and the catch-up must fetch from here, not
 * from the highest.
 */
export function contiguousTop(messages: readonly MessengerMessage[]): number {
  if (messages.length === 0) return 0;
  let top = messages[0]!.seq;
  for (let i = 1; i < messages.length; i += 1) {
    const seq = messages[i]!.seq;
    if (seq !== top + 1) break;
    top = seq;
  }
  return top;
}

/**
 * Where a refetched seq (an edit, a delete, a reaction) goes: merged when it
 * is inside the window held; a catch-up when it is above it (the catch-up
 * brings it with whatever is under it); ignored below the window (scrolling
 * up loads it in place). Merging a seq outside the window would leave a
 * hole that neither the catch-up nor scrolling up ever fills.
 */
export function refetchPlacement(
  messages: readonly MessengerMessage[],
  seq: number,
): 'merge' | 'catch-up' | 'ignore' {
  const low = lowestSeq(messages);
  if (low === null) return 'catch-up';
  if (seq < low) return 'ignore';
  if (seq > contiguousTop(messages)) return 'catch-up';
  return 'merge';
}

/** The lowest seq held: the next scroll-up's `before_seq`, null with none. */
export function lowestSeq(messages: readonly MessengerMessage[]): number | null {
  return messages.length ? messages[0]!.seq : null;
}

/** Drop the outbox lines a stored message answers (the same clientMsgId). */
function settleOutbox(outbox: readonly OutboxLine[], messages: readonly MessengerMessage[]) {
  if (outbox.length === 0) return outbox as OutboxLine[];
  const stored = new Set(messages.map((m) => m.clientMsgId).filter(Boolean));
  return outbox.filter((o) => !stored.has(o.clientMsgId));
}

/** The first page of a chat (the last PAGE_SIZE): replaces the window, keeps
 *  my unanswered sends. */
export function withLatestPage(t: Transcript, page: MessengerMessagesResponse): Transcript {
  const messages = mergeMessages([], page.messages);
  return { messages, hasOlder: page.hasMore, outbox: settleOutbox(t.outbox, messages) };
}

/** An older page (scrolling up): below the window. */
export function withOlderPage(t: Transcript, page: MessengerMessagesResponse): Transcript {
  return { ...t, messages: mergeMessages(t.messages, page.messages), hasOlder: page.hasMore };
}

/** A newer page (the catch-up after_seq) or a refetched single message. */
export function withNewer(t: Transcript, messages: readonly MessengerMessage[]): Transcript {
  const merged = mergeMessages(t.messages, messages);
  return { ...t, messages: merged, outbox: settleOutbox(t.outbox, merged) };
}

export function withOutbox(t: Transcript, line: OutboxLine): Transcript {
  return { ...t, outbox: [...t.outbox.filter((o) => o.clientMsgId !== line.clientMsgId), line] };
}

export function withoutOutbox(t: Transcript, clientMsgId: string): Transcript {
  return { ...t, outbox: t.outbox.filter((o) => o.clientMsgId !== clientMsgId) };
}

/** The query string of a page: the latest, older than a seq, or newer. */
export function pageQuery(
  q: { beforeSeq?: number | null; afterSeq?: number | null; limit?: number } = {},
): string {
  const qs = new URLSearchParams();
  if (q.beforeSeq != null) qs.set('before_seq', String(q.beforeSeq));
  if (q.afterSeq != null) qs.set('after_seq', String(q.afterSeq));
  if (q.limit != null) qs.set('limit', String(q.limit));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Messages within this long of each other, from one author, read as one
 *  group: no stamp between them, the name once. */
export const GROUP_GAP_MS = 10 * 60_000;

export type TranscriptItem =
  | { kind: 'stamp'; key: string; at: string }
  | {
      kind: 'message';
      key: string;
      message: MessengerMessage;
      mine: boolean;
      /** The author's name goes above this bubble (a group, a new run). */
      showAuthor: boolean;
    }
  | { kind: 'outbox'; key: string; line: OutboxLine };

function isMine(m: MessengerMessage, myLoginId: string | null): boolean {
  return m.authorKind === 'login' && !!myLoginId && m.authorId === myLoginId;
}

/**
 * The transcript as rows to draw: a stamp before the first message and
 * wherever the gap to the previous one is longer than GROUP_GAP_MS (or the
 * day changes), the author's name above the first bubble of a run in a
 * group, then my unanswered sends at the end.
 */
export function transcriptItems(
  t: Transcript,
  myLoginId: string | null,
  group: boolean,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let prev: MessengerMessage | null = null;
  for (const m of t.messages) {
    const at = new Date(m.createdAt).getTime();
    const prevAt = prev ? new Date(prev.createdAt).getTime() : null;
    const newDay =
      prev !== null &&
      new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
    const stamp = prevAt === null || at - prevAt > GROUP_GAP_MS || newDay;
    if (stamp) items.push({ kind: 'stamp', key: `stamp-${m.seq}`, at: m.createdAt });
    const mine = isMine(m, myLoginId);
    const sameRun =
      !stamp && prev !== null && prev.authorKind === m.authorKind && prev.authorId === m.authorId;
    items.push({
      kind: 'message',
      key: `m-${m.seq}`,
      message: m,
      mine,
      showAuthor: group && !mine && m.authorKind !== 'system' && !sameRun,
    });
    prev = m;
  }
  for (const line of t.outbox) {
    items.push({ kind: 'outbox', key: `o-${line.clientMsgId}`, line });
  }
  return items;
}

/**
 * The read cursor to send, or null: the newest seq on screen when it is past
 * my cursor and not my own (a send moves my cursor on the brain already).
 */
export function readCursorToSend(
  newestOnScreen: number | null,
  myLastReadSeq: number,
  newestIsMine = false,
): number | null {
  if (newestOnScreen === null || newestIsMine || newestOnScreen <= myLastReadSeq) return null;
  return newestOnScreen;
}

/** Whether the reader is looking at the newest message now: the first page
 *  landed without an error, the tab is visible and the transcript is at its
 *  bottom. Only then does the read cursor move. */
export function readerSeesNewest(s: {
  loaded: boolean;
  error: string | null;
  visible: boolean;
  atBottom: boolean;
}): boolean {
  return s.loaded && !s.error && s.visible && s.atBottom;
}

/** A fresh clientMsgId for a send (idempotent retries). */
export function newClientMsgId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The body as sent: trimmed of trailing blank lines, refused when empty or
 *  past the brain's 8000 characters. */
export const BODY_MAX = 8000;
export function sendableBody(raw: string): string | null {
  const body = raw.replace(/\s+$/, '');
  if (!body.trim() || body.length > BODY_MAX) return null;
  return body;
}

/**
 * What the transcript itself proves about other people's read cursors: a
 * send moves its author's cursor to its seq (brain sendMessengerMessage), so
 * each login has read at least up to its own newest message. Seeds the
 * receipts on open, before any read event is heard.
 */
export function authorReadSeqs(messages: readonly MessengerMessage[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of messages) {
    if (m.authorKind !== 'login' || !m.authorId) continue;
    if ((out.get(m.authorId) ?? 0) < m.seq) out.set(m.authorId, m.seq);
  }
  return out;
}
