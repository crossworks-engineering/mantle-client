'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@mantle/web-ui/lib/utils';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Button } from '@mantle/web-ui/ui/button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import {
  CLASH_DETAIL,
  aggregateProgress,
  clashVerdict,
  sha256Hex,
  storedFilename,
  formatBytes,
  formatEta,
  formatRate,
  overLimitMessage,
  progressTicker,
  spreadsheetHint,
  refreshAfterUpload,
  uploadForm,
} from '@/lib/upload-progress';
import type { AggregateProgress, ClashVerdict } from '@/lib/upload-progress';
import { UploadAbortedError, UploadHttpError, xhrUploadToBrain } from '@/lib/xhr-upload';
import {
  autoRetryDelayMs,
  canRetryTask,
  createUploadQueue,
  retryableIds,
} from '@/lib/upload-queue';
import type { UploadQueue } from '@/lib/upload-queue';
import {
  ALREADY_HERE,
  LOCKED_NOTE,
  SKIPPED_NOTE,
  answerClash as settleClash,
  clashStep,
  moreInBatch,
  readNameRefusal,
  readUploadAnswer,
} from '@/lib/upload-clash';
import type { BatchRule, ClashAnswer, WaitingClash } from '@/lib/upload-clash';
import { UploadClashPrompt } from './upload-clash-prompt';
import { useNoAutoTables } from '@/components/workspaces/use-shell-workspaces';
import { uploadBatchSound } from '@/lib/sounds/events';
import { play } from '@/lib/sounds/play';
import { useUploadWhere } from './use-upload-where';

/**
 * App-wide background file uploader. Lives in the persistent app shell so a
 * drop on /files keeps uploading while you navigate anywhere else in Mantle.
 * Uploads run with bounded concurrency, continue past individual failures,
 * and surface progress in a floating dock. A `beforeunload` guard covers the
 * one case an in-tab manager can't survive: a full reload / tab close.
 *
 * Progress is by BYTES (XMLHttpRequest, see lib/xhr-upload), with speed and
 * time left, a size check against the server's cap BEFORE a byte is sent, a
 * stall watchdog, cancel, and retry. The old fetch-based loop showed one
 * spinner and a bar that counted finished files: a single 250 MB upload sat
 * at 0% for half an hour and then said nothing when it died.
 *
 * Each successful POST creates a `file` node → `node_ingested` → the realtime
 * layer refreshes /files live, so the manager never has to cross-talk to it.
 */
/** `exists`: the name was taken by a file with the same bytes, so it is
 *  already uploaded. `conflict`: a different version holds the name and the
 *  brain kept it; this file was not saved. */
export type UploadStatus =
  'pending' | 'uploading' | 'done' | 'exists' | 'conflict' | 'error' | 'cancelled';

export type UploadTask = {
  id: string;
  name: string;
  parentPath: string;
  status: UploadStatus;
  size: number;
  loaded: number;
  /** Smoothed bytes/s while uploading; null before the first sample. */
  rate: number | null;
  error?: string;
  /** What a name clash turned out to be (`exists` and `conflict`). */
  note?: string;
  /** False when the failure is final (refused as too large): retry is pointless. */
  retryable?: boolean;
  /** Pending again after a dropped connection: its one automatic retry. */
  retrying?: boolean;
  /** Paused on a name taken by other bytes: the clash prompt asks. */
  asking?: boolean;
};

