/**
 * The turn safety poll: the durable message row is the truth, the live stream
 * is an optimisation.
 *
 * A non-blocking turn (202) normally settles on the stream's terminal `done` /
 * `error` event. That event can fail to arrive while the turn itself finishes
 * fine: a dropped reconnect, or an inspecting corporate proxy that holds a
 * `text/event-stream` response back for minutes (seen in the field, 2026-09:
 * the POST got its 202, the agent replied in seconds, and the stream completed
 * 6-13 minutes later, so the user saw nothing and cancelled). Short requests
 * pass such a proxy untouched, so a plain poll of the durable rows always works.
 *
 * So both the stream and this poll are announcers, and whichever reports a
 * terminal state first wins. No proxy detection, no setting: the poll is one
 * small request every few seconds, only while a turn is in flight.
 *
 * Pure and injectable on purpose (fetch + timers), so it is testable without a
 * browser and shareable between the dock and the /assistant page.
 */

/** The slice of an `assistant_messages` row the poll reads. */
export type SafetyPollRow = {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  createdAt: string;
  status?: 'pending' | 'complete' | 'failed';
  error?: string | null;
};

export type TurnRowHandle = {
  /** The exact outbound row id (from the stream's `turn-start`), when known. */
  outboundId?: string | null;
  /** ISO lower bound for this turn's rows, used when the id is unknown. */
  sinceIso: string;
};

/**
 * Find THIS turn's outbound row in a page of rows.
 *
 * Prefer the exact id. Without it, pair by order instead of trusting the time
 * bound alone: take the OLDEST inbound row at/after `sinceIso` (this turn's user
 * message) and return the first outbound row at/after it. The bound carries a
 * safety margin, so the previous turn's reply can fall inside it; that reply
 * was written BEFORE this turn's inbound row, so pairing excludes it and a
 * finished older reply is never mistaken for this turn's.
 */
export function findTurnOutboundRow(
  rows: readonly SafetyPollRow[],
  handle: TurnRowHandle,
): SafetyPollRow | undefined {
  if (handle.outboundId) {
    return rows.find((m) => m.id === handle.outboundId && m.direction === 'outbound');
  }
  const asc = rows
    .filter((m) => m.createdAt >= handle.sinceIso)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const inboundAt = asc.findIndex((m) => m.direction === 'inbound');
  if (inboundAt < 0) return undefined;
  return asc.slice(inboundAt).find((m) => m.direction === 'outbound');
}

/**
 * The lower time bound for a turn's rows, in the SERVER's clock when possible.
 *
 * `createdAt` is stamped by the server, so comparing it with the client clock
 * breaks under skew (a client running ahead never matches; one running behind
 * can match older rows). The 202's `Date` header is the server's "now"; subtract
 * how long ago the turn was first sent plus a margin. `Date` is not readable
 * cross-origin unless exposed, so a detached client falls back to its own clock.
 */
export function turnSinceIso(opts: {
  /** `Date` response header of the turn ack, if readable. */
  serverDateHeader: string | null | undefined;
  /** Client ms when the turn was FIRST sent (not the re-attach attempt). */
  firstSentAtMs: number;
  /** Client ms now. */
  nowMs: number;
  marginMs?: number;
}): string {
  const margin = opts.marginMs ?? 2000;
  const elapsed = Math.max(0, opts.nowMs - opts.firstSentAtMs);
  const serverNow = opts.serverDateHeader ? Date.parse(opts.serverDateHeader) : Number.NaN;
  const base = Number.isFinite(serverNow) ? serverNow - elapsed : opts.firstSentAtMs;
  return new Date(base - margin).toISOString();
}

export type TurnSafetyPollOptions = {
  /** Fetch the newest page of rows for the turn's agent thread. */
  fetchRows: () => Promise<readonly SafetyPollRow[]>;
  /** Read the outbound id lazily: the stream may learn it after the poll starts. */
  getOutboundId: () => string | null | undefined;
  sinceIso: string;
  /** The row reached `complete`. Called at most once; the poll stops itself. */
  onComplete: (row: SafetyPollRow) => void;
  /** The row reached `failed`. Called at most once; the poll stops itself. */
  onFailed: (row: SafetyPollRow) => void;
  /**
   * Asked after every non-terminal tick. Return true to stop waiting (e.g. the
   * stream is dead AND the turn has run past any sane bound); `onGiveUp` then
   * fires once. Omit to poll until stopped.
   */
  shouldGiveUp?: () => boolean;
  onGiveUp?: () => void;
  /** Tick cadence. The first tick is one interval in: the stream usually wins. */
  intervalMs?: number;
  /**
   * A cadence that changes over time, for the poll that IS the reply (a login
   * without the live stream). The interval then only wakes the poll every
   * SCHEDULED_POLL_WAKE_MS; a fetch runs when `delayMs` says one is due, never
   * while `isHidden()` (a hidden tab asks nothing), and later after failures.
   */
  schedule?: PollSchedule;
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
};

