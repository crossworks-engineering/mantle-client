/**
 * A file's processing status (Files program P4): the corner badge on a file
 * icon and the Details panel's view model. Pure: no React, no fetch.
 *
 * The wire shapes are mirrored from mantle's
 * packages/client-types/src/dto/file-status.ts, which is not published yet.
 * TODO(p4): once a mantle release carries file-status.ts, bump the
 * @mantle/client-types pin, import FileStatus and FileProcessing from it and
 * delete the copies below. Every field is optional on the row: a brain
 * before P4 sends no `status`, and then no badge shows.
 */

import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { fmtSize, type FileExtraction } from './files-shared';

/* ── Wire shapes (contract-p4, 2026-11-18) ─────────────────────────── */

/** Was the content read into the brain (search, facts, mentions). */
export type FileIngest = 'done' | 'partial' | 'waiting' | 'failed' | 'none';
/** An extract job for the file in the queue now. */
export type FileJob = 'queued' | 'running';
/** The state of the file's own database (its Data view). */
export type FileDbState = 'ready' | 'too-large' | 'no-rows' | 'unreadable' | 'not-built';

/** The compact status on a file row and a file tree item. */
export type FileStatus = {
  ingest: FileIngest;
  job?: FileJob;
  db?: FileDbState;
  /** P5: sent only when an older reader (or an older Reader pipeline) read
   *  it. Absent: current, or unknown (read before P5). */
  stale?: boolean;
  /** P5: the name of the Reader pipeline that built its database. */
  pipeline?: string;
};

/** P5: the reader that read the file, with its version then and now
 *  (`current` null: no longer a known reader). */
export type FileReadBy = { reader: string; version: number; current: number | null };

/** P5: the Reader pipeline that built the file's database or text
 *  (`current` null: that pipeline is not installed now). */
export type FilePipelineRead = {
  id: string;
  name: string;
  version: string;
  current: string | null;
};

/** One item made from the file ("where it went"). */
export type FileDerivedItem = {
  id: string;
  /** 'file' (an extracted image), 'table', 'page', 'note', or a later kind. */
  kind: string;
  title: string;
  /** The ltree path of its folder or parent. */
  path: string;
};

/** GET /api/files/files/:id/processing */
export type FileProcessing = {
  file: {
    id: string;
    filename: string;
    extension: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string | null;
    parentPath: string;
    createdAt: string;
    updatedAt: string;
  };
  status: FileStatus;
  extraction: FileExtraction;
  readAt: string | null;
  readMode: 'full' | 'metadata' | 'local' | null;
  pages: number | null;
  textChars: number;
  summarized: boolean;
  embedded: boolean;
  chunks: number;
  facts: number;
  mentions: number;
  database: null | {
    state: FileDbState;
    bytes: number | null;
    readBy: { pipeline: string; version: string } | null;
    /** What the pipeline extracted: each tab and its rows (added 2026-11-18). */
    tables?: { name: string; rows: number }[];
  };
  job: FileJob | null;
  /** true stale, false current, null no stamp (unknown). */
  stale: boolean | null;
  /** P5; absent from a brain before it. */
  readBy?: FileReadBy | null;
  pipelineRead?: FilePipelineRead | null;
  error: null | { reason: string; hint: string | null };
  images: null | { kept: number; found: number };
  derived: { items: FileDerivedItem[]; truncated: boolean };
};

/* ── The corner badge ──────────────────────────────────────────────── */

/** Which badge a file shows, most urgent first. */
export type StatusBadgeKind =
  'failed' | 'running' | 'waiting' | 'partial' | 'stale' | 'pipeline' | 'done';

export type StatusBadge = {
  kind: StatusBadgeKind;
  /** The badge's name (its aria-label, the tooltip's first line). */
  title: string;
  /** Every fact behind it, one per line (the tooltip). */
  lines: string[];
};

/** Plain words for each badge, in priority order: the legend reads this. */
export const BADGE_LEGEND: { kind: StatusBadgeKind; title: string; meaning: string }[] = [
  {
    kind: 'failed',
    title: 'Failed',
    meaning: 'Could not be read, or its database could not be built',
  },
  { kind: 'running', title: 'Being read', meaning: 'The brain is reading it now' },
  { kind: 'waiting', title: 'Waiting', meaning: 'In the queue, or not read yet' },
  {
    kind: 'partial',
    title: 'Read in part',
    meaning: 'Some pages or pictures were left; Details says which',
  },
  {
    kind: 'stale',
    title: 'Older read',
    meaning: 'Read by an older reader. Reindex to read it again',
  },
  {
    kind: 'pipeline',
    title: 'Database ready',
    meaning: 'A pipeline built its database (Data view)',
  },
  {
    kind: 'done',
    title: 'In the brain',
    meaning: 'Read whole: found in search, facts and mentions',
  },
];

