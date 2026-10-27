import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeDeskState } from './contract/home-desk';
import { defaultDesk, deskToWire, type DeskPrefs } from './home-desk';
import { SAVE_DELAY_MS, conflictState, createDeskSaver, type DeskSend } from './home-desk-saver';

const desk = (clock: 'digital' | 'analog', x = 0): DeskPrefs => ({
  ...defaultDesk(['notes']),
  items: [{ id: 'clock', x, y: 0, w: 3, h: 2 }],
  clock,
});

const stateOf = (d: DeskPrefs, version: number): HomeDeskState => ({
  homeDesk: deskToWire(d) as HomeDeskState['homeDesk'],
  version,
});

/** An API client's error, as apiFetch throws it. */
const failure = (status: number, body?: Record<string, unknown>) =>
  Object.assign(new Error(`status ${status}`), { status, body });

type Call = { desk: DeskPrefs; version: number; settle: Settle };
type Settle = { ok: (state: HomeDeskState) => void; fail: (err: unknown) => void };

/** A send that records each call and leaves it open until the test answers. */
function sender() {
  const calls: Call[] = [];
  const send: DeskSend = vi.fn(
    (d, version) =>
      new Promise<HomeDeskState>((ok, fail) => {
        calls.push({ desk: d, version, settle: { ok, fail } });
      }),
  );
  /** Answer call `i` as the brain would for a save that landed. */
  const land = async (i: number) => {
    const c = calls[i]!;
    c.settle.ok(stateOf(c.desk, c.version + 1));
    await vi.runAllTimersAsync();
  };
  const refuse = async (i: number, err: unknown) => {
    calls[i]!.settle.fail(err);
    await vi.runAllTimersAsync();
  };
  return { send, calls, land, refuse };
}

const hooks = () => ({ onSaved: vi.fn(), onConflict: vi.fn(), onFailed: vi.fn() });

