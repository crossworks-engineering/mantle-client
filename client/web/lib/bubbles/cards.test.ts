import { describe, expect, it } from 'vitest';
import type { MessengerListRow, MessengerMessage } from '@/lib/messenger/dto';
import {
  CARDS_MAX,
  CHATS_PER_SYNC,
  PINNED_MAX,
  POPPED_MAX,
  addPopped,
  cardFromMessage,
  cardFromReply,
  cardKey,
  chatWindowOpen,
  chatsToSync,
  cursorMayMove,
  linesWanted,
  liveCards,
  newestReplies,
  parsePopped,
  readAfterPop,
  rowSignature,
  setChatCards,
  toastWanted,
  togglePinned,
  type BubbleCard,
} from './cards';

const row = (over: Partial<MessengerListRow> = {}): MessengerListRow => ({
  kind: 'direct',
  id: 'c1',
  title: 'Ann',
  lastSeq: 3,
  lastMessageAt: '2026-11-07T10:00:00.000Z',
  preview: null,
  unread: 1,
  mention: false,
  muted: false,
  favourite: false,
  participants: [],
  ...over,
});

const message = (over: Partial<MessengerMessage> = {}): MessengerMessage =>
  ({
    id: 'm',
    conversationId: 'c1',
    seq: 3,
    authorKind: 'login',
    authorId: 'ann',
    authorName: 'Ann',
    via: null,
    body: 'Hello',
    attachments: [],
    mentions: [],
    replyToSeq: null,
    clientMsgId: null,
    status: 'complete',
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    reactions: [],
    ...over,
  }) as MessengerMessage;

const card = (chat: string, order: number, at = order): BubbleCard => ({
  key: cardKey(chat, order),
  chat,
  kind: 'direct',
  order,
  at,
  title: chat,
  text: 'x',
  cut: false,
  note: null,
  agentSlug: null,
  author: { kind: 'login', id: 'a', name: 'A', avatar: null, photoVersion: null },
});

describe('cardFromMessage', () => {
  it('makes a card of a person line, in a group with the group named', () => {
    const c = cardFromMessage(message(), row({ kind: 'group', title: 'Crew' }), 'me');
    expect(c?.key).toBe('c1:3');
    expect(c?.title).toBe('Ann in Crew');
    expect(c?.text).toBe('Hello');
    expect(c?.at).toBe(Date.parse('2026-11-07T10:00:00.000Z'));
  });

  it('takes the face from the row participant', () => {
    const avatar = { style: 'lorelei', seed: 's' };
    const participants = [{ id: 'ann', avatar, photoVersion: 'v1' }];
    const c = cardFromMessage(
      message(),
      row({ participants } as unknown as Partial<MessengerListRow>),
      'me',
    );
    expect(c?.author.avatar).toEqual(avatar);
    expect(c?.author.photoVersion).toBe('v1');
  });

  it('makes no card of my own line, a system line or a deleted line', () => {
    expect(cardFromMessage(message({ authorId: 'me' }), row(), 'me')).toBeNull();
    expect(cardFromMessage(message({ authorKind: 'system' }), row(), 'me')).toBeNull();
    expect(cardFromMessage(message({ deletedAt: 'then' }), row(), 'me')).toBeNull();
  });

  it('makes no card in a muted chat', () => {
    expect(cardFromMessage(message(), row({ muted: true }), 'me')).toBeNull();
  });

  it('marks a long message with its size', () => {
    const c = cardFromMessage(message({ body: 'a\nb\nc\nd\ne\nf\ng' }), row(), 'me');
    expect(c?.cut).toBe(true);
    expect(c?.note).toBe('sent a long message, 7 lines');
  });
});

