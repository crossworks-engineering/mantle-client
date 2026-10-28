/** Which line rings, its words, and the call lines the transcript shows. */
import { describe, expect, it } from 'vitest';
import { RING_MS } from './session';
import {
  callEventOf,
  callLine,
  callerNameOf,
  durationLabel,
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
  const base = { message: started, muted: false, busy: false, now: 11_000 };
  it('rings a fresh call started line', () => {
    expect(shouldRing(base)).toBe(true);
  });
  it('never a muted chat, never while busy, never a deleted line', () => {
    expect(shouldRing({ ...base, muted: true })).toBe(false);
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
  it('a line older than a ring lasts is history, not a ring', () => {
    expect(shouldRing({ ...base, now: 10_000 + RING_MS - 1 })).toBe(true);
    expect(shouldRing({ ...base, now: 10_000 + RING_MS })).toBe(false);
    expect(shouldRing({ ...base, message: { ...started, createdAt: 'never' } })).toBe(false);
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
