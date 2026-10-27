/**
 * Saving the Desk to the login's profile (PUT /api/profile/home-desk
 * { homeDesk, version }), compare-and-set: the brain keeps a version beside
 * the desk and takes a save only while the version sent is the one it holds.
 * Pure: no React, no storage, no fetch, so the rules are unit-tested
 * (home-desk-saver.test.ts); `useDeskPrefs` (components/home/desk/desk-data)
 * holds one per brain and login for the page's life.
 *
 * - A change is saved SAVE_DELAY_MS after the last one: a drag or a resize is
 *   many changes and one save. `flush` sends what is waiting now; leaving the
 *   Desk, hiding or closing the tab sends it with `keepalive`, so the request
 *   outlives the page.
 * - One save in flight. A desk changed meanwhile waits, only the latest, and
 *   goes when the save in flight settles, with the version it answered.
 * - Each save carries the version of the last read or save that landed. A 409
 *   means another device saved first: its desk and version are adopted
 *   (`onConflict`), what was waiting here is dropped, and nothing is retried.
 * - 401 (the session is gone, on its way to sign-in): the saver stops for the
 *   visit. Any other failure (offline, a 5xx) calls `onFailed` once until a
 *   save lands again; each save carries the whole desk, so the next change
 *   saves what a failed one missed.
 * - A read of the desk (GET) is shown only when nothing is waiting or in
 *   flight and its version is not older than the one known here (`read`):
 *   a slow read that started before a save landed never brings back the desk
 *   that save replaced.
 */
import type { HomeDeskState } from './contract/home-desk';
import type { DeskPrefs } from './home-desk';

/** How long the desk waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** Send one desk with the version it was changed from. Resolves with the
 *  brain's answer; rejects with the error the API client throws (its
 *  `status`, and on a 409 its `body`: the stored desk and version). */
export type DeskSend = (
  desk: DeskPrefs,
  version: number,
  opts: { keepalive: boolean },
) => Promise<HomeDeskState>;

export type DeskSaverHooks = {
  /** A save landed: the brain's desk and its new version. */
  onSaved?: (state: HomeDeskState) => void;
  /** Another device saved first (409): its desk and version, now the
   *  saver's. Called once a conflict. */
  onConflict: (state: HomeDeskState) => void;
  /** A save failed another way. Called once until a save lands again. */
  onFailed: () => void;
};

export type DeskSaver = {
  /** Wait SAVE_DELAY_MS for more changes, then send `desk`. */
  save: (desk: DeskPrefs) => void;
  /** Send what is waiting now, if anything (after the save in flight).
   *  Resolves when nothing is waiting or in flight. Never rejects. */
  flush: (opts?: { keepalive?: boolean }) => Promise<void>;
  /** A read of the desk landed: whether to show it. True (and its version
   *  taken) when nothing is waiting or in flight and it is not older than
   *  the version known here. */
  read: (state: HomeDeskState) => boolean;
  /** The version the next save is sent with. */
  readonly version: number;
  /** A desk is waiting to be sent, or a save is on its way. */
  readonly busy: boolean;
  /** A 401: nothing is sent any more this visit. */
  readonly stopped: boolean;
};

/** The HTTP status of a failed request, when it names one. */
export function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const s = (err as { status: unknown }).status;
  return typeof s === 'number' ? s : null;
}

/** The stored desk and version a 409 names (the API client's `body`). */
export function conflictState(err: unknown): HomeDeskState | null {
  if (statusOf(err) !== 409 || typeof err !== 'object' || err === null) return null;
  const body = (err as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return null;
  const { homeDesk, version } = body as Record<string, unknown>;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return null;
  return {
    homeDesk:
      homeDesk && typeof homeDesk === 'object' ? (homeDesk as HomeDeskState['homeDesk']) : null,
    version,
  };
}

export function createDeskSaver(
  send: DeskSend,
  hooks: DeskSaverHooks,
  delayMs: number = SAVE_DELAY_MS,
): DeskSaver {
  let version = 0;
  // Changed, not yet sent (the timer is armed).
  let pending: DeskPrefs | null = null;
  // Flushed while a save was in flight: sent when it settles.
  let queued: { desk: DeskPrefs; keepalive: boolean } | null = null;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let warned = false;
  let idleWaiters: Array<() => void> = [];

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const drop = () => {
    clearTimer();
    pending = null;
    queued = null;
  };

  const wakeIfIdle = () => {
    if (inFlight || queued) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const fn of waiters) fn();
  };

  const sendNow = (desk: DeskPrefs, keepalive: boolean) => {
    inFlight = true;
    send(desk, version, { keepalive }).then(
      (state) => {
        version = state.version;
        warned = false;
        hooks.onSaved?.(state);
        settle();
      },
      (err: unknown) => {
        const status = statusOf(err);
        const theirs = conflictState(err);
        if (theirs) {
          // The other device won: its desk stands, ours is not retried.
          version = theirs.version;
          drop();
          hooks.onConflict(theirs);
        } else if (status === 401) {
          stopped = true;
          drop();
        } else if (!warned) {
          warned = true;
          hooks.onFailed();
        }
        settle();
      },
    );
  };

  const settle = () => {
    inFlight = false;
    const next = queued;
    queued = null;
    if (next && !stopped) sendNow(next.desk, next.keepalive);
    wakeIfIdle();
  };

  const flush = (opts: { keepalive?: boolean } = {}): Promise<void> => {
    clearTimer();
    const keepalive = opts.keepalive === true;
    const desk = pending;
    pending = null;
    if (desk && !stopped) {
      if (inFlight) queued = { desk, keepalive: keepalive || (queued?.keepalive ?? false) };
      else sendNow(desk, keepalive);
    } else if (keepalive && queued) {
      // On the way out: the desk waiting behind the save in flight goes
      // with keepalive when it settles.
      queued = { ...queued, keepalive: true };
    }
    if (!inFlight && !queued) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  };

  return {
    save(desk) {
      if (stopped) return;
      pending = desk;
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    read(state) {
      if (stopped || pending || inFlight || queued || state.version < version) return false;
      version = state.version;
      return true;
    },
    get version() {
      return version;
    },
    get busy() {
      return pending !== null || inFlight || queued !== null;
    },
    get stopped() {
      return stopped;
    },
  };
}
