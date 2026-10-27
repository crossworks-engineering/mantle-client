/**
 * Saving the Desk to the login's profile (PUT /api/profile/home-desk
 * { homeDesk, version, loginId }), compare-and-set: the brain keeps a
 * version beside the desk and takes a save only while the version sent is
 * the one it holds. Pure: no React, no storage, no fetch, so the rules are
 * unit-tested (home-desk-saver.test.ts); `useDeskPrefs`
 * (components/home/desk/desk-data) holds one per brain and login for the
 * page's life.
 *
 * - A change is saved SAVE_DELAY_MS after the last one: a drag or a resize is
 *   many changes and one save. `flush` sends what is waiting now (leaving
 *   the Desk, hiding or closing the tab); every save goes with keepalive
 *   (desk-data `putDesk`), so one on its way outlives the page.
 * - One save in flight. A desk changed meanwhile waits, only the latest, and
 *   goes when the save in flight settles, with the version it answered.
 * - Each save carries the version of the last read or save that landed. A
 *   409 means another device saved first: its desk and version are adopted
 *   (`onConflict`), what was waiting here is dropped, and nothing is
 *   retried.
 * - A save that fails on the way (offline, a 5xx, a 429) keeps its desk
 *   waiting, unless a newer change waits already: nothing is lost, and a
 *   read cannot replace it (`busy` stays true; a Desk opened again shows
 *   `latest`). It goes again with the next change or on `flush`; nothing
 *   retries on a timer. `onFailed` is called once until a save lands again.
 * - 401 (the session is gone) or 403 (the desk is another login's: the
 *   login in use changed in another tab): the saver stops for the visit
 *   (`onStopped`). Any other refusal (a 400: a desk the brain will not
 *   keep) drops that desk and calls `onFailed` the same way.
 * - A read of the desk (GET) is shown only when nothing is waiting or in
 *   flight and its version is not older than the one known here (`read`):
 *   a slow read that started before a save landed never brings back the desk
 *   that save replaced.
 */
import type { HomeDeskState } from '@mantle/client-types';
import type { DeskPrefs } from './home-desk';

/** How long the desk waits after the last change before saving it. */
export const SAVE_DELAY_MS = 800;

/** Send one desk with the version it was changed from. Resolves with the
 *  brain's answer; rejects with the error the API client throws (its
 *  `status`, and on a 409 its `body`: the stored desk and version). */
export type DeskSend = (desk: DeskPrefs, version: number) => Promise<HomeDeskState>;

export type DeskSaverHooks = {
  /** A save landed: the brain's desk and its new version. */
  onSaved?: (state: HomeDeskState) => void;
  /** Another device saved first (409): its desk and version, now the
   *  saver's. Called once a conflict. */
  onConflict: (state: HomeDeskState) => void;
  /** A save failed another way. Called once until a save lands again. */
  onFailed: () => void;
  /** A 401 or 403 stopped the saver (its status). Called once. */
  onStopped?: (status: number) => void;
};

export type DeskSaver = {
  /** Wait SAVE_DELAY_MS for more changes, then send `desk`. */
  save: (desk: DeskPrefs) => void;
  /** Send what is waiting now, if anything (after the save in flight).
   *  Resolves when nothing is in flight or about to be sent. Never
   *  rejects. */
  flush: () => Promise<void>;
  /** A read of the desk landed: whether to show it. True (and its version
   *  taken) when nothing is waiting or in flight and it is not older than
   *  the version known here. */
  read: (state: HomeDeskState) => boolean;
  /** The version the next save is sent with. */
  readonly version: number;
  /** A desk is waiting to be sent (or kept from a save that failed), or a
   *  save is on its way. */
  readonly busy: boolean;
  /** The newest desk not known to have landed (waiting, or on its way),
   *  for a Desk opened again meanwhile; null when there is none. */
  readonly latest: DeskPrefs | null;
  /** A 401 or 403: nothing is sent any more this visit. */
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

/** A failure that may pass: no answer (offline, the request cut), a 5xx, a
 *  429. Its desk is kept. */
function passing(status: number | null): boolean {
  return status === null || status >= 500 || status === 429;
}

export function createDeskSaver(
  send: DeskSend,
  hooks: DeskSaverHooks,
  delayMs: number = SAVE_DELAY_MS,
): DeskSaver {
  let version = 0;
  // Changed and not landed: a change (its timer may be armed), or the desk
  // of a save that failed.
  let waiting: DeskPrefs | null = null;
  // `waiting` goes as soon as the save in flight settles (flushed meanwhile).
  let sendWhenFree = false;
  let inFlight: DeskPrefs | null = null;
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
    waiting = null;
    sendWhenFree = false;
  };

  const warn = () => {
    if (warned) return;
    warned = true;
    hooks.onFailed();
  };

  const sendWaiting = () => {
    const sent = waiting!;
    waiting = null;
    sendWhenFree = false;
    inFlight = sent;
    send(sent, version).then(
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
        } else if (status === 401 || status === 403) {
          stopped = true;
          drop();
          hooks.onStopped?.(status);
        } else {
          // On the way (offline, a 5xx): the desk waits for the next change
          // or flush, unless a change made since waits already (it is
          // newer). Refused (a 400): it is not kept.
          if (passing(status) && !waiting) waiting = sent;
          warn();
        }
        settle();
      },
    );
  };

  const settle = () => {
    inFlight = null;
    if (!stopped && waiting && sendWhenFree) sendWaiting();
    if (inFlight) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const fn of waiters) fn();
  };

  const flush = (): Promise<void> => {
    clearTimer();
    if (waiting && !stopped) {
      if (inFlight) sendWhenFree = true;
      else sendWaiting();
    }
    if (!inFlight) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  };

  return {
    save(desk) {
      if (stopped) return;
      waiting = desk;
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    read(state) {
      if (stopped || waiting || inFlight || state.version < version) return false;
      version = state.version;
      return true;
    },
    get version() {
      return version;
    },
    get busy() {
      return waiting !== null || inFlight !== null;
    },
    get latest() {
      return waiting ?? inFlight;
    },
    get stopped() {
      return stopped;
    },
  };
}
