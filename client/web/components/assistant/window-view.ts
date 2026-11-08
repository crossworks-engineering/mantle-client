/**
 * What the Chats window shows (Bubble Chat phase 5): the list, the dock's
 * agent thread, New chat, or one person or group chat. Kept in the browser
 * per login, as a key or an id only, never text. A reload brings the window
 * back on its last view, and open again if it was open (Jason, 2026-11-08).
 */

/** `new` is the New chat form; it is not brought back by a reload. */
import type { MessengerListRow } from '@/lib/messenger/dto';

export type WindowView =
  { kind: 'list' } | { kind: 'agent' } | { kind: 'new' } | { kind: 'chat'; id: string };

export const LIST_VIEW: WindowView = { kind: 'list' };

const VIEW_KEY = 'mantle_window_view';
const OPEN_KEY = 'mantle_window_open';
/** A messenger chat id is a uuid; anything longer is not one of ours. */
const ID_MAX = 64;

export function viewToString(v: WindowView): string {
  return v.kind === 'chat' ? `chat:${v.id}` : v.kind;
}

/** A saved value back to a view. Anything unknown is the list. */
export function parseView(raw: string | null | undefined): WindowView {
  if (raw === 'agent') return { kind: 'agent' };
  if (raw?.startsWith('chat:')) {
    const id = raw.slice('chat:'.length);
    if (id && id.length <= ID_MAX) return { kind: 'chat', id };
  }
  return LIST_VIEW;
}

export function readView(login: string): WindowView {
  try {
    return parseView(window.localStorage.getItem(`${VIEW_KEY}:${login}`));
  } catch {
    return LIST_VIEW;
  }
}

export function writeView(login: string, v: WindowView): void {
  try {
    window.localStorage.setItem(`${VIEW_KEY}:${login}`, viewToString(v));
  } catch {
    /* no storage: this tab only */
  }
}

/** Open or not lives in this tab's session storage: a reload brings the
 *  window back, a new tab or a link opened in one starts with it closed. */
export function readWindowOpen(login: string): boolean {
  try {
    return window.sessionStorage.getItem(`${OPEN_KEY}:${login}`) === '1';
  } catch {
    return false;
  }
}

export function writeWindowOpen(login: string, open: boolean): void {
  try {
    window.sessionStorage.setItem(`${OPEN_KEY}:${login}`, open ? '1' : '0');
  } catch {
    /* no storage: this tab only */
  }
}

/**
 * Whether a route change steps the open window aside: only the full shape,
 * which covers the screen. The column and the movable window stay open
 * while the person moves between screens. Below lg every shape is drawn
 * full, so a narrow viewport steps aside too.
 */
export function stepsAsideOnRoute(display: 'full' | 'docked' | 'popout', wide: boolean): boolean {
  return display === 'full' || !wide;
}

/** The viewport the column and the movable window need (Tailwind's lg). */
export function isWide(): boolean {
  return window.matchMedia('(min-width: 64rem)').matches;
}

/** The unread lines of every chat but the one on screen, muted ones left out. */
export function othersUnread(
  rows: readonly MessengerListRow[],
  current: (r: MessengerListRow) => boolean,
): number {
  let n = 0;
  for (const r of rows) if (!r.muted && !current(r)) n += r.unread;
  return n;
}
