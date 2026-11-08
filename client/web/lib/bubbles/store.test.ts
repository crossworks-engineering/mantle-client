import { beforeEach, describe, expect, it } from 'vitest';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { cardKey, type BubbleCard } from './cards';
import {
  clearBubbles,
  forgetPin,
  getBubbleCards,
  getPinnedKeys,
  isBubblePinned,
  popBubble,
  putPinnedBubble,
  reconcileBubbles,
  setBubbleChat,
  setBubbleLogin,
  togglePinBubble,
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

  it('a pinned card stays when the chat is read, and goes when unpinned', () => {
    setBubbleChat('a', [card('a', 1)]);
    togglePinBubble('a:1');
    expect(isBubblePinned('a:1')).toBe(true);
    reconcileBubbles([row('a', 0)]);
    expect(keys()).toEqual(['a:1']);
    togglePinBubble('a:1');
    expect(keys()).toEqual([]);
  });

  it('a pinned card of a chat no longer listed goes', () => {
    setBubbleChat('a', [card('a', 1)]);
    togglePinBubble('a:1');
    reconcileBubbles([]);
    expect(keys()).toEqual([]);
  });

  it('a close takes the pin with it', () => {
    setBubbleChat('a', [card('a', 1)]);
    togglePinBubble('a:1');
    // It moves no cursor: the line may be one read long ago.
    expect(popBubble(card('a', 1))).toBeNull();
    expect(isBubblePinned('a:1')).toBe(false);
    expect(keys()).toEqual([]);
  });

  it('a pinned card does not hold back the read of the other cards of its chat', () => {
    setBubbleChat('a', [card('a', 1), card('a', 2)]);
    togglePinBubble('a:1');
    expect(popBubble(card('a', 2))).toBe(2);
    expect(keys()).toEqual(['a:1']);
  });

  it('a pinned card can be put back after a reload, and only a pinned one', () => {
    togglePinBubble('a:1');
    reconcileBubbles([row('a', 0)]);
    putPinnedBubble(card('a', 1));
    putPinnedBubble(card('a', 2));
    expect(keys()).toEqual(['a:1']);
    expect(getPinnedKeys()).toEqual(['a:1']);
  });

  it('forgetting a pin drops the card of a chat already read', () => {
    togglePinBubble('a:1');
    reconcileBubbles([row('a', 0)]);
    putPinnedBubble(card('a', 1));
    forgetPin('a:1');
    expect(keys()).toEqual([]);
  });

  it('forgetting a pin drops the card of a chat still unread too: its line is gone', () => {
    togglePinBubble('a:1');
    reconcileBubbles([row('a', 1)]);
    putPinnedBubble(card('a', 1));
    forgetPin('a:1');
    expect(keys()).toEqual([]);
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
