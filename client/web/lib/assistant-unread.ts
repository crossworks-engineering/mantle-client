/**
 * The unread badge of a login's own chats (workspaces W7c), the pure half.
 * Pinned by assistant-unread.test.ts.
 *
 * Before W7c a member's badge read GET /api/member/chat/unread, which now
 * answers 410. Every login's unread count now comes from its own threads:
 * GET /api/assistant/conversations lists one row per assistant the login may
 * chat with, each with the unread count of ITS OWN thread (replies newer than
 * its read cursor), and POST /api/assistant/read `{ agentSlug }` moves the
 * cursor. GET /api/assistant/stream pings `{ agentSlug, direction }` on each
 * message of the login's own threads, so the badge refreshes on a reply.
 */

export const CONVERSATIONS_PATH = '/api/assistant/conversations';
export const READ_PATH = '/api/assistant/read';
export const THREAD_STREAM_PATH = '/api/assistant/stream';

/** One row of GET /api/assistant/conversations. */
export type AssistantConversation = {
  agentId: string;
  slug: string;
  name: string;
  unreadCount: number;
  lastMessage: { text: string; direction: 'inbound' | 'outbound'; createdAt: string } | null;
};

/** A count the brain sent, as a whole number of at least 0. */
function countOf(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The unread replies over all of the login's own threads. */
export function unreadTotal(
  conversations: readonly Pick<AssistantConversation, 'unreadCount'>[] | null | undefined,
): number {
  return (conversations ?? []).reduce((sum, c) => sum + countOf(c.unreadCount), 0);
}

/** Whether the thread with `agentSlug` has unread replies, so that showing
 *  it should mark it read. False with no slug or no row. */
export function hasUnread(
  conversations: readonly Pick<AssistantConversation, 'slug' | 'unreadCount'>[] | null | undefined,
  agentSlug: string | null | undefined,
): boolean {
  if (!agentSlug) return false;
  const row = (conversations ?? []).find((c) => c.slug === agentSlug);
  return countOf(row?.unreadCount) > 0;
}

/** Does a ping of the thread stream change the badge: a reply (outbound),
 *  never the login's own message echoed back. A ping that cannot be read
 *  counts, so the badge refreshes rather than stays stale. */
export function pingChangesUnread(data: string): boolean {
  try {
    const ev = JSON.parse(data) as { direction?: unknown };
    return ev?.direction !== 'inbound';
  } catch {
    return true;
  }
}

/** The body of POST /api/assistant/read for one thread: read up to now, or up
 *  to `at`. */
export function readBody(agentSlug: string, at?: string): { agentSlug: string; at?: string } {
  return at ? { agentSlug, at } : { agentSlug };
}
