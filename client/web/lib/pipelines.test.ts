import { describe, expect, it } from 'vitest';
import { mayOpenPath } from './workspaces';
import {
  canChange,
  changedOptions,
  claimsText,
  countText,
  filterPipelines,
  hasState,
  keepCounts,
  kindText,
  nameLines,
  neverRan,
  offFromOn,
  offInOf,
  offText,
  olderText,
  readsText,
  rereadLabel,
  setBody,
  statsOf,
  takesFile,
  usedInText,
  versionLines,
  wordOf,
  CANNOT_ADD,
  NOT_ON_DISK,
  PACKAGE_FILES_MAX,
  PACKAGE_MAX_BYTES,
  addRefusedText,
  base64Of,
  canWriteAgain,
  isOwn,
  manifestFacts,
  packageFileName,
  packageFileOf,
  problemOf,
  readPackage,
  replacesText,
  type PickedFile,
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
  offIn: [],
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

const AFTER: PipelineRow = { ...ROW, id: 'site-tags', kind: 'after', offIn: ['w1'] };

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
    expect(setBody(ROW, { width: 30, frames: false, words: ['AB'] }, [])).toBeNull();
  });

  it('only the changed option names', () => {
    expect(changedOptions(ROW, { width: 40, frames: false, words: ['AB'] })).toEqual({
      width: 40,
    });
    expect(setBody(ROW, { width: 30, frames: true, words: ['AB', 'CD'] }, [])).toEqual({
      options: { frames: true, words: ['AB', 'CD'] },
    });
  });

  it('the off list goes as offIn when it moved, for a reader and a Transformer (`after`); never workspaces', () => {
    const same = { width: 30, frames: false, words: ['AB'] };
    expect(setBody(ROW, same, ['w1'])).toEqual({ offIn: ['w1'] });
    expect(setBody(AFTER, same, ['w1'])).toBeNull();
    expect(setBody(AFTER, same, [])).toEqual({ offIn: [] });
    expect(setBody(AFTER, { ...same, width: 6 }, ['w2', 'w1'])).toEqual({
      options: { width: 6 },
      offIn: ['w2', 'w1'],
    });
    // The order alone is no change.
    expect(setBody({ ...AFTER, offIn: ['w1', 'w2'] }, same, ['w2', 'w1'])).toBeNull();
    for (const off of [[], ['w1'], ['w1', 'w2']]) {
      expect(setBody(AFTER, { ...same, width: 7 }, off)).not.toHaveProperty('workspaces');
    }
  });

  it('an older server sends no offIn: on everywhere, and no crash', () => {
    const { offIn: _o, ...old } = ROW;
    expect(offInOf(old)).toEqual([]);
    expect(usedInText(old)).toBe('Every workspace');
    expect(setBody(old, { width: 30, frames: false, words: ['AB'] }, [])).toBeNull();
  });

  it('the summary line and the off list from the switches', () => {
    expect(offText(0)).toBe('On in every workspace');
    expect(offText(1)).toBe('Off in 1 workspace');
    expect(offText(3)).toBe('Off in 3 workspaces');
    // w2 switched off; w1 switched on again; x (not shown) stays off.
    expect(offFromOn(['w1', 'x'], ['w1', 'w2', 'w3'], ['w1', 'w3'])).toEqual(['x', 'w2']);
    expect(offFromOn([], ['w1'], ['w1'])).toEqual([]);
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

/** A router row as the server gives it (mantle feat/router-2r; made-up
 *  counts): no files, no options, no workspaces of its own. */
const ROUTER: PipelineRow = {
  ...ROW,
  id: 'pdf-router',
  name: 'PDF router',
  kind: 'router',
  reads: ['pdf'],
  shapes: [],
  workers: ['decider'],
  options: [],
  files: null,
  older: null,
  names: [
    { kind: 'pid', decider: false },
    { kind: 'pfd', decider: true },
  ],
  claims: [],
};

describe('Settings > Pipelines, the router and the kinds', () => {
  it('one rule: a reader and a Transformer (`after`) can change; a router and an unknown kind cannot', () => {
    expect(canChange(ROW)).toBe(true);
    expect(canChange(AFTER)).toBe(true);
    expect(canChange(ROUTER)).toBe(false);
    expect(canChange({ ...ROW, kind: 'sorter' })).toBe(false);
  });

  it('the role word, and the Used in cell', () => {
    expect(kindText(ROW)).toBe('Reader');
    expect(kindText(AFTER)).toBe('Transformer, on -');
    expect(kindText({ ...AFTER, after: 'texts-v1' })).toBe('Transformer, on texts-v1');
    expect(kindText({ ...ROW, kind: 'agent' })).toBe('Agent');
    expect(kindText(ROUTER)).toBe('Router');
    expect(kindText({ ...ROW, kind: 'sorter' })).toBe('Sorter');
    expect(usedInText(ROW)).toBe('Every workspace');
    expect(usedInText(AFTER)).toBe('Off in 1');
    expect(usedInText({ ...ROW, offIn: ['w1', 'w2'] })).toBe('Off in 2');
    expect(usedInText(ROUTER)).toBe('Router');
    expect(usedInText({ ...ROW, kind: 'sorter', workspaces: [] })).toBe('Sorter');
  });

  it("the kinds a router can name, the decider's marked", () => {
    expect(nameLines(ROUTER)).toEqual(['pid', "pfd (only by the decider's answer)"]);
  });

  it('the kinds a reader claims, in one line; none says nothing', () => {
    expect(claimsText({ ...ROW, claims: ['pid', 'scan'] })).toBe(
      'Reads a file only when the router names one of these kinds: pid, scan.',
    );
    expect(claimsText({ ...ROW, claims: [] })).toBeNull();
  });

  it('an older server sends no names and no claims: nothing shows', () => {
    const { names: _n, claims: _c, ...old } = ROUTER;
    expect(nameLines(old)).toEqual([]);
    expect(claimsText(ROW)).toBeNull();
  });
});

describe('filterPipelines: the search of the list', () => {
  const rows: PipelineRow[] = [
    { ...ROW, description: 'Reads a PDF drawing into its texts.', versions: [] } as PipelineRow,
    { ...AFTER, name: 'Site tags', reads: ['dwg'] },
    ROUTER,
  ];
  const ids = (q: string) => filterPipelines(rows, q).map((r) => r.id);

  it('an empty search keeps every row, in the order given', () => {
    expect(ids('')).toEqual(['drawing-pdf', 'site-tags', ROUTER.id]);
    expect(ids('   ')).toEqual(['drawing-pdf', 'site-tags', ROUTER.id]);
  });

  it('matches the name and the id, any case', () => {
    expect(ids('site TAGS')).toEqual(['site-tags']);
    expect(ids('drawing-pdf')).toEqual(['drawing-pdf']);
  });

  it('matches the role word a person reads, not only the data word', () => {
    expect(ids('reader')).toEqual(['drawing-pdf']);
    expect(ids('Transformer')).toEqual(['site-tags']);
    expect(ids('router')).toContain(ROUTER.id);
    expect(ids('router')).not.toContain('site-tags');
  });

  it('matches an extension, with or without its dot, and the description', () => {
    expect(ids('.dwg')).toEqual(['site-tags']);
    expect(ids('dwg')).toEqual(['site-tags']);
    expect(ids('into its texts')).toEqual(['drawing-pdf']);
  });

  it('every word must hit; a miss is empty', () => {
    expect(ids('reader pdf')).toEqual(['drawing-pdf']);
    expect(ids('reader dwg')).toEqual([]);
    expect(ids('nothing like this')).toEqual([]);
  });

  it('a phase 1 row (no kind) has no role to match', () => {
    const { kind: _k, ...v1 } = ROW;
    expect(filterPipelines([v1], 'reader')).toEqual([]);
    expect(filterPipelines([v1], 'pdf')).toHaveLength(1);
  });
});

// Own pipelines: the folder read into the package, the caps, "replaces
// version", the download file name, the problem text. Made-up package.

const enc = (s: string) => new TextEncoder().encode(s);
const MANIFEST = JSON.stringify({
  id: 'lx9-logger',
  name: 'LX-9 data logger',
  version: '1.1.0',
  match: { ext: ['lx9'] },
});
const folder = (files: Record<string, Uint8Array | null>): PickedFile[] =>
  Object.entries(files).map(([path, bytes]) => ({ path: `bun/${path}`, bytes }));

describe('own pipelines: the folder read into the package', () => {
  it('drops the folder name; text is text, other bytes are base64; the manifest facts show', () => {
    const bin = new Uint8Array([0xff, 0x00, 0xfe, 0x01]);
    const read = readPackage(
      folder({
        'pipeline.json': enc(MANIFEST),
        'step.ts': enc('export const step = 1;\n'),
        'bin/tool': bin,
      }),
    );
    expect(read.pkg.files).toEqual({
      'pipeline.json': MANIFEST,
      'step.ts': 'export const step = 1;\n',
      'bin/tool': { base64: base64Of(bin) },
    });
    expect(base64Of(bin)).toBe('/wD+AQ==');
    expect(read.count).toBe(3);
    expect(read.problems).toEqual([]);
    expect(read.manifest).toEqual({
      id: 'lx9-logger',
      name: 'LX-9 data logger',
      version: '1.1.0',
      reads: ['lx9'],
      role: 'Reader',
    });
  });

  it('a text file keeps its BOM, so its bytes are the same on the box', () => {
    expect(packageFileOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('﻿a');
  });

  it('a NUL byte goes as base64; CRLF stays text; an empty file is empty text', () => {
    expect(packageFileOf(enc('ab\u0000c'))).toEqual({ base64: base64Of(enc('ab\u0000c')) });
    expect(packageFileOf(new Uint8Array(4))).toEqual({ base64: 'AAAAAA==' });
    expect(packageFileOf(enc('a\r\nb\r\n'))).toBe('a\r\nb\r\n');
    expect(packageFileOf(new Uint8Array(0))).toBe('');
  });

  it("a file that could not be read, and Finder's file, are said, never dropped silently", () => {
    const read = readPackage(
      folder({ 'pipeline.json': enc(MANIFEST), 'step.ts': null, '.DS_Store': enc('x') }),
    );
    expect(read.problems).toEqual(['A file could not be read: step.ts.']);
    expect(read.leftOut).toEqual(['.DS_Store']);
    expect(read.pkg.files).not.toHaveProperty('.DS_Store');
  });

  it('a folder over the caps is a problem before the send', () => {
    const many = Object.fromEntries(
      Array.from({ length: PACKAGE_FILES_MAX + 1 }, (_, i) => [`f${i}.txt`, enc('a')]),
    );
    expect(readPackage(folder(many)).problems).toEqual([
      `A package has at most 200 files; this folder has ${PACKAGE_FILES_MAX + 1}.`,
    ]);
    const big = readPackage(folder({ 'a.bin': new Uint8Array(PACKAGE_MAX_BYTES + 1) }));
    expect(big.problems).toEqual([
      'A package is at most 5.0 MB of files; this folder has 5.0 MB, 1 B over.',
    ]);
    expect(readPackage(folder({})).problems).toEqual(['The folder has no files.']);
  });

  it('no pipeline.json, or one that is not JSON: no facts, and the brain says why', () => {
    expect(readPackage(folder({ 'step.ts': enc('x') })).manifest).toBeNull();
    expect(manifestFacts('{ not json')).toBeNull();
    expect(manifestFacts('[]')).toBeNull();
    expect(manifestFacts('{"router":true}')?.role).toBe('Router');
    expect(manifestFacts('{"match":{"after":"texts-v1"}}')?.role).toBe('Transformer');
  });
});

describe('own pipelines: replaces, download name, problem, refusal', () => {
  const own = { ...ROW, id: 'lx9-logger', source: 'own' as const, version: '1.0.0' };
  it('an own row of the same id says it is installed; a new id or a built-in id says nothing', () => {
    const line =
      'Version 1.0.0 is installed: a higher version replaces it; the same version with the same files writes its folder again.';
    expect(replacesText([own], { id: 'lx9-logger', version: '1.1.0' })).toBe(line);
    expect(replacesText([own], { id: 'lx9-logger', version: '0.9.0' })).toBe(line);
    expect(replacesText([{ ...own, version: '' }], { id: 'lx9-logger', version: '1.0.0' })).toBe(
      'A version is installed: a higher version replaces it; the same version with the same files writes its folder again.',
    );
    expect(replacesText([own], { id: 'other', version: '1.0.0' })).toBeNull();
    expect(replacesText([ROW], { id: ROW.id, version: '2.0.0' })).toBeNull();
  });

  it('the download is saved as <id>-<version>.json', () => {
    expect(packageFileName('lx9-logger', '1.0.0')).toBe('lx9-logger-1.0.0.json');
    expect(packageFileName('lx9-logger', null)).toBe('lx9-logger.json');
  });

  it('the problem of a row; an older server sends none; only "not on disk" has its act', () => {
    expect(problemOf(ROW)).toBeNull();
    expect(problemOf({ ...own, problem: null } as typeof own)).toBeNull();
    expect(problemOf({ ...own, problem: NOT_ON_DISK } as typeof own)).toBe(NOT_ON_DISK);
    expect(canWriteAgain(NOT_ON_DISK)).toBe(true);
    expect(canWriteAgain('A built-in now reads .lx9.')).toBe(false);
    expect(isOwn(own)).toBe(true);
    expect(isOwn(ROW)).toBe(false);
  });

  it("a refused install shows the brain's sentence; no install route says so plainly", () => {
    const err = (message: string, status: number) => Object.assign(new Error(message), { status });
    expect(addRefusedText(err('Version 1.2.0 is installed. Send a higher version.', 400))).toBe(
      'Version 1.2.0 is installed. Send a higher version.',
    );
    expect(addRefusedText(err('not found', 404))).toBe(CANNOT_ADD);
    expect(addRefusedText(err('method not allowed', 405))).toBe(CANNOT_ADD);
  });
});
