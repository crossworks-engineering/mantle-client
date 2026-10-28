/** Which line rings, its words, and the call lines the transcript shows. */
import { describe, expect, it } from 'vitest';
import { RING_MS } from './session';
import {
  Chains,
  GAP_RING_AGE_MS,
  RingBook,
  callEventOf,
  callLine,
  callerNameOf,
  durationLabel,
  isMine,
  openCallSeq,
  peopleLabel,
  ringText,
  shouldRing,
} from './ring';

const started = {
  authorKind: 'system' as const,
  event: { type: 'call_started' as const, callId: 'call1' },
  deletedAt: null,
  createdAt: new Date(10_000).toISOString(),
  body: 'Ann Lee started a call.',
  authorName: null,
};

describe('callEventOf', () => {
  it('reads a call line and nothing else', () => {
    expect(callEventOf(started)).toEqual({ type: 'call_started', callId: 'call1' });
    expect(
      callEventOf({
        authorKind: 'system',
        event: { type: 'call_ended', callId: 'c', seconds: 61, participants: 2 },
      }),
    ).toEqual({ type: 'call_ended', callId: 'c', seconds: 61, participants: 2 });
    expect(callEventOf({ authorKind: 'system', event: null })).toBeNull();
    expect(callEventOf({ authorKind: 'system', event: undefined })).toBeNull();
    expect(callEventOf({ authorKind: 'login', event: started.event })).toBeNull();
    expect(
      callEventOf({ authorKind: 'system', event: { type: 'later', callId: 'x' } as never }),
    ).toBeNull();
    expect(
      callEventOf({ authorKind: 'system', event: { type: 'call_started' } as never }),
    ).toBeNull();
  });
  it('clamps a bad count', () => {
    expect(
      callEventOf({
        authorKind: 'system',
        event: { type: 'call_cap', callId: 'c', seconds: -5, participants: 'x' } as never,
      }),
    ).toEqual({ type: 'call_cap', callId: 'c', seconds: 0, participants: 0 });
  });
});

describe('shouldRing', () => {
  const base = {
    message: started,
    muted: false,
    mine: false,
    busy: false,
    live: true,
    now: 11_000,
  };
  it('rings a call started line heard live', () => {
    expect(shouldRing(base)).toBe(true);
  });
  it('never a muted chat, never my own call, never while busy, never a deleted line', () => {
    expect(shouldRing({ ...base, muted: true })).toBe(false);
    expect(shouldRing({ ...base, mine: true })).toBe(false);
    expect(shouldRing({ ...base, busy: true })).toBe(false);
    expect(shouldRing({ ...base, message: { ...started, deletedAt: '2026-10-28' } })).toBe(false);
  });
  it('never an ended line, an ordinary message, or a plain system line', () => {
    expect(
      shouldRing({
        ...base,
        message: {
          ...started,
          event: { type: 'call_ended', callId: 'call1', seconds: 1, participants: 1 },
        },
      }),
    ).toBe(false);
    expect(shouldRing({ ...base, message: { ...started, authorKind: 'login' } })).toBe(false);
    expect(shouldRing({ ...base, message: { ...started, event: null } })).toBe(false);
  });
  it('a line found in a gap rings only while young; one heard live is new by definition', () => {
    const gap = { ...base, live: false };
    expect(shouldRing({ ...gap, now: 10_000 + GAP_RING_AGE_MS - 1 })).toBe(true);
    expect(shouldRing({ ...gap, now: 10_000 + GAP_RING_AGE_MS })).toBe(false);
    expect(shouldRing({ ...gap, message: { ...started, createdAt: 'never' } })).toBe(false);
    // A clock that runs ahead of the brain's does not lose a live ring.
    expect(shouldRing({ ...base, now: 10_000 + RING_MS * 10 })).toBe(true);
    expect(GAP_RING_AGE_MS).toBeGreaterThan(RING_MS);
  });
});

describe('callerNameOf', () => {
  it('reads the name the brain wrote into the line', () => {
    expect(callerNameOf(started)).toBe('Ann Lee');
    expect(callerNameOf({ body: 'Jo started a call', authorName: null })).toBe('Jo');
    expect(callerNameOf({ body: 'Someone joined.', authorName: null })).toBe('Someone');
    expect(callerNameOf({ body: '', authorName: 'Ben' })).toBe('Ben');
  });
});

describe('ringText', () => {
  it('names the caller, and the group', () => {
    expect(ringText('Ann Lee', null).title).toBe('Ann Lee is calling');
    expect(ringText('Ann Lee', 'Design').title).toBe('Ann Lee started a call in Design');
  });
});

describe('the call lines', () => {
  it('durationLabel', () => {
    expect(durationLabel(0)).toBe('0 s');
    expect(durationLabel(59)).toBe('59 s');
    expect(durationLabel(60)).toBe('1 min');
    expect(durationLabel(754)).toBe('13 min');
    expect(durationLabel(3600)).toBe('1 h');
    expect(durationLabel(3900)).toBe('1 h 05 min');
    expect(durationLabel(-3)).toBe('0 s');
  });
  it('peopleLabel', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(3)).toBe('3 people');
  });
  it('callLine: the start as written, the end with duration and head count', () => {
    expect(callLine(started)).toEqual({ kind: 'call_started', text: 'Ann Lee started a call.' });
    expect(
      callLine({
        authorKind: 'system',
        body: 'Call ended (13 min, 3 people).',
        event: { type: 'call_ended', callId: 'c', seconds: 754, participants: 3 },
      }),
    ).toEqual({ kind: 'call_ended', text: 'Call ended (13 min, 3 people).' });
    expect(
      callLine({
        authorKind: 'system',
        body: '',
        event: { type: 'call_cap', callId: 'c', seconds: 14_400, participants: 1 },
      }),
    ).toEqual({ kind: 'call_cap', text: 'Call ended at the time limit (4 h, 1 person).' });
    expect(callLine({ authorKind: 'system', body: 'Ann added Ben.', event: null })).toBeNull();
  });
});

