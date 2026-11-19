/**
 * Read files again (Files program P5): POST /api/files/reindex, the whole
 * pipeline (text, embedding, facts, file database), for one file or many.
 * Pure: the pages, the send loop over an injected sender, and the answer in
 * plain words. The hook and the confirm are file-reindex-ui.tsx.
 *
 * The wire shapes mirror mantle's packages/client-types/src/dto/file-status.ts
 * (contract-p5), not published yet. TODO(p5): import FileReindexAnswer and
 * FILE_REINDEX_MAX from @mantle/client-types once a release carries them.
 */
import { reasonWords } from './file-status';

/** The most ids one call takes; more go in pages. */
export const FILE_REINDEX_MAX = 200;

export type FileReindexSkip = 'not-found' | 'not-allowed' | 'in-queue' | 'bytes-missing' | 'busy';

/** POST /api/files/reindex 200. */
export type FileReindexAnswer = {
  queued: number;
  databases: number;
  skipped: Array<{ id: string; reason: FileReindexSkip }>;
};

export const REINDEX_PATH = '/api/files/reindex';

/** The ids in pages of FILE_REINDEX_MAX, each id once, in order. */
export function reindexPages(ids: readonly string[], max = FILE_REINDEX_MAX): string[][] {
  const once = [...new Set(ids)];
  const pages: string[][] = [];
  for (let i = 0; i < once.length; i += max) pages.push(once.slice(i, i + max));
  return pages;
}

/** The skip reasons this client knows. A newer brain may send another:
 *  it counts as `other` and is named (never dropped). */
type KnownSkip = Exclude<FileReindexSkip, 'busy'>;

const SKIP_WORDS: Record<KnownSkip, string> = {
  'in-queue': 'already in the queue',
  'not-allowed': 'not allowed',
  'not-found': 'not found',
  'bytes-missing': 'have no bytes on the server (upload them again)',
};

/** What a reindex of many pages came to. */
export type ReindexOutcome = {
  queued: number;
  databases: number;
  /** Skips by reason, busy left out (see `busy`); `other`: a reason this
   *  client does not know, named in `otherReasons`. */
  skipped: Record<KnownSkip | 'other', number>;
  otherReasons: string[];
  /** The read queue was busy: the rest was not queued. */
  busy: boolean;
  /** A page failed (network, 500): what it threw, else null. Earlier pages
   *  stay queued; that page and every page after it are in `left`. */
  error: unknown;
  /** The ids not queued because the queue was busy, or never sent after a
   *  busy page or a failed one: the ones to keep picked for a try again. */
  left: string[];
};

type Send = (path: string, body: { ids: string[] }) => Promise<FileReindexAnswer>;

/** How many ids the brain answered for (queued or skipped, busy left out). */
export function answered(o: ReindexOutcome): number {
  return o.queued + Object.values(o.skipped).reduce((a, b) => a + b, 0);
}

/**
 * Send the ids in pages of 200, one after another. A busy queue stops the
 * loop: nothing more would be queued, so the rest is not sent and is named
 * in `left` with the busy page's own busy ids. An error stops it too: it is
 * kept in `error`, and that page and the rest go in `left`. It never throws,
 * so what earlier pages queued is always told.
 */
export async function sendReindex(ids: readonly string[], send: Send): Promise<ReindexOutcome> {
  const out: ReindexOutcome = {
    queued: 0,
    databases: 0,
    skipped: { 'not-found': 0, 'not-allowed': 0, 'in-queue': 0, 'bytes-missing': 0, other: 0 },
    otherReasons: [],
    busy: false,
    error: null,
    left: [],
  };
  const pages = reindexPages(ids);
  for (let i = 0; i < pages.length; i++) {
    let a: FileReindexAnswer;
    try {
      a = await send(REINDEX_PATH, { ids: pages[i]! });
    } catch (err) {
      out.error = err ?? new Error('failed');
      for (const rest of pages.slice(i)) out.left.push(...rest);
      break;
    }
    out.queued += a.queued;
    out.databases += a.databases;
    for (const s of a.skipped) {
      const reason = s.reason as string;
      if (reason === 'busy') out.left.push(s.id);
      else if (Object.hasOwn(SKIP_WORDS, reason)) out.skipped[reason as KnownSkip] += 1;
      else {
        out.skipped.other += 1;
        if (!out.otherReasons.includes(reason)) out.otherReasons.push(reason);
      }
    }
    if (a.skipped.some((s) => s.reason === 'busy')) {
      out.busy = true;
      for (const rest of pages.slice(i + 1)) out.left.push(...rest);
      break;
    }
  }
  return out;
}

export const REINDEX_BUSY =
  'The read queue is busy. Nothing more was queued; try again in a few minutes.';

/** The confirm's words for a read again of many files. */
export function reindexConfirmText(n: number): { title: string; body: string; action: string } {
  const body =
    'This runs the whole pipeline (text, embedding, facts, file database) and may use model credits.';
  return {
    title: `Read ${n.toLocaleString('en-GB')} files again?`,
    // The brain answers busy while its read queue holds more than 50.
    body:
      n > FILE_REINDEX_MAX
        ? `${body} Up to ${FILE_REINDEX_MAX} are queued at a time; the rest stay picked so you can send them next.`
        : body,
    action: `Reindex ${n.toLocaleString('en-GB')} files`,
  };
}

