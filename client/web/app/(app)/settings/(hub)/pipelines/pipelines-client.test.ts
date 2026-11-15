/**
 * Settings > Pipelines renders the brain's list from one answer. A phase 1
 * brain (rows with no `kind`): every pipeline with its version, what it
 * reads, On, and its counts, read only. A phase 2 brain: a row opens its
 * detail, whose form is made from each option's spec; a reader and an
 * `after` pipeline show every workspace with a switch, on unless the off
 * list holds it; a test result shows its tabs and that nothing was written.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import { afterEach, describe, expect, it } from 'vitest';
import { markRereadRouteGone, resetRereadRouteGone } from '@/lib/pipeline-run';
import {
  COUNTS_PARTIAL,
  NOTHING_WRITTEN,
  NO_RUN_YET,
  PIPELINES_PATH,
  ROUTER_WORKSPACES,
  TEST_BUSY,
  type PipelineList,
  type PipelineRow,
  type PipelineStats,
  type PipelineTestResult,
} from '@/lib/pipelines';
import { WORKSPACES_KEY } from '@/lib/workspaces';
import { PipelinesClient, PipelinesList } from './pipelines-client';
import { PipelineDetail, TestResult } from './pipeline-detail';

/** A fixed answer of GET /api/pipelines, as a phase 1 brain gives it. */
const LIST: PipelineList = {
  api: 1,
  pipelines: [
    {
      id: 'sheet',
      name: 'Spreadsheet',
      version: '1.0.0',
      source: 'builtin',
      start: 'upload',
      reads: ['xlsx', 'xls', 'csv'],
      weight: 'light',
      shapes: [],
      workers: [],
      tools: [],
      files: 1,
      older: 1,
    },
    {
      id: 'drawing-cad',
      name: 'CAD drawing',
      version: '1.0.0',
      source: 'builtin',
      start: 'upload',
      reads: ['dwg', 'dxf', 'dgn'],
      weight: 'heavy',
      shapes: ['drawing-v1', 'circuit-v1'],
      workers: [],
      tools: [],
      files: 0,
      older: 0,
    },
  ],
  countsPartial: false,
};

/** A phase 2 reader with one option of each type (made up). */
const READER: PipelineRow = {
  ...LIST.pipelines[1]!,
  kind: 'reader',
  workspaces: 'all',
  offIn: [],
  after: null,
  tabs: [],
  options: [
    {
      name: 'box_width',
      spec: { type: 'number', label: 'Box width', default: 30, min: 5, max: 90 },
      value: 30,
    },
    {
      name: 'keep_frames',
      spec: { type: 'bool', label: 'Keep frames', help: 'Keeps the frame texts.', default: false },
      value: true,
    },
    {
      name: 'prefixes',
      spec: {
        type: 'words',
        label: 'Tag prefixes',
        default: [],
        maxItems: 50,
        maxChars: 8,
      },
      value: ['FV', 'PT'],
    },
  ],
};

/** A phase 2 `after` pipeline, off in one workspace (made up). */
const AFTER: PipelineRow = {
  ...LIST.pipelines[1]!,
  id: 'site-tags',
  name: 'Site tags',
  kind: 'after',
  workspaces: 'all',
  offIn: ['w2'],
  after: 'texts-v1',
  tabs: ['Site tags'],
  options: [],
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

function render(node: ReactNode, workspaces: unknown[] = []): string {
  const client = new QueryClient();
  client.setQueryData(WORKSPACES_KEY, workspaces);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ToastProvider, { children: node }),
    ),
  );
}

