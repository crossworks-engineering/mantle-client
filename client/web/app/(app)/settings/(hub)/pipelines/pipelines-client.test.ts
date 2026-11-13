/**
 * Settings > Pipelines renders the brain's list from one answer: every
 * pipeline with its version, what it reads, On, and its counts; a dash for a
 * count the brain did not make; the partial note when the scan stopped.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { COUNTS_PARTIAL, PIPELINES_PATH, type PipelineList } from '@/lib/pipelines';
import { PipelinesClient, PipelinesList } from './pipelines-client';

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

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Settings > Pipelines', () => {
  it('lists every pipeline with its version, reads, state and files', () => {
    const html = text(renderToStaticMarkup(createElement(PipelinesList, { list: LIST })));
    for (const want of [
      'Spreadsheet',
      'CAD drawing',
      '.xlsx, .xls, .csv',
      '.dwg, .dxf, .dgn',
      '1.0.0',
      '1 file was read by an older version',
    ]) {
      expect(html, want).toContain(want);
    }
    expect(html.match(/ On /g)).toHaveLength(2);
    expect(html).not.toContain(COUNTS_PARTIAL);
    // Read only: nothing to press.
    expect(renderToStaticMarkup(createElement(PipelinesList, { list: LIST }))).not.toMatch(
      /<button|role="switch"/,
    );
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