const TITLE: Record<StatusBadgeKind, string> = Object.fromEntries(
  BADGE_LEGEND.map((b) => [b.kind, b.title]),
) as Record<StatusBadgeKind, string>;

/** Which badge wins: failed > running/waiting > partial > stale > database
 *  ready > done; null for a file with nothing to say (or an older brain). */
export function statusBadgeKind(s: FileStatus | undefined | null): StatusBadgeKind | null {
  if (!s) return null;
  if (s.ingest === 'failed' || s.db === 'unreadable') return 'failed';
  if (s.job === 'running') return 'running';
  if (s.job === 'queued' || s.ingest === 'waiting' || s.db === 'not-built') return 'waiting';
  if (s.ingest === 'partial') return 'partial';
  if (s.stale) return 'stale';
  if (s.db === 'ready') return 'pipeline';
  if (s.ingest === 'done') return 'done';
  return null;
}

/** Whether a read again is what the file needs now (failed, read in part,
 *  or an older read): the Details sheet's Reindex button stands out. */
export function reindexUrgent(s: FileStatus | undefined | null): boolean {
  const k = statusBadgeKind(s);
  return k === 'failed' || k === 'partial' || k === 'stale';
}

/** The brain's reason codes (packages/files extraction-status.ts) in plain
 *  words, lower case so they follow "Could not be read: " (`capital` for
 *  words shown alone). */
const REASON_WORDS: Record<string, string> = {
  document_unreadable: 'the reader could not open it',
  pdf_too_large: 'the PDF is too large to read',
  encrypted_pdf: 'the PDF is password-protected',
  bytes_unavailable: 'its bytes are not on the server',
  parked: 'its index could not be written',
  needs_export: 'this format cannot be read directly',
  unsupported_media: 'audio and video are kept, not read',
  no_parser: 'no reader takes this file type',
  body_too_short: 'it holds too little text to index',
  no_text_layer: 'the scan gave no text',
  no_vision_text: 'the picture gave no text',
  type_not_in_allowlist: 'this file type is not read here',
  local_only: 'read on this box with no model',
  not_read_no_model: 'no assistant reads its workspace',
  // Skips the brain stamps on its own items (packages/db extract-exempt.ts).
  snapshot_copy: 'a read-only copy; it is not read again',
  conversation_digest: 'a chat record; kept, not read as a document',
  chat_archive: 'a chat record; kept, not read as a document',
  derived_mixed_unrefolded: 'indexed from its own text, with no model; its next edit summarises it',
};

/** A reason code in plain words; null for a code this client does not know
 *  (never shown raw: the caller says "Could not be read" and the hint). */
export function reasonWords(reason: string | undefined | null): string | null {
  return reason && Object.hasOwn(REASON_WORDS, reason) ? REASON_WORDS[reason]! : null;
}

export const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The line about the brain's read of the content. */
export function ingestLine(ingest: FileIngest, x: FileExtraction | undefined): string {
  switch (ingest) {
    case 'done':
      return 'Read into the brain';
    case 'partial':
      return x?.pages ? `Read in part: ${x.pages.read} of ${x.pages.total} pages` : 'Read in part';
    case 'waiting':
      return 'Not read yet';
    case 'failed': {
      const words = reasonWords(x?.reason);
      return words ? `Could not be read: ${words}` : 'Could not be read';
    }
    case 'none':
      return x?.state === 'name_only'
        ? 'Kept to its name: the content is not read'
        : 'Not read: nothing to read';
  }
}

export function jobLine(job: FileJob): string {
  return job === 'running' ? 'Being read now' : 'In the queue to be read';
}

/** The words for an older read: the stale mark's tooltip. No end stop:
 *  the badge joins its lines with ". ". */
export const STALE_LINE = 'Read by an older reader. Reindex to read it again';

export function dbLine(db: FileDbState, pipeline?: string): string {
  switch (db) {
    case 'ready':
      return pipeline ? `Database built by ${pipeline}` : 'Database ready, built by a pipeline';
    case 'too-large':
      return 'No database: the file is too large';
    case 'no-rows':
      return 'No database: no rows found';
    case 'unreadable':
      return 'Its database could not be built';
    case 'not-built':
      return 'Database not built yet';
  }
}

