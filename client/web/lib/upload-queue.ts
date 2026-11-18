/**
 * The upload dock's queue and its retry rules, free of React so they can be
 * unit-tested: which rows "Retry failed" sends again, how many files go at
 * once, and which failures heal by themselves with one automatic retry.
 */
import { UploadHttpError, UploadNetworkError } from './xhr-upload';

/** The fields of a dock row the retry rules read. */
export type RetryableRow = {
  id: string;
  status: string;
  /** False when the failure is final (refused as too large). */
  retryable?: boolean;
};

/** A row the user can send again: a failure that is not final. A name taken
 *  in the folder is a `conflict` (Replace), never an `error`. */
export function canRetryTask(t: RetryableRow): boolean {
  return t.status === 'error' && t.retryable !== false;
}

/** The rows "Retry failed" sends again, in list order. */
export function retryableIds(tasks: readonly RetryableRow[]): string[] {
  return tasks.filter(canRetryTask).map((t) => t.id);
}

/** How long a failed upload waits before its one automatic retry. */
export const AUTO_RETRY_DELAY_MS = 3000;

/** The gateway's own answers when its link to the brain drops mid-request. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * The wait before an automatic retry, or null for none. Only a dropped
 * connection (or the gateway saying it lost the brain) is retried, and only
 * once: a refusal, a conflict, a stall, a cancel or a second drop stays on
 * the row for the user. A resend is safe: if the first copy did land, the
 * resend meets the name clash and the row reads "already there".
 */
export function autoRetryDelayMs(err: unknown, attempts: number): number | null {
  if (attempts > 0) return null;
  if (err instanceof UploadNetworkError) return AUTO_RETRY_DELAY_MS;
  if (err instanceof UploadHttpError && GATEWAY_STATUSES.has(err.status)) {
    return AUTO_RETRY_DELAY_MS;
  }
  return null;
}

/**
 * Let a send's controller go when that send ends, but only while it is still
 * that send's. An Override (or its batch's Override rule) starts the next
 * send of the same row from inside the old send's catch, at once when a slot
 * is free; wiping the controller then left Cancel with nothing to abort.
 */
export function releaseController(
  entry: { controller?: AbortController },
  mine: AbortController,
): void {
  if (entry.controller === mine) entry.controller = undefined;
}

export type UploadQueue = {
  /** Queue ids at the back (or the front), then start as many as the limit allows. */
  push: (ids: readonly string[], opts?: { front?: boolean }) => void;
  /** Start nothing new until every hold is released. Running uploads go on. */
  hold: () => void;
  release: () => void;
  /** Take a queued id out before it starts; a running one is not touched. */
  drop: (id: string) => void;
  /** Whether the id waits in the queue. */
  has: (id: string) => boolean;
  readonly running: number;
  readonly queued: number;
  readonly held: boolean;
};

/**
 * A FIFO that runs at most `limit` uploads at once. A slot frees when the
 * promise `start` returns settles, whichever way it settles. While held (a
 * dropped connection waits out its back-off) nothing new starts, so the rest
 * of a batch does not fail into the same outage one file after another.
 */
export function createUploadQueue(
  limit: number,
  start: (id: string) => Promise<void>,
): UploadQueue {
  let waiting: string[] = [];
  let running = 0;
  let holds = 0;

  const settle = () => {
    running = Math.max(0, running - 1);
    pump();
  };
  const pump = () => {
    while (holds === 0 && running < limit && waiting.length > 0) {
      const id = waiting.shift()!;
      running++;
      let p: Promise<void>;
      try {
        p = start(id);
      } catch (err) {
        p = Promise.reject(err);
      }
      p.then(settle, settle);
    }
  };

  return {
    push(ids, opts) {
      if (opts?.front) waiting.unshift(...ids);
      else waiting.push(...ids);
      pump();
    },
    hold() {
      holds++;
    },
    release() {
      holds = Math.max(0, holds - 1);
      pump();
    },
    drop(id) {
      waiting = waiting.filter((q) => q !== id);
    },
    has(id) {
      return waiting.includes(id);
    },
    get running() {
      return running;
    },
    get queued() {
      return waiting.length;
    },
    get held() {
      return holds > 0;
    },
  };
}
