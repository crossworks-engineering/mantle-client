/**
 * Saving the Desk to the login's profile (PUT /api/profile/home-desk): the
 * debounce, the flush on the way out, what a failed save does, and which
 * reads of the desk may still be shown. Pure: no React and no storage, so
 * the rules are unit-tested (home-desk-saver.test.ts); `useDeskPrefs`
 * (components/home/desk/desk-data) holds one per page.
 *
 * - A change is saved SAVE_DELAY_MS after the last one: a drag or a resize
 *   is many changes and one save. `flush` sends what is waiting now (leaving
 *   the Desk, the tab hidden or closed: `keepalive`, so the request outlives
 *   the page), and resolves once the saver is idle, so the session switch
 *   and the 401 bounce (web-ui session-flush, capped at a second) wait for
 *   the save before the login changes.
 * - One save in flight at a time. A desk flushed while one is in flight
 *   waits for it, and only the latest waits: two saves never race, so an
 *   older desk can never land after a newer one. Except on the way out: a
 *   `keepalive` flush sends at once, beside the save in flight, since a desk
 *   left waiting would die with the page.
 * - A desk is sent only as the login it was changed as (`hooks.session`,
 *   read at `save`): one waiting while the login changed (a switch, another
 *   tab) is dropped, never sent with the next login's credential.
 * - A refusal stops the saver for good: `onRefused` is called once with the
 *   status. 403 (a brain that does not let this login save its desk): the
 *   hook keeps the desk in this browser's storage for the rest of the visit,
 *   with no toast. 401 (the session expired, on its way to sign-in): the hook
 *   writes nothing.
 * - Any other failure (offline, a 5xx) calls `onFailed` once, not once a
 *   save: the next save that lands arms it again. Each save carries the
 *   whole desk, so the next change saves everything a failed one missed.
 * - Every change bumps `gen`. A read of the desk (GET /api/shell) is only
 *   shown when it started with the saver idle and no change came since
 *   (`readStart`, `readFresh`): a slow read that started before a change, or
 *   while a save was on its way, holds the desk as it was and is dropped.
 * - A save replaces the whole desk on the profile, so the last save wins
 *   across devices. To keep a desk arranged on another device from being
 *   overwritten by a stale one here, the hook reads the desk again when the
 *   window comes back after DESK_REFRESH_AFTER_MS with nothing waiting
 *   (`needsRefresh`), before the person changes anything.
 */
import type { DeskPrefs } from './home-desk';

/** How long the desk waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** How long since the desk was last read or saved before coming back to the
 *  window reads it again. */
export const DESK_REFRESH_AFTER_MS = 5 * 60_000;

/** Send one desk. Resolves with the brain's answer; rejects with the error
 *  the API client throws (its `status` names a refusal). */
export type DeskSend = (desk: DeskPrefs, opts: { keepalive: boolean }) => Promise<unknown>;

/** How a save ended: the HTTP status (200 for one that landed), or null when
 *  no answer came (offline). */
export type DeskSaveOutcome = { status: number | null };

export type DeskSaverHooks = {
  /** The brain refused a save (401 or 403). Called once; the saver is
   *  stopped from then on. */
  onRefused: (status: 401 | 403) => void;
  /** A save failed another way. Called once until a save lands again. */
  onFailed: () => void;
  /** A save landed: the brain's answer, and the `gen` of the desk it
   *  carried (older than `gen` now: a change came since). */
  onSaved?: (answer: unknown, gen: number) => void;
  /** The login in use now. Read at each change and again before its desk is
   *  sent: a desk whose login is no longer the one in use is dropped (its
   *  waiters are told `status: null`). */
  session?: () => string | null;
};

export type DeskSaver = {
  /** Wait SAVE_DELAY_MS for more changes, then send `desk`. `onSettled`:
   *  told how the save that carried this desk (or a later one that replaced
   *  it before it was sent) ended. */
  save: (desk: DeskPrefs, onSettled?: (outcome: DeskSaveOutcome) => void) => void;
  /** Send what is waiting now, if anything (after the save in flight, or
   *  at once with `keepalive`). Resolves when the saver is idle: nothing in
   *  flight and nothing queued. Never rejects. */
  flush: (opts?: { keepalive?: boolean }) => Promise<void>;
  /** A desk is waiting to be sent. */
  readonly pending: boolean;
  /** A save is on its way to the brain. */
  readonly inFlight: boolean;
  /** The brain refused a save: nothing is sent any more. */
  readonly stopped: boolean;
  /** Changes so far: bumped by every `save`. */
  readonly gen: number;
  /** A read starts now: its token for `readFresh`, or null when the saver is
   *  not idle (a desk waiting or in flight), so the read cannot be shown. */
  readStart: () => number | null;
  /** Whether a read that started with `token` may be shown now. */
  readFresh: (token: number | null) => boolean;
  /** Whether coming back to the window should read the desk again first. */
  needsRefresh: (now: number) => boolean;
  /** The desk was just read (a refresh): the idle clock starts again. */
  synced: (now: number) => void;
};