/** The badge and its tooltip lines, or null for no badge. */
export function statusBadge(
  s: FileStatus | undefined | null,
  x?: FileExtraction,
): StatusBadge | null {
  const kind = statusBadgeKind(s);
  if (!kind || !s) return null;
  const lines = [ingestLine(s.ingest, x)];
  if (s.job) lines.push(jobLine(s.job));
  if (s.db) lines.push(dbLine(s.db, s.pipeline));
  if (s.stale) lines.push(STALE_LINE);
  if (x?.hint) lines.push(x.hint);
  return { kind, title: TITLE[kind], lines };
}

/* ── The Details panel ─────────────────────────────────────────────── */

export type DetailTone = 'ok' | 'warning' | 'error' | 'muted';

export type DetailRow = { label: string; value: string; tone?: DetailTone };

export type DetailsView = {
  badge: StatusBadge | null;
  /** The file itself: size, type, dates, pages. */
  file: DetailRow[];
  /** What the brain holds of it. */
  brain: DetailRow[];
  /** The pipeline that read it and what it extracted; null with no Data view. */
  pipeline: null | {
    rows: DetailRow[];
    tables: { name: string; rows: string }[];
  };
  /** Why it was not read, in plain words: 'error' for a failed read,
   *  'muted' for a skip (nothing failed). */
  problem: null | FileProblem;
  /** Where it went: the items made from it. */
  derived: { items: FileDerivedItem[]; more: boolean };
};

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

function readLine(p: FileProcessing): DetailRow {
  if (p.status.job === 'running') return { label: 'Read', value: 'Being read now', tone: 'muted' };
  if (!p.readAt) {
    return {
      label: 'Read',
      value: p.status.job === 'queued' ? 'In the queue' : 'Not read yet',
      tone: 'muted',
    };
  }
  const { how, tone } = readHow(p);
  return { label: 'Read', value: `${how}, ${formatDateTime(p.readAt)}`, tone };
}

/** How the last read went, from extraction.state (the source of truth for
 *  a read in part) and then readMode (the folder's indexing when it ran:
 *  'full' says how it was asked, not that every page was read). */
export function readHow(p: Pick<FileProcessing, 'extraction' | 'readMode'>): {
  how: string;
  tone?: DetailTone;
} {
  const x = p.extraction;
  // The counts are in Status, Pages and Pictures: the Read line says when.
  if (x.state === 'partial') return { how: 'Read in part', tone: 'warning' };
  if (x.state === 'failed' || x.state === 'skipped') return { how: 'Last tried', tone: 'muted' };
  if (x.state === 'name_only' || p.readMode === 'metadata') return { how: 'Name only' };
  if (p.readMode === 'local') return { how: 'Read on this box, no model' };
  if (x.state === 'indexed') return { how: 'Read whole' };
  return { how: 'Read' };
}

/** The "Read by" row: the reader and its version, and the current version
 *  when a newer reader is here (P5). */
export function readByRow(r: FileReadBy): DetailRow {
  const was = `${r.reader} v${r.version}`;
  if (r.current == null) {
    return { label: 'Read by', value: `${was}, no longer a reader here`, tone: 'muted' };
  }
  if (r.current > r.version) {
    return { label: 'Read by', value: `${was}, current: v${r.current}`, tone: 'warning' };
  }
  return { label: 'Read by', value: `${was}, current`, tone: 'ok' };
}

/** The "Pipeline" row: the Reader pipeline that built it, its version, and
 *  the installed one when it differs (P5). */
export function pipelineReadRow(r: FilePipelineRead): DetailRow {
  const was = `${r.name}, version ${r.version}`;
  if (r.current == null) {
    return { label: 'Pipeline', value: `${was}, not installed now`, tone: 'muted' };
  }
  if (r.current !== r.version) {
    return { label: 'Pipeline', value: `${was}, current: ${r.current}`, tone: 'warning' };
  }
  return { label: 'Pipeline', value: `${was}, current`, tone: 'ok' };
}

