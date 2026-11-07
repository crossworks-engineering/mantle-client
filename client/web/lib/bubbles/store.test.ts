import { beforeEach, describe, expect, it } from 'vitest';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { cardKey, type BubbleCard } from './cards';
import {
  clearBubbles,
  getBubbleCards,
  popBubble,
  reconcileBubbles,
  setBubbleChat,
  setBubbleLogin,
} from './store';

const card = (chat: string, order: number): BubbleCard => ({
  key: cardKey(chat, order),
  chat,
  kind: 'direct',
  order,
  at: order,
  title: chat,
  text: 'x',
  cut: false,
  note: null,
  agentSlug: null,
  author: { kind: 'login', id: 'a', name: 'A', avatar: null, photoVersion: null },
});

const row = (id: string, unread: number) =>
  ({ id, unread, muted: false, participants: [] }) as unknown as MessengerListRow;

const keys = () => getBubbleCards().map((c) => c.key);

// The store runs here with no browser: the popped set lives for the visit, the
// way it does in a private window. Each test takes a login of its own.
let n = 0;
beforeEach(() => {
  n += 1;
  setBubbleLogin(`login-${n}`);
  clearBubbles();
  reconcileBubbles([row('a', 1), row('b', 1)]);
});

describe('the bubble store', () => {
  it('holds what a read returned, for each chat, newest first', () => {
    setBubbleChat('a', [card('a', 1)]);
    setBubbleChat('b', [card('b', 2)]);
    expect(keys()).toEqual(['b:2', 'a:1']);
  });

  it('a read of a chat the list says is read adds nothing (a late answer)', () => {
    reconcileBubbles([row('a', 0)]);
    setBubbleChat('a', [card('a', 1)]);
    expect(keys()).toEqual([]);
  });

  it('a popped card does not come back with the next read', () => {
    setBubbleChat('a', [card('a', 2), card('a', 1)]);
    popBubble(card('a', 2));
    setBubbleChat('a', [card('a', 2), card('a', 1)]);
    expect(keys()).toEqual(['a:1']);
  });

  it('a pop answers null until the last card of the chat goes, then the highest', () => {
    setBubbleChat('a', [card('a', 2), card('a', 1)]);
    expect(popBubble(card('a', 2))).toBeNull();
    expect(popBubble(card('a', 1))).toBe(2);
  });

  it('drops the cards of a chat the list says was read', () => {
    setBubbleChat('a', [card('a', 1)]);
    setBubbleChat('b', [card('b', 2)]);
    reconcileBubbles([row('a', 0), row('b', 1)]);
    expect(keys()).toEqual(['b:2']);
  });

  it('a new login starts with no cards and its own popped set', () => {
    setBubbleChat('a', [card('a', 1)]);
    popBubble(card('a', 1));
    setBubbleLogin('another');
    reconcileBubbles([row('a', 1)]);
    setBubbleChat('a', [card('a', 1)]);
    expect(keys()).toEqual(['a:1']);
  });
});
