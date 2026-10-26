/**
 * Saving the Home desk to the login's profile (PUT /api/profile/home-desk):
 * the debounce, the flush on the way out, and what a failed save does. Pure:
 * no React and no storage, so the rules are unit-tested
 * (home-desk-saver.test.ts); `useDeskPrefs` (components/home/desk/desk-data)
 * holds one per mount.
 *
 * - A change is saved SAVE_DELAY_MS after the last one: a drag or a resize
 *   is many changes and one save. `flush` sends what is waiting now (leaving
 *   Home, the tab hidden or closed: `keepalive`, so the request outlives the
 *   page).
 * - A refusal (401 or 403: a brain that does not let this login save its
 *   desk) stops the saver for good. `onRefused` is called once, and the hook
 *   keeps the desk in this browser's storage for the rest of the visit, with
 *   no toast.
 * - Any other failure (offline, a 5xx) calls `onFailed` once, not once a
 *   save: the next save that lands arms it again. Each save carries the
 *   whole desk, so the next change saves everything a failed one missed.
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

/** Send one desk. Rejects with the error the API client throws (its
 *  `status` names a refusal). */
export type DeskSend = (desk: DeskPrefs, opts: { keepalive: boolean }) => Promise<unknown>;

export type DeskSaverHooks = {
  /** The brain refused a save (401 or 403). Called once; the saver is
   *  stopped from then on. */
  onRefused: () => void;
  /** A save failed another way. Called once until a save lands again. */
  onFailed: () => void;
};

export type DeskSaver = {
  /** Wait SAVE_DELAY_MS for more changes, then send `desk`. */
  save: (desk: DeskPrefs) => void;
  /** Send what is waiting now, if anything. */
  flush: (opts?: { keepalive?: boolean }) => void;
  /** A desk is waiting to be sent. */
  readonly pending: boolean;
  /** The brain refused a save: nothing is sent any more. */
  readonly stopped: boolean;
  /** Whether coming back to the window should read the desk again first. */
  needsRefresh: (now: number) => boolean;
  /** The desk was just read (a refresh): the idle clock starts again. */
  synced: (now: number) => void;
};

/** The HTTP status of a failed request, when it names one. */
function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const s = (err as { status: unknown }).status;
  return typeof s === 'number' ? s : null;
}

export function createDeskSaver(
  send: DeskSend,
  hooks: DeskSaverHooks,
  delayMs: number = SAVE_DELAY_MS,
): DeskSaver {
  let pending: DeskPrefs | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let warned = false;
  let lastSync = Date.now();

  const flush = (opts: { keepalive?: boolean } = {}) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const desk = pending;
    pending = null;
    if (!desk || stopped) return;
    lastSync = Date.now();
    send(desk, { keepalive: opts.keepalive === true }).then(
      () => {
        warned = false;
      },
      (err: unknown) => {
        const status = statusOf(err);
        if (status === 401 || status === 403) {
          if (stopped) return;
          stopped = true;
          if (timer !== null) clearTimeout(timer);
          timer = null;
          pending = null;
          hooks.onRefused();
          return;
        }
        if (stopped || warned) return;
        warned = true;
        hooks.onFailed();
      },
    );
  };

  return {
    save(desk) {
      if (stopped) return;
      pending = desk;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => flush(), delayMs);
    },
    flush,
    get pending() {
      return pending !== null;
    },
    get stopped() {
      return stopped;
    },
    needsRefresh(now) {
      return !stopped && pending === null && now - lastSync >= DESK_REFRESH_AFTER_MS;
    },
    synced(now) {
      lastSync = now;
    },
  };
}
