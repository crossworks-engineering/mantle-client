/**
 * Settings > Pipelines renders the brain's list from one answer. A phase 1
 * brain (rows with no `kind`): every pipeline with its version, what it
 * reads, On, and its counts, read only. A phase 2 brain: a row opens its
 * detail, whose form is made from each option's spec; a reader shows no
 * ticks, an `after` pipeline with no tick says it does nothing; a test
 * result shows its tabs and that nothing was written.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import { describe, expect, it } from 'vitest';
import {
  ATTACHED_NONE,
  COUNTS_PARTIAL,
  NOTHING_WRITTEN,
  PIPELINES_PATH,
  READER_EVERYWHERE,
  TEST_BUSY,
  type PipelineList,
  type PipelineRow,
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

/** A phase 2 `after` pipeline attached to no workspace (made up). */
const AFTER: PipelineRow = {
  ...LIST.pipelines[1]!,
  id: 'site-tags',
  name: 'Site tags',
  kind: 'after',
  workspaces: [],
  after: 'texts-v1',
  tabs: ['Site tags'],
  options: [],
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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
  it('a row opens its detail, and says where it is used', () => {
    const list: PipelineList = { ...LIST, pipelines: [READER, AFTER] };
    const html = renderToStaticMarkup(createElement(PipelinesList, { list, onOpen: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(text(html)).toContain('Every workspace');
    expect(text(html)).toContain('No workspace');
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

  it('a reader shows no ticks: it is used in every workspace', () => {
    const ws = [{ id: 'w1', name: 'North site', archived: false }];
    const html = render(createElement(PipelineDetail, { row: READER }), ws);
    expect(text(html)).toContain(READER_EVERYWHERE);
    expect(html).not.toContain('role="checkbox"');
    expect(text(html)).not.toContain('North site');
  });

  it('an after pipeline gets a tick per workspace, and with none it does nothing', () => {
    const ws = [
      { id: 'w1', name: 'North site', archived: false },
      { id: 'w2', name: 'South site', archived: false },
    ];
    const html = render(createElement(PipelineDetail, { row: AFTER }), ws);
    expect(html.match(/role="checkbox"/g)).toHaveLength(2);
    expect(text(html)).toContain(ATTACHED_NONE);
    expect(text(html)).not.toContain(READER_EVERYWHERE);

    const on = render(createElement(PipelineDetail, { row: { ...AFTER, workspaces: ['w1'] } }), ws);
    expect(text(on)).not.toContain(ATTACHED_NONE);
    expect(on.match(/aria-checked="true"/g)).toHaveLength(1);
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
