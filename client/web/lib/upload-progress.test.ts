import { describe, it, expect } from 'vitest';
import {
  aggregateProgress,
  clashVerdict,
  etaSeconds,
  formatBytes,
  formatEta,
  formatRate,
  isNameClash,
  isSpreadsheetName,
  noAutoTablesOf,
  overLimitMessage,
  progressTicker,
  sha256Hex,
  spreadsheetHint,
  storedFilename,
  updateRate,
  uploadForm,
} from './upload-progress';

describe('formatting', () => {
  it('formats bytes at a sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2.5 * 1024)).toBe('2.5 KB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
  });
  it('formats rate and eta', () => {
    expect(formatRate(3.1 * 1024 * 1024)).toBe('3.1 MB/s');
    expect(formatRate(null)).toBe('');
    expect(formatEta(2)).toBe('almost done');
    expect(formatEta(45)).toBe('45s left');
    expect(formatEta(80)).toBe('1m 20s left');
    expect(formatEta(3725)).toBe('1h 2m left');
  });
  it('says both numbers when refusing a file', () => {
    expect(overLimitMessage(250 * 1024 * 1024, 64 * 1024 * 1024)).toBe(
      'File is 250 MB. The limit is 64 MB.',
    );
  });
});

describe('rate + eta', () => {
  it('seeds then smooths the rate', () => {
    const r1 = updateRate(null, 1000, 1000);
    expect(r1).toBe(1000);
    const r2 = updateRate(r1, 3000, 1000);
    expect(r2).toBeCloseTo(1600);
    expect(updateRate(r2, 10, 0)).toBe(r2);
  });
  it('derives eta from what is left', () => {
    expect(etaSeconds(50, 100, 10)).toBe(5);
    expect(etaSeconds(50, 100, null)).toBeNull();
    expect(etaSeconds(150, 100, 10)).toBe(0);
  });
});

describe('aggregateProgress', () => {
  it('counts bytes, not files, and skips failed or cancelled tasks', () => {
    const agg = aggregateProgress([
      { status: 'done', size: 100, loaded: 100, rate: null },
      { status: 'uploading', size: 900, loaded: 300, rate: 100 },
      { status: 'pending', size: 1000, loaded: 0, rate: null },
      { status: 'error', size: 5000, loaded: 0, rate: null },
      { status: 'cancelled', size: 5000, loaded: 10, rate: null },
    ]);
    expect(agg.total).toBe(2000);
    expect(agg.loaded).toBe(400);
    expect(agg.pct).toBe(20);
    expect(agg.rate).toBe(100);
    expect(agg.etaSec).toBe(16);
  });
  it('is quiet when nothing is queued', () => {
    expect(aggregateProgress([])).toEqual({
      loaded: 0,
      total: 0,
      pct: 0,
      rate: null,
      etaSec: null,
    });
  });
});

describe('uploadForm', () => {
  it('sends confirm before the file part, so the brain reads it first', () => {
    const form = uploadForm('files.shared', new Blob(['x']), true);
    expect([...form.keys()]).toEqual(['parentPath', 'confirm', 'file']);
    expect(form.get('confirm')).toBe('true');
    expect(form.get('parentPath')).toBe('files.shared');
  });
  it('sends replace before the file part too', () => {
    const form = uploadForm('files', new Blob(['x']), false, true);
    expect([...form.keys()]).toEqual(['parentPath', 'replace', 'file']);
  });
  it('sends no confirm unless asked', () => {
    expect([...uploadForm('files', new Blob(['x'])).keys()]).toEqual(['parentPath', 'file']);
  });
});