describe('openCallSeq', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const start = (seq: number, ms: number) => ({
    authorKind: 'system' as const,
    event: { type: 'call_started' as const, callId: `c${seq}` },
    seq,
    createdAt: at(ms),
  });
  const end = (seq: number, ms: number) => ({
    authorKind: 'system' as const,
    event: { type: 'call_ended' as const, callId: 'x', seconds: 1, participants: 1 },
    seq,
    createdAt: at(ms),
  });
  const text = (seq: number) => ({
    authorKind: 'login' as const,
    event: null,
    seq,
    createdAt: at(0),
  });
  it('is the newest start with no end after it', () => {
    expect(openCallSeq([text(1), start(2, 1000), text(3)], 5000)).toBe(2);
    expect(openCallSeq([start(2, 1000), end(3, 2000)], 5000)).toBeNull();
    expect(openCallSeq([start(2, 1000), end(3, 2000), start(4, 3000)], 5000)).toBe(4);
    expect(openCallSeq([text(1)], 5000)).toBeNull();
    expect(openCallSeq([], 5000)).toBeNull();
  });
  it('a start older than the cap with no end is history', () => {
    expect(openCallSeq([start(2, 0)], 240 * 60_000 - 1)).toBe(2);
    expect(openCallSeq([start(2, 0)], 240 * 60_000)).toBeNull();
  });
});

describe('RingBook', () => {
  const row = (id: string, lastSeq: number | null, kind = 'direct') => ({ id, lastSeq, kind });
  it('the first list is the baseline: nothing moved', () => {
    const b = new RingBook();
    expect(b.moved([row('a', 5), row('b', 2)])).toEqual([]);
    expect(b.moved([row('a', 6), row('b', 2), row('c', 1)])).toEqual([
      { c: 'a', seq: 6 },
      { c: 'c', seq: 1 },
    ]);
    expect(b.moved([row('a', 6)])).toEqual([]);
  });
  it('an agent row and a chat with no line never move', () => {
    const b = new RingBook();
    b.moved([]);
    expect(b.moved([row('x', 3, 'agent'), row('y', null)])).toEqual([]);
  });
  it('a line heard on the stream is known to the list', () => {
    const b = new RingBook();
    b.moved([row('a', 5)]);
    b.heard('a', 7);
    expect(b.moved([row('a', 7)])).toEqual([]);
    b.heard('a', 2);
    expect(b.moved([row('a', 8)])).toEqual([{ c: 'a', seq: 8 }]);
  });
  it('a line is claimed once; a released claim can be taken again', () => {
    const b = new RingBook();
    expect(b.claim('a', 1)).toBe(true);
    expect(b.claim('a', 1)).toBe(false);
    b.release('a', 1);
    expect(b.claim('a', 1)).toBe(true);
  });
  it('a line heard, then given back, is offered by the next list', () => {
    const b = new RingBook();
    b.moved([row('a', 5)]);
    b.heard('a', 6);
    expect(b.claim('a', 6)).toBe(true);
    b.release('a', 6);
    expect(b.moved([row('a', 6)])).toEqual([{ c: 'a', seq: 6 }]);
    expect(b.moved([row('a', 6)])).toEqual([]);
  });
  it('two lines of one chat given back both come back, once each', () => {
    const b = new RingBook();
    b.moved([]);
    b.claim('a', 1);
    b.claim('a', 2);
    b.release('a', 1);
    b.release('a', 2);
    b.release('a', 2);
    expect(b.moved([])).toEqual([
      { c: 'a', seq: 1 },
      { c: 'a', seq: 2 },
    ]);
  });
  it('forgets the oldest claims past its size', () => {
    const b = new RingBook(2);
    b.claim('a', 1);
    b.claim('a', 2);
    b.claim('a', 3);
    expect(b.claim('a', 1)).toBe(true);
  });
});

describe('isMine', () => {
  const base = { mineCall: false, startPending: false, myName: 'Jo', callerName: 'Ann Lee' };
  it('mine by the call, by a start in flight, or by my own name on the line', () => {
    expect(isMine(base)).toBe(false);
    expect(isMine({ ...base, mineCall: true })).toBe(true);
    expect(isMine({ ...base, startPending: true })).toBe(true);
    expect(isMine({ ...base, callerName: 'Jo' })).toBe(true);
    expect(isMine({ ...base, myName: null, callerName: 'Someone' })).toBe(false);
  });
});

describe('Chains', () => {
  it('runs one key in order, keys apart, and goes on past a throw', async () => {
    const c = new Chains();
    const log: string[] = [];
    const step =
      (name: string, ms: number, fail = false) =>
      async () => {
        await new Promise((r) => setTimeout(r, ms));
        if (fail) throw new Error(name);
        log.push(name);
      };
    const a1 = c.run('a', step('a1', 5));
    const a2 = c.run('a', step('a2', 0, true));
    const a3 = c.run('a', step('a3', 0));
    const b1 = c.run('b', step('b1', 0));
    await Promise.all([a1, a2, a3, b1]);
    expect(log).toEqual(['b1', 'a1', 'a3']);
    expect(c.size).toBe(0);
  });
});