describe('newestReplies', () => {
  const r = (over: object) => ({
    direction: 'outbound' as const,
    status: 'complete' as const,
    text: 'ok',
    createdAt: '2026-11-07T10:00:00.000Z',
    ...over,
  });

  it('never reaches past the cursor to a reply already read', () => {
    const rows = [
      r({ text: 'read long ago', createdAt: '2026-11-07T09:00:00.000Z' }),
      r({ status: 'pending', text: '', createdAt: '2026-11-07T10:00:00.000Z' }),
    ];
    // The brain counts the pending row: unread 1.
    expect(newestReplies(rows, 1)).toEqual([]);
    const failed = [rows[0]!, r({ status: 'failed', createdAt: '2026-11-07T10:00:00.000Z' })];
    expect(newestReplies(failed, 1)).toEqual([]);
    const replaced = [rows[0]!, r({ superseded: true, createdAt: '2026-11-07T10:00:00.000Z' })];
    expect(newestReplies(replaced, 1)).toEqual([]);
  });

  it('skips a person line between replies when it counts', () => {
    const rows = [
      r({ text: 'old', createdAt: '2026-11-07T09:00:00.000Z' }),
      r({ direction: 'inbound', createdAt: '2026-11-07T09:30:00.000Z' }),
      r({ text: 'new', createdAt: '2026-11-07T10:00:00.000Z' }),
    ];
    expect(newestReplies(rows, 1).map((x) => x.text)).toEqual(['new']);
  });

  it('never takes a pending reply, a failed one or the person own line', () => {
    expect(
      newestReplies(
        [
          r({ status: 'pending', text: '' }),
          r({ status: 'failed' }),
          r({ direction: 'inbound' }),
          r({ superseded: true }),
        ],
        5,
      ),
    ).toEqual([]);
  });

  it('takes the newest ones, at most the count', () => {
    const out = newestReplies(
      [
        r({ text: 'a', createdAt: '2026-11-07T10:00:01.000Z' }),
        r({ text: 'c', createdAt: '2026-11-07T10:00:03.000Z' }),
        r({ text: 'b', createdAt: '2026-11-07T10:00:02.000Z' }),
      ],
      2,
    );
    expect(out.map((x) => x.text)).toEqual(['c', 'b']);
  });
});

describe('cardFromReply', () => {
  it('names the assistant and orders by time', () => {
    const c = cardFromReply(
      { createdAt: '2026-11-07T10:00:00.000Z' },
      row({ kind: 'agent', id: 'ag', title: 'Rea', lastSeq: null, agentSlug: 'rea' }),
      { text: 'Done.', cut: false, note: null },
    );
    const at = Date.parse('2026-11-07T10:00:00.000Z');
    expect(c).toMatchObject({ key: `ag:${at}`, order: at, title: 'Rea', agentSlug: 'rea' });
    expect(c.author.kind).toBe('agent');
  });
});

describe('setChatCards', () => {
  it('replaces one chat and sorts the stack newest first', () => {
    const out = setChatCards([card('a', 1), card('b', 2)], 'a', [card('a', 3)], []);
    expect(out.map((c) => c.key)).toEqual(['a:3', 'b:2']);
  });

  it('forgets lines read elsewhere: a chat is what its last read returned', () => {
    const held = [card('a', 7), card('a', 6), card('a', 5)];
    expect(setChatCards(held, 'a', [card('a', 8)], []).map((c) => c.key)).toEqual(['a:8']);
  });

  it('an empty read empties the chat', () => {
    expect(setChatCards([card('a', 1), card('b', 2)], 'a', [], []).map((c) => c.chat)).toEqual([
      'b',
    ]);
  });

  it('leaves out what was popped', () => {
    expect(setChatCards([], 'a', [card('a', 1)], ['a:1'])).toEqual([]);
  });

  it('keeps a pinned card of the chat through a new read', () => {
    const out = setChatCards([card('a', 1)], 'a', [card('a', 3)], [], ['a:1']);
    expect(out.map((c) => c.key)).toEqual(['a:3', 'a:1']);
  });

  it('holds at most the limit, dropping the oldest', () => {
    const many = Array.from({ length: CARDS_MAX + 5 }, (_, i) => card('a', i));
    const out = setChatCards([], 'a', many, []);
    expect(out).toHaveLength(CARDS_MAX);
    expect(out.at(-1)?.order).toBe(5);
  });

  it('keeps a pinned card past the limit', () => {
    const many = Array.from({ length: CARDS_MAX + 5 }, (_, i) => card('a', i));
    const out = setChatCards([], 'a', many, [], ['a:0']);
    expect(out).toHaveLength(CARDS_MAX + 1);
    expect(out.at(-1)?.key).toBe('a:0');
  });
});