/** The Details panel's rows: plain words, no React. */
export function detailsView(p: FileProcessing): DetailsView {
  const file: DetailRow[] = [
    { label: 'Size', value: fmtSize(p.file.sizeBytes) },
    { label: 'Created', value: formatDateTime(p.file.createdAt) },
    { label: 'Updated', value: formatDateTime(p.file.updatedAt) },
  ];
  const pages = p.pages ?? p.extraction.pages?.total ?? null;
  if (pages != null) {
    const read = p.extraction.pages;
    file.push({
      label: 'Pages',
      value: read && read.read < read.total ? `${read.read} of ${read.total} read` : String(pages),
      tone: read && read.read < read.total ? 'warning' : undefined,
    });
  }

  const brain: DetailRow[] = [
    {
      label: 'Status',
      // A failure's words are in the card at the top, once.
      value:
        p.status.ingest === 'failed'
          ? 'Could not be read'
          : ingestLine(p.status.ingest, p.extraction),
      tone:
        p.status.ingest === 'failed'
          ? 'error'
          : p.status.ingest === 'partial'
            ? 'warning'
            : p.status.ingest === 'done'
              ? 'ok'
              : 'muted',
    },
    readLine(p),
    {
      label: 'Embedded',
      value: p.embedded ? 'Yes: found by meaning in search' : 'No',
      tone: p.embedded ? 'ok' : 'muted',
    },
  ];
  if (p.textChars > 0) brain.push({ label: 'Text', value: count(p.textChars, 'character') });
  brain.push(
    { label: 'Chunks', value: count(p.chunks, 'chunk') },
    { label: 'Facts', value: count(p.facts, 'fact') },
    { label: 'Mentions', value: count(p.mentions, 'mention') },
    {
      label: 'Summary',
      value: p.summarized ? 'Written' : 'None',
      tone: p.summarized ? 'ok' : 'muted',
    },
  );
  if (p.images) {
    const left = p.images.found - p.images.kept;
    brain.push({
      label: 'Pictures',
      value:
        left > 0
          ? `${p.images.kept} of ${p.images.found} kept (${left} left)`
          : count(p.images.kept, 'picture') + ' kept',
      tone: left > 0 ? 'warning' : undefined,
    });
  }
  if (p.readBy) brain.push(readByRow(p.readBy));
  else if (p.stale) brain.push({ label: 'Read by', value: STALE_LINE, tone: 'warning' });

  const pipelineRow = p.pipelineRead
    ? pipelineReadRow(p.pipelineRead)
    : p.database?.readBy
      ? {
          label: 'Pipeline',
          value: `${p.database.readBy.pipeline}, version ${p.database.readBy.version}`,
        }
      : null;
  const pipeline =
    p.database || pipelineRow
      ? {
          rows: [
            ...(p.database
              ? [
                  {
                    label: 'Database',
                    value: dbLine(p.database.state),
                    tone: (p.database.state === 'ready'
                      ? 'ok'
                      : p.database.state === 'unreadable'
                        ? 'error'
                        : 'muted') as DetailTone,
                  },
                ]
              : []),
            ...(pipelineRow ? [pipelineRow] : []),
            ...(p.database?.bytes != null
              ? [{ label: 'Size', value: fmtSize(p.database.bytes) }]
              : []),
          ],
          tables: (p.database?.tables ?? []).map((t) => ({
            name: t.name,
            rows: count(t.rows, 'row'),
          })),
        }
      : null;

  // A failed read says why in its badge card (title, reason, hint); the
  // red block is for the rest (a skip), so the words show once.
  const problem = p.status.ingest === 'failed' ? null : problemOf(p);

  return {
    // The badge card carries a failure's hint: the extraction's, else the error's.
    badge: statusBadge(p.status, {
      ...p.extraction,
      ...(p.extraction.hint || !p.error?.hint ? {} : { hint: p.error.hint }),
    }),
    file,
    brain,
    pipeline,
    problem,
    derived: { items: p.derived.items, more: p.derived.truncated },
  };
}

export type FileProblem = { reason: string; hint: string | null; tone: 'error' | 'muted' };

/** Why a file was not read, in plain words: the known reason, else "Could
 *  not be read" for a failed read and a neutral "Not read" for a skip (a
 *  code this client does not know yet), with the brain's hint. */
export function problemOf(p: Pick<FileProcessing, 'error' | 'extraction'>): null | FileProblem {
  const failed = p.extraction.state === 'failed';
  const raw = p.error ?? (failed ? p.extraction : null);
  if (!raw?.reason) return null;
  const words = reasonWords(raw.reason);
  return {
    reason: words ? capital(words) : failed ? 'Could not be read' : 'Not read',
    hint: raw.hint ?? null,
    tone: failed ? 'error' : 'muted',
  };
}

/** Where a derived item opens: a file in its own folder, anything else
 *  through the universal permalink (/n resolves the kind's screen). */
export function derivedHref(item: Pick<FileDerivedItem, 'id' | 'kind' | 'path'>): string {
  if (item.kind === 'file') {
    const sp = new URLSearchParams();
    if (item.path) sp.set('path', item.path);
    sp.set('file', item.id);
    return `/files?${sp.toString()}`;
  }
  return `/n/${encodeURIComponent(item.id)}`;
}

/** A kind's noun for the "Where it went" list. */
export function derivedNoun(kind: string): string {
  switch (kind) {
    case 'file':
      return 'Picture';
    case 'table':
      return 'Table';
    case 'page':
      return 'Page';
    case 'note':
      return 'Note';
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
