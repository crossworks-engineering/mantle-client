import { describe, expect, it } from 'vitest';
import {
  extractBusy,
  extractLine,
  extractPath,
  mayBeArchive,
  refusalWords,
  type ArchiveExtractView,
} from './archive-extract';

const view = (over: Partial<ArchiveExtractView>): ArchiveExtractView => ({
  state: 'done',
  folder: { id: 'f1', path: 'files.reports.report_2026' },
  queuedAt: '2026-11-20T10:00:00Z',
  files: 0,
  folders: 0,
  bytes: 0,
  skipped: 0,
  flattened: 0,
  refused: [],
  refusedCount: 0,
  ...over,
});

describe('mayBeArchive: which names ask the brain', () => {
  it('takes ZIP, TAR and gzip endings, any case', () => {
    for (const n of ['a.zip', 'B.ZIP', 'c.tar', 'd.tar.gz', 'e.tgz', 'f.gz', ' g.zip ']) {
      expect(mayBeArchive(n)).toBe(true);
    }
  });
  it('leaves out 7z, RAR, documents and no name', () => {
    for (const n of ['a.7z', 'b.rar', 'c.docx', 'zip', 'notes.txt', '', null, undefined]) {
      expect(mayBeArchive(n)).toBe(false);
    }
  });
});

describe('extractPath', () => {
  it('is the file extract route', () => {
    expect(extractPath('abc')).toBe('/api/files/files/abc/extract');
  });
});

describe('extractBusy', () => {
  it('is true while queued or running only', () => {
    expect(extractBusy(view({ state: 'queued' }))).toBe(true);
    expect(extractBusy(view({ state: 'running' }))).toBe(true);
    expect(extractBusy(view({ state: 'done' }))).toBe(false);
    expect(extractBusy(view({ state: 'failed' }))).toBe(false);
    expect(extractBusy(null)).toBe(false);
  });
});

describe('extractLine: the state in plain words', () => {
  it('says nothing when none was asked', () => {
    expect(extractLine(null)).toBeNull();
  });
  it('queued and running, with the files so far', () => {
    expect(extractLine(view({ state: 'queued' }))?.text).toBe('In the queue to extract');
    expect(extractLine(view({ state: 'running' }))?.text).toBe('Extracting');
    expect(extractLine(view({ state: 'running', files: 1200 }))?.text).toBe(
      'Extracting: 1,200 files so far',
    );
  });
  it('done: the counts, ok with nothing refused', () => {
    const l = extractLine(view({ files: 12, folders: 3 }));
    expect(l).toEqual({ text: 'Extracted 12 files in 3 folders', tone: 'ok', more: [] });
    expect(extractLine(view({ files: 1 }))?.text).toBe('Extracted 1 file');
  });
  it('done with entries not written, flattened and skipped: a warning with each line', () => {
    const l = extractLine(
      view({
        files: 5,
        folders: 1,
        refusedCount: 2,
        refused: [
          { name: 'x/../../etc', reason: 'traversal' },
          { name: 'link', reason: 'link' },
        ],
        flattened: 1,
        skipped: 4,
      }),
    );
    expect(l?.tone).toBe('warning');
    expect(l?.more).toEqual([
      '2 entries not written',
      '1 file with deeper folders kept in the name',
      '4 system files left out',
    ]);
  });
  it('failed: the brain sentence', () => {
    expect(extractLine(view({ state: 'failed', error: 'The archive is damaged.' }))).toEqual({
      text: 'Could not extract: The archive is damaged.',
      tone: 'error',
      more: [],
    });
    expect(extractLine(view({ state: 'failed' }))?.text).toBe('Could not extract');
  });
});

describe('refusalWords', () => {
  it('names a known reason in plain words and an unknown one as sent', () => {
    expect(refusalWords('encrypted')).toBe('encrypted');
    expect(refusalWords('traversal')).toBe('a path out of the folder');
    expect(refusalWords('newer-reason')).toBe('newer-reason');
  });
});