/** Whether a shell read made at `readAt` is too old to lay the desk out
 *  from without reading it again (the Desk opened after a long while). */
export function shellReadIsOld(readAt: number, now: number): boolean {
  return now - readAt >= DESK_REFRESH_AFTER_MS;
}

/**
 * Whether the brain answered the move of this browser's desk up to the
 * profile, so it is never offered again: it landed (2xx), or it was refused
 * for good (400: not a desk the brain keeps; 403: this login may not save
 * it). No answer (offline), a 5xx or a 401 (the session expired, not a no
 * to the desk): offered again on a later visit.
 */
export function moveUpAnswered(status: number | null): boolean {
  if (status === null) return false;
  return (status >= 200 && status < 300) || status === 400 || status === 403;
}

/** The HTTP status of a failed request, when it names one. */
export function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const s = (err as { status: unknown }).status;
  return typeof s === 'number' ? s : null;
}

type Waiting = {
  desk: DeskPrefs;
  gen: number;
  keepalive: boolean;
  /** The login the change was made as (`hooks.session`). */
  session: string | null;
  settled: Array<(outcome: DeskSaveOutcome) => void>;
};

export function createDeskSaver(
  send: DeskSend,
  hooks: DeskSaverHooks,
  delayMs: number = SAVE_DELAY_MS,
): DeskSaver {
  // Armed by `save`, sent by `flush` (or the timer).
  let pending: Waiting | null = null;
  // Flushed while a save was in flight: sent when it settles.
  let queued: Waiting | null = null;
  // Saves on their way: one, or two when a keepalive flush went out beside it.
  let inFlight = 0;
  // Flushes waiting for the saver to go idle.
  let idleWaiters: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let warned = false;
  let gen = 0;
  let lastSync = Date.now();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** Join a newer desk onto one already waiting: the newer desk is sent,
   *  and everyone waiting on either is told how it went. */
  const join = (older: Waiting | null, newer: Waiting): Waiting =>
    older
      ? {
          ...newer,
          keepalive: older.keepalive || newer.keepalive,
          settled: [...older.settled, ...newer.settled],
        }
      : newer;

  const tell = (w: Waiting, outcome: DeskSaveOutcome) => {
    for (const fn of w.settled) fn(outcome);
  };

  const session = () => hooks.session?.() ?? null;

  const idle = () => inFlight === 0 && queued === null;

  const whenIdle = (): Promise<void> =>
    idle() ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));

  const wakeIfIdle = () => {
    if (!idle()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const fn of waiters) fn();
  };

  const sendNow = (w: Waiting) => {
    if (w.session !== session()) {
      // The login changed since this desk was changed: never sent as the
      // next one.
      tell(w, { status: null });
      return;
    }
    inFlight += 1;
    lastSync = Date.now();
    send(w.desk, { keepalive: w.keepalive }).then(
      (answer) => {
        warned = false;
        tell(w, { status: 200 });
        hooks.onSaved?.(answer, w.gen);
        settle();
      },
      (err: unknown) => {
        const status = statusOf(err);
        tell(w, { status });
        if (status === 401 || status === 403) {
          if (!stopped) {
            stopped = true;
            clearTimer();
            if (pending) tell(pending, { status });
            if (queued) tell(queued, { status });
            pending = null;
            queued = null;
            hooks.onRefused(status);
          }
        } else if (!stopped && !warned) {
          warned = true;
          hooks.onFailed();
        }
        settle();
      },
    );
  };

  const settle = () => {
    inFlight -= 1;
    if (inFlight === 0 && queued) {
      const next = queued;
      queued = null;
      if (!stopped) sendNow(next);
    }
    wakeIfIdle();
  };

  const flush = (opts: { keepalive?: boolean } = {}) => {
    clearTimer();
    const keepalive = opts.keepalive === true;
    const w = pending;
    pending = null;
    if (!stopped) {
      if (w && inFlight > 0 && !keepalive) {
        queued = join(queued, w);
      } else if (w || keepalive) {
        // On the way out a queued desk goes too: the page may not outlive
        // the save in flight.
        const out = w ? join(queued, w) : queued;
        queued = null;
        if (out) sendNow({ ...out, keepalive: out.keepalive || keepalive });
      }
    }
    return whenIdle();
  };

  return {
    save(desk, onSettled) {
      if (stopped) return;
      gen += 1;
      pending = join(pending, {
        desk,
        gen,
        keepalive: false,
        session: session(),
        settled: onSettled ? [onSettled] : [],
      });
      clearTimer();
      timer = setTimeout(() => flush(), delayMs);
    },
    flush,
    get pending() {
      return pending !== null || queued !== null;
    },
    get inFlight() {
      return inFlight > 0;
    },
    get stopped() {
      return stopped;
    },
    get gen() {
      return gen;
    },
    readStart() {
      return pending === null && idle() ? gen : null;
    },
    readFresh(token) {
      return token !== null && token === gen && !stopped && pending === null && idle();
    },
    needsRefresh(now) {
      return !stopped && pending === null && idle() && now - lastSync >= DESK_REFRESH_AFTER_MS;
    },
    synced(now) {
      lastSync = now;
    },
  };
}