describe('name clashes', () => {
  it('stores names as the brain does', () => {
    expect(storedFilename('My Doc.PDF')).toBe('my-doc.pdf');
    expect(storedFilename('a/b/readme.md')).toBe('readme.md');
    expect(storedFilename('..hidden.md')).toBe('hidden.md');
  });
  it('spots the brain’s name-taken refusal only', () => {
    expect(isNameClash(409, { error: "adoptSpooled: 'a.txt' already exists in this folder" })).toBe(
      true,
    );
    expect(isNameClash(409, { error: 'visibility' })).toBe(false);
    expect(isNameClash(400, { error: 'already exists' })).toBe(false);
  });
  it('calls equal bytes already uploaded and other bytes a different version', () => {
    expect(clashVerdict({ size: 3, sha256: 'aa' }, { sizeBytes: 3, sha256: 'aa' })).toBe('same');
    expect(clashVerdict({ size: 3, sha256: 'aa' }, { sizeBytes: 3, sha256: 'bb' })).toBe(
      'different',
    );
    expect(clashVerdict({ size: 3, sha256: null }, { sizeBytes: 4, sha256: 'aa' })).toBe(
      'different',
    );
    expect(clashVerdict({ size: 3, sha256: null }, { sizeBytes: 3, sha256: 'aa' })).toBe(
      'same-size',
    );
    expect(clashVerdict({ size: 3, sha256: 'aa' }, undefined)).toBe('different');
  });
  it('hashes a file as hex SHA-256', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('leaves clashes out of the byte progress', () => {
    const agg = aggregateProgress([
      { status: 'done', size: 10, loaded: 10, rate: null },
      { status: 'exists', size: 50, loaded: 50, rate: null },
      { status: 'conflict', size: 50, loaded: 0, rate: null },
    ]);
    expect(agg).toMatchObject({ loaded: 10, total: 10, pct: 100 });
  });
});

describe('progressTicker', () => {
  it('throttles, and always gives the last one', () => {
    const ticks: number[] = [];
    const onProgress = progressTicker((loaded) => ticks.push(loaded));
    onProgress(10, 100); // the first
    onProgress(20, 100); // inside the tick: dropped
    onProgress(100, 100); // the last
    expect(ticks).toEqual([10, 100]);
  });
});

describe('the dock line for a spreadsheet', () => {
  const line =
    'Spreadsheets stay in Files. For a Table, use the upload button next to New on the Tables screen.';
  const done = (name: string) => ({ name, status: 'done' });

  it('knows the three types', () => {
    for (const name of ['a.xlsx', 'a.xls', 'a.CSV'])
      expect(isSpreadsheetName(name), name).toBe(true);
    for (const name of ['a.pdf', 'a.xlsm', 'xlsx'])
      expect(isSpreadsheetName(name), name).toBe(false);
  });

  it('shows only with the field and only for those types', () => {
    expect(spreadsheetHint([done('a.xlsx')], true)).toBe(line);
    expect(spreadsheetHint([done('a.xls')], true)).toBe(line);
    expect(spreadsheetHint([done('a.csv')], true)).toBe(line);
    expect(spreadsheetHint([done('a.pdf'), done('b.csv')], true)).toBe(line);
    expect(spreadsheetHint([done('a.pdf')], true)).toBeNull();
    expect(spreadsheetHint([done('a.xlsx')], false)).toBeNull();
    expect(spreadsheetHint([], true)).toBeNull();
  });

  it('only for a file going in or there', () => {
    for (const status of ['pending', 'uploading', 'done', 'exists']) {
      expect(spreadsheetHint([{ name: 'a.csv', status }], true), status).toBe(line);
    }
    for (const status of ['error', 'cancelled', 'conflict']) {
      expect(spreadsheetHint([{ name: 'a.csv', status }], true), status).toBeNull();
    }
  });

  it('reads the field: true only, an older brain sends none', () => {
    expect(noAutoTablesOf({ noAutoTables: true })).toBe(true);
    expect(noAutoTablesOf({ noAutoTables: false })).toBe(false);
    expect(noAutoTablesOf({})).toBe(false);
    expect(noAutoTablesOf(null)).toBe(false);
  });
});