describe('Settings > Pipelines, a phase 1 brain', () => {
  it('lists every pipeline with its version, reads, state and files', () => {
    const html = text(renderToStaticMarkup(createElement(PipelinesList, { list: LIST })));
    for (const want of [
      'Spreadsheet',
      'CAD drawing',
      '.xlsx, .xls, .csv',
      '.dwg, .dxf, .dgn',
      '1.0.0',
      '1 file was read by an older version or with other options',
    ]) {
      expect(html, want).toContain(want);
    }
    expect(html.match(/ On /g)).toHaveLength(2);
    expect(html).not.toContain(COUNTS_PARTIAL);
  });

  it('a row with no kind is the read-only list: nothing to press', () => {
    const html = renderToStaticMarkup(
      createElement(PipelinesList, { list: LIST, onOpen: () => {} }),
    );
    expect(html).not.toMatch(/<button|role="switch"/);
  });

  it('a count the brain did not make is a dash, and partial counts say so', () => {
    const list: PipelineList = {
      ...LIST,
      countsPartial: true,
      pipelines: [{ ...LIST.pipelines[0]!, files: null, older: null }],
    };
    const html = text(renderToStaticMarkup(createElement(PipelinesList, { list })));
    expect(html).toContain(' - ');
    expect(html).not.toContain('older version');
    expect(html).toContain(COUNTS_PARTIAL);
  });

  it('the client shows the answer of GET /api/pipelines', () => {
    const client = new QueryClient();
    client.setQueryData([PIPELINES_PATH], LIST);
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(PipelinesClient) }),
    );
    expect(text(html)).toContain('Spreadsheet');
  });
});

describe('Settings > Pipelines, a phase 2 brain', () => {
  it('a row opens its detail, and shows the off count only above 0', () => {
    const list: PipelineList = { ...LIST, pipelines: [READER, AFTER] };
    const html = renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(text(html)).toContain('Every workspace');
    expect(text(html)).toContain('Off in 1');
    expect(text(html)).not.toContain('Off in 0');
  });

  it('the detail renders each option type from its spec', () => {
    const html = render(createElement(PipelineDetail, { row: READER }));
    // number: its bounds
    expect(html).toMatch(/type="number"[^>]*min="5"[^>]*max="90"/);
    expect(text(html)).toContain('From 5 to 90; default 30.');
    // bool: a switch, on
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(text(html)).toContain('Keeps the frame texts.');
    // words: chips
    expect(text(html)).toContain('Tag prefixes');
    expect(html).toContain('aria-label="Remove FV"');
    expect(html).toContain('aria-label="Remove PT"');
    expect(text(html)).toContain('At most 50 words of 8 characters.');
  });

  const WS = [
    { id: 'w1', name: 'North site', archived: false },
    { id: 'w2', name: 'South site', archived: false },
    { id: 'w3', name: 'Old site', archived: true },
  ];
  const wsSwitch = (html: string, name: string) =>
    html.match(new RegExp(`aria-checked="(true|false)"[^>]*aria-label="Toggle ${name}"`))?.[1];

  it('a reader gets a switch per workspace, every one on by default', () => {
    const html = render(createElement(PipelineDetail, { row: READER }), WS);
    expect(text(html)).toContain('On in every workspace');
    expect(wsSwitch(html, 'North site')).toBe('true');
    expect(wsSwitch(html, 'South site')).toBe('true');
    // An archived workspace that is not off is not shown.
    expect(text(html)).not.toContain('Old site');
    expect(html).not.toContain('role="checkbox"');
  });

  it('a Transformer (`after`): its off list turns those switches off, and the line counts them', () => {
    const html = render(createElement(PipelineDetail, { row: AFTER }), WS);
    expect(text(html)).toContain('Role Transformer, on texts-v1');
    expect(text(html)).not.toContain('After a reader');
    expect(text(html)).toContain('Off in 1 workspace');
    expect(wsSwitch(html, 'North site')).toBe('true');
    expect(wsSwitch(html, 'South site')).toBe('false');

    // An archived workspace in the off list stays visible, off.
    const two = render(
      createElement(PipelineDetail, { row: { ...AFTER, offIn: ['w2', 'w3'] } }),
      WS,
    );
    expect(text(two)).toContain('Off in 2 workspaces');
    expect(wsSwitch(two, 'Old site')).toBe('false');
    expect(text(two)).toContain('Archived');
  });

  it('a row of an older server (no offIn) is on everywhere', () => {
    const { offIn: _o, ...old } = AFTER;
    const html = render(createElement(PipelineDetail, { row: old }), WS);
    expect(text(html)).toContain('On in every workspace');
    expect(wsSwitch(html, 'South site')).toBe('true');
  });

  it('the test part shows a fixed result, and that nothing was written', () => {
    const result: PipelineTestResult = {
      status: 'ok',
      pipeline: 'site-tags',
      version: '1.0.0',
      ms: 1234,
      tabs: [
        {
          name: 'Site tags',
          rows: 2,
          columns: ['Tag', 'Page'],
          first: [
            ['FV-101', 1],
            ['PT-202', 2],
          ],
        },
      ],
      shapes: [],
      warnings: ['Only the first 10 texts were read.'],
      writes: ['file_tabs_write'],
      word: null,
    };
    const html = text(renderToStaticMarkup(createElement(TestResult, { result })));
    for (const want of [
      'Read',
      '1,234 ms',
      'Site tags',
      '2 rows',
      'Tag',
      'FV-101',
      'PT-202',
      'Only the first 10 texts were read.',
      NOTHING_WRITTEN,
    ]) {
      expect(html, want).toContain(want);
    }

    const none = text(
      renderToStaticMarkup(
        createElement(TestResult, {
          result: { ...result, status: 'not_mine', tabs: [], warnings: [], word: 'no-match' },
        }),
      ),
    );
    expect(none).toContain('no-match');
    expect(none).toContain(NOTHING_WRITTEN);
  });

  it('busy is no error: the reader is busy, try again', () => {
    const html = text(
      renderToStaticMarkup(
        createElement(TestResult, {
          result: {
            status: 'busy',
            pipeline: 'drawing-cad',
            version: '1.0.0',
            ms: 0,
            tabs: [],
            shapes: [],
            warnings: [],
            writes: [],
            word: null,
          },
        }),
      ),
    );
    expect(html).toContain(TEST_BUSY);
    expect(html).not.toMatch(/failed/i);
  });
});

