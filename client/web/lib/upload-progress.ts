/**
 * Pure helpers for the upload dock: byte/rate/ETA formatting, the size
 * pre-check message, and the aggregate progress across a batch. Kept free of
 * React so they can be unit-tested and reused by any other upload surface.
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < KB) return `${Math.round(n)} B`;
  if (n < MB) return `${(n / KB).toFixed(n < 10 * KB ? 1 : 0)} KB`;
  if (n < GB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
}

export function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  if (s < 5) return 'almost done';
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}

/** The message for a file refused before a byte is sent. Says both numbers,
 *  because "too large" on its own sends people guessing. */
export function overLimitMessage(size: number, limit: number): string {
  return `File is ${formatBytes(size)}. The limit is ${formatBytes(limit)}.`;
}

/**
 * The upload's form, in the order the brain reads it: the folder, then
 * `confirm` and `replace` (write over a file of the same name in place), then
 * the file itself. A field after the file part would reach the brain only
 * once the bytes had.
 *
 * `confirm` is always sent: a new file takes its folder's sharing with no
 * question (owner's word, 2026-11-12). A brain from before that still asks
 * for it on a shared folder, and takes this yes; a newer brain ignores it.
 */
export function uploadForm(parentPath: string, file: Blob, replace = false): FormData {
  const form = new FormData();
  form.set('parentPath', parentPath);
  form.set('confirm', 'true');
  if (replace) form.set('replace', 'true');
  form.set('file', file);
  return form;
}

/** The views a finished upload (or replace) changes, as the Files screen's
 *  own refresh names them: every Files view (list, pane, tree, Recent, Data
 *  files) and the tree rail, which lists files too. Asked again at once, so
 *  the new file shows without a reload and without waiting on the realtime
 *  stream (owner, 2026-11-12). */
export const UPLOAD_DONE_KEYS: ReadonlyArray<readonly string[]> = [['files'], ['tree', 'files']];

/** Exponential moving average of the transfer rate, so the ETA does not
 *  jitter with every progress event. `prev` null seeds it. */
export function updateRate(
  prev: number | null,
  deltaBytes: number,
  deltaMs: number,
): number | null {
  if (deltaMs <= 0) return prev;
  const instant = (deltaBytes * 1000) / deltaMs;
  if (prev == null) return instant;
  return prev * 0.7 + instant * 0.3;
}

/** How often progress reaches React: a fast link fires hundreds of events a
 *  second. */
const PROGRESS_TICK_MS = 150;

/**
 * An upload's `onProgress`, as `tick(loaded, rate, total)` calls: throttled,
 * with the smoothed rate, and always the last one.
 */
export function progressTicker(
  tick: (loaded: number, rate: number | null, total: number) => void,
): (loaded: number, total: number) => void {
  let lastLoaded = 0;
  let lastAt = performance.now();
  let rate: number | null = null;
  let lastWrite = -Infinity;
  return (loaded, total) => {
    const now = performance.now();
    rate = updateRate(rate, loaded - lastLoaded, now - lastAt);
    lastLoaded = loaded;
    lastAt = now;
    if (now - lastWrite < PROGRESS_TICK_MS && loaded < total) return;
    lastWrite = now;
    tick(loaded, rate, total);
  };
}

export function etaSeconds(loaded: number, total: number, rate: number | null): number | null {
  if (rate == null || rate <= 0 || total <= 0) return null;
  return Math.max(0, (total - loaded) / rate);
}

export type ProgressLike = {
  status: string;
  size: number;
  loaded: number;
  rate: number | null;
};

export type AggregateProgress = {
  /** Bytes sent across every task that is still counted (not failed, not cancelled). */
  loaded: number;
  total: number;
  /** 0..100 by BYTES, not by file count: one big file moves the bar. */
  pct: number;
  /** Combined rate of the tasks uploading right now, bytes/s. */
  rate: number | null;
  etaSec: number | null;
};

export function aggregateProgress(tasks: readonly ProgressLike[]): AggregateProgress {
  let loaded = 0;
  let total = 0;
  let rate = 0;
  let anyRate = false;
  for (const t of tasks) {
    if (t.status !== 'pending' && t.status !== 'uploading' && t.status !== 'done') continue;
    total += t.size;
    loaded += t.status === 'done' ? t.size : t.loaded;
    if (t.status === 'uploading' && t.rate != null && t.rate > 0) {
      rate += t.rate;
      anyRate = true;
    }
  }
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const r = anyRate ? rate : null;
  return { loaded, total, pct, rate: r, etaSec: etaSeconds(loaded, total, r) };
}

/**
 * The name the brain stores an upload under, as its `sanitizeFilename`
 * (packages/files): "My Doc.PDF" lands as "my-doc.pdf". Needed to find the
 * file a name clash collided with.
 */
export function storedFilename(raw: string): string | null {
  const base = raw.replace(/^.*[\\/]/, '');
  const lower = base.toLowerCase().normalize('NFKD');
  const dot = lower.lastIndexOf('.');
  const stem = dot > 0 ? lower.slice(0, dot) : lower;
  const ext = dot > 0 ? lower.slice(dot + 1) : '';
  const cleanStem = stem
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
  const cleanExt = ext.replace(/[^a-z0-9]+/g, '').slice(0, 16);
  if (!cleanStem) return null;
  return cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem;
}

/** The brain's refusal of an upload whose name is taken in that folder. It
 *  checks the name only: the bytes may or may not match. */
export function isNameClash(status: number, body: Record<string, unknown> | null): boolean {
  return status === 409 && typeof body?.error === 'string' && body.error.includes('already exists');
}

/**
 * What a name clash means. `same`: the file there has these bytes, so the
 * upload is already done. `same-size`: equal size, bytes not checked (no
 * fingerprint on either side). `different`: another version is there, and
 * the brain kept it; this upload was NOT saved.
 */
export type ClashVerdict = 'same' | 'same-size' | 'different';

export function clashVerdict(
  local: { size: number; sha256: string | null },
  stored: { sizeBytes: number; sha256: string | null } | undefined,
): ClashVerdict {
  if (!stored || stored.sizeBytes !== local.size) return 'different';
  if (stored.sha256 && local.sha256) return stored.sha256 === local.sha256 ? 'same' : 'different';
  return 'same-size';
}

export const CLASH_DETAIL: Record<ClashVerdict, string> = {
  same: 'Already uploaded',
  'same-size': 'Already here, same size',
  different: 'A different version is already here, not replaced',
};

/** SHA-256 of a file as hex, or null where the browser has no WebCrypto
 *  (a plain-http LAN address is not a secure context). */
export async function sha256Hex(file: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A file the Tables screen can import. On a box with the line
 *  (`noAutoTables`) it stays in Files and makes no Table. */
export function isSpreadsheetName(name: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(name);
}

/**
 * The dock's one line for a spreadsheet in Files, on a box where an upload no
 * longer makes a Table; null otherwise. Only for a file that is going in or is
 * there: one that failed, was cancelled or was not replaced stays nowhere.
 */
export function spreadsheetHint(
  tasks: readonly { name: string; status: string }[],
  noAutoTables: boolean,
): string | null {
  if (!noAutoTables) return null;
  const going = new Set(['pending', 'uploading', 'done', 'exists']);
  return tasks.some((t) => going.has(t.status) && isSpreadsheetName(t.name))
    ? 'Spreadsheets stay in Files. For a Table, use the upload button next to New on the Tables screen.'
    : null;
}