export type PollSchedule = {
  /** ms from a fetch to the next, by how long the poll has run and how many
   *  fetches in a row failed. */
  delayMs: (elapsedMs: number, failures: number) => number;
  /** True while no fetch should run (document.hidden). */
  isHidden?: () => boolean;
  /** The clock, injectable for tests. */
  now?: () => number;
};

export const TURN_SAFETY_POLL_MS = 3000;

/** How often a scheduled poll wakes to see whether a fetch is due. */
export const SCHEDULED_POLL_WAKE_MS = 1000;

/** The reply poll of a login without the live stream: every 3 s for the
 *  first minute, every 10 s after, doubling per failed fetch in a row up to
 *  one minute. */
export const REPLY_POLL_FAST_MS = 3000;
export const REPLY_POLL_SLOW_MS = 10_000;
export const REPLY_POLL_FAST_FOR_MS = 60_000;
export const REPLY_POLL_MAX_MS = 60_000;

export function replyPollDelayMs(elapsedMs: number, failures: number): number {
  const base = elapsedMs < REPLY_POLL_FAST_FOR_MS ? REPLY_POLL_FAST_MS : REPLY_POLL_SLOW_MS;
  if (failures <= 0) return base;
  return Math.min(REPLY_POLL_MAX_MS, base * 2 ** Math.min(failures, 5));
}

/**
 * Start polling. Returns a disposer; safe to call more than once. Ticks never
 * overlap (a slow fetch skips the next tick instead of stacking requests), a
 * failed fetch is retried on the next tick, and nothing fires after `stop()`.
 */
export function startTurnSafetyPoll(opts: TurnSafetyPollOptions): () => void {
  const timers = opts.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  let stopped = false;
  let inFlight = false;
  let handle: unknown = null;
  const schedule = opts.schedule;
  const now = schedule?.now ?? (() => Date.now());
  const startedAt = now();
  let failures = 0;
  let nextAt = schedule ? startedAt + schedule.delayMs(0, 0) : 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    if (schedule && (schedule.isHidden?.() || now() < nextAt)) return;
    inFlight = true;
    try {
      const rows = await opts.fetchRows();
      failures = 0;
      if (stopped) return;
      const row = findTurnOutboundRow(rows, {
        outboundId: opts.getOutboundId(),
        sinceIso: opts.sinceIso,
      });
      if (row?.status === 'complete') {
        stop();
        opts.onComplete(row);
        return;
      }
      if (row?.status === 'failed') {
        stop();
        opts.onFailed(row);
        return;
      }
    } catch {
      /* transient: try again next tick (a scheduled poll backs off) */
      failures += 1;
    } finally {
      inFlight = false;
      if (schedule) nextAt = now() + schedule.delayMs(now() - startedAt, failures);
    }
    if (!stopped && opts.shouldGiveUp?.()) {
      stop();
      opts.onGiveUp?.();
    }
  };

  const every = schedule ? SCHEDULED_POLL_WAKE_MS : (opts.intervalMs ?? TURN_SAFETY_POLL_MS);
  handle = timers.setInterval(() => void tick(), every);
  return stop;
}

/**
 * What a transcript that is waiting on a non-blocking turn should do when the
 * dock reports a turn settled. The dock owns the only safety poll (one request
 * stream per turn, not one per mounted transcript), so the transcript reconciles
 * on the dock's verdict instead of polling again.
 *
 * Returns null when the signal is not for the turn this transcript is waiting
 * on: nothing pending, or a different turn's key. A signal without a key (an
 * older dock) is accepted, since a transcript only ever has one turn pending.
 */
export function verdictForSettled(
  pending: { idempotencyKey: string } | null,
  detail: { idempotencyKey?: string; status: 'done' | 'error' },
): 'done' | 'error' | null {
  if (!pending) return null;
  if (detail.idempotencyKey && detail.idempotencyKey !== pending.idempotencyKey) return null;
  return detail.status;
}