/** The fields of an M8 server on the reader (made up): a current version, an
 *  older one, and files read before versions were recorded. */
const STATS: PipelineStats = {
  description: 'Reads a CAD drawing into its texts, lines and symbols.',
  versions: [
    { version: '1.1.0', files: 120 },
    { version: '1.0.0', files: 40 },
    { version: null, files: 3 },
  ],
  runs: 1234,
  lastRunAt: '2026-11-02T09:30:00.000Z',
};
const M8: PipelineRow = { ...READER, version: '1.1.0', files: 163, older: 43, ...STATS };

describe('Settings > Pipelines, an M8 server: description, runs, versions', () => {
  afterEach(() => resetRereadRouteGone());

  it('the description shows under the name in the list, cut to one line', () => {
    const list: PipelineList = { ...LIST, pipelines: [M8, AFTER] };
    const html = renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} }));
    expect(text(html)).toContain(STATS.description);
    expect(html).toMatch(/class="[^"]*truncate[^"]*" title="Reads a CAD drawing/);
  });

  it('the Overview shows the whole description, the runs and one line per version', () => {
    const t = text(render(createElement(PipelineDetail, { row: M8 })));
    for (const want of [
      STATS.description,
      'Runs: 1,234. Last run: ',
      '120 files read with 1.1.0 (current)',
      '40 files read with 1.0.0 (older)',
      '3 files read before versions were recorded',
      '43 files were read by an older version or with other options',
      'Read the 43 older files again',
    ]) {
      expect(t, want).toContain(want);
    }
    expect(t).not.toContain(NO_RUN_YET);
  });

  it('a pipeline that never ran says so', () => {
    for (const runs of [0, null]) {
      const row = { ...M8, runs, lastRunAt: null };
      const t = text(render(createElement(PipelineDetail, { row })));
      expect(t).toContain(NO_RUN_YET);
      expect(t).not.toContain('Runs:');
    }
  });

  it('the re-read button shows only with older files above 0', () => {
    const none = text(render(createElement(PipelineDetail, { row: { ...M8, older: 0 } })));
    expect(none).not.toContain('older files again');
    const uncounted = text(render(createElement(PipelineDetail, { row: { ...M8, older: null } })));
    expect(uncounted).not.toContain('older files again');
    const one = text(render(createElement(PipelineDetail, { row: { ...M8, older: 1 } })));
    expect(one).toContain('Read the 1 older file again');
  });

  it('a 404 of the re-read route hides the button for the session', () => {
    markRereadRouteGone();
    const t = text(render(createElement(PipelineDetail, { row: M8 })));
    expect(t).not.toContain('older files again');
    // The numbers stay: only the button goes.
    expect(t).toContain('40 files read with 1.0.0 (older)');
  });

  it('a row with no versions (a server before M8) shows none of the new parts', () => {
    const t = text(render(createElement(PipelineDetail, { row: { ...READER, older: 5 } })));
    for (const not of [NO_RUN_YET, 'Runs:', 'files read', 'older files again']) {
      expect(t, not).not.toContain(not);
    }
    const list: PipelineList = { ...LIST, pipelines: [READER] };
    const html = renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} }));
    expect(html).not.toContain('truncate');
  });
});