type UploadApi = {
  tasks: UploadTask[];
  active: boolean;
  /** The server's per-file cap (from /api/shell); null until known. */
  maxUploadBytes: number | null;
  setMaxUploadBytes: (bytes: number | null) => void;
  enqueue: (input: FileList | File[], parentPath: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  /** Send every failed row that can be retried again, through the same queue. */
  retryAll: () => void;
  /** Send a `conflict` upload again, over the different version. */
  replace: (id: string) => void;
  clearFinished: () => void;
  /** The name clash the prompt asks about now, and how many more of its
   *  batch wait behind it. */
  clash: WaitingClash | null;
  clashMore: number;
  /** The person's answer to `clash` (Escape or close is `skip`). */
  answerClash: (answer: ClashAnswer) => void;
};

const UploadContext = createContext<UploadApi | null>(null);

/** How many files upload at once. Sequential was slow for a 20-file batch. */
const CONCURRENCY = 3;
/** What an old server (no `maxUploadBytes` in /api/shell) accepts. */
const LEGACY_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * A 409 with no reason: a brain before file history refuses any taken name,
 * and a newer one a name the login may not change. Look at the file that
 * holds the name: the same bytes mean the upload is already done; other
 * bytes mean a different version stays there. Null when the folder could
 * not be read.
 */
async function checkClash(file: File, parentPath: string): Promise<ClashVerdict | null> {
  try {
    const { files } = await apiFetch<{
      files: Array<{ filename?: string; sizeBytes?: number; sha256?: string | null }>;
    }>(`/api/files/files?parent=${encodeURIComponent(parentPath)}`);
    const name = storedFilename(file.name);
    const row = files.find((f) => f.filename === name);
    const stored =
      row && typeof row.sizeBytes === 'number'
        ? { sizeBytes: row.sizeBytes, sha256: row.sha256 ?? null }
        : undefined;
    // Hash only when it can decide: equal sizes and a fingerprint to match.
    const sha256 = stored?.sha256 && stored.sizeBytes === file.size ? await sha256Hex(file) : null;
    return clashVerdict({ size: file.size, sha256 }, stored);
  } catch {
    return null;
  }
}

type Pending = {
  file: File;
  parentPath: string;
  /** Write over the file of the same name (the Replace on a conflict). */
  replace?: boolean;
  controller?: AbortController;
  /** Automatic retries used since the last send the user asked for. */
  autoRetries?: number;
  /** The enqueue it came in with: an "...all" clash answer holds for it. */
  batch: string;
};

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  // The rendered tasks, for callbacks that must not read state through an
  // updater (see clearFinished).
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  const limitRef = useRef<number | null>(null);
  limitRef.current = maxUploadBytes;
  const pendingRef = useRef(new Map<string, Pending>());
  const idRef = useRef(0);
  const batchSeqRef = useRef(0);
  // Name clashes waiting for the person, first one asked. The ref is the
  // truth (read and written at once); the state mirrors it for render.
  const clashesRef = useRef<WaitingClash[]>([]);
  const [clashes, setClashes] = useState<WaitingClash[]>([]);
  const setWaiting = useCallback((w: WaitingClash[]) => {
    clashesRef.current = w;
    setClashes(w);
  }, []);
  // An "...all" answer, per batch.
  const rulesRef = useRef(new Map<string, BatchRule>());
  const uploadOneRef = useRef<(id: string) => Promise<void>>(undefined);
  // At most CONCURRENCY at once. Calls the latest uploader through a ref, so
  // the queue is made once and the uploader can change every render.
  const [queue] = useState<UploadQueue>(() =>
    createUploadQueue(CONCURRENCY, async (id) => uploadOneRef.current?.(id)),
  );
  // Rows waiting out the back-off before their automatic retry.
  const retryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const toast = useToast();
  const queryClient = useQueryClient();

  const update = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    const timers = retryTimersRef.current;
    return () => {
      unmountedRef.current = true;
      for (const t of timers.values()) {
        clearTimeout(t);
        queue.release();
      }
      timers.clear();
    };
  }, [queue]);

  /**
   * Queue a row again after the back-off, at the front. The queue starts
   * nothing new while a back-off runs: a drop is often the whole link, and the
   * next files would fail into it too. A cancel in the meantime wins.
   */
  const scheduleAutoRetry = useCallback(
    (id: string, delay: number) => {
      if (unmountedRef.current) return;
      queue.hold();
      const timer = setTimeout(() => {
        retryTimersRef.current.delete(id);
        const entry = pendingRef.current.get(id);
        if (entry && !entry.controller && !queue.has(id)) queue.push([id], { front: true });
        queue.release();
      }, delay);
      retryTimersRef.current.set(id, timer);
    },
    [queue],
  );

  /** Settle clashes: Override sends the rows again with replace=true, at
   *  the front of the queue; Skip leaves them as `conflict` rows, where the
   *  dock still offers Replace. */
  const settleRef = useRef<(override: string[], skip: string[]) => void>(() => {});
  settleRef.current = (override, skip) => {
    const ready = override.filter((id) => pendingRef.current.has(id));
    for (const id of ready) {
      const entry = pendingRef.current.get(id)!;
      entry.replace = true;
      entry.autoRetries = 0;
      update(id, { status: 'pending', loaded: 0, rate: null, asking: undefined, note: undefined });
    }
    if (ready.length > 0) queue.push(ready, { front: true });
    for (const id of skip) {
      if (!pendingRef.current.has(id)) continue;
      update(id, {
        status: 'conflict',
        rate: null,
        asking: undefined,
        retryable: true,
        note: SKIPPED_NOTE,
      });
    }
  };

  const answerClash = useCallback(
    (answer: ClashAnswer) => {
      const out = settleClash(clashesRef.current, answer);
      if (out.rule) rulesRef.current.set(out.rule.batch, out.rule.rule);
      setWaiting(out.waiting);
      settleRef.current(out.override, out.skip);
    },
    [setWaiting],
  );

  uploadOneRef.current = async (id: string) => {
    const entry = pendingRef.current.get(id);
    if (!entry) return;
    const controller = new AbortController();
    entry.controller = controller;
    update(id, {
      status: 'uploading',
      loaded: 0,
      rate: null,
      error: undefined,
      retrying: undefined,
    });

    // Progress bookkeeping lives outside React state; state gets a throttled copy.
    const onProgress = progressTicker((loaded, rate) => update(id, { loaded, rate }));

    try {
      const form = uploadForm(entry.parentPath, entry.file, entry.replace === true);
      const answer = readUploadAnswer(
        await xhrUploadToBrain('/api/files/files', {
          form,
          signal: controller.signal,
          onProgress,
        }),
      );
      pendingRef.current.delete(id);
      if (answer.kind === 'already-here') {
        // The same bytes are there under that name: nothing was written.
        update(id, { status: 'exists', loaded: entry.file.size, rate: null, note: ALREADY_HERE });
        return;
      }
      update(id, { status: 'done', loaded: entry.file.size, rate: null });
      // Show it now: the realtime stream can be late or blocked.
      void refreshAfterUpload(queryClient);
    } catch (err) {
      const refusal =
        err instanceof UploadHttpError ? readNameRefusal(err.status, err.body) : null;
      if (err instanceof UploadAbortedError) {
        update(id, { status: 'cancelled', rate: null });
        pendingRef.current.delete(id);
      } else if (refusal?.kind === 'name-taken' && !entry.replace) {
        // Other bytes hold the name: the batch's "...all" answer, or ask.
        // The File stays in pendingRef for Override (and the dock's Replace).
        const step = clashStep(rulesRef.current.get(entry.batch));
        if (step === 'ask') {
          update(id, { status: 'pending', loaded: 0, rate: null, asking: true });
          setWaiting([
            ...clashesRef.current,
            {
              id,
              batch: entry.batch,
              name: entry.file.name,
              parentPath: entry.parentPath,
              size: entry.file.size,
              existing: refusal.existing,
            },
          ]);
        } else {
          settleRef.current(step === 'override' ? [id] : [], step === 'skip' ? [id] : []);
        }
      } else if (refusal) {
        // A name this login may not write over (or a brain before file
        // history). The same bytes there are still "Already here".
        const verdict = entry.replace ? null : await checkClash(entry.file, entry.parentPath);
        if (verdict === 'same' || verdict === 'same-size') {
          update(id, {
            status: 'exists',
            rate: null,
            loaded: entry.file.size,
            note: verdict === 'same' ? ALREADY_HERE : CLASH_DETAIL[verdict],
          });
        } else {
          update(id, { status: 'conflict', rate: null, retryable: false, note: LOCKED_NOTE });
        }
        pendingRef.current.delete(id);
      } else {
        const attempts = entry.autoRetries ?? 0;
        const delay = autoRetryDelayMs(err, attempts);
        if (delay !== null) {
          // A dropped connection: wait a moment, then send it once more. It
          // does not hold a slot while it waits.
          entry.autoRetries = attempts + 1;
          update(id, { status: 'pending', loaded: 0, rate: null, retrying: true });
          scheduleAutoRetry(id, delay);
        } else {
          // Keep the File so "retry" can resend it without a new picker round.
          update(id, {
            status: 'error',
            rate: null,
            error: err instanceof Error ? err.message : 'Upload failed.',
            retryable: true,
            retrying: undefined,
          });
        }
      }
    } finally {
      entry.controller = undefined;
    }
  };

  const enqueue = useCallback(
    (input: FileList | File[], parentPath: string) => {
      const files = Array.from(input).filter((f) => f.size > 0);
      if (files.length === 0) return;
      const limit = limitRef.current ?? LEGACY_LIMIT_BYTES;
      const batch = `b${batchSeqRef.current++}`;
      const fresh: UploadTask[] = [];
      const refused: string[] = [];
      const queued: string[] = [];
      for (const file of files) {
        const id = `u${idRef.current++}`;
        const base = {
          id,
          name: file.name,
          parentPath,
          size: file.size,
          loaded: 0,
          rate: null,
        };
        if (file.size > limit) {
          // Refused here, not by the server: no bytes leave the machine, and
          // the message carries both numbers instead of a bare "too large".
          fresh.push({
            ...base,
            status: 'error',
            error: overLimitMessage(file.size, limit),
            retryable: false,
          });
          refused.push(file.name);
          continue;
        }
        pendingRef.current.set(id, { file, parentPath, batch });
        queued.push(id);
        fresh.push({ ...base, status: 'pending' });
      }
      setTasks((ts) => [...ts, ...fresh]);
      queue.push(queued);
      if (refused.length > 0) {
        toast.error(
          refused.length === 1
            ? `${refused[0]} is over the ${formatBytes(limit)} upload limit.`
            : `${refused.length} files are over the ${formatBytes(limit)} upload limit.`,
        );
      }
    },
    [queue, toast],
  );

  const cancel = useCallback(
    (id: string) => {
      const entry = pendingRef.current.get(id);
      if (entry?.controller) {
        entry.controller.abort(); // the uploader marks it cancelled
        return;
      }
      // Still queued, waiting for its automatic retry, or for a clash
      // answer: pull it before it starts.
      queue.drop(id);
      if (clashesRef.current.some((c) => c.id === id)) {
        setWaiting(clashesRef.current.filter((c) => c.id !== id));
      }
      const timer = retryTimersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        retryTimersRef.current.delete(id);
        queue.release();
      }
      pendingRef.current.delete(id);
      update(id, { status: 'cancelled', retrying: undefined, asking: undefined });
    },
    [queue, update, setWaiting],
  );

  /** Send rows again through the queue: one state update, one push. Rows not
   *  idle (running, queued, waiting for an automatic retry) are skipped. */
  const requeue = useCallback(
    (ids: readonly string[]) => {
      const ready = ids.filter((id) => {
        const entry = pendingRef.current.get(id);
        return (
          entry !== undefined &&
          !entry.controller &&
          !queue.has(id) &&
          !retryTimersRef.current.has(id)
        );
      });
      if (ready.length === 0) return;
      // A send the user asked for gets its own automatic retry again.
      for (const id of ready) pendingRef.current.get(id)!.autoRetries = 0;
      const picked = new Set(ready);
      setTasks((ts) =>
        ts.map((t) =>
          picked.has(t.id)
            ? { ...t, status: 'pending', loaded: 0, rate: null, error: undefined }
            : t,
        ),
      );
      queue.push(ready);
    },
    [queue],
  );

  const retry = useCallback((id: string) => requeue([id]), [requeue]);

  // From the rendered rows, as clearFinished does: the rows on screen are the
  // ones the button counted.
  const retryAll = useCallback(() => requeue(retryableIds(tasksRef.current)), [requeue]);

  const replace = useCallback(
    (id: string) => {
      const entry = pendingRef.current.get(id);
      if (!entry || entry.controller || queue.has(id)) return;
      entry.replace = true;
      entry.autoRetries = 0;
      update(id, { status: 'pending', loaded: 0, rate: null, note: undefined });
      queue.push([id]);
    },
    [queue, update],
  );

  const clearFinished = useCallback(() => {
    // Drop the kept files of the rows being dismissed, OUTSIDE the state
    // updater: React may run an updater again on a later render, and a
    // delete in there then took the file of every row finished since (a
    // conflict's Replace, an error's Retry), leaving the button dead. Only
    // rows known to be finished: one enqueued since the last render stays.
    const finished = tasksRef.current.filter(
      (t) => t.status !== 'pending' && t.status !== 'uploading',
    );
    for (const t of finished) pendingRef.current.delete(t.id);
    const gone = new Set(finished.map((t) => t.id));
    setTasks((ts) => ts.filter((t) => !gone.has(t.id)));
  }, []);

  const active = useMemo(
    () => tasks.some((t) => t.status === 'pending' || t.status === 'uploading'),
    [tasks],
  );

  // One sound when a batch is through (none left to send), from the rows
  // that were in it: earlier, still-listed rows do not count again.
  const batchRef = useRef(new Set<string>());
  useEffect(() => {
    if (active) {
      for (const t of tasks) {
        if (t.status === 'pending' || t.status === 'uploading') batchRef.current.add(t.id);
      }
      return;
    }
    if (batchRef.current.size === 0) return;
    const batch = batchRef.current;
    batchRef.current = new Set();
    const kind = uploadBatchSound(tasks.filter((t) => batch.has(t.id)).map((t) => t.status));
    if (kind) play(kind);
  }, [active, tasks]);

  useUnloadGuard(active);

  const api = useMemo<UploadApi>(
    () => ({
      tasks,
      active,
      maxUploadBytes,
      setMaxUploadBytes,
      enqueue,
      cancel,
      retry,
      retryAll,
      replace,
      clearFinished,
      clash: clashes[0] ?? null,
      clashMore: moreInBatch(clashes),
      answerClash,
    }),
    [
      tasks,
      active,
      maxUploadBytes,
      enqueue,
      cancel,
      retry,
      retryAll,
      replace,
      clearFinished,
      clashes,
      answerClash,
    ],
  );

  return (
    <UploadContext.Provider value={api}>
      {children}
      <UploadClashPrompt clash={api.clash} clashMore={api.clashMore} answerClash={answerClash} />
    </UploadContext.Provider>
  );
}

