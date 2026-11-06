import { describe, expect, it, vi } from 'vitest';
import {
  findTurnOutboundRow,
  replyPollDelayMs,
  startTurnSafetyPoll,
  turnSinceIso,
  verdictForSettled,
  type SafetyPollRow,
} from './turn-safety-poll';

const row = (over: Partial<SafetyPollRow> & Pick<SafetyPollRow, 'id'>): SafetyPollRow => ({
  direction: 'outbound',
  text: '',
  createdAt: '2026-09-18T09:00:00.000Z',
  status: 'complete',
  ...over,
});

/** A hand-cranked interval so a test decides exactly when a tick happens. */
function manualTimers() {
  let fn: (() => void) | null = null;
  return {
    timers: {
      setInterval: (f: () => void) => {
        fn = f;
        return 1;
      },
      clearInterval: () => {
        fn = null;
      },
    },
    /** Fire one tick and let its async body finish. */
    tick: async () => {
      fn?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    armed: () => fn !== null,
  };
}

describe('findTurnOutboundRow', () => {
  it('prefers the exact outbound id over everything else', () => {
    const rows = [
      row({ id: 'old', createdAt: '2026-09-18T09:00:05.000Z' }),
      row({ id: 'mine', createdAt: '2026-09-18T08:00:00.000Z', status: 'pending' }),
    ];
    const hit = findTurnOutboundRow(rows, {
      outboundId: 'mine',
      sinceIso: '2026-09-18T09:00:00.000Z',
    });
    expect(hit?.id).toBe('mine');
  });

  it('never matches an inbound row by id', () => {
    const rows = [row({ id: 'x', direction: 'inbound' })];
    expect(findTurnOutboundRow(rows, { outboundId: 'x', sinceIso: '1970-01-01' })).toBeUndefined();
  });

  it('pairs with this turn’s inbound row, so the previous reply inside the margin is excluded', () => {
    // The margin pulled `since` back far enough to include the PREVIOUS turn's
    // finished reply. It was written before this turn's inbound row, so it must
    // not be reported as this turn's answer.
    const rows = [
      row({ id: 'prev-reply', createdAt: '2026-09-18T09:00:01.000Z', text: 'old answer' }),
      row({ id: 'my-q', direction: 'inbound', createdAt: '2026-09-18T09:00:02.500Z' }),
      row({ id: 'my-reply', createdAt: '2026-09-18T09:00:02.600Z', status: 'pending' }),
    ];
    const hit = findTurnOutboundRow(rows, { sinceIso: '2026-09-18T09:00:00.000Z' });
    expect(hit?.id).toBe('my-reply');
    expect(hit?.status).toBe('pending');
  });

  it('returns nothing until this turn’s inbound row exists', () => {
    const rows = [row({ id: 'prev-reply', createdAt: '2026-09-18T09:00:01.000Z' })];
    expect(findTurnOutboundRow(rows, { sinceIso: '2026-09-18T09:00:00.000Z' })).toBeUndefined();
  });

  it('is order-independent (the API returns newest first)', () => {
    const rows = [
      row({ id: 'my-reply', createdAt: '2026-09-18T09:00:03.000Z' }),
      row({ id: 'my-q', direction: 'inbound', createdAt: '2026-09-18T09:00:02.000Z' }),
      row({ id: 'ancient', createdAt: '2026-09-17T09:00:00.000Z' }),
    ];
    expect(findTurnOutboundRow(rows, { sinceIso: '2026-09-18T09:00:00.000Z' })?.id).toBe(
      'my-reply',
    );
  });
});

describe('turnSinceIso', () => {
  it('uses the server clock from the Date header, minus elapsed and margin', () => {
    // Client clock is an hour ahead of the server: the client clock must not leak in.
    const iso = turnSinceIso({
      serverDateHeader: 'Fri, 18 Sep 2026 09:00:10 GMT',
      firstSentAtMs: Date.parse('2026-09-18T10:00:06.000Z'),
      nowMs: Date.parse('2026-09-18T10:00:10.000Z'),
    });
    // server now 09:00:10 − 4 s elapsed − 2 s margin
    expect(iso).toBe('2026-09-18T09:00:04.000Z');
  });

  it('falls back to the client clock when the header is unreadable (cross-origin)', () => {
    const iso = turnSinceIso({
      serverDateHeader: null,
      firstSentAtMs: Date.parse('2026-09-18T09:00:06.000Z'),
      nowMs: Date.parse('2026-09-18T09:00:10.000Z'),
    });
    expect(iso).toBe('2026-09-18T09:00:04.000Z');
  });

  it('ignores a garbage header', () => {
    const iso = turnSinceIso({
      serverDateHeader: 'not a date',
      firstSentAtMs: Date.parse('2026-09-18T09:00:06.000Z'),
      nowMs: Date.parse('2026-09-18T09:00:06.000Z'),
      marginMs: 0,
    });
    expect(iso).toBe('2026-09-18T09:00:06.000Z');
  });
});

describe('startTurnSafetyPoll', () => {
  const since = '2026-09-18T09:00:00.000Z';
  const q = row({ id: 'q', direction: 'inbound', createdAt: '2026-09-18T09:00:01.000Z' });

  it('completes the turn from the durable row when the stream never says a word', async () => {
    // The field failure: a proxy holds the event stream back, so NO stream event
    // ever reaches the client. The poll alone must finish the turn, with the
    // row's text (there is no streamed buffer to fall back on).
    const t = manualTimers();
    const pages: SafetyPollRow[][] = [
      [q, row({ id: 'r', createdAt: '2026-09-18T09:00:01.100Z', status: 'pending' })],
      [q, row({ id: 'r', createdAt: '2026-09-18T09:00:01.100Z', status: 'pending' })],
      [q, row({ id: 'r', createdAt: '2026-09-18T09:00:01.100Z', text: 'The durable reply.' })],
    ];
    const fetchRows = vi.fn(async () => pages.shift() ?? []);
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    startTurnSafetyPoll({
      fetchRows,
      getOutboundId: () => null, // turn-start never arrived either
      sinceIso: since,
      onComplete,
      onFailed,
      timers: t.timers,
    });

    await t.tick();
    await t.tick();
    expect(onComplete).not.toHaveBeenCalled();
    await t.tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0].text).toBe('The durable reply.');
    expect(onFailed).not.toHaveBeenCalled();
    // It stops itself: no further requests once the turn is settled.
    expect(t.armed()).toBe(false);
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(3);
  });

  it('reports a failed row', async () => {
    const t = manualTimers();
    const onFailed = vi.fn();
    startTurnSafetyPoll({
      fetchRows: async () => [
        q,
        row({ id: 'r', createdAt: '2026-09-18T09:00:02.000Z', status: 'failed', error: 'boom' }),
      ],
      getOutboundId: () => 'r',
      sinceIso: since,
      onComplete: vi.fn(),
      onFailed,
      timers: t.timers,
    });
    await t.tick();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0]![0].error).toBe('boom');
  });

  it('picks up the outbound id when the stream learns it late', async () => {
    const t = manualTimers();
    let id: string | null = null;
    const onComplete = vi.fn();
    startTurnSafetyPoll({
      // No inbound row in the page, so only the id can match.
      fetchRows: async () => [row({ id: 'r', createdAt: '2026-09-18T09:00:02.000Z' })],
      getOutboundId: () => id,
      sinceIso: since,
      onComplete,
      onFailed: vi.fn(),
      timers: t.timers,
    });
    await t.tick();
    expect(onComplete).not.toHaveBeenCalled();
    id = 'r';
    await t.tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('survives a failing fetch and tries again next tick', async () => {
    const t = manualTimers();
    let calls = 0;
    const onComplete = vi.fn();
    startTurnSafetyPoll({
      fetchRows: async () => {
        calls += 1;
        if (calls === 1) throw new Error('network');
        return [q, row({ id: 'r', createdAt: '2026-09-18T09:00:02.000Z' })];
      },
      getOutboundId: () => null,
      sinceIso: since,
      onComplete,
      onFailed: vi.fn(),
      timers: t.timers,
    });
    await t.tick();
    expect(onComplete).not.toHaveBeenCalled();
    await t.tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('never stacks requests: a slow fetch skips the overlapping tick', async () => {
    const t = manualTimers();
    let release: (rows: SafetyPollRow[]) => void = () => {};
    const fetchRows = vi.fn(
      () =>
        new Promise<SafetyPollRow[]>((r) => {
          release = r;
        }),
    );
    startTurnSafetyPoll({
      fetchRows,
      getOutboundId: () => null,
      sinceIso: since,
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      timers: t.timers,
    });
    await t.tick();
    await t.tick(); // first fetch still hanging
    expect(fetchRows).toHaveBeenCalledTimes(1);
    release([]);
    await new Promise((r) => setTimeout(r, 0));
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it('fires nothing after stop(), even for a fetch already in flight', async () => {
    const t = manualTimers();
    let release: (rows: SafetyPollRow[]) => void = () => {};
    const onComplete = vi.fn();
    const stop = startTurnSafetyPoll({
      fetchRows: () =>
        new Promise<SafetyPollRow[]>((r) => {
          release = r;
        }),
      getOutboundId: () => null,
      sinceIso: since,
      onComplete,
      onFailed: vi.fn(),
      timers: t.timers,
    });
    await t.tick();
    stop(); // the stream won the race (or the dock unmounted)
    release([q, row({ id: 'r', createdAt: '2026-09-18T09:00:02.000Z' })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(onComplete).not.toHaveBeenCalled();
    stop(); // idempotent
  });

  it('gives up once, only when asked, and only while the row is not terminal', async () => {
    const t = manualTimers();
    let giveUp = false;
    const onGiveUp = vi.fn();
    startTurnSafetyPoll({
      fetchRows: async () => [
        q,
        row({ id: 'r', createdAt: '2026-09-18T09:00:02.000Z', status: 'pending' }),
      ],
      getOutboundId: () => null,
      sinceIso: since,
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      shouldGiveUp: () => giveUp,
      onGiveUp,
      timers: t.timers,
    });
    await t.tick();
    expect(onGiveUp).not.toHaveBeenCalled();
    giveUp = true;
    await t.tick();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(t.armed()).toBe(false);
  });
});

describe('verdictForSettled', () => {
  const pending = { idempotencyKey: 'key-1' };

  it('settles the pending turn when the dock reports ITS key', () => {
    expect(verdictForSettled(pending, { idempotencyKey: 'key-1', status: 'done' })).toBe('done');
    expect(verdictForSettled(pending, { idempotencyKey: 'key-1', status: 'error' })).toBe('error');
  });

  it('ignores another turn settling', () => {
    expect(verdictForSettled(pending, { idempotencyKey: 'key-2', status: 'done' })).toBeNull();
  });

  it('ignores every signal while nothing is pending (blocking turn, or already stopped)', () => {
    expect(verdictForSettled(null, { idempotencyKey: 'key-1', status: 'done' })).toBeNull();
  });

  it('accepts a keyless signal: a transcript has at most one turn pending', () => {
    expect(verdictForSettled(pending, { status: 'done' })).toBe('done');
  });
});

describe('the reply poll of a login without the live stream', () => {
  it('every 3 s for the first minute, then every 10 s', () => {
    expect(replyPollDelayMs(0, 0)).toBe(3000);
    expect(replyPollDelayMs(59_999, 0)).toBe(3000);
    expect(replyPollDelayMs(60_000, 0)).toBe(10_000);
    expect(replyPollDelayMs(10 * 60_000, 0)).toBe(10_000);
  });

  it('backs off on failed reads, up to one minute, and recovers', () => {
    expect(replyPollDelayMs(0, 1)).toBe(6000);
    expect(replyPollDelayMs(0, 2)).toBe(12_000);
    expect(replyPollDelayMs(120_000, 1)).toBe(20_000);
    expect(replyPollDelayMs(120_000, 9)).toBe(60_000);
    expect(replyPollDelayMs(0, 50)).toBe(60_000);
    expect(replyPollDelayMs(120_000, 0)).toBe(10_000);
  });

  it('fetches only when due, never while hidden, and later after a failure', async () => {
    const t = manualTimers();
    let clock = 0;
    let hidden = false;
    let fail = false;
    const fetchRows = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return [row({ id: 'r', status: 'pending', createdAt: '2026-09-18T09:00:01.000Z' })];
    });
    const stop = startTurnSafetyPoll({
      fetchRows,
      getOutboundId: () => 'r',
      sinceIso: '2026-09-18T09:00:00.000Z',
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      schedule: { delayMs: replyPollDelayMs, isHidden: () => hidden, now: () => clock },
      timers: t.timers,
    });

    clock = 2000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(0); // not due before 3 s
    clock = 3000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(1);

    hidden = true;
    clock = 30_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(1); // a hidden tab asks nothing
    hidden = false;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(2);

    fail = true;
    clock = 33_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(3); // fails: next one 6 s on
    clock = 36_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(3);
    clock = 39_000;
    fail = false;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(4);

    // Past the first minute: every 10 s.
    clock = 70_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(5);
    clock = 75_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(5);
    clock = 80_000;
    await t.tick();
    expect(fetchRows).toHaveBeenCalledTimes(6);
    stop();
  });
});