/** A router row as the server gives it (mantle feat/router-2r; made up). */
const ROUTER: PipelineRow & PipelineStats = {
  ...M8,
  id: 'pdf-router',
  name: 'PDF router',
  kind: 'router',
  version: '1.0.0',
  description: 'Names the kind of a PDF.',
  reads: ['pdf'],
  shapes: [],
  workers: ['decider'],
  options: [],
  files: null,
  older: null,
  versions: [],
  runs: 12,
  lastRunAt: '2026-11-02T09:30:00.000Z',
  names: [
    { kind: 'pid', decider: false },
    { kind: 'table', decider: true },
  ],
  claims: [],
};

describe('Settings > Pipelines, a router and kinds the client does not know', () => {
  it('the list: a router row reads as a router, with no file count', () => {
    const list: PipelineList = { ...LIST, pipelines: [M8, ROUTER] };
    const html = renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} }));
    const t = text(html);
    expect(t).toContain('PDF router');
    expect(t).toContain('Names the kind of a PDF.');
    expect(t).toContain(' Router ');
    expect(t).toContain('.pdf');
    // Its name still opens its detail.
    expect(html.match(/<button/g)).toHaveLength(2);
    // The router's Files cell is empty, not a dash; the reader's count stays.
    expect(t).not.toContain(' - ');
    expect(t).toContain('163');
  });

  it('the detail of a router: what it names and asks, its runs, and nothing to change', () => {
    const html = render(createElement(PipelineDetail, { row: ROUTER }));
    const t = text(html);
    for (const want of [
      'Router',
      'File types',
      '.pdf',
      'pid',
      "table (only by the decider's answer)",
      'May ask decider',
      'Runs: 12. Last run: ',
      ROUTER_WORKSPACES,
    ]) {
      expect(t, want).toContain(want);
    }
    expect(t).not.toContain("pid (only by the decider's answer)");
    for (const not of [
      'Options and workspaces',
      'This pipeline has no options.',
      'On in every workspace',
      'Toggle ',
      'Save pipeline',
      'Run test',
      'older files again',
    ]) {
      expect(t, not).not.toContain(not);
    }
    expect(html).not.toMatch(/<button|<input|<form/);
  });

  it('a reader with claims says so in one line; with none it says nothing', () => {
    const claims = text(
      render(createElement(PipelineDetail, { row: { ...M8, claims: ['pid', 'scan'] } })),
    );
    expect(claims).toContain(
      'Reads a file only when the router names one of these kinds: pid, scan.',
    );
    for (const row of [{ ...M8, claims: [] }, M8]) {
      const t = text(render(createElement(PipelineDetail, { row })));
      expect(t).not.toContain('the router names');
    }
  });

  it('an unknown kind is a plain, read-only row and detail', () => {
    // A future kind with none of the phase 2 parts: nothing may fail.
    const { options: _o, workspaces: _w, offIn: _f, tabs: _t, ...bare } = READER;
    const odd = { ...bare, id: 'sorter-1', name: 'Sorter', kind: 'sorter' } as PipelineRow;
    const list: PipelineList = { ...LIST, pipelines: [odd] };
    const row = text(
      renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} })),
    );
    expect(row).toContain('Sorter');
    const html = render(createElement(PipelineDetail, { row: odd }));
    expect(text(html)).toContain('Role Sorter');
    expect(html).not.toMatch(/<button|<input|<form/);
  });

  it('an older server (no router, no claims) shows the reader as before', () => {
    const t = text(render(createElement(PipelineDetail, { row: READER })));
    expect(t).toContain('Role Reader');
    expect(t).toContain('Options and workspaces');
    expect(t).toContain('Run test');
    expect(t).not.toContain('the router names');
  });
});