describe('cursorMayMove', () => {
  it('moves when what is unread was all shown', () => {
    expect(cursorMayMove({ unread: 1 })).toBe(true);
    expect(cursorMayMove({ unread: 5 })).toBe(true);
  });

  it('stays when the chat was read in another place, or is gone', () => {
    expect(cursorMayMove({ unread: 0 })).toBe(false);
    expect(cursorMayMove(undefined)).toBe(false);
  });

  it('stays when more is unread than a chat shows', () => {
    expect(cursorMayMove({ unread: 6 })).toBe(false);
  });
});

describe('liveCards, the one rule', () => {
  const cards = [card('a', 2), card('a', 1), card('b', 1)];

  it('keeps a card while its chat is unread', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(liveCards(cards, rows, [])).toHaveLength(3);
  });

  it('drops the cards of a chat read anywhere', () => {
    const rows = [row({ id: 'a', unread: 0 }), row({ id: 'b' })];
    expect(liveCards(cards, rows, []).map((c) => c.chat)).toEqual(['b']);
  });

  it('drops the cards of a chat muted anywhere', () => {
    const rows = [row({ id: 'a', muted: true }), row({ id: 'b' })];
    expect(liveCards(cards, rows, []).map((c) => c.chat)).toEqual(['b']);
  });

  it('drops the cards of a chat no longer listed (left, removed)', () => {
    expect(liveCards(cards, [row({ id: 'a' })], []).map((c) => c.chat)).toEqual(['a', 'a']);
  });

  it('drops a popped card', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(liveCards(cards, rows, ['a:2']).map((c) => c.key)).toEqual(['a:1', 'b:1']);
  });

  it('keeps a pinned card through a read and a mute, but not a chat left', () => {
    const rows = [row({ id: 'a', unread: 0, muted: true })];
    expect(liveCards(cards, rows, [], ['a:2', 'b:1']).map((c) => c.key)).toEqual(['a:2']);
  });
});

