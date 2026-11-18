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

/** The most ids one call takes; more go in pages. */
export const FILE_REINDEX_MAX = 200;

export type FileReindexSkip = 'not-found' | 'not-allowed' | 'in-queue' | 'busy';

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

/** What a reindex of many pages came to. */
export type ReindexOutcome = {
  queued: number;
  databases: number;
  /** Skips by reason, busy left out (see `busy`). */
  skipped: Record<Exclude<FileReindexSkip, 'busy'>, number>;
  /** The read queue was busy: the rest was not queued. */
  busy: boolean;
  /** The ids not queued because the queue was busy, or never sent after it:
   *  the ones to keep picked for a try again. */
  left: string[];
};

type Send = (path: string, body: { ids: string[] }) => Promise<FileReindexAnswer>;

/**
 * Send the ids in pages of 200, one after another. A busy queue stops the
 * loop: nothing more would be queued, so the rest is not sent and is named
 * in `left` with the busy page's own busy ids. An error (network, 400, 404)
 * throws on; what earlier pages queued is already queued.
 */
export async function sendReindex(ids: readonly string[], send: Send): Promise<ReindexOutcome> {
  const out: ReindexOutcome = {
    queued: 0,
    databases: 0,
    skipped: { 'not-found': 0, 'not-allowed': 0, 'in-queue': 0 },
    busy: false,
    left: [],
  };
  const pages = reindexPages(ids);
  for (let i = 0; i < pages.length; i++) {
    const a = await send(REINDEX_PATH, { ids: pages[i]! });
    out.queued += a.queued;
    out.databases += a.databases;
    for (const s of a.skipped) {
      if (s.reason === 'busy') out.left.push(s.id);
      else if (s.reason in out.skipped) out.skipped[s.reason] += 1;
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
  return {
    title: `Read ${n.toLocaleString('en-GB')} files again?`,
    body: 'This runs the whole pipeline (text, embedding, facts, file database) and may use model credits.',
    action: `Reindex ${n.toLocaleString('en-GB')} files`,
  };
}

const SKIP_WORDS: Record<Exclude<FileReindexSkip, 'busy'>, string> = {
  'in-queue': 'already in the queue',
  'not-allowed': 'not allowed',
  'not-found': 'not found',
};

/**
 * The answer in plain words, and how to show it. One file by name when it
 * is known: "report.pdf is queued to be read again." Many: "Queued 3.
 * Skipped 4: 2 already in the queue, 1 not allowed, 1 not found."
 */
export function reindexText(
  o: ReindexOutcome,
  one?: string,
): { tone: 'success' | 'info' | 'error'; message: string } {
  const skips = (Object.keys(SKIP_WORDS) as (keyof typeof SKIP_WORDS)[])
    .filter((k) => o.skipped[k] > 0)
    .map((k) => `${o.skipped[k].toLocaleString('en-GB')} ${SKIP_WORDS[k]}`);
  const skipped = Object.values(o.skipped).reduce((a, b) => a + b, 0);

  if (one !== undefined && o.queued + skipped + o.left.length <= 1) {
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
    return { tone: 'error', message: `${one} was not found.` };
  }

  const parts: string[] = [];
  if (o.queued > 0) parts.push(`Queued ${o.queued.toLocaleString('en-GB')}.`);
  else if (!o.busy) parts.push('Nothing was queued.');
  if (o.databases > 0) {
    parts.push(
      `${o.databases.toLocaleString('en-GB')} ${o.databases === 1 ? 'database' : 'databases'} will be built again.`,
    );
  }
  if (skipped > 0) parts.push(`Skipped ${skipped.toLocaleString('en-GB')}: ${skips.join(', ')}.`);
  if (o.busy) parts.push(REINDEX_BUSY);
  return {
    tone: o.busy ? 'error' : o.queued > 0 ? 'success' : 'info',
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
  return f.extraction?.hint ?? f.extraction?.reason ?? '';
}