/**
 * The answer in plain words, and how to show it. One file by name when it
 * is known: "report.pdf is queued to be read again." Many: "Queued 3.
 * Skipped 4: 2 already in the queue, 1 not allowed, 1 not found." A page
 * that failed after others: "Queued 200, then the request failed. 400 not
 * sent; try again."
 */
export function reindexText(
  o: ReindexOutcome,
  one?: string,
): { tone: 'success' | 'info' | 'error'; message: string } {
  const skips = (Object.keys(SKIP_WORDS) as KnownSkip[])
    .filter((k) => o.skipped[k] > 0)
    .map((k) => `${o.skipped[k].toLocaleString('en-GB')} ${SKIP_WORDS[k]}`);
  if (o.skipped.other > 0) {
    skips.push(`${o.skipped.other.toLocaleString('en-GB')} other (${o.otherReasons.join(', ')})`);
  }
  const skipped = Object.values(o.skipped).reduce((a, b) => a + b, 0);
  const failed = o.error !== null;

  if (one !== undefined && !failed && o.queued + skipped + o.left.length <= 1) {
    if (o.busy) return { tone: 'error', message: REINDEX_BUSY };
    if (o.queued === 1) {
      return {
        tone: 'success',
        message: `${one} is queued to be read again${o.databases ? ', its database too' : ''}.`,
      };
    }
    if (o.skipped['in-queue']) return { tone: 'info', message: `${one} is already in the queue.` };
    if (o.skipped['not-allowed']) {
      return { tone: 'error', message: `You may not change ${one}, so it was not queued.` };
    }
    if (o.skipped['bytes-missing']) {
      return {
        tone: 'error',
        message: `${one} was not queued: its bytes are missing on the server.`,
      };
    }
    if (o.skipped.other) {
      return { tone: 'error', message: `${one} was not queued (${o.otherReasons.join(', ')}).` };
    }
    return { tone: 'error', message: `${one} was not found.` };
  }

  const parts: string[] = [];
  const queued = o.queued.toLocaleString('en-GB');
  if (failed) {
    parts.push(
      o.queued > 0
        ? `Queued ${queued}, then the request failed.`
        : 'Nothing was queued, then the request failed.',
    );
  } else if (o.queued > 0) parts.push(`Queued ${queued}.`);
  else if (!o.busy) parts.push('Nothing was queued.');
  if (o.databases > 0) {
    parts.push(
      `${o.databases.toLocaleString('en-GB')} ${o.databases === 1 ? 'database' : 'databases'} will be built again.`,
    );
  }
  if (skipped > 0) parts.push(`Skipped ${skipped.toLocaleString('en-GB')}: ${skips.join(', ')}.`);
  if (o.busy) parts.push(REINDEX_BUSY);
  if (failed) parts.push(`${o.left.length.toLocaleString('en-GB')} not sent; try again.`);
  return {
    tone: o.busy || failed ? 'error' : o.queued > 0 ? 'success' : 'info',
    message: parts.join(' '),
  };
}

/* ── Needs attention (GET /api/files/stale) ────────────────────────── */

export type FileStaleState = 'stale' | 'failed' | 'partial';

/** The panel's three lists, in tab order, with their empty words. */
export const ATTENTION_TABS: { state: FileStaleState; label: string; empty: string }[] = [
  { state: 'stale', label: 'Older read', empty: 'Every file was read by the current readers.' },
  { state: 'failed', label: 'Failed', empty: 'No file failed to be read.' },
  { state: 'partial', label: 'Read in part', empty: 'No file was read in part.' },
];

/** GET /api/files/stale?state=&cursor=&limit= */
export function stalePath(state: FileStaleState, cursor: string | null, limit = 50): string {
  const sp = new URLSearchParams({ state, limit: String(limit) });
  if (cursor) sp.set('cursor', cursor);
  return `/api/files/stale?${sp.toString()}`;
}

/** The second line of a row in the panel: what read it (an older read),
 *  or why it was not read whole (the brain's hint, else its reason). */
export function attentionHint(
  f: {
    readBy?: { reader: string; v: number };
    pipelineRead?: { name: string; version: string };
    extraction?: { reason?: string; hint?: string };
  },
  state: FileStaleState,
): string {
  if (state === 'stale') {
    const parts: string[] = [];
    if (f.readBy) parts.push(`Read by ${f.readBy.reader} v${f.readBy.v}`);
    if (f.pipelineRead) {
      parts.push(`database by ${f.pipelineRead.name}, version ${f.pipelineRead.version}`);
    }
    return parts.length ? parts.join('; ') : 'Read by an older reader';
  }
  // Never the raw code: the hint, else the reason in plain words.
  return f.extraction?.hint ?? reasonWords(f.extraction?.reason) ?? '';
}
