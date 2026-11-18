import { describe, expect, it } from 'vitest';
import {
  AUTO_RETRY_DELAY_MS,
  autoRetryDelayMs,
  canRetryTask,
  createUploadQueue,
  releaseController,
  retryableIds,
} from './upload-queue';
import {
  UploadAbortedError,
  UploadHttpError,
  UploadNetworkError,
  UploadStalledError,
} from './xhr-upload';

describe('retryableIds', () => {
  it('picks only the failed rows that can be sent again, in list order', () => {
    const rows = [
      { id: 'a', status: 'error', retryable: true },
      { id: 'b', status: 'done' },
      { id: 'c', status: 'error', retryable: false }, // refused as too large
      { id: 'd', status: 'conflict', retryable: true }, // name taken: Replace, not Retry
      { id: 'e', status: 'exists' },
      { id: 'f', status: 'cancelled' },
      { id: 'g', status: 'pending' },
      { id: 'h', status: 'uploading' },
      { id: 'i', status: 'error' }, // no flag: retryable, as the row button reads it
      { id: 'j', status: 'pending', retryable: true }, // waiting for its automatic retry
    ];
    expect(retryableIds(rows)).toEqual(['a', 'i']);
  });

  it('agrees with the row button', () => {
    expect(canRetryTask({ id: 'x', status: 'error' })).toBe(true);
    expect(canRetryTask({ id: 'x', status: 'error', retryable: false })).toBe(false);
    expect(canRetryTask({ id: 'x', status: 'conflict' })).toBe(false);
  });
});

