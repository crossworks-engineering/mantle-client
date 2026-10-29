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
import { cn } from '@mantle/web-ui/lib/utils';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Button } from '@mantle/web-ui/ui/button';
import { isCrossOrigin, runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { tokenStore } from '@mantle/web-ui/token-store';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import {
  CLASH_DETAIL,
  SHARED_UPLOAD_REFUSED,
  aggregateProgress,
  clashVerdict,
  isNameClash,
  sha256Hex,
  storedFilename,
  formatBytes,
  formatEta,
  formatRate,
  overLimitMessage,
  updateRate,
  uploadForm,
} from '@/lib/upload-progress';
import type { ClashVerdict } from '@/lib/upload-progress';
import { UploadAbortedError, UploadHttpError, xhrUpload } from '@/lib/xhr-upload';
import { withCreateWs } from '@/lib/create-workspace';
import { uploadBatchSound } from '@/lib/sounds/events';
import { play } from '@/lib/sounds/play';

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
};

type UploadApi = {
  tasks: UploadTask[];
  active: boolean;
  /** The server's per-file cap (from /api/shell); null until known. */
  maxUploadBytes: number | null;
  setMaxUploadBytes: (bytes: number | null) => void;
  /** `confirm`: the owner said yes to a folder shared with the team or
   *  clients (the brain refuses such an upload without it, 409). */
  enqueue: (input: FileList | File[], parentPath: string, opts?: { confirm?: boolean }) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  /** Send a `conflict` upload again, over the different version. */
  replace: (id: string) => void;
  clearFinished: () => void;
};

const UploadContext = createContext<UploadApi | null>(null);

/** How many files upload at once. Sequential was slow for a 20-file batch. */
const CONCURRENCY = 3;
/** Progress writes are throttled to this so a fast link does not re-render
 *  the dock hundreds of times a second. */
