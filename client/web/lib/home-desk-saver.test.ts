import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDesk, type DeskPrefs } from './home-desk';
import {
  DESK_REFRESH_AFTER_MS,
  SAVE_DELAY_MS,
  createDeskSaver,
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

  it('asks for a fresh read only after a long idle, with nothing waiting', () => {
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
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS - 1)).toBe(false);
    saver.synced(saved + DESK_REFRESH_AFTER_MS);
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS * 2 - 1)).toBe(false);
    expect(saver.needsRefresh(saved + DESK_REFRESH_AFTER_MS * 2)).toBe(true);
  });
});