describe('the desk saver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces: many changes, one save of the last desk after the delay', () => {
    const { send, calls } = sender();
    const saver = createDeskSaver(send, hooks());
    saver.save(desk('digital', 1));
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    saver.save(desk('digital', 2));
    vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    saver.save(desk('analog', 3));
    expect(calls).toEqual([]);
    expect(saver.busy).toBe(true);
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls.map((c) => [c.desk, c.version])).toEqual([[desk('analog', 3), 0]]);
  });

  it('sends each save with the version of the last read or save that landed', async () => {
    const { send, calls, land } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    expect(saver.read(stateOf(desk('digital'), 4))).toBe(true);
    saver.save(desk('analog'));
    void saver.flush();
    expect(calls[0]!.version).toBe(4);
    await land(0);
    expect(h.onSaved).toHaveBeenCalledWith(stateOf(desk('analog'), 5));
    expect(saver.version).toBe(5);
    saver.save(desk('digital'));
    void saver.flush();
    expect(calls[1]!.version).toBe(5);
  });

  it('one save in flight: a desk changed meanwhile waits, only the latest, with the new version', async () => {
    const { send, calls, land } = sender();
    const saver = createDeskSaver(send, hooks());
    saver.save(desk('digital', 1));
    void saver.flush();
    saver.save(desk('digital', 2));
    void saver.flush();
    saver.save(desk('analog', 3));
    void saver.flush();
    expect(calls).toHaveLength(1);
    await land(0);
    expect(calls.map((c) => [c.desk, c.version])).toEqual([
      [desk('digital', 1), 0],
      [desk('analog', 3), 1],
    ]);
    await land(1);
    expect(saver.busy).toBe(false);
    expect(saver.version).toBe(2);
  });

  it('on a 409 adopts the other device desk and version, drops what waits, never retries', async () => {
    const { send, calls, refuse } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    saver.save(desk('digital', 1));
    void saver.flush();
    // A change waits behind the save in flight, another is still debouncing.
    saver.save(desk('digital', 2));
    void saver.flush();
    saver.save(desk('digital', 3));
    const theirs = stateOf(desk('analog', 9), 7);
    await refuse(0, failure(409, { ...theirs }));
    expect(h.onConflict).toHaveBeenCalledTimes(1);
    expect(h.onConflict).toHaveBeenCalledWith(theirs);
    expect(h.onFailed).not.toHaveBeenCalled();
    expect(saver.version).toBe(7);
    expect(saver.busy).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3);
    expect(calls).toHaveLength(1);
    // The next change saves on top of the desk that won.
    saver.save(desk('digital', 4));
    void saver.flush();
    expect(calls[1]!.version).toBe(7);
  });

  it('reads a 409 body only when it names a version', () => {
    expect(conflictState(failure(409, { homeDesk: null, version: 3 }))).toEqual({
      homeDesk: null,
      version: 3,
    });
    expect(conflictState(failure(409, { error: 'x' }))).toBeNull();
    expect(conflictState(failure(409))).toBeNull();
    expect(conflictState(failure(500, { homeDesk: null, version: 3 }))).toBeNull();
  });

  it('a 401 or a 403 stops the saver for the visit: nothing waiting is sent, nothing new is taken', async () => {
    for (const status of [401, 403]) {
      const { send, calls, refuse } = sender();
      const h = { ...hooks(), onStopped: vi.fn() };
      const saver = createDeskSaver(send, h);
      saver.save(desk('digital', 1));
      void saver.flush();
      saver.save(desk('digital', 2));
      void saver.flush();
      await refuse(0, failure(status, { code: 'login-mismatch' }));
      expect(saver.stopped).toBe(true);
      expect(h.onStopped).toHaveBeenCalledWith(status);
      expect(h.onFailed).not.toHaveBeenCalled();
      saver.save(desk('analog', 3));
      await saver.flush();
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
      expect(calls).toHaveLength(1);
      expect(h.onStopped).toHaveBeenCalledTimes(1);
      expect(saver.read(stateOf(desk('analog'), 9))).toBe(false);
    }
  });

  it('a failed save warns once, not once a save; a save that lands arms it again', async () => {
    const { send, calls, land, refuse } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    for (const x of [1, 2, 3]) {
      saver.save(desk('digital', x));
      void saver.flush();
      await refuse(calls.length - 1, new TypeError('Failed to fetch'));
    }
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    // Each save carries the whole desk with the same version: the next one
    // saves what a failed one missed.
    expect(calls.map((c) => c.version)).toEqual([0, 0, 0]);
    saver.save(desk('analog'));
    void saver.flush();
    await land(3);
    saver.save(desk('digital', 4));
    void saver.flush();
    await refuse(4, failure(500));
    expect(h.onFailed).toHaveBeenCalledTimes(2);
  });

  it('flushes on the way out at once, and only once', async () => {
    const { send, calls, land } = sender();
    const saver = createDeskSaver(send, hooks());
    await saver.flush(); // nothing waiting: nothing sent
    expect(calls).toHaveLength(0);
    saver.save(desk('analog'));
    const idle = saver.flush();
    expect(calls.map((c) => [c.desk, c.version])).toEqual([[desk('analog'), 0]]);
    // The armed timer was cleared: a second flush (pagehide after
    // visibilitychange) and the delay send nothing more.
    void saver.flush();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(calls).toHaveLength(1);
    let done = false;
    void idle.then(() => (done = true));
    await land(0);
    expect(done).toBe(true);
  });

  it('a save that fails on the way keeps its desk: busy, never replaced by a read, not retried on a timer', async () => {
    const { send, calls, refuse } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    expect(saver.read(stateOf(desk('digital'), 3))).toBe(true);
    saver.save(desk('analog', 1));
    void saver.flush();
    await refuse(0, failure(503));
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    expect(saver.busy).toBe(true);
    expect(saver.latest).toEqual(desk('analog', 1));
    expect(saver.read(stateOf(desk('digital', 9), 4))).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 50);
    expect(calls).toHaveLength(1);
    // On flush (the way out) it goes again, from the same version.
    void saver.flush();
    expect(calls.map((c) => [c.desk, c.version])).toEqual([
      [desk('analog', 1), 3],
      [desk('analog', 1), 3],
    ]);
    await refuse(1, new TypeError('Failed to fetch'));
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    // The next change replaces it and goes after the delay.
    saver.save(desk('digital', 2));
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(calls[2]!.desk).toEqual(desk('digital', 2));
  });

  it('holds the newest desk not known to have landed, for a Desk opened again', async () => {
    const { send, land } = sender();
    const saver = createDeskSaver(send, hooks());
    expect(saver.latest).toBeNull();
    saver.save(desk('digital', 1));
    expect(saver.latest).toEqual(desk('digital', 1));
    void saver.flush();
    expect(saver.latest).toEqual(desk('digital', 1));
    await land(0);
    expect(saver.latest).toBeNull();
  });

  it('a newer change made while a save fails is not replaced by the failed desk', async () => {
    const { send, calls, refuse } = sender();
    const saver = createDeskSaver(send, hooks());
    saver.save(desk('digital', 1));
    void saver.flush();
    saver.save(desk('analog', 2));
    await refuse(0, failure(502));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(calls.map((c) => c.desk)).toEqual([desk('digital', 1), desk('analog', 2)]);
  });

  it('a desk the brain refuses (400) is dropped, with the one warning', async () => {
    const { send, calls, refuse } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    saver.save(desk('digital', 1));
    void saver.flush();
    await refuse(0, failure(400, { error: 'homeDesk (a v1 desk) required' }));
    expect(h.onFailed).toHaveBeenCalledTimes(1);
    expect(saver.busy).toBe(false);
    await saver.flush();
    expect(calls).toHaveLength(1);
  });

  it('a desk carried up from this browser is sent from version 0', async () => {
    const { send, calls, land } = sender();
    const h = hooks();
    const saver = createDeskSaver(send, h);
    expect(saver.read({ homeDesk: null, version: 0 })).toBe(true);
    saver.save(desk('analog', 4));
    void saver.flush();
    expect(calls.map((c) => [c.desk, c.version])).toEqual([[desk('analog', 4), 0]]);
    await land(0);
    expect(h.onSaved).toHaveBeenCalledWith(stateOf(desk('analog', 4), 1));
  });

  it('shows a read only when nothing is on its way and it is not older than what it knows', async () => {
    const { send, land } = sender();
    const saver = createDeskSaver(send, hooks());
    expect(saver.read(stateOf(desk('digital'), 2))).toBe(true);
    // A change waits: a read (even a newer one) would undo it on screen.
    saver.save(desk('analog'));
    expect(saver.read(stateOf(desk('digital'), 3))).toBe(false);
    void saver.flush();
    expect(saver.read(stateOf(desk('digital'), 3))).toBe(false);
    await land(0);
    expect(saver.version).toBe(3);
    // A read that left before the save landed answers the older version.
    expect(saver.read(stateOf(desk('digital'), 2))).toBe(false);
    expect(saver.version).toBe(3);
    // Another device saved since: shown, and its version taken.
    expect(saver.read(stateOf(desk('digital', 5), 4))).toBe(true);
    expect(saver.version).toBe(4);
  });
});