describe('chatsToSync', () => {
  it('reads only rows with something unread, not muted, and not seen', () => {
    const fresh = row({ id: 'a' });
    const seen = row({ id: 'b' });
    const rows = [fresh, seen, row({ id: 'c', unread: 0 }), row({ id: 'd', muted: true })];
    const out = chatsToSync(rows, new Map([['b', rowSignature(seen)]]));
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('reads a row again when a pending reply got its text', () => {
    const pending = row({ id: 'a', lastSeq: null, preview: null });
    const done = { ...pending, preview: { authorName: 'Rea', text: 'Done' } } as MessengerListRow;
    expect(chatsToSync([done], new Map([['a', rowSignature(pending)]]))).toHaveLength(1);
  });

  it('takes the newest first, at most the limit', () => {
    const rows = Array.from({ length: CHATS_PER_SYNC + 3 }, (_, i) =>
      row({ id: `c${i}`, lastMessageAt: `2026-11-07T10:00:${String(i).padStart(2, '0')}.000Z` }),
    );
    const out = chatsToSync(rows, new Map());
    expect(out).toHaveLength(CHATS_PER_SYNC);
    expect(out[0]?.id).toBe(`c${CHATS_PER_SYNC + 2}`);
  });
});

describe('linesWanted', () => {
  it('reads what is unread, up to the limit', () => {
    expect(linesWanted(0)).toBe(0);
    expect(linesWanted(2)).toBe(2);
    expect(linesWanted(99)).toBe(5);
  });
});

describe('readAfterPop', () => {
  it('waits while the chat has another card', () => {
    expect(readAfterPop('a', [card('a', 1)], ['a:2'])).toBeNull();
  });

  it('moves to the highest line popped, when the last card goes', () => {
    expect(readAfterPop('a', [card('b', 9)], ['a:2', 'a:1', 'b:7'])).toBe(2);
  });

  it('reads a time order the same way', () => {
    const at = Date.parse('2026-11-07T10:00:00.000Z');
    expect(readAfterPop('ag', [], [`ag:${at}`])).toBe(at);
  });

  it('answers null when nothing of the chat was popped', () => {
    expect(readAfterPop('a', [], ['b:1', 'junk'])).toBeNull();
  });

  it('does not wait for a pinned card, which stays through a read', () => {
    expect(readAfterPop('a', [card('a', 1)], ['a:2'], ['a:1'])).toBe(2);
  });
});

describe('the popped set', () => {
  it('adds once and drops the oldest past the limit', () => {
    expect(addPopped(['a:1'], 'a:1')).toEqual(['a:1']);
    const full = Array.from({ length: POPPED_MAX }, (_, i) => `a:${i}`);
    const out = addPopped(full, 'b:1');
    expect(out).toHaveLength(POPPED_MAX);
    expect(out[0]).toBe('a:1');
    expect(out.at(-1)).toBe('b:1');
  });

  it('reads anything unreadable as empty', () => {
    expect(parsePopped(null)).toEqual([]);
    expect(parsePopped('{')).toEqual([]);
    expect(parsePopped('{"a":1}')).toEqual([]);
    expect(parsePopped('["a:1",2]')).toEqual(['a:1']);
  });
});

describe('togglePinned', () => {
  it('adds and takes out', () => {
    expect(togglePinned([], 'a:1')).toEqual(['a:1']);
    expect(togglePinned(['a:1', 'b:2'], 'a:1')).toEqual(['b:2']);
  });

  it('drops the oldest past the limit', () => {
    const full = Array.from({ length: PINNED_MAX }, (_, i) => `a:${i}`);
    const out = togglePinned(full, 'b:1');
    expect(out).toHaveLength(PINNED_MAX);
    expect(out[0]).toBe('a:1');
  });
});

describe('chatWindowOpen', () => {
  it('is open on the chat and assistant screens', () => {
    for (const pathname of ['/chats', '/chats/abc', '/assistant', '/assistant/x']) {
      expect(chatWindowOpen({ panel: 'closed', pathname })).toBe(true);
    }
  });

  it('is open with the side window open, on any screen', () => {
    expect(chatWindowOpen({ panel: 'open', pathname: '/tables' })).toBe(true);
  });

  it('is closed with the window minimised or closed, on any other screen', () => {
    expect(chatWindowOpen({ panel: 'min', pathname: '/tables' })).toBe(false);
    expect(chatWindowOpen({ panel: 'closed', pathname: '/chats-archive' })).toBe(false);
    expect(chatWindowOpen({ panel: 'closed', pathname: null })).toBe(false);
  });
});

describe('toastWanted', () => {
  it('always pops with bubbles off', () => {
    expect(toastWanted({ bubbles: false, panel: 'closed', pathname: '/chats' })).toBe(true);
    expect(toastWanted({ bubbles: false, panel: 'closed', pathname: '/tables' })).toBe(true);
  });

  it('gives way to the card or the highlight with bubbles on', () => {
    expect(toastWanted({ bubbles: true, panel: 'closed', pathname: '/tables' })).toBe(false);
    expect(toastWanted({ bubbles: true, panel: 'min', pathname: '/tables' })).toBe(false);
    expect(toastWanted({ bubbles: true, panel: 'closed', pathname: '/chats' })).toBe(false);
  });

  it('stays while only the side window is open, which has no list yet', () => {
    expect(toastWanted({ bubbles: true, panel: 'open', pathname: '/tables' })).toBe(true);
    expect(toastWanted({ bubbles: true, panel: 'open', pathname: '/chats' })).toBe(false);
  });
});
