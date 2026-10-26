import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDesk, type DeskPrefs } from './home-desk';
import {
  DESK_REFRESH_AFTER_MS,
  SAVE_DELAY_MS,
  createDeskSaver,
  moveUpAnswered,
  shellReadIsOld,
  type DeskSend,
} from './home-desk-saver';

const desk = (clock: 'digital' | 'analog', x = 0): DeskPrefs => ({
  ...defaultDesk(['notes']),
  items: [{ id: 'clock', x, y: 0, w: 3, h: 2 }],
  clock,
});

/** A send that records each call and answers as `answer` says. */
function sender(answer: () => Promise<unknown> = () => Promise.resolve({})) {
  const calls: Array<{ desk: DeskPrefs; keepalive: boolean }> = [];
  const send: DeskSend = vi.fn((d, opts) => {
    calls.push({ desk: d, keepalive: opts.keepalive });
    return answer();
  });
  return { send, calls };
}

const refusal = (status: number) => Object.assign(new Error('refused'), { status });

describe('the desk saver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: many changes, one save of the last desk after the delay', () => {
    const { send, calls } = sender();
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn() });
    saver.save(desk('digital', 1));
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    saver.save(desk('digital', 2));
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    saver.save(desk('analog', 3));
    expect(calls).toEqual([]);
    expect(saver.pending).toBe(true);
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls).toEqual([{ desk: desk('analog', 3), keepalive: false }]);
    expect(saver.pending).toBe(false);
  });

  it('flushes what is waiting at once (keepalive on the way out), and only once', () => {
    const { send, calls } = sender();
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn() });
    saver.flush({ keepalive: true }); // nothing waiting: nothing sent
    saver.save(desk('analog'));
    saver.flush({ keepalive: true });
    expect(calls).toEqual([{ desk: desk('analog'), keepalive: true }]);
    // The armed timer was cleared: no second save after the delay, and a
    // second flush (pagehide after visibilitychange) sends nothing.
    saver.flush({ keepalive: true });
    vi.advanceTimersByTime(SAVE_DELAY_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('a failed save warns once, not once a save; a save that lands arms it again', async () => {
    let fail = true;
    const { send } = sender(() =>
      fail ? Promise.reject(new Error('offline')) : Promise.resolve(),
    );
    const onFailed = vi.fn();
    const onRefused = vi.fn();
    const saver = createDeskSaver(send, { onRefused, onFailed });
    for (const x of [1, 2, 3]) {
      saver.save(desk('digital', x));
      saver.flush();
      await vi.runAllTimersAsync();
    }
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(saver.stopped).toBe(false);
    fail = false;
    saver.save(desk('digital', 4));
    saver.flush();
    await vi.runAllTimersAsync();
    fail = true;
    saver.save(desk('digital', 5));
    saver.flush();
    await vi.runAllTimersAsync();
    expect(onFailed).toHaveBeenCalledTimes(2);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'a %s refusal stops the saver: one call, no toast, nothing sent again',
    async (status) => {
      const { send, calls } = sender(() => Promise.reject(refusal(status)));
      const onFailed = vi.fn();
      const onRefused = vi.fn();
      const saver = createDeskSaver(send, { onRefused, onFailed });
      saver.save(desk('digital'));
      saver.flush();
      // A second save waiting while the first is refused is dropped too.
      saver.save(desk('analog'));
      await vi.runAllTimersAsync();
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onFailed).not.toHaveBeenCalled();
      expect(saver.stopped).toBe(true);
      expect(saver.pending).toBe(false);
      saver.save(desk('analog', 9));
      saver.flush({ keepalive: true });
      await vi.runAllTimersAsync();
      expect(calls).toHaveLength(1);
      expect(onRefused).toHaveBeenCalledTimes(1);
    },
  );

  it('asks for a fresh read only after a long idle, with nothing waiting', async () => {
    const { send } = sender();
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn() });
    const t0 = Date.now();
    expect(saver.needsRefresh(t0 + DESK_REFRESH_AFTER_MS - 1)).toBe(false);
    expect(saver.needsRefresh(t0 + DESK_REFRESH_AFTER_MS)).toBe(true);
    // A change waiting: never replaced by a read.
    saver.save(desk('analog'));
    expect(saver.needsRefresh(t0 + DESK_REFRESH_AFTER_MS * 2)).toBe(false);
    // A save restarts the idle clock, and so does a read.
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    const saved = Date.now();
    // In flight: never replaced by a read either, until it lands.
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS * 2)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS - 1)).toBe(false);
    saver.synced(saved + DESK_REFRESH_AFTER_MS);
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS * 2 - 1)).toBe(false);
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS * 2)).toBe(true);
  });

  it('sends one save at a time: a desk flushed meanwhile waits, and only the latest', async () => {
    const answers: Array<(v: unknown) => void> = [];
    const { send, calls } = sender(() => new Promise((resolve) => answers.push(resolve)));
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn() });
    saver.save(desk('digital', 1));
    saver.flush();
    expect(saver.inFlight).toBe(true);
    saver.save(desk('digital', 2));
    saver.flush();
    saver.save(desk('analog', 3));
    saver.flush({ keepalive: true });
    // Nothing more goes out while the first is on its way.
    expect(calls).toHaveLength(1);
    expect(saver.pending).toBe(true);
    answers[0]!({});
    await vi.advanceTimersByTimeAsync(0);
    // Then the latest alone, with the keepalive one flush asked for.
    expect(calls).toEqual([
      { desk: desk('digital', 1), keepalive: false },
      { desk: desk('analog', 3), keepalive: true },
    ]);
    answers[1]!({});
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(calls).toHaveLength(2);
    expect(saver.inFlight).toBe(false);
    expect(saver.pending).toBe(false);
  });

  it('tells each save how it ended, the replaced ones by the save that carried them', async () => {
    let status: number | null = 200;
    const { send } = sender(() =>
      status === 200
        ? Promise.resolve({})
        : Promise.reject(status === null ? new Error('offline') : refusal(status)),
    );
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn() });
    const first = vi.fn();
    const second = vi.fn();
    saver.save(desk('digital', 1), first);
    saver.save(desk('digital', 2), second);
    await vi.runAllTimersAsync();
    expect(first).toHaveBeenCalledWith({ status: 200 });
    expect(second).toHaveBeenCalledWith({ status: 200 });
    for (const s of [null, 503, 400] as const) {
      status = s;
      const told = vi.fn();
      saver.save(desk('analog'), told);
      saver.flush();
      await vi.runAllTimersAsync();
      expect(told).toHaveBeenCalledWith({ status: s });
    }
  });

  it.each([401, 403] as const)(
    'names the refusal (%s), so the hook tells an expired session from a no',
    async (status) => {
      const { send } = sender(() => Promise.reject(refusal(status)));
      const onRefused = vi.fn();
      const waiting = vi.fn();
      const saver = createDeskSaver(send, { onRefused, onFailed: vi.fn() });
      saver.save(desk('digital'));
      saver.flush();
      saver.save(desk('analog'), waiting);
      saver.flush();
      await vi.runAllTimersAsync();
      expect(onRefused).toHaveBeenCalledWith(status);
      // The desk queued behind it is never sent, and is told why.
      expect(waiting).toHaveBeenCalledWith({ status });
    },
  );

  it('counts the changes, and drops a read that started before one', async () => {
    const answers: Array<(v: unknown) => void> = [];
    const { send } = sender(() => new Promise((resolve) => answers.push(resolve)));
    const saved = vi.fn();
    const saver = createDeskSaver(send, { onRefused: vi.fn(), onFailed: vi.fn(), onSaved: saved });
    // Idle: a read may be shown when it lands, if nothing changed.
    const idle = saver.readStart();
    expect(idle).toBe(0);
    expect(saver.readFresh(idle)).toBe(true);
    // A change while the read is on its way: the read is dropped.
    saver.save(desk('digital', 1));
    expect(saver.gen).toBe(1);
    expect(saver.readFresh(idle)).toBe(false);
    // A read that starts with a change waiting, or a save in flight, is
    // never shown: it may predate the save.
    expect(saver.readStart()).toBeNull();
    saver.flush();
    const during = saver.readStart();
    expect(during).toBeNull();
    saver.save(desk('digital', 2));
    answers[0]!({ homeDesk: 'first' });
    await vi.advanceTimersByTimeAsync(0);
    // Its answer names the change it carried, older than the latest.
    expect(saved).toHaveBeenLastCalledWith({ homeDesk: 'first' }, 1);
    expect(saver.readFresh(during)).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    answers[1]!({ homeDesk: 'second' });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveBeenLastCalledWith({ homeDesk: 'second' }, 2);
    // Settled: a read from now on may be shown again.
    const after = saver.readStart();
    expect(after).toBe(2);
    expect(saver.readFresh(after)).toBe(true);
  });
});

describe('reading the desk again', () => {
  it('reads the shell again when the Desk opens on an old read', () => {
    const now = 1_000_000_000;
    expect(shellReadIsOld(now - DESK_REFRESH_AFTER_MS + 1, now)).toBe(false);
    expect(shellReadIsOld(now - DESK_REFRESH_AFTER_MS, now)).toBe(true);
    // Never read (no shell in the cache): old.
    expect(shellReadIsOld(0, now)).toBe(true);
  });

  it('marks the move up done only when the brain answered it', () => {
    for (const s of [200, 204, 400, 401, 403]) expect(moveUpAnswered(s), String(s)).toBe(true);
    for (const s of [null, 404, 409, 413, 429, 500, 502, 503]) {
      expect(moveUpAnswered(s), String(s)).toBe(false);
    }
  });
});
