/**
 * The tab's bubble cards and this browser's popped set. The cards live in
 * memory only and the browser keeps card keys only, never message text. The
 * key of the store names the login, so a second login on one browser starts
 * clean. A pop in another tab arrives by the `storage` event.
 */
import type { MessengerListRow } from '@/lib/messenger/dto';
import {
  addPopped,
  liveCards,
  parsePopped,
  readAfterPop,
  setChatCards,
  type BubbleCard,
} from './cards';

const POPPED_PREFIX = 'mantle_bubbles_popped_v1:';
const NO_CARDS: readonly BubbleCard[] = [];

let login: string | null = null;
let popped: string[] = [];
let cards: readonly BubbleCard[] = NO_CARDS;
/** The list as last read: a late read of a chat is judged by it too. */
let rows: readonly MessengerListRow[] | null = null;
const listeners = new Set<() => void>();

function changed(next: readonly BubbleCard[]): void {
  if (next.length === 0 && cards.length === 0) return;
  cards = next;
  for (const l of listeners) l();
}

function poppedKey(id: string): string {
  return `${POPPED_PREFIX}${id}`;
}

function readPopped(id: string): string[] {
  try {
    return parsePopped(window.localStorage.getItem(poppedKey(id)));
  } catch {
    return [];
  }
}

/** Who is looking. A new login starts with its own popped set and no cards. */
export function setBubbleLogin(id: string): void {
  if (id === login) return;
  login = id;
  popped = readPopped(id);
  changed(NO_CARDS);
}

/** A chat's cards are what its last read returned. */
export function setBubbleChat(chat: string, fresh: readonly BubbleCard[]): void {
  const next = setChatCards(cards, chat, fresh, popped);
  changed(rows ? liveCards(next, rows, popped) : next);
}

/** The one rule, over a fresh list. */
export function reconcileBubbles(fresh: readonly MessengerListRow[]): void {
  rows = fresh;
  const next = liveCards(cards, fresh, popped);
  if (next.length !== cards.length) changed(next);
}

export function clearBubbles(): void {
  changed(NO_CARDS);
}

/** Pop a card. Answers where the chat's read cursor moves now, or null while
 *  the chat has another card. */
export function popBubble(card: BubbleCard): number | null {
  popped = addPopped(popped, card.key);
  try {
    if (login) window.localStorage.setItem(poppedKey(login), JSON.stringify(popped));
  } catch {
    /* private mode: the pop lasts for the visit */
  }
  const remaining = cards.filter((c) => c.key !== card.key);
  changed(remaining);
  return readAfterPop(card.chat, remaining, popped);
}

export function getBubbleCards(): readonly BubbleCard[] {
  return cards;
}

export function serverBubbleCards(): readonly BubbleCard[] {
  return NO_CARDS;
}

export function subscribeBubbles(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (!login || e.key !== poppedKey(login)) return;
    popped = parsePopped(e.newValue);
    const next = cards.filter((c) => !popped.includes(c.key));
    if (next.length !== cards.length) changed(next);
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