/** A start function whose uploads the test finishes by hand. */
function harness(limit: number) {
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  let inFlight = 0;
  let peak = 0;
  const queue = createUploadQueue(limit, (id) => {
    started.push(id);
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<void>((resolve) => {
      finishers.set(id, () => {
        inFlight--;
        resolve();
      });
    });
  });
  const finish = async (id: string) => {
    finishers.get(id)!();
    finishers.delete(id);
    // The slot frees on the settled promise: let its callbacks run.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { queue, started, finish, peak: () => peak, open: () => [...finishers.keys()] };
}

describe('createUploadQueue', () => {
  it('runs 62 retries three at a time, in order, until all are through', async () => {
    const h = harness(3);
    const ids = Array.from({ length: 62 }, (_, i) => `r${i}`);
    h.queue.push(ids);
    expect(h.started).toEqual(['r0', 'r1', 'r2']);
    expect(h.queue.running).toBe(3);
    expect(h.queue.queued).toBe(59);
    while (h.open().length > 0) await h.finish(h.open()[0]!);
    expect(h.started).toEqual(ids);
    expect(h.peak()).toBe(3);
    expect(h.queue.running).toBe(0);
    expect(h.queue.queued).toBe(0);
  });

  it('starts the next one as soon as a slot frees', async () => {
    const h = harness(3);
    h.queue.push(['a', 'b', 'c', 'd']);
    expect(h.started).toEqual(['a', 'b', 'c']);
    await h.finish('b');
    expect(h.started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shares the limit with uploads already running', async () => {
    const h = harness(3);
    h.queue.push(['a', 'b']);
    h.queue.push(['x', 'y', 'z']); // "Retry failed" while two still upload
    expect(h.started).toEqual(['a', 'b', 'x']);
    expect(h.queue.has('y')).toBe(true);
  });

  it('drops a queued id before it starts', async () => {
    const h = harness(1);
    h.queue.push(['a', 'b', 'c']);
    h.queue.drop('b');
    expect(h.queue.has('b')).toBe(false);
    await h.finish('a');
    expect(h.started).toEqual(['a', 'c']);
  });

  it('starts nothing new while a back-off holds it, and resumes on release', async () => {
    const h = harness(3);
    h.queue.push(['a', 'b', 'c', 'd', 'e']);
    // 'a' dropped: its back-off holds the queue.
    h.queue.hold();
    await h.finish('a');
    await h.finish('b');
    expect(h.started).toEqual(['a', 'b', 'c']);
    expect(h.queue.held).toBe(true);
    // Back-off over: 'a' goes first, then the rest, up to the limit.
    h.queue.push(['a'], { front: true });
    expect(h.started).toEqual(['a', 'b', 'c']);
    h.queue.release();
    expect(h.queue.held).toBe(false);
    expect(h.started).toEqual(['a', 'b', 'c', 'a', 'd']);
  });

  it('waits for every hold to be released', async () => {
    const h = harness(1);
    h.queue.hold();
    h.queue.hold();
    h.queue.push(['a']);
    h.queue.release();
    expect(h.started).toEqual([]);
    h.queue.release();
    expect(h.started).toEqual(['a']);
    h.queue.release(); // an extra release does not go below zero
    h.queue.hold();
    h.queue.push(['b']);
    await h.finish('a');
    expect(h.started).toEqual(['a']);
  });

  it('frees the slot when an upload rejects or throws', async () => {
    const started: string[] = [];
    const queue = createUploadQueue(1, (id) => {
      started.push(id);
      if (id === 'throws') throw new Error('boom');
      return Promise.reject(new Error('nope'));
    });
    queue.push(['rejects', 'throws', 'last']);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(started).toEqual(['rejects', 'throws', 'last']);
  });
});

describe('autoRetryDelayMs', () => {
  const http = (status: number) => new UploadHttpError(status, `${status}`, null);

  it('retries a dropped connection once, after a short wait', () => {
    expect(autoRetryDelayMs(new UploadNetworkError(), 0)).toBe(AUTO_RETRY_DELAY_MS);
    expect(AUTO_RETRY_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(AUTO_RETRY_DELAY_MS).toBeLessThanOrEqual(10_000);
  });

  it('retries the gateway losing the brain once', () => {
    for (const s of [502, 503, 504]) expect(autoRetryDelayMs(http(s), 0)).toBe(AUTO_RETRY_DELAY_MS);
  });

  it('never retries a second time', () => {
    expect(autoRetryDelayMs(new UploadNetworkError(), 1)).toBeNull();
    expect(autoRetryDelayMs(http(502), 1)).toBeNull();
  });

  it('never retries a refusal, a conflict, a stall or a cancel', () => {
    for (const s of [400, 401, 403, 409, 413, 429, 500]) {
      expect(autoRetryDelayMs(http(s), 0)).toBeNull();
    }
    expect(autoRetryDelayMs(new UploadStalledError(60), 0)).toBeNull();
    expect(autoRetryDelayMs(new UploadAbortedError(), 0)).toBeNull();
    expect(autoRetryDelayMs(new Error('other'), 0)).toBeNull();
  });
});

describe('releaseController', () => {
  it('keeps the controller of an Override resend that started inside the old send', async () => {
    // The provider's shape: each send puts its controller on the row, a
    // name-taken refusal pushes the Override at the front from its catch
    // (it starts at once: a slot is free), and the finally lets go.
    const entry: { controller?: AbortController } = {};
    const sends: AbortController[] = [];
    const queue = createUploadQueue(3, async (id) => {
      const controller = new AbortController();
      entry.controller = controller;
      sends.push(controller);
      try {
        if (sends.length === 1) {
          await Promise.resolve();
          throw new Error('409 name-taken');
        }
        await new Promise<void>(() => {}); // the resend is still uploading
      } catch {
        queue.push([id], { front: true });
      } finally {
        releaseController(entry, controller);
      }
    });
    queue.push(['a']);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(sends).toHaveLength(2);
    // Cancel reads the row's controller: it must be the resend's.
    expect(entry.controller).toBe(sends[1]);
    entry.controller?.abort();
    expect(sends[1]!.signal.aborted).toBe(true);
  });

  it('lets go of its own controller when no other send took the row', () => {
    const mine = new AbortController();
    const entry: { controller?: AbortController } = { controller: mine };
    releaseController(entry, mine);
    expect(entry.controller).toBeUndefined();
  });
});
