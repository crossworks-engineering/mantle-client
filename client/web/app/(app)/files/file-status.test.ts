import { describe, expect, it } from 'vitest';
import {
  BADGE_LEGEND,
  derivedHref,
  derivedNoun,
  detailsView,
  statusBadge,
  statusBadgeKind,
  type FileProcessing,
  type FileStatus,
} from './file-status';

describe('statusBadgeKind: which corner badge a file shows', () => {
  const cases: [FileStatus | undefined, ReturnType<typeof statusBadgeKind>][] = [
    // An older brain sends no status: no badge.
    [undefined, null],
    // Kept to its name, or nothing to read: no badge.
    [{ ingest: 'none' }, null],
    [{ ingest: 'none', db: 'no-rows' }, null],
    [{ ingest: 'none', db: 'too-large' }, null],
    [{ ingest: 'done' }, 'done'],
    [{ ingest: 'done', db: 'ready' }, 'pipeline'],
    [{ ingest: 'none', db: 'ready' }, 'pipeline'],
    [{ ingest: 'partial' }, 'partial'],
    [{ ingest: 'partial', db: 'ready' }, 'partial'],
    [{ ingest: 'waiting' }, 'waiting'],
    [{ ingest: 'done', db: 'not-built' }, 'waiting'],
    [{ ingest: 'done', job: 'queued' }, 'waiting'],
    [{ ingest: 'waiting', job: 'running' }, 'running'],
    [{ ingest: 'partial', job: 'running' }, 'running'],
    // Failed beats everything, also a job in the queue.
    [{ ingest: 'failed', job: 'queued' }, 'failed'],
    [{ ingest: 'done', db: 'unreadable', job: 'running' }, 'failed'],
    // Stale (reserved for P5) sits below partial, above database ready.
    [{ ingest: 'done', db: 'ready', stale: true }, 'stale'],
    [{ ingest: 'partial', stale: true }, 'partial'],
  ];
  it.each(cases)('%j -> %s', (status, kind) => {
    expect(statusBadgeKind(status)).toBe(kind);
  });

  it('the legend names every badge kind once', () => {
    const kinds = BADGE_LEGEND.map((b) => b.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(['failed', 'running', 'waiting', 'partial', 'stale', 'pipeline', 'done']);
  });
});

describe('statusBadge: the tooltip words', () => {
  it('says pages read of total for a partial read, and the hint', () => {
    const b = statusBadge(
      { ingest: 'partial' },
      { state: 'partial', pages: { read: 40, total: 120 }, hint: 'Read the rest from Details.' },
    );
    expect(b?.title).toBe('Read in part');
    expect(b?.lines).toEqual(['Read in part: 40 of 120 pages', 'Read the rest from Details.']);
  });

  it('lists the read, the job and the database', () => {
    const b = statusBadge({ ingest: 'done', job: 'queued', db: 'ready' });
    expect(b?.kind).toBe('waiting');
    expect(b?.lines).toEqual([
      'Read into the brain',
      'In the queue to be read',
      'Database ready, built by a pipeline',
    ]);
  });

  it('names the reason of a failed read', () => {
    const b = statusBadge({ ingest: 'failed' }, { state: 'failed', reason: 'password protected' });
    expect(b?.lines[0]).toBe('Could not be read: password protected');
  });

  it('is null with no status', () => {
    expect(statusBadge(undefined)).toBeNull();
    expect(statusBadge({ ingest: 'none' }, { state: 'name_only' })).toBeNull();
  });
});

function processing(over: Partial<FileProcessing> = {}): FileProcessing {
  return {
    file: {
      id: 'f1',
      filename: 'report.pdf',
      extension: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      sha256: null,
      parentPath: 'files.work',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
    },
    status: { ingest: 'done' },
    extraction: { state: 'indexed' },
    readAt: '2026-11-02T10:05:00.000Z',
    readMode: 'full',
    pages: 12,
    textChars: 12345,
    summarized: true,
    embedded: true,
    chunks: 1,
    facts: 7,
    mentions: 0,
    database: null,
    job: null,
    stale: null,
    error: null,
    images: null,
    derived: { items: [], truncated: false },
    ...over,
  };
}

const value = (rows: { label: string; value: string }[], label: string) =>
  rows.find((r) => r.label === label)?.value;

describe('detailsView: the Details panel in plain words', () => {
  it('a whole read: size, pages, embedded and the counts', () => {
    const v = detailsView(processing());
    expect(v.badge?.kind).toBe('done');
    expect(value(v.file, 'Size')).toBe('2.0 KB');
    expect(value(v.file, 'Pages')).toBe('12');
    expect(value(v.brain, 'Embedded')).toBe('Yes: found by meaning in search');
    expect(value(v.brain, 'Text')).toBe('12,345 characters');
    expect(value(v.brain, 'Chunks')).toBe('1 chunk');
    expect(value(v.brain, 'Facts')).toBe('7 facts');
    expect(value(v.brain, 'Mentions')).toBe('0 mentions');
    expect(value(v.brain, 'Summary')).toBe('Written');
    expect(value(v.brain, 'Read')).toMatch(/^Read whole, /);
    expect(v.pipeline).toBeNull();
    expect(v.problem).toBeNull();
  });

  it('a partial read: pages read of total and pictures kept of found', () => {
    const v = detailsView(
      processing({
        status: { ingest: 'partial' },
        extraction: { state: 'partial', pages: { read: 40, total: 120 } },
        pages: 120,
        images: { kept: 50, found: 64 },
      }),
    );
    expect(v.badge?.kind).toBe('partial');
    expect(v.file.find((r) => r.label === 'Pages')).toEqual({
      label: 'Pages',
      value: '40 of 120 read',
      tone: 'warning',
    });
    expect(v.brain.find((r) => r.label === 'Pictures')).toEqual({
      label: 'Pictures',
      value: '50 of 64 kept (14 left)',
      tone: 'warning',
    });
  });

  it('every picture kept is no warning', () => {
    const v = detailsView(processing({ images: { kept: 3, found: 3 } }));
    expect(v.brain.find((r) => r.label === 'Pictures')).toEqual({
      label: 'Pictures',
      value: '3 pictures kept',
      tone: undefined,
    });
  });

  it('the pipeline section: database state, who read it, its tables', () => {
    const v = detailsView(
      processing({
        status: { ingest: 'done', db: 'ready' },
        database: {
          state: 'ready',
          bytes: 4096,
          readBy: { pipeline: 'pdf-tables', version: '3' },
          tables: [
            { name: 'lines', rows: 1200 },
            { name: 'totals', rows: 1 },
          ],
        },
      }),
    );
    expect(v.badge?.kind).toBe('pipeline');
    expect(v.pipeline?.rows).toEqual([
      { label: 'Database', value: 'Database ready, built by a pipeline', tone: 'ok' },
      { label: 'Pipeline', value: 'pdf-tables, version 3' },
      { label: 'Size', value: '4.0 KB' },
    ]);
    expect(v.pipeline?.tables).toEqual([
      { name: 'lines', rows: '1,200 rows' },
      { name: 'totals', rows: '1 row' },
    ]);
  });

  it('a database not read by a pipeline yet, with no tables field', () => {
    const v = detailsView(
      processing({ database: { state: 'not-built', bytes: null, readBy: null } }),
    );
    expect(v.pipeline?.rows).toEqual([
      { label: 'Database', value: 'Database not built yet', tone: 'muted' },
    ]);
    expect(v.pipeline?.tables).toEqual([]);
  });

  it('a failed read: the problem with its hint', () => {
    const v = detailsView(
      processing({
        status: { ingest: 'failed' },
        extraction: { state: 'failed', reason: 'encrypted' },
        readAt: null,
        readMode: null,
        error: { reason: 'The file is encrypted', hint: 'Upload it without a password.' },
      }),
    );
    expect(v.badge?.kind).toBe('failed');
    expect(v.problem).toEqual({
      reason: 'The file is encrypted',
      hint: 'Upload it without a password.',
    });
    expect(value(v.brain, 'Read')).toBe('Not read yet');
  });

  it('a job in the queue or running says so on the Read line', () => {
    expect(
      value(
        detailsView(processing({ readAt: null, status: { ingest: 'waiting', job: 'queued' } }))
          .brain,
        'Read',
      ),
    ).toBe('In the queue');
    expect(
      value(detailsView(processing({ status: { ingest: 'done', job: 'running' } })).brain, 'Read'),
    ).toBe('Being read now');
  });

  it('read on the box with no model', () => {
    const v = detailsView(processing({ readMode: 'local', summarized: false }));
    expect(value(v.brain, 'Read')).toMatch(/^Read on this box, no model, /);
    expect(value(v.brain, 'Summary')).toBe('None');
  });

  it('where it went: the items and "and more" when truncated', () => {
    const items = [
      { id: 'p1', kind: 'page', title: 'Story', path: 'pages.work' },
      { id: 'i1', kind: 'file', title: 'img-1.png', path: 'files.work.report_images' },
    ];
    const v = detailsView(processing({ derived: { items, truncated: true } }));
    expect(v.derived).toEqual({ items, more: true });
  });
});

describe('derived links', () => {
  it('a picture opens in its folder in Files; other kinds through /n', () => {
    expect(derivedHref({ id: 'i1', kind: 'file', path: 'files.work.imgs' })).toBe(
      '/files?path=files.work.imgs&file=i1',
    );
    expect(derivedHref({ id: 'p1', kind: 'page', path: 'pages' })).toBe('/n/p1');
    expect(derivedHref({ id: 't1', kind: 'table', path: 'tables' })).toBe('/n/t1');
  });

  it('names each kind', () => {
    expect(['file', 'table', 'page', 'note', 'draw'].map(derivedNoun)).toEqual([
      'Picture',
      'Table',
      'Page',
      'Note',
      'Draw',
    ]);
  });
});
