/**
 * Settings > Pipelines renders the brain's list from one answer, as cards
 * with the open one's detail beside them. A phase 1 brain (rows with no
 * `kind`): every pipeline with its version, what it reads and its counts,
 * and a plain read-only detail. A phase 2 brain: each card wears its role
 * (Router, Reader, Transformer); the detail's form is made from each
 * option's spec; a reader and an `after` pipeline show every workspace with
 * a switch, on unless the off list holds it; a test result shows its tabs
 * and that nothing was written.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markRereadRouteGone, resetRereadRouteGone } from '@/lib/pipeline-run';
import {
  COUNTS_PARTIAL,
  NOTHING_WRITTEN,
  NOT_ON_DISK,
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

/** The URL's query: `?q=` is the search, `?selected=` the open card. */
const url = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/pipelines',
  useSearchParams: () => url.params,
}));
// The resizable scaffold is not this test's subject: both panes, in order.
vi.mock('@mantle/web-ui/ui/master-detail', async () => {
  const { createElement: h } = await import('react');
  return {
    MasterDetail: ({ list, detail }: { list: ReactNode; detail: ReactNode }) =>
      h('div', null, h('aside', null, list), h('main', null, detail)),
  };
});

const { PipelinesClient, PipelinesScreen } = await import('./pipelines-client');
const { PipelineDetail, TestResult } = await import('./pipeline-detail');

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

/** The screen on `list`, with the URL's query `query` ("q=reader"). */
function screen(list: PipelineList, query = '', workspaces: unknown[] = []): string {
  url.params = new URLSearchParams(query);
  return render(createElement(PipelinesScreen, { list }), workspaces);
}
/** The list pane and the detail pane of a screen's markup. */
const panes = (html: string) => ({
  list: html.slice(html.indexOf('<aside>'), html.indexOf('</aside>')),
  detail: html.slice(html.indexOf('<main>'), html.indexOf('</main>')),
});
/** The cards of a list pane: one button each, after the list header's
 *  Add button (P3-3). */
const cards = (list: string) =>
  list
    .split('<button')
    .slice(1)
    .filter((b) => !/^[^>]*>\s*(<svg[\s\S]*?<\/svg>)?\s*Add<\/button>/.test(b));
/** The detail's one button is the header's Info: "About this pipeline". */
const onlyInfoButton = (detail: string) =>
  detail.split('<button').length === 2 && detail.includes('aria-label="About this pipeline"');
const titleOf = (card: string) => card.match(/class="text-sm font-medium truncate">([^<]*)/)?.[1];

afterEach(() => {
  url.params = new URLSearchParams();
});

describe('Settings > Pipelines, a phase 1 brain', () => {
  it('a card per pipeline with its version, reads, files and the older line', () => {
    const { list } = panes(screen(LIST));
    expect(cards(list).map(titleOf)).toEqual(['Spreadsheet', 'CAD drawing']);
    const t = text(list);
    for (const want of [
      '.xlsx, .xls, .csv',
      '.dwg, .dxf, .dgn',
      '1.0.0',
      '1 file',
      '0 files',
      '1 file was read by an older version or with other options',
      '2 pipelines',
    ]) {
      expect(t, want).toContain(want);
    }
    expect(t).not.toContain(COUNTS_PARTIAL);
    // A row with no kind has no role: no pill.
    expect(list).not.toContain('data-role');
  });

  it('the first card is open: a plain detail with its facts, nothing to change', () => {
    const { list, detail } = panes(screen(LIST));
    expect(cards(list)[0]).toContain('data-selected="true"');
    expect(cards(list)[1]).not.toContain('data-selected');
    const t = text(detail);
    expect(detail).toMatch(/<h2[^>]*>.*Spreadsheet/);
    for (const want of [
      'A pipeline reads a file into its database when the file is uploaded.',
      'Version 1.0.0',
      'Reads .xlsx, .xls, .csv',
      'Files 1',
      'State On',
      '1 file was read by an older version or with other options',
    ]) {
      expect(t, want).toContain(want);
    }
    // The header's one Info button, and nothing to change under it.
    expect(onlyInfoButton(detail)).toBe(true);
    expect(detail).not.toMatch(/<input|<form|role="switch"/);
  });

  it('a count the brain did not make is a dash, and partial counts say so', () => {
    const list: PipelineList = {
      ...LIST,
      countsPartial: true,
      pipelines: [{ ...LIST.pipelines[0]!, files: null, older: null }],
    };
    const html = panes(screen(list));
    // The card shows the dash alone, as the detail does.
    expect(text(html.list)).toContain('· -');
    expect(text(html.list)).not.toContain('- files');
    expect(text(html.detail)).toContain('Files -');
    expect(text(html.list + html.detail)).not.toContain('older version');
    expect(text(html.list)).toContain(COUNTS_PARTIAL);
  });

  it('the client shows the answer of GET /api/pipelines', () => {
    const client = new QueryClient();
    client.setQueryData([PIPELINES_PATH], LIST);
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, {
        client,
        children: createElement(ToastProvider, { children: createElement(PipelinesClient) }),
      }),
    );
    expect(text(html)).toContain('Spreadsheet');
  });
});

