/**
 * The words and times the chat screen shows (Messenger V1 Phase 2), the pure
 * half. Pinned by format.test.ts.
 */
import type { MessengerListRow, MessengerParticipant } from './dto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `then` to `now` (0: the same day). */
function daysBetween(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
}

function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The time at the right of a list row: "Just now", "10 minutes", "3 hours"
 * the same day, "Yesterday", "13 days", then the date.
 */
export function listTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const ms = Math.max(0, now.getTime() - then.getTime());
  const days = daysBetween(then, now);
  if (days <= 0) {
    if (ms < MINUTE) return 'Just now';
    if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute');
    return plural(Math.floor(ms / HOUR), 'hour');
  }
  if (days === 1) return 'Yesterday';
  if (days < 31) return plural(days, 'day');
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The stamp between message groups: "Today 10:05", "Yesterday 10:05",
 *  "Mon 12 Oct, 10:05". */
export function stampLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = daysBetween(then, now);
  if (days === 0) return `Today ${clock(then)}`;
  if (days === 1) return `Yesterday ${clock(then)}`;
  const date = then.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${date}, ${clock(then)}`;
}

/** The time under a bubble. */
export function bubbleTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clock(d);
}

/** Up to two initials for an avatar without a photo. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!;
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${words[words.length - 1]![0]}`.toUpperCase();
}

/** The other people of a chat as I see them: everyone but me, still in it. */
export function otherPeople(
  participants: readonly MessengerParticipant[],
  myLoginId: string | null,
): MessengerParticipant[] {
  return participants.filter((p) => p.id !== myLoginId && p.leftAt === null);
}

/** The direct chat's other login, or null for a group (or a chat with
 *  myself). */
export function directPeer(
  row: Pick<MessengerListRow, 'kind' | 'participants'>,
  myLoginId: string | null,
): MessengerParticipant | null {
  if (row.kind !== 'direct') return null;
  return row.participants.find((p) => p.id !== myLoginId && p.kind === 'login') ?? null;
}

/** My own name in a chat (to tell my own last line). */
function myName(
  participants: readonly MessengerParticipant[],
  myLoginId: string | null,
): string | null {
  return participants.find((p) => p.id === myLoginId)?.name ?? null;
}

export type PreviewLine = {
  /** The last line is mine: it carries a tick, and "You:" in a group. */
  mine: boolean;
  text: string;
};

/**
 * The one line under a row's name. The preview carries the author's name,
 * not an id, so "mine" is the name of my own participant row (a login with
 * a namesake in the same chat would read as mine; acceptable in V1).
 */
export function previewLine(
  row: Pick<MessengerListRow, 'kind' | 'participants' | 'preview'>,
  myLoginId: string | null,
): PreviewLine | null {
  const p = row.preview;
  if (!p) return null;
  const me = myName(row.participants, myLoginId);
  const mine = p.authorKind === 'login' && !!me && p.authorName === me;
  const text = p.text === '' ? 'This message was deleted' : p.text.replace(/\s+/g, ' ').trim();
  if (row.kind === 'group') {
    if (mine) return { mine, text: `You: ${text}` };
    if (p.authorName && p.authorKind !== 'system') {
      return { mine, text: `${firstName(p.authorName)}: ${text}` };
    }
  }
  return { mine, text };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The count in the green badge: "99+" past 99. */
export function badgeCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** A row's unread pill: its text, what a screen reader says, grey or not,
 *  and the mention mark beside it. */
export type RowBadge = { text: string; label: string; muted: boolean; mention: boolean };

/** The pill for people, groups and assistant threads alike: none at 0 (or
 *  a count that is not a finite number), the count (99+ at most), grey when
 *  the chat is muted, and the mention mark while a mention of me is unread. */
export function rowBadge(
  row: Pick<MessengerListRow, 'unread' | 'muted' | 'mention'>,
): RowBadge | null {
  const n = Number.isFinite(row.unread) ? Math.max(0, Math.floor(row.unread)) : 0;
  if (n === 0) return null;
  return { text: badgeCount(n), label: `${n} unread`, muted: row.muted, mention: row.mention };
}

/** The list search: the title, a participant's name or the last line. */
export function rowMatches(
  row: Pick<MessengerListRow, 'title' | 'participants' | 'preview'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.title.toLowerCase().includes(q)) return true;
  if (row.participants.some((p) => p.name.toLowerCase().includes(q))) return true;
  return !!row.preview?.text.toLowerCase().includes(q);
}

/** Under a chat's name in its header: "Online", "Offline", or a group's
 *  head count. */
export function presenceLine(
  row: Pick<MessengerListRow, 'kind' | 'participants'>,
  myLoginId: string | null,
  online: ReadonlySet<string>,
): string {
  if (row.kind === 'group') {
    const n = row.participants.filter((p) => p.leftAt === null && p.kind === 'login').length;
    const here = otherPeople(row.participants, myLoginId).filter((p) => online.has(p.id)).length;
    return `${plural(n, 'member')}${here ? `, ${here} online` : ''}`;
  }
  const peer = directPeer(row, myLoginId);
  if (!peer) return '';
  return online.has(peer.id) ? 'Online' : 'Offline';
}

/** The address of a list row under /chats: a conversation's id, or
 *  `agent:<agent id>` for an assistant thread (the two id spaces apart). */
export function rowAddress(row: Pick<MessengerListRow, 'kind' | 'id'>): string {
  return row.kind === 'agent' ? `agent:${row.id}` : row.id;
}

/** The agent id in an address made by `rowAddress`, or null. */
export function agentIdOf(address: string | null | undefined): string | null {
  return address?.startsWith('agent:') ? address.slice('agent:'.length) || null : null;
}