export function useUploads(): UploadApi {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used inside <UploadProvider>');
  return ctx;
}

/**
 * Floating progress dock. Rendered inside the shell so it inherits the
 * `--activity-w` rail var (sits just left of the live-activity column on lg).
 * Hidden when there's nothing to show.
 *
 * ONE spinner (the title) and ONE progress bar with its numbers (the bottom
 * line). Rows carry a static icon, the name, and a short detail: bytes so far
 * for the file in flight, the size when done, the reason when not. The first
 * cut had a spinner, a bar and a percentage per row on top of the header's,
 * which read as three uploads for one file.
 */
export function UploadDock() {
  const { tasks, active, cancel, retry, retryAll, replace, clearFinished } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const noAutoTables = useNoAutoTables();
  // Each row says where it goes, by the folder titles the Files screen
  // loaded (a path segment where it has not).
  const whereOf = useUploadWhere();

  if (tasks.length === 0) return null;

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const exists = tasks.filter((t) => t.status === 'exists').length;
  const conflicts = tasks.filter((t) => t.status === 'conflict').length;
  const failed = tasks.filter((t) => t.status === 'error').length;
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
  const retryable = tasks.filter(canRetryTask).length;
  const finished = done + exists + conflicts + failed + cancelled;
  const agg = aggregateProgress(tasks);
  const hint = spreadsheetHint(tasks, noAutoTables);

  const heading = active
    ? `Uploading ${Math.min(finished + 1, total)} of ${total}`
    : finishedHeading({ done, exists, conflicts, failed, cancelled });

  return (
    <div className="pointer-events-auto w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
      <RowButton
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
      >
        {active ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary-ink" aria-hidden />
        ) : failed > 0 ? (
          <AlertCircle className="size-4 shrink-0 text-destructive-ink" aria-hidden />
        ) : conflicts > 0 ? (
          <AlertCircle className="size-4 shrink-0 text-warning-ink" aria-hidden />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-primary-ink" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{heading}</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            collapsed && '-rotate-90',
          )}
          aria-hidden
        />
      </RowButton>

      {!collapsed && (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto scrollbar-thin border-t border-border">
          {tasks.map((t) => (
            <UploadRow
              key={t.id}
              task={t}
              where={whereOf(t.parentPath)}
              onCancel={cancel}
              onRetry={retry}
              onReplace={replace}
            />
          ))}
        </ul>
      )}

      {!collapsed && hint && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{hint}</p>
      )}

      {active ? (
        <div className="border-t border-border">
          <UploadProgressBar progress={agg} />
        </div>
      ) : (
        <div className="flex justify-end gap-1 border-t border-border px-2 py-1.5">
          {retryable > 0 && (
            <RowButton
              onClick={retryAll}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Retry failed ({retryable})
            </RowButton>
          )}
          <RowButton
            onClick={clearFinished}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden /> Dismiss
          </RowButton>
        </div>
      )}
    </div>
  );
}

