/**
 * Live delivery: stream frames become effects, a reconnect asks for the gap,
 * and a silent stream (a proxy buffering SSE) falls back to a 5-second poll
 * until it speaks again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_MS,
  ReceiptBook,
  STREAM_HEARTBEAT_MS,
  STREAM_SILENCE_MS,
  SilenceWatchdog,
  TYPING_SHOW_MS,
  TypingBook,
  connectMessengerLive,
  effectOf,
  parseStreamEvent,
  shouldSendTyping,
  typingLine,
  type LiveEffect,
  type StreamSource,
} from './live';

describe('parseStreamEvent', () => {
  it('reads the events of the stream route (type, never text)', () => {
    expect(parseStreamEvent('{"type":"message","c":"c1","seq":4,"kind":"new"}')).toEqual({
      type: 'message',
      c: 'c1',
      seq: 4,
      kind: 'new',
    });
    expect(parseStreamEvent({ type: 'read', c: 'c1', seq: 3, loginId: 'l1' })).toEqual({
      type: 'read',
      c: 'c1',
      seq: 3,
      loginId: 'l1',
    });
    expect(parseStreamEvent({ type: 'typing', c: 'c1', loginId: 'l1' })?.type).toBe('typing');
    expect(parseStreamEvent({ type: 'participants', c: 'c1' })?.type).toBe('participants');
    expect(parseStreamEvent({ type: 'history', c: 'c1' })?.type).toBe('history');
    expect(parseStreamEvent({ type: 'reaction', c: 'c1', seq: 2 })?.type).toBe('reaction');
  });

  it('drops what is not an event', () => {
    expect(parseStreamEvent('not json')).toBeNull();
    expect(parseStreamEvent({ type: 'message', c: 'c1', kind: 'new' })).toBeNull();
    expect(parseStreamEvent({ type: 'message', c: 'c1', seq: 1, kind: 'shout' })).toBeNull();
    expect(parseStreamEvent({ type: 'read', c: 'c1', seq: 1 })).toBeNull();
    expect(parseStreamEvent({ type: 'pending_tool_call', id: '' })).toBeNull();
    expect(parseStreamEvent(null)).toBeNull();
  });
});

describe('effectOf', () => {
  it('a new message catches up; an edit, delete or reaction refetches its seq', () => {
    const n = effectOf({ type: 'message', c: 'c', seq: 7, kind: 'new' });
    expect(n).toMatchObject({ catchUp: true, newSeq: 7, refetchSeq: null, refreshList: true });
    expect(effectOf({ type: 'message', c: 'c', seq: 3, kind: 'edit' })).toMatchObject({
      catchUp: false,
      refetchSeq: 3,
    });
    expect(effectOf({ type: 'message', c: 'c', seq: 3, kind: 'delete' }).refetchSeq).toBe(3);
    expect(effectOf({ type: 'reaction', c: 'c', seq: 2 }).refetchSeq).toBe(2);
  });

  it('people and history reload the chat; typing leaves the list alone', () => {
    expect(effectOf({ type: 'participants', c: 'c' }).reload).toBe(true);
    expect(effectOf({ type: 'history', c: 'c' }).reload).toBe(true);
    const typing = effectOf({ type: 'typing', c: 'c', loginId: 'l' });
    expect(typing).toMatchObject({ typing: 'l', refreshList: false });
    expect(effectOf({ type: 'read', c: 'c', seq: 4, loginId: 'l' }).read).toEqual({
      loginId: 'l',
      seq: 4,
    });
  });
});

/** A stream the test drives by hand. */
function fakeStream() {
  const h: Parameters<StreamSource>[0][] = [];
  let closed = 0;
  const source: StreamSource = (handlers) => {
    h.push(handlers);
    return () => {
      closed += 1;
    };
  };
  return {
    source,
    connect: () => h.forEach((x) => x.onConnect()),
    keepAlive: () => h.forEach((x) => x.onActivity()),
    send: (data: unknown) =>
      h.forEach((x) => {
        x.onActivity();
        x.onData(data);
      }),
    get closed() {
      return closed;
    },
  };
}

