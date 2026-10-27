/**
 * What the messenger says outside the Chats screen (Messenger V1 Phase 2,
 * M3): the rail's one count, whether the brain has a messenger at all, and
 * when a new message pops (a toast in the app, an OS notice from the desktop
 * shell while the window is hidden). The pure half; pinned by
 * notify.test.ts.
 */
import type { MessengerMessage, MessengerUnreadResponse } from './dto';

/**
 * Whether this brain has the messenger: GET /api/messenger/unread answers
 * 404 on a brain before it (the Chats entry hides), anything else that
 * fails says nothing yet (the entry stays as it was).
 */
export function messengerAvailability(q: {
  data?: unknown;
  error?: unknown;
}): 'yes' | 'no' | 'unknown' {
  if (q.data !== undefined) return 'yes';
  const status = (q.error as { status?: unknown } | null | undefined)?.status;
  return status === 404 ? 'no' : 'unknown';
}

/** The rail's one count: people chats, groups and the assistant replies (the
 *  brain sums them, `total`). */
export function railCount(u: MessengerUnreadResponse | null | undefined): number {
  const n = u?.total;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The chat open at a path (`/chats/<id>`), or null. */
export function openChatId(pathname: string | null | undefined): string | null {
  const m = /^\/chats\/([^/?#]+)/.exec(pathname ?? '');
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Whether a new message pops: never my own, never a muted chat's (it still
 * counts), never a deleted one, never the chat on screen while the reader is
 * looking at it.
 */
export function shouldPop(s: {
  message: Pick<MessengerMessage, 'authorKind' | 'authorId' | 'deletedAt'>;
  me: string | null;
  muted: boolean;
  onScreen: boolean;
}): boolean {
  if (s.muted || s.onScreen || s.message.deletedAt) return false;
  if (s.message.authorKind === 'login' && s.message.authorId === s.me) return false;
  return true;
}

/** The longest first line a notice carries. */
export const NOTICE_LINE_MAX = 120;

/** A notice's words: the author (and the group), then the first line. */
export function noticeText(
  message: Pick<MessengerMessage, 'authorName' | 'body'>,
  groupTitle: string | null,
): { title: string; body: string } {
  const author = message.authorName ?? 'Someone';
  const first = (message.body.split('\n').find((l) => l.trim()) ?? '').trim();
  const body = first.length > NOTICE_LINE_MAX ? `${first.slice(0, NOTICE_LINE_MAX - 1)}…` : first;
  return { title: groupTitle ? `${author} in ${groupTitle}` : author, body };
}

/** Where a notice goes: the OS (the desktop shell, window hidden), or an
 *  in-app toast. A hidden browser tab still gets the toast: it waits there. */
export function noticeRoute(s: { desktop: boolean; visible: boolean }): 'os' | 'toast' {
  return s.desktop && !s.visible ? 'os' : 'toast';
}