const PROGRESS_TICK_MS = 150;
/** What an old server (no `maxUploadBytes` in /api/shell) accepts. */
const LEGACY_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * The brain refuses an upload whose name is taken in the folder, whatever
 * its bytes. Look at the file that holds the name: the same bytes mean the
 * upload is already done; other bytes mean a different version stays there.
 * Null when the folder could not be read.
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
  /** A yes to a shared folder, kept for a retry. */
  confirm?: boolean;
  /** Write over the file of the same name (the Replace on a conflict). */
  replace?: boolean;
  controller?: AbortController;
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
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef(0);
  const idRef = useRef(0);
  const uploadOneRef = useRef<(id: string) => Promise<void>>(undefined);
  const toast = useToast();

  const update = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Start as many uploads as concurrency allows. Calls the latest uploader via
  // a ref so pump/uploadOne can reference each other without a render cycle.
  const pump = useCallback(() => {
    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const id = queueRef.current.shift()!;
      runningRef.current++;
      void uploadOneRef.current?.(id);
    }
  }, []);

  uploadOneRef.current = async (id: string) => {
    const entry = pendingRef.current.get(id);
    if (!entry) {
      runningRef.current = Math.max(0, runningRef.current - 1);
      pump();
      return;
    }
    const controller = new AbortController();
    entry.controller = controller;
    update(id, { status: 'uploading', loaded: 0, rate: null, error: undefined });

    // Progress bookkeeping lives outside React state; state gets a throttled copy.
    let lastLoaded = 0;
    let lastAt = performance.now();
    let rate: number | null = null;
    let lastWrite = 0;
    const onProgress = (loaded: number) => {
      const now = performance.now();
      rate = updateRate(rate, loaded - lastLoaded, now - lastAt);
      lastLoaded = loaded;
      lastAt = now;
      if (now - lastWrite < PROGRESS_TICK_MS && loaded < entry.file.size) return;
      lastWrite = now;
      update(id, { loaded, rate });
    };

    try {
      const form = uploadForm(
        entry.parentPath,
        entry.file,
        entry.confirm === true,
        entry.replace === true,
      );
      const token = tokenStore.get();
      await xhrUpload({
        url: `${runtimeApiBase()}${withCreateWs('/api/files/files')}`,
        form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        // Same rule as apiFetch: cookie on same-origin, bearer only across origins.
        withCredentials: !isCrossOrigin(),
        signal: controller.signal,
        onProgress,
      });
      update(id, { status: 'done', loaded: entry.file.size, rate: null });
      pendingRef.current.delete(id);
    } catch (err) {
      if (err instanceof UploadAbortedError) {
        update(id, { status: 'cancelled', rate: null });
        pendingRef.current.delete(id);
      } else if (err instanceof UploadHttpError && isNameClash(err.status, err.body)) {
        // Not a failure to retry: the name is taken. Say what holds it. A
        // replace refused the same way means a brain older than `replace`.
        const verdict = entry.replace ? null : await checkClash(entry.file, entry.parentPath);
        if (verdict === 'same' || verdict === 'same-size') {
          update(id, {
            status: 'exists',
            rate: null,
            loaded: entry.file.size,
            note: CLASH_DETAIL[verdict],
          });
          pendingRef.current.delete(id);
        } else {
          // The File stays in pendingRef so Replace can send it again.
          update(id, {
            status: 'conflict',
            rate: null,
            retryable: !entry.replace,
            note: entry.replace
              ? 'Not replaced: this brain cannot replace files yet'
              : verdict
                ? CLASH_DETAIL.different
                : 'A file with this name is already here, not replaced',
          });
        }
      } else {
        // A folder shared since the screen last looked: the yes is asked
        // for on the Files screen, not by a retry here.
        const unasked =
          err instanceof UploadHttpError && err.status === 409 && err.body?.error === 'visibility';
        // Keep the File so "retry" can resend it without a new picker round.
        update(id, {
          status: 'error',
          rate: null,
          error: unasked
            ? SHARED_UPLOAD_REFUSED
            : err instanceof Error
              ? err.message
              : 'Upload failed.',
          retryable: !unasked,
        });
        if (unasked) pendingRef.current.delete(id);
      }
    } finally {
      entry.controller = undefined;
      runningRef.current = Math.max(0, runningRef.current - 1);
      pump();
    }
  };

  const enqueue = useCallback(
    (input: FileList | File[], parentPath: string, opts: { confirm?: boolean } = {}) => {
      const files = Array.from(input).filter((f) => f.size > 0);
      if (files.length === 0) return;
      const limit = limitRef.current ?? LEGACY_LIMIT_BYTES;
      const fresh: UploadTask[] = [];
      const refused: string[] = [];
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
        pendingRef.current.set(id, { file, parentPath, confirm: opts.confirm });
        queueRef.current.push(id);
        fresh.push({ ...base, status: 'pending' });
      }
      setTasks((ts) => [...ts, ...fresh]);
      if (refused.length > 0) {
        toast.error(
          refused.length === 1
            ? `${refused[0]} is over the ${formatBytes(limit)} upload limit.`
            : `${refused.length} files are over the ${formatBytes(limit)} upload limit.`,
        );
      }
      pump();
    },
    [pump, toast],
  );

  const cancel = useCallback(
    (id: string) => {
      const entry = pendingRef.current.get(id);
      if (entry?.controller) {
        entry.controller.abort(); // the uploader marks it cancelled
        return;
      }
      // Still queued: pull it before it starts.
      queueRef.current = queueRef.current.filter((q) => q !== id);
      pendingRef.current.delete(id);
      update(id, { status: 'cancelled' });
    },
    [update],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = pendingRef.current.get(id);
      if (!entry || entry.controller) return;
      update(id, { status: 'pending', loaded: 0, rate: null, error: undefined });
      queueRef.current.push(id);
      pump();
    },
    [pump, update],
  );

  const replace = useCallback(
    (id: string) => {
      const entry = pendingRef.current.get(id);
      if (!entry || entry.controller) return;
      entry.replace = true;
      update(id, { status: 'pending', loaded: 0, rate: null, note: undefined });
      queueRef.current.push(id);
      pump();
    },
    [pump, update],
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

  // Guard against losing in-flight uploads to a reload / tab close.
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);

  const api = useMemo<UploadApi>(
    () => ({
      tasks,
      active,
      maxUploadBytes,
      setMaxUploadBytes,
      enqueue,
      cancel,
      retry,
      replace,
      clearFinished,
    }),
    [tasks, active, maxUploadBytes, enqueue, cancel, retry, replace, clearFinished],
  );

  return <UploadContext.Provider value={api}>{children}</UploadContext.Provider>;
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
  const { tasks, active, cancel, retry, replace, clearFinished } = useUploads();
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const exists = tasks.filter((t) => t.status === 'exists').length;
  const conflicts = tasks.filter((t) => t.status === 'conflict').length;
  const failed = tasks.filter((t) => t.status === 'error').length;
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
  const finished = done + exists + conflicts + failed + cancelled;
  const agg = aggregateProgress(tasks);

  const heading = active
    ? `Uploading ${Math.min(finished + 1, total)} of ${total}`
    : finishedHeading({ done, exists, conflicts, failed, cancelled });
  const progressLine = [`${agg.pct}%`, formatRate(agg.rate), formatEta(agg.etaSec)]
    .filter(Boolean)
    .join(' · ');

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
            <UploadRow key={t.id} task={t} onCancel={cancel} onRetry={retry} onReplace={replace} />
          ))}
        </ul>
      )}

      {active ? (
        <div className="border-t border-border">
          <div
            className="h-1 w-full bg-muted"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={agg.pct}
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${agg.pct}%` }} />
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
            <span>{progressLine}</span>
            <span>
              {formatBytes(agg.loaded)} of {formatBytes(agg.total)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex justify-end border-t border-border px-2 py-1.5">
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
  onCancel,
  onRetry,
  onReplace,
}: {
  task: UploadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onReplace: (id: string) => void;
}) {
  const detail =
    t.status === 'uploading'
      ? `${formatBytes(t.loaded)} of ${formatBytes(t.size)}`
      : t.status === 'pending'
        ? `Waiting · ${formatBytes(t.size)}`
        : t.status === 'done'
          ? formatBytes(t.size)
          : t.status === 'exists' || t.status === 'conflict'
            ? (t.note ?? '')
            : t.status === 'cancelled'
              ? 'Cancelled'
              : (t.error ?? 'Upload failed.');
  const canCancel = t.status === 'pending' || t.status === 'uploading';
  const canRetry = t.status === 'error' && t.retryable !== false;
  // `retryable` false on a conflict: a replace was refused already.
  const canReplace = t.status === 'conflict' && t.retryable !== false;

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-xs">
      {t.status === 'done' || t.status === 'exists' ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
      ) : t.status === 'conflict' ? (
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
      <span className="min-w-0 flex-1 truncate" title={t.name}>
        {t.name}
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