/** Guard against losing an upload under way to a reload or a tab close. */
export function useUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}

/** The one progress bar with its numbers: the dock's, and any other upload's. */
export function UploadProgressBar({ progress: p }: { progress: AggregateProgress }) {
  const line = [`${p.pct}%`, formatRate(p.rate), formatEta(p.etaSec)].filter(Boolean).join(' · ');
  return (
    <>
      <div
        className="h-1 w-full bg-muted"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.pct}
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${p.pct}%` }} />
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
        <span>{line}</span>
        <span>
          {formatBytes(p.loaded)} of {formatBytes(p.total)}
        </span>
      </div>
    </>
  );
}

/** The dock title once nothing is moving. Files already there count as
 *  uploaded; only a different version left in place is called out. */
export function finishedHeading(c: {
  done: number;
  exists: number;
  conflicts: number;
  failed: number;
  cancelled: number;
}): string {
  const uploaded = c.done + c.exists;
  const rest: string[] = [];
  if (c.exists > 0) rest.push(`${c.exists} already there`);
  if (c.conflicts > 0) rest.push(`${c.conflicts} not replaced`);
  if (c.failed > 0) rest.push(`${c.failed} failed`);
  if (c.cancelled > 0) rest.push(`${c.cancelled} cancelled`);
  // "Uploaded 0 files · 1 not replaced" read as a failure count; lead with
  // what did happen.
  if (uploaded === 0 && rest.length > 0) return rest.join(' · ');
  return [`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}`, ...rest].join(' · ');
}

function UploadRow({
  task: t,
  where,
  onCancel,
  onRetry,
  onReplace,
}: {
  task: UploadTask;
  /** The folder it goes to, as a breadcrumb line. */
  where: string;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onReplace: (id: string) => void;
}) {
  const detail =
    t.status === 'uploading'
      ? `${formatBytes(t.loaded)} of ${formatBytes(t.size)}`
      : t.status === 'pending'
        ? t.asking
          ? 'Name taken · waiting for your answer'
          : t.retrying
          ? 'Connection dropped · retrying'
          : `Waiting · ${formatBytes(t.size)}`
        : t.status === 'done'
          ? formatBytes(t.size)
          : t.status === 'exists' || t.status === 'conflict'
            ? (t.note ?? '')
            : t.status === 'cancelled'
              ? 'Cancelled'
              : (t.error ?? 'Upload failed.');
  const canCancel = t.status === 'pending' || t.status === 'uploading';
  const canRetry = canRetryTask(t);
  // `retryable` false on a conflict: a replace was refused already.
  const canReplace = t.status === 'conflict' && t.retryable !== false;

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-xs">
      {t.status === 'done' || t.status === 'exists' ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
      ) : t.status === 'conflict' || t.asking ? (
        <AlertCircle className="size-3.5 shrink-0 text-warning-ink" aria-hidden />
      ) : t.status === 'error' ? (
        <AlertCircle className="size-3.5 shrink-0 text-destructive-ink" aria-hidden />
      ) : t.status === 'cancelled' ? (
        <XCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <UploadCloud
          className={cn(
            'size-3.5 shrink-0',
            t.status === 'uploading' ? 'text-primary-ink' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={t.name}>
          {t.name}
        </span>
        <span className="truncate text-[11px] text-muted-foreground" title={`To ${where}`}>
          to {where}
        </span>
      </span>
      <span
        className={cn(
          'max-w-[45%] shrink-0 truncate',
          t.status === 'error'
            ? 'text-destructive-ink'
            : t.status === 'conflict'
              ? 'text-warning-ink'
              : 'text-muted-foreground',
        )}
        title={detail}
      >
        {detail}
      </span>
      {canCancel && (
        <Button
          variant="ghost"
          size="icon-2xs"
          type="button"
          onClick={() => onCancel(t.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Cancel ${t.name}`}
          title="Cancel"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      )}
      {canReplace && (
        <Button
          variant="ghost"
          size="2xs"
          type="button"
          onClick={() => onReplace(t.id)}
          className="shrink-0"
          aria-label={`Replace the version already here with ${t.name}`}
          title="Replace the version already here with this file"
        >
          Replace
        </Button>
      )}
      {canRetry && (
        <Button
          variant="ghost"
          size="icon-2xs"
          type="button"
          onClick={() => onRetry(t.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Retry ${t.name}`}
          title="Retry"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
      )}
    </li>
  );
}
