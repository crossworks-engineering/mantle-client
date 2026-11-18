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
  /** Reserved for P5 (read by an older reader); never sent yet. */
  stale?: boolean;
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
  stale: boolean | null;
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
    meaning: 'Read by an older reader; read it again to refresh',
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

/** The line about the brain's read of the content. */
export function ingestLine(ingest: FileIngest, x: FileExtraction | undefined): string {
  switch (ingest) {
    case 'done':
      return 'Read into the brain';
    case 'partial':
      return x?.pages ? `Read in part: ${x.pages.read} of ${x.pages.total} pages` : 'Read in part';
    case 'waiting':
      return 'Not read yet';
    case 'failed':
      return x?.reason ? `Could not be read: ${x.reason}` : 'Could not be read';
    case 'none':
      return x?.state === 'name_only'
        ? 'Kept to its name: the content is not read'
        : 'Not read: nothing to read';
  }
}

export function jobLine(job: FileJob): string {
  return job === 'running' ? 'Being read now' : 'In the queue to be read';
}

export function dbLine(db: FileDbState): string {
  switch (db) {
    case 'ready':
      return 'Database ready, built by a pipeline';
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
  if (s.db) lines.push(dbLine(s.db));
  if (s.stale) lines.push('Read by an older reader');
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
  /** Something went wrong, in plain words. */
  problem: null | { reason: string; hint: string | null };
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
  const how =
    p.readMode === 'metadata'
      ? 'Name only'
      : p.readMode === 'local'
        ? 'Read on this box, no model'
        : 'Read whole';
  return { label: 'Read', value: `${how}, ${formatDateTime(p.readAt)}` };
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
      value: ingestLine(p.status.ingest, p.extraction),
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
  if (p.stale)
    brain.push({ label: 'Reader', value: 'An older reader; read it again', tone: 'warning' });

  const pipeline = p.database
    ? {
        rows: [
          {
            label: 'Database',
            value: dbLine(p.database.state),
            tone: (p.database.state === 'ready'
              ? 'ok'
              : p.database.state === 'unreadable'
                ? 'error'
                : 'muted') as DetailTone,
          },
          ...(p.database.readBy
            ? [
                {
                  label: 'Pipeline',
                  value: `${p.database.readBy.pipeline}, version ${p.database.readBy.version}`,
                },
              ]
            : []),
          ...(p.database.bytes != null
            ? [{ label: 'Size', value: fmtSize(p.database.bytes) }]
            : []),
        ],
        tables: (p.database.tables ?? []).map((t) => ({
          name: t.name,
          rows: count(t.rows, 'row'),
        })),
      }
    : null;

  const problem = p.error
    ? { reason: p.error.reason, hint: p.error.hint }
    : p.extraction.state === 'failed' && p.extraction.reason
      ? { reason: p.extraction.reason, hint: p.extraction.hint ?? null }
      : null;

  return {
    badge: statusBadge(p.status, p.extraction),
    file,
    brain,
    pipeline,
    problem,
    derived: { items: p.derived.items, more: p.derived.truncated },
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