describe('the polling fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits out the heartbeat before deciding the stream is silent', () => {
    expect(STREAM_SILENCE_MS).toBeGreaterThan(STREAM_HEARTBEAT_MS);
    expect(POLL_MS).toBe(5_000);
  });

  it('polls every 5 seconds while a connected stream says nothing, and stops when it speaks', () => {
    const stream = fakeStream();
    const onPoll = vi.fn();
    const off = connectMessengerLive({
      source: stream.source,
      onEffect: () => {},
      onGap: () => {},
      onPoll,
    });
    stream.connect();

    // Inside the heartbeat window: a silent stream is still a healthy one.
    vi.advanceTimersByTime(STREAM_SILENCE_MS);
    expect(onPoll).not.toHaveBeenCalled();

    // Past it: the next check polls, then one poll every 5 seconds.
    vi.advanceTimersByTime(POLL_MS);
    expect(onPoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(onPoll).toHaveBeenCalledTimes(4);

    // The stream speaks again (an event): the poll stops.
    stream.send({ type: 'message', c: 'c1', seq: 9, kind: 'new' });
    vi.advanceTimersByTime(POLL_MS * 4);
    expect(onPoll).toHaveBeenCalledTimes(4);

    off();
    expect(stream.closed).toBe(1);
  });

  it('a stream that only breathes (keep-alive comments) never polls', () => {
    const stream = fakeStream();
    const onPoll = vi.fn();
    connectMessengerLive({ source: stream.source, onEffect: () => {}, onGap: () => {}, onPoll });
    stream.connect();
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(STREAM_HEARTBEAT_MS);
      stream.keepAlive();
    }
    expect(onPoll).not.toHaveBeenCalled();
  });

  it('a stream that never connects (buffered from the start) polls too', () => {
    const stream = fakeStream();
    const onPoll = vi.fn();
    connectMessengerLive({ source: stream.source, onEffect: () => {}, onGap: () => {}, onPoll });
    vi.advanceTimersByTime(STREAM_SILENCE_MS + POLL_MS);
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it('stops polling once disconnected', () => {
    const stream = fakeStream();
    const onPoll = vi.fn();
    const off = connectMessengerLive({
      source: stream.source,
      onEffect: () => {},
      onGap: () => {},
      onPoll,
    });
    off();
    vi.advanceTimersByTime(STREAM_SILENCE_MS * 3);
    expect(onPoll).not.toHaveBeenCalled();
  });

  it('the watchdog alone: silent only past its window', () => {
    let now = 0;
    const timers: (() => void)[] = [];
    const dog = new SilenceWatchdog(() => {}, {
      clock: {
        now: () => now,
        setInterval: (fn) => timers.push(fn),
        clearInterval: () => {},
      },
      silenceMs: 100,
    });
    dog.start();
    now = 100;
    expect(dog.silent).toBe(false);
    now = 101;
    expect(dog.silent).toBe(true);
    dog.heard();
    expect(dog.silent).toBe(false);
  });
});

describe('connectMessengerLive', () => {
  it('hands each event its effect and asks for the gap on every connect', () => {
    const stream = fakeStream();
    const effects: LiveEffect[] = [];
    const onGap = vi.fn();
    connectMessengerLive({
      source: stream.source,
      onEffect: (e) => effects.push(e),
      onGap,
      onPoll: () => {},
    });
    stream.connect();
    expect(onGap).toHaveBeenCalledTimes(1);
    stream.send({ type: 'message', c: 'c1', seq: 2, kind: 'new' });
    stream.send('garbage');
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ c: 'c1', catchUp: true });
    stream.connect();
    expect(onGap).toHaveBeenCalledTimes(2);
  });
});

describe('ReceiptBook', () => {
  it('keeps the highest seq each login read and answers the lowest over the others', () => {
    const book = new ReceiptBook();
    const heard = vi.fn();
    book.subscribe(heard);
    book.record('c', 'a', 5);
    book.record('c', 'a', 3);
    expect(book.readByAll('c', ['a'])).toBe(5);
    expect(book.readByAll('c', ['a', 'b'])).toBe(0);
    book.record('c', 'b', 4);
    expect(book.readByAll('c', ['a', 'b'])).toBe(4);
    expect(book.readByAll('c', [])).toBe(0);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('typing', () => {
  it('shows a typist for 5 seconds after the last ping', () => {
    let now = 1_000;
    const book = new TypingBook(() => now);
    book.record('c', 'ann');
    expect(book.typing('c')).toEqual(['ann']);
    now += TYPING_SHOW_MS - 1;
    expect(book.typing('c')).toEqual(['ann']);
    now += 2;
    expect(book.typing('c')).toEqual([]);
    book.record('c', 'ann');
    book.clear('c', 'ann');
    expect(book.typing('c')).toEqual([]);
  });

  it('sends at most one ping every 3 seconds', () => {
    expect(shouldSendTyping(null, 0)).toBe(true);
    expect(shouldSendTyping(1_000, 3_999)).toBe(false);
    expect(shouldSendTyping(1_000, 4_000)).toBe(true);
  });

  it('says who is typing', () => {
    expect(typingLine([])).toBeNull();
    expect(typingLine(['Ann'])).toBe('Ann is typing');
    expect(typingLine(['Ann', 'Ben'])).toBe('Ann and Ben are typing');
    expect(typingLine(['Ann', 'Ben', 'Cy'])).toBe('3 people are typing');
  });
});