describe('Settings > Pipelines, a phase 2 brain', () => {
  it('each card wears its role; the off count shows only above 0', () => {
    const list: PipelineList = { ...LIST, pipelines: [READER, AFTER] };
    const all = cards(panes(screen(list)).list);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatch(/data-role="reader"[^>]*>Reader</);
    expect(all[1]).toMatch(/data-role="after"[^>]*>Transformer</);
    expect(text(all[0]!)).not.toContain('Off in');
    expect(text(all[1]!)).toContain('Off in 1');
    expect(text(all.join(''))).not.toContain('Off in 0');
  });

  it('the search narrows the cards; "reader" finds the readers, and the count says so', () => {
    const list: PipelineList = { ...LIST, pipelines: [READER, AFTER] };
    const reader = panes(screen(list, 'q=reader')).list;
    expect(cards(reader).map(titleOf)).toEqual(['CAD drawing']);
    expect(text(reader)).toContain('1 of 2 pipelines');
    const after = panes(screen(list, 'q=transformer')).list;
    expect(cards(after).map(titleOf)).toEqual(['Site tags']);
    const none = text(panes(screen(list, 'q=nothing%20like%20this')).list);
    expect(none).toContain('No pipelines match');
    expect(none).toContain('Clear');
  });

  it('?selected= opens that card; the detail header names it with its role', () => {
    const list: PipelineList = { ...LIST, pipelines: [READER, AFTER] };
    const { list: l, detail } = panes(screen(list, 'selected=site-tags'));
    expect(cards(l)[1]).toContain('data-selected="true"');
    expect(cards(l)[0]).not.toContain('data-selected');
    expect(detail).toMatch(/<h2[^>]*>.*Site tags.*data-role="after"[^>]*>Transformer</);
    expect(text(detail)).toContain('Role Transformer, on texts-v1');
    // An id that is not in the list opens the first card.
    const odd = panes(screen(list, 'selected=gone')).detail;
    expect(odd).toMatch(/<h2[^>]*>.*CAD drawing/);
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

  it('the description shows on the card, cut to two lines', () => {
    const list: PipelineList = { ...LIST, pipelines: [M8, AFTER] };
    const card = cards(panes(screen(list)).list)[0]!;
    expect(card).toMatch(/class="[^"]*line-clamp-2[^"]*">Reads a CAD drawing/);
    expect(text(card)).toContain('1.1.0 · .dwg, .dxf, .dgn · 163 files');
    expect(text(card)).toContain('43 files were read by an older version or with other options');
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
    expect(cards(panes(screen(list)).list)[0]).not.toContain('line-clamp-2');
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
  it('the card: a router wears its role pill, with no file count and no off count', () => {
    const list: PipelineList = { ...LIST, pipelines: [M8, ROUTER] };
    const all = cards(panes(screen(list)).list);
    // Its card still opens its detail.
    expect(all).toHaveLength(2);
    const router = all[1]!;
    expect(router).toMatch(/data-role="router"[^>]*>Router</);
    const t = text(router);
    expect(t).toContain('PDF router');
    expect(t).toContain('Names the kind of a PDF.');
    expect(t).toContain('1.0.0 · .pdf');
    expect(t).not.toContain('files');
    expect(t).not.toContain('Off in');
    // The reader's count stays.
    expect(text(all[0]!)).toContain('163 files');
  });

  it('a click on the router card opens its read-only detail on the right', () => {
    const list: PipelineList = { ...LIST, pipelines: [M8, ROUTER] };
    const { detail } = panes(screen(list, 'selected=pdf-router'));
    expect(detail).toMatch(/<h2[^>]*>.*PDF router.*data-role="router"/);
    expect(text(detail)).toContain(ROUTER_WORKSPACES);
    expect(onlyInfoButton(detail)).toBe(true);
    expect(detail).not.toMatch(/<input|<form/);
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
    const card = cards(panes(screen(list)).list)[0]!;
    expect(text(card)).toContain('Sorter');
    expect(card).toMatch(/data-role="sorter"[^>]*>Sorter</);
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

describe('Settings > Pipelines, own pipelines (P3-3)', () => {
  /** An own Reader, as a P3-1 brain lists it (made up). */
  const OWN: PipelineRow = {
    ...READER,
    id: 'lx9-logger',
    name: 'LX-9 data logger',
    source: 'own',
    reads: ['lx9'],
    options: [],
    problem: null,
  };

  it('the list header has Add, on every brain', () => {
    expect(text(panes(screen(LIST)).list)).toMatch(/^ Pipelines Add /);
    expect(text(panes(screen({ ...LIST, pipelines: [READER, OWN] })).list)).toContain('Add');
  });

  it('an own card wears Own beside its role; a built-in does not', () => {
    const all = cards(panes(screen({ ...LIST, pipelines: [READER, OWN] })).list);
    expect(text(all[1]!)).toContain('Own');
    expect(all[1]).toMatch(/data-role="reader"/);
    expect(text(all[0]!)).not.toContain('Own');
  });

  it('the detail of an own row: Own, Download package and Remove in its header', () => {
    const { detail } = panes(screen({ ...LIST, pipelines: [READER, OWN] }, 'selected=lx9-logger'));
    const head = detail.slice(0, detail.indexOf('</h2>') + 600);
    expect(text(head)).toContain('Own');
    expect(detail).toContain('aria-label="Download package"');
    expect(detail).toContain('aria-label="Remove LX-9 data logger"');
    // The Test part stays as it is.
    expect(detail).toContain('aria-label="Test"');
    expect(detail).not.toContain('aria-label="Problem"');
  });

  it('a built-in shows no Download and no Remove', () => {
    const { detail } = panes(screen({ ...LIST, pipelines: [READER, OWN] }));
    // The header only: the word list's chips have their own Remove buttons.
    const head = detail.slice(0, detail.indexOf('aria-label="Overview"'));
    expect(head).toContain('aria-label="About this pipeline"');
    expect(head).not.toContain('Download package');
    expect(head).not.toContain('aria-label="Remove');
  });

  it('a row with files not on disk: a quiet mark on its card, its line, and Write the files again', () => {
    const gone = { ...OWN, problem: NOT_ON_DISK };
    const { list, detail } = panes(
      screen({ ...LIST, pipelines: [READER, gone] }, 'selected=lx9-logger'),
    );
    expect(cards(list)[1]).toContain('aria-label="Does not run: see its detail"');
    expect(cards(list)[0]).not.toContain('Does not run');
    const t = text(detail);
    expect(t).toContain(NOT_ON_DISK);
    expect(t).toContain('Write the files again');
  });

  it('another problem shows its line and offers nothing else', () => {
    const clash = {
      ...OWN,
      problem: 'A built-in now reads .lx9. Remove this one, or install it for another extension.',
    };
    const t = text(panes(screen({ ...LIST, pipelines: [clash] })).detail);
    expect(t).toContain('A built-in now reads .lx9.');
    expect(t).not.toContain('Write the files again');
  });
});
