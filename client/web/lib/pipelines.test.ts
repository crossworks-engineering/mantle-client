import { describe, expect, it } from 'vitest';
import { mayOpenPath } from './workspaces';
import {
  canChange,
  changedOptions,
  claimsText,
  countText,
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
