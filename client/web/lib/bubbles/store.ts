/**
 * The tab's bubble cards and this browser's popped and pinned sets. The cards
 * live in memory only and the browser keeps card keys only, never message
 * text. The key of the store names the login, so a second login on one browser
 * starts clean. A pop or a pin in another tab arrives by the `storage` event.
 */
import type { MessengerListRow } from '@/lib/messenger/dto';
import {
  addPopped,
  liveCards,
  parsePopped,
  readAfterPop,
  setChatCards,
  togglePinned,
  type BubbleCard,
} from './cards';

const POPPED_PREFIX = 'mantle_bubbles_popped_v1:';
const PINNED_PREFIX = 'mantle_bubbles_pinned_v1:';
const NO_CARDS: readonly BubbleCard[] = [];

let login: string | null = null;
let popped: string[] = [];
let pinned: string[] = [];
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

function pinnedKey(id: string): string {
  return `${PINNED_PREFIX}${id}`;
}

function readKeys(storeKey: string): string[] {
  try {
    return parsePopped(window.localStorage.getItem(storeKey));
  } catch {
    return [];
  }
}

function writeKeys(storeKey: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(storeKey, JSON.stringify(keys));
  } catch {
    /* private mode: it lasts for the visit */
  }
}

/** The one rule again, after a pop, a pin or a new list. */
function applyRule(): void {
  if (!rows) return;
  const next = liveCards(cards, rows, popped, pinned);
  if (next.length !== cards.length) changed(next);
}

/** Who is looking. A new login starts with its own popped set and no cards. */
export function setBubbleLogin(id: string): void {
  if (id === login) return;
  login = id;
  popped = readKeys(poppedKey(id));
  pinned = readKeys(pinnedKey(id));
  changed(NO_CARDS);
}

/** A chat's cards are what its last read returned. */
export function setBubbleChat(chat: string, fresh: readonly BubbleCard[]): void {
  const next = setChatCards(cards, chat, fresh, popped, pinned);
  changed(rows ? liveCards(next, rows, popped, pinned) : next);
}

/** The one rule, over a fresh list. */
export function reconcileBubbles(fresh: readonly MessengerListRow[]): void {
  rows = fresh;
  applyRule();
}

export function clearBubbles(): void {
  changed(NO_CARDS);
}

/** Pop a card. Answers where the chat's read cursor moves now, or null while
 *  the chat has another card. A pinned card's close moves no cursor: it may be
 *  a line read long ago, and the lines around it were not on screen. */
export function popBubble(card: BubbleCard): number | null {
  popped = addPopped(popped, card.key);
  if (login) writeKeys(poppedKey(login), popped);
  const wasPinned = pinned.includes(card.key);
  if (wasPinned) {
    pinned = togglePinned(pinned, card.key);
    if (login) writeKeys(pinnedKey(login), pinned);
  }
  const remaining = cards.filter((c) => c.key !== card.key);
  changed(remaining);
  return wasPinned ? null : readAfterPop(card.chat, remaining, popped, pinned);
}

export function isBubblePinned(key: string): boolean {
  return pinned.includes(key);
}

/** The pinned keys: the sync brings them back after a reload. */
export function getPinnedKeys(): readonly string[] {
  return pinned;
}

/** Pin a card, or unpin it. An unpinned card of a chat already read goes. */
export function togglePinBubble(key: string): void {
  pinned = togglePinned(pinned, key);
  if (login) writeKeys(pinnedKey(login), pinned);
  changed([...cards]);
  applyRule();
}

/** A pinned card, read again (a reload, an edit). */
export function putPinnedBubble(card: BubbleCard): void {
  if (!pinned.includes(card.key)) return;
  changed(setChatCards([...cards.filter((c) => c.key !== card.key), card], '', [], popped, pinned));
}

/** A pinned line is gone (deleted, the chat left): its pin and its card go. */
export function forgetPin(key: string): void {
  if (!pinned.includes(key)) return;
  pinned = pinned.filter((k) => k !== key);
  if (login) writeKeys(pinnedKey(login), pinned);
  changed(cards.filter((c) => c.key !== key));
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
    if (!login) return;
    if (e.key === pinnedKey(login)) {
      pinned = parsePopped(e.newValue);
      changed([...cards]);
      applyRule();
      return;
    }
    if (e.key !== poppedKey(login)) return;
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
