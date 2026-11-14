import { describe, expect, it } from 'vitest';
import { mayOpenPath } from './workspaces';
import {
  changedOptions,
  countText,
  hasState,
  keepCounts,
  neverRan,
  olderText,
  readsText,
  rereadLabel,
  setBody,
  statsOf,
  takesFile,
  versionLines,
  wordOf,
  type PipelineList,
  type PipelineRow,
} from './pipelines';

const ROW: PipelineRow = {
  id: 'drawing-pdf',
  name: 'PDF drawing',
  version: '1.0.0',
  source: 'builtin',
  start: 'upload',
  reads: ['pdf'],
  weight: 'light',
  shapes: ['pdf-file-v1'],
  workers: [],
  tools: [],
  files: 4,
  older: 1,
  kind: 'reader',
  workspaces: 'all',
  after: null,
  tabs: [],
  options: [
    {
      name: 'width',
      spec: { type: 'number', label: 'Width', default: 30, min: 5, max: 90 },
      value: 30,
    },
    { name: 'frames', spec: { type: 'bool', label: 'Frames', default: false }, value: false },
    {
      name: 'words',
      spec: { type: 'words', label: 'Words', default: [], maxItems: 10, maxChars: 8 },
      value: ['AB'],
    },
  ],
};

const AFTER: PipelineRow = { ...ROW, id: 'site-tags', kind: 'after', workspaces: ['w1'] };

describe('Settings > Pipelines words', () => {
  it('a count the brain did not make is a dash', () => {
    expect(countText(null)).toBe('-');
    expect(countText(0)).toBe('0');
    expect(countText(1234)).toBe('1,234');
  });

  it('the older line says how many files an older version or other options read', () => {
    expect(olderText(1)).toBe('1 file was read by an older version or with other options');
    expect(olderText(12)).toBe('12 files were read by an older version or with other options');
    expect(olderText(0)).toBeNull();
    expect(olderText(null)).toBeNull();
  });

  it('the extensions read as one short line', () => {
    expect(readsText(['xlsx', 'xls', 'csv'])).toBe('.xlsx, .xls, .csv');
  });

  it('a word is kept upper case', () => {
    expect(wordOf(' fv ')).toBe('FV');
  });

  it('the test picker takes files of the extensions read', () => {
    expect(takesFile(ROW, 'Plan A.PDF')).toBe(true);
    expect(takesFile(ROW, 'plan.dwg')).toBe(false);
    expect(takesFile(ROW, 'pdf')).toBe(false);
  });
});

describe('a phase 1 brain is known by a row with no kind', () => {
  it('rows with kind are phase 2; any row without is phase 1', () => {
    const list: PipelineList = { api: 1, pipelines: [ROW], countsPartial: false };
    expect(hasState(list)).toEqual([ROW]);
    const { kind: _k, ...v1 } = ROW;
    expect(hasState({ ...list, pipelines: [v1] })).toBeNull();
  });
});

describe('Save sends the changed values only', () => {
  it('nothing changed: no body', () => {
    expect(setBody(ROW, { width: 30, frames: false, words: ['AB'] }, null)).toBeNull();
  });

  it('only the changed option names', () => {
    expect(changedOptions(ROW, { width: 40, frames: false, words: ['AB'] })).toEqual({
      width: 40,
    });
    expect(setBody(ROW, { width: 30, frames: true, words: ['AB', 'CD'] }, null)).toEqual({
      options: { frames: true, words: ['AB', 'CD'] },
    });
  });

  it('a reader never sends workspaces; an after pipeline sends them when they moved', () => {
    const same = { width: 30, frames: false, words: ['AB'] };
    expect(setBody(ROW, same, ['w1'])).toBeNull();
    expect(setBody(AFTER, same, ['w1'])).toBeNull();
    expect(setBody(AFTER, same, [])).toEqual({ workspaces: [] });
    expect(setBody(AFTER, { ...same, width: 6 }, ['w1', 'w2'])).toEqual({
      options: { width: 6 },
      workspaces: ['w1', 'w2'],
    });
  });

  it('the saved row keeps the list counts (the PATCH answer has none)', () => {
    const saved = { ...ROW, files: null, older: null };
    expect(keepCounts(saved, ROW)).toMatchObject({ files: 4, older: 1 });
  });
});

describe("the screen is the settings area's", () => {
  it('a login without it is refused Settings > Pipelines', () => {
    expect(mayOpenPath([], '/settings/pipelines')).toBe(false);
    expect(mayOpenPath(['connectors', 'users'], '/settings/pipelines')).toBe(false);
    expect(mayOpenPath(['settings'], '/settings/pipelines')).toBe(true);
  });
});

describe('Settings > Pipelines, the M8 fields', () => {
  const stats = {
    description: 'Reads a PDF drawing.',
    versions: [
      { version: '1.1.0', files: 1 },
      { version: '1.0.0', files: 40 },
      { version: null, files: 3 },
    ],
    runs: 7,
    lastRunAt: '2026-11-02T09:30:00.000Z',
  };

  it('a row with no versions is a server before M8: no fields', () => {
    expect(statsOf(ROW)).toBeNull();
    expect(statsOf({ ...ROW, ...stats })).toEqual(stats);
  });

  it('current is the row version; every other is older; null is before versions', () => {
    expect(versionLines('1.1.0', stats.versions)).toEqual([
      '1 file read with 1.1.0 (current)',
      '40 files read with 1.0.0 (older)',
      '3 files read before versions were recorded',
    ]);
    expect(versionLines('2.0.0', stats.versions)[0]).toBe('1 file read with 1.1.0 (older)');
  });

  it('never ran: no count above 0 and no last run', () => {
    expect(neverRan({ runs: 0, lastRunAt: null })).toBe(true);
    expect(neverRan({ runs: null, lastRunAt: null })).toBe(true);
    expect(neverRan({ runs: 2, lastRunAt: stats.lastRunAt })).toBe(false);
  });

  it('the re-read label only with older files above 0', () => {
    expect(rereadLabel(null)).toBeNull();
    expect(rereadLabel(0)).toBeNull();
    expect(rereadLabel(1)).toBe('Read the 1 older file again');
    expect(rereadLabel(1200)).toBe('Read the 1,200 older files again');
  });

  it('a Save keeps the list versions and runs: the set answer has none', () => {
    const saved = { ...ROW, ...stats, files: null, older: null, versions: [], runs: null };
    const kept = keepCounts(saved, { ...ROW, ...stats });
    expect(kept.files).toBe(4);
    expect(statsOf(kept)).toEqual(stats);
  });
});
