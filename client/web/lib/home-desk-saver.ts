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
 *   many changes and one save. `flush` sends what is waiting now.
 * - One save in flight. A desk changed meanwhile waits, only the latest, and
 *   goes when the save in flight settles, with the version it answered. On
 *   the way out (`flush({ leaving: true })`) it goes at once instead, sent
 *   from the version the save in flight will make: the page may not live to
 *   hear that save's answer. Should that save not land, the brain answers
 *   the early one with a 409 naming an older version than it was sent with:
 *   the desk then waits again, to go from the version the brain holds.
 * - Each save carries the version of the last read or save that landed. A 409
 *   naming another desk means another device saved first: its desk and
 *   version are adopted (`onConflict`), what was waiting here is dropped,
 *   and nothing is retried. A 409 naming a desk this saver sent (a save that
 *   landed though its answer was lost) is this saver's own: its version is
 *   taken and the desk waiting, if any, goes from it.
 * - A save that fails on the way (offline, a 5xx, a 429) keeps its desk
 *   waiting, unless a newer change waits already: nothing is lost, and a read
 *   cannot replace it (`busy` stays true). It goes again with the next
 *   change, on `flush`, and on `retry` (the browser back online); nothing
 *   retries on a timer. `onFailed` is called once until a save lands again.
 * - 401 (the session is gone, or the desk is another login's): the saver
 *   stops for the visit. Any other refusal (a 400: a desk the brain will not
 *   keep) drops that desk and calls `onFailed` the same way.
 * - A read of the desk (GET) is shown only when nothing is waiting or in
 *   flight and its version is not older than the one known here (`read`):
 *   a slow read that started before a save landed never brings back the desk
 *   that save replaced.
 */
import type { HomeDeskState } from './contract/home-desk';
import { deskToWire, type DeskPrefs } from './home-desk';

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
};

export type DeskSaver = {
  /** Wait SAVE_DELAY_MS for more changes, then send `desk`. */
  save: (desk: DeskPrefs) => void;
  /** Send what is waiting now, if anything: after the save in flight, or
   *  `leaving`, at once. Resolves when nothing is in flight or about to be
   *  sent. Never rejects. */
  flush: (opts?: { leaving?: boolean }) => Promise<void>;
  /** A save failed and its desk waits: send it now (the browser is back
   *  online). Nothing otherwise. */
  retry: () => void;
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

/** A failure that may pass: no answer (offline, the request cut), a 5xx, a
 *  429. Its desk is kept. */
function passing(status: number | null): boolean {
  return status === null || status >= 500 || status === 429;
}

/** Deep equality of two JSON values, key order aside. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const rb = b as Record<string, unknown>;
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => k in rb && sameJson((a as Record<string, unknown>)[k], rb[k]))
  );
}

/** A desk and the change it came from (later changes count higher). */
type Change = { desk: DeskPrefs; seq: number };
type Flight = Change & { version: number };

/** Desks sent whose answer was lost, kept to tell this saver's own landed
 *  save in a later 409; the last few are plenty. */
const UNSURE_MAX = 8;

export function createDeskSaver(
  send: DeskSend,
  hooks: DeskSaverHooks,
  delayMs: number = SAVE_DELAY_MS,
): DeskSaver {
  let version = 0;
  let seq = 0;
  // Changed and not landed: a change (its timer may be armed), or the desk
  // of a save that failed.
  let waiting: Change | null = null;
  // `waiting` goes as soon as no save is in flight (flushed meanwhile).
  let sendWhenFree = false;
  // `waiting` is the desk of a save that failed (`retry` sends it).
  let failed = false;
  const flights: Flight[] = [];
  let unsure: DeskPrefs[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let warned = false;
  let idleWaiters: Array<() => void> = [];

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** A desk sent and not landed waits again, unless a newer change does. */
  const keep = (f: Change) => {
    if (!waiting || waiting.seq < f.seq) waiting = { desk: f.desk, seq: f.seq };
  };

  const warn = () => {
    if (warned) return;
    warned = true;
    hooks.onFailed();
  };

  const idle = () => flights.length === 0 && !(sendWhenFree && waiting);

  const settle = () => {
    if (!stopped && waiting && sendWhenFree && flights.length === 0) sendWaiting(version);
    if (!idle()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const fn of waiters) fn();
  };

  const landed = (state: HomeDeskState) => {
    unsure = [];
    warned = false;
    // Two saves answered out of order: the older answer changes nothing.
    if (state.version < version) return;
    version = state.version;
    hooks.onSaved?.(state);
  };

  const sendWaiting = (from: number) => {
    const f: Flight = { ...waiting!, version: from };
    waiting = null;
    sendWhenFree = false;
    failed = false;
    flights.push(f);
    send(f.desk, f.version).then(
      (state) => {
        flights.splice(flights.indexOf(f), 1);
        landed(state);
        settle();
      },
      (err: unknown) => {
        flights.splice(flights.indexOf(f), 1);
        const status = statusOf(err);
        const theirs = conflictState(err);
        if (theirs && theirs.version < f.version) {
          // Sent ahead of a save that did not land (yet): nobody else saved.
          // The desk goes again from the version the brain holds.
          keep(f);
          sendWhenFree = true;
        } else if (
          theirs &&
          [f.desk, ...unsure].some((d) => sameJson(theirs.homeDesk, deskToWire(d)))
        ) {
          // A save of ours landed though its answer was lost: its version is
          // ours, and the desk changed since goes from it.
          if (theirs.version > version) {
            version = theirs.version;
            hooks.onSaved?.(theirs);
          }
          unsure = [];
          warned = false;
          if (!sameJson(theirs.homeDesk, deskToWire(f.desk))) {
            keep(f);
            sendWhenFree = true;
          }
        } else if (theirs) {
          // The other device won: its desk stands, ours is not retried.
          version = theirs.version;
          unsure = [];
          clearTimer();
          waiting = null;
          sendWhenFree = false;
          failed = false;
          hooks.onConflict(theirs);
        } else if (status === 401) {
          stopped = true;
          clearTimer();
          waiting = null;
          sendWhenFree = false;
        } else if (passing(status)) {
          // It may have landed: a later 409 naming it is ours.
          unsure = [...unsure, f.desk].slice(-UNSURE_MAX);
          if (!waiting || waiting.seq <= f.seq) failed = true;
          keep(f);
          warn();
        } else {
          // Refused (a 400): this desk is not kept, nothing sends it again.
          warn();
        }
        settle();
      },
    );
  };

  const flush = (opts: { leaving?: boolean } = {}): Promise<void> => {
    clearTimer();
    if (waiting && !stopped) {
      if (flights.length === 0) sendWaiting(version);
      else if (opts.leaving) {
        // The page may go before the save in flight answers: send now, from
        // the version that save makes.
        sendWaiting(Math.max(...flights.map((f) => f.version)) + 1);
      } else sendWhenFree = true;
    }
    if (idle()) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  };

  return {
    save(desk) {
      if (stopped) return;
      waiting = { desk, seq: ++seq };
      failed = false;
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    retry() {
      if (failed) void flush();
    },
    read(state) {
      if (stopped || waiting || flights.length > 0 || state.version < version) return false;
      version = state.version;
      return true;
    },
    get version() {
      return version;
    },
    get busy() {
      return waiting !== null || flights.length > 0;
    },
    get latest() {
      const newest = flights.reduce<Change | null>((a, f) => (a && a.seq > f.seq ? a : f), waiting);
      return newest?.desk ?? null;
    },
    get stopped() {
      return stopped;
    },
  };
}
