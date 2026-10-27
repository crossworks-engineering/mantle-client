/**
 * The transcript window of one chat: seq orders and merges, pages land above
 * and below, my sends settle by clientMsgId, and the rows to draw.
 */
import { describe, expect, it } from 'vitest';
import type { MessengerMessage } from './dto';
import {
  EMPTY_TRANSCRIPT,
  authorReadSeqs,
  highestSeq,
  lowestSeq,
  mergeMessages,
  pageQuery,
  readCursorToSend,
  sendableBody,
  transcriptItems,
  withLatestPage,
  withNewer,
  withOlderPage,
  withOutbox,
  withoutOutbox,
} from './transcript';

const ME = 'login-me';
const ANN = 'login-ann';

function msg(seq: number, over: Partial<MessengerMessage> = {}): MessengerMessage {
  return {
    id: `id-${seq}`,
    conversationId: 'c1',
    seq,
    authorKind: 'login',
    authorId: ANN,
    authorName: 'Ann',
    via: null,
    body: `message ${seq}`,
    attachments: [],
    mentions: [],
    replyToSeq: null,
    clientMsgId: null,
    status: 'complete',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(2026, 9, 27, 10, 0, seq).toISOString(),
    reactions: [],
    ...over,
  };
}

describe('mergeMessages', () => {
  it('orders by seq and keeps one message per seq, the later copy winning', () => {
    const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3, { body: 'edited' })]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(merged[2]!.body).toBe('edited');
  });

  it('answers the same array when nothing comes in', () => {
    const a = [msg(1)];
    expect(mergeMessages(a, [])).toBe(a);
  });
});

describe('the window', () => {
  it('reads the highest and lowest seq held', () => {
    expect(highestSeq([])).toBe(0);
    expect(lowestSeq([])).toBeNull();
    const t = withLatestPage(EMPTY_TRANSCRIPT, {
      messages: [msg(21), msg(40)],
      lastSeq: 40,
      hasMore: true,
    });
    expect(highestSeq(t.messages)).toBe(40);
    expect(lowestSeq(t.messages)).toBe(21);
    expect(t.hasOlder).toBe(true);
  });

  it('puts an older page below and takes its hasMore', () => {
    let t = withLatestPage(EMPTY_TRANSCRIPT, {
      messages: [msg(21), msg(22)],
      lastSeq: 22,
      hasMore: true,
    });
    t = withOlderPage(t, { messages: [msg(19), msg(20)], lastSeq: 22, hasMore: false });
    expect(t.messages.map((m) => m.seq)).toEqual([19, 20, 21, 22]);
    expect(t.hasOlder).toBe(false);
  });

  it('settles my send once the stored message carries its clientMsgId', () => {
    let t = withOutbox(EMPTY_TRANSCRIPT, {
      clientMsgId: 'x1',
      body: 'hi',
      createdAt: new Date().toISOString(),
      state: 'sending',
    });
    expect(t.outbox).toHaveLength(1);
    t = withNewer(t, [msg(5, { authorId: ME, clientMsgId: 'x1', body: 'hi' })]);
    expect(t.outbox).toHaveLength(0);
    expect(t.messages.map((m) => m.seq)).toEqual([5]);
  });

  it('keeps a failed send until it is retried or discarded', () => {
    const line = { clientMsgId: 'x2', body: 'hi', createdAt: '', state: 'failed' as const };
    let t = withOutbox(EMPTY_TRANSCRIPT, line);
    t = withLatestPage(t, { messages: [msg(1)], lastSeq: 1, hasMore: false });
    expect(t.outbox).toHaveLength(1);
    t = withOutbox(t, { ...line, state: 'sending' });
    expect(t.outbox).toEqual([{ ...line, state: 'sending' }]);
    expect(withoutOutbox(t, 'x2').outbox).toHaveLength(0);
  });
});

describe('pageQuery', () => {
  it('builds the latest, older and newer queries', () => {
    expect(pageQuery()).toBe('');
    expect(pageQuery({ limit: 20 })).toBe('?limit=20');
    expect(pageQuery({ beforeSeq: 21, limit: 20 })).toBe('?before_seq=21&limit=20');
    expect(pageQuery({ afterSeq: 40, limit: 100 })).toBe('?after_seq=40&limit=100');
    expect(pageQuery({ afterSeq: 0 })).toBe('?after_seq=0');
  });
});

describe('transcriptItems', () => {
  it('stamps the first message and a long gap, and names a group run once', () => {
    const t = withLatestPage(EMPTY_TRANSCRIPT, {
      messages: [
        msg(1),
        msg(2),
        msg(3, { authorId: ME, authorName: 'Me' }),
        msg(4, { createdAt: new Date(2026, 9, 27, 11, 0, 0).toISOString() }),
      ],
      lastSeq: 4,
      hasMore: false,
    });
    const items = transcriptItems(t, ME, true);
    expect(items.map((i) => i.kind)).toEqual([
      'stamp',
      'message',
      'message',
      'message',
      'stamp',
      'message',
    ]);
    const msgs = items.filter((i) => i.kind === 'message');
    expect(msgs.map((m) => m.showAuthor)).toEqual([true, false, false, true]);
    expect(msgs.map((m) => m.mine)).toEqual([false, false, true, false]);
  });

  it('never names the author in a direct chat', () => {
    const t = withLatestPage(EMPTY_TRANSCRIPT, { messages: [msg(1)], lastSeq: 1, hasMore: false });
    const m = transcriptItems(t, ME, false).find((i) => i.kind === 'message');
    expect(m && m.kind === 'message' && m.showAuthor).toBe(false);
  });

  it('puts my unanswered sends last', () => {
    let t = withLatestPage(EMPTY_TRANSCRIPT, { messages: [msg(1)], lastSeq: 1, hasMore: false });
    t = withOutbox(t, { clientMsgId: 'o', body: 'x', createdAt: '', state: 'sending' });
    expect(transcriptItems(t, ME, false).at(-1)?.kind).toBe('outbox');
  });
});

describe('readCursorToSend', () => {
  it('moves the cursor forward only', () => {
    expect(readCursorToSend(null, 0)).toBeNull();
    expect(readCursorToSend(5, 5)).toBeNull();
    expect(readCursorToSend(4, 5)).toBeNull();
    expect(readCursorToSend(9, 5)).toBe(9);
  });
});

describe('sendableBody', () => {
  it('refuses an empty body and one past 8000 characters, trims the tail', () => {
    expect(sendableBody('   \n ')).toBeNull();
    expect(sendableBody('x'.repeat(8001))).toBeNull();
    expect(sendableBody('  hi\n\n')).toBe('  hi');
    expect(sendableBody('x'.repeat(8000))).toHaveLength(8000);
  });
});

describe('authorReadSeqs', () => {
  it('each login has read up to its own newest message', () => {
    const reads = authorReadSeqs([
      msg(1),
      msg(2, { authorId: ME }),
      msg(3),
      msg(4, { authorKind: 'system', authorId: null }),
    ]);
    expect(reads.get(ANN)).toBe(3);
    expect(reads.get(ME)).toBe(2);
    expect(reads.size).toBe(2);
  });
});
