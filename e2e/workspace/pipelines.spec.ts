import { expect, test, type Page, type Route } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { scopedNav } from './shell-nav';

/**
 * Settings > Pipelines. Phase 1: the readers that make a file's database,
 * read only. Phase 2: a row opens its detail, Save sends a PATCH with the
 * changed values only, and a test runs on one file. The pipelines routes,
 * /api/workspaces and the file search are fixed answers given in the
 * browser; the rest is the in-memory brain, which answers the list 404 like
 * a brain before pipelines.
 */

/** A phase 1 brain's answer, as one was given (made-up counts). */
const LIST = {
  api: 1,
  pipelines: [
    ['sheet', 'Spreadsheet', ['xlsx', 'xls', 'csv'], 'light', [], 1, 1],
    ['plan-mspdi', 'Microsoft Project plan', ['xml'], 'light', [], 0, 0],
    ['drawing-pdf', 'PDF drawing', ['pdf'], 'light', ['pdf-file-v1'], 0, 0],
    ['plot-dwf', 'DWF plot set', ['dwf'], 'heavy', [], 0, 0],
    [
      'drawing-cad',
      'CAD drawing',
      ['dwg', 'dxf', 'dgn'],
      'heavy',
      ['drawing-v1', 'circuit-v1'],
      0,
      0,
    ],
  ].map(([id, name, reads, weight, shapes, files, older]) => ({
    id,
    name,
    version: '1.0.0',
    source: 'builtin',
    start: 'upload',
    reads,
    weight,
    shapes,
    workers: [],
    tools: [],
    files,
    older,
  })),
  countsPartial: false,
};

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

/** Answer GET /api/pipelines with `body`, and keep every request to it. */
async function routePipelines(page: Page, body: unknown): Promise<string[]> {
  const seen: string[] = [];
  await page.route(
    (u) => u.pathname === '/api/pipelines',
    async (route: Route) => {
      seen.push(route.request().method());
      return route.fulfill({ json: body });
    },
  );
  return seen;
}

test('an admin opens Pipelines from Settings: the list, its counts, one GET and no write', async ({
  page,
}) => {
  const seen = await routePipelines(page, LIST);
  await signIn(page, 'admin');
  const nav = await scopedNav(page, 'Settings');
  await nav.getByRole('link', { name: 'Pipelines', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/settings/pipelines');

  const table = page.getByRole('main').getByRole('table', { name: 'Pipelines' });
  await expect(table.getByRole('row')).toHaveCount(6);
  const sheet = table.getByRole('row').filter({ hasText: 'Spreadsheet' });
  await expect(sheet).toContainText('1.0.0');
  await expect(sheet).toContainText('.xlsx, .xls, .csv');
  await expect(sheet).toContainText('On');
  await expect(sheet).toContainText('1 file was read by an older version or with other options');
  await expect(table.getByText(/read by an older version/)).toHaveCount(1);
  await expect(table.getByText('On', { exact: true })).toHaveCount(5);
  await expect(page.getByText(/counts are partial/)).toHaveCount(0);
  // Read only: no switch and no button in the list.
  await expect(table.getByRole('switch')).toHaveCount(0);
  await expect(table.getByRole('button')).toHaveCount(0);
  await expect(page.getByText('You cannot manage this part of the brain.')).toHaveCount(0);

  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((m) => m === 'GET')).toBe(true);
});

test('null counts are a dash, and partial counts say so', async ({ page }) => {
  await routePipelines(page, {
    ...LIST,
    countsPartial: true,
    pipelines: LIST.pipelines.map((p) => ({ ...p, files: null, older: null })),
  });
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const table = page.getByRole('main').getByRole('table', { name: 'Pipelines' });
  await expect(table.getByRole('cell', { name: '-', exact: true })).toHaveCount(5);
  await expect(page.getByText(/The counts are partial/)).toBeVisible();
});

test('a box before pipelines (404) gets one calm line, not an error', async ({ page }) => {
  // No route: the in-memory brain answers 404, as an older brain does.
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  await expect(page.getByText('This box does not list its pipelines yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Pipelines' })).toHaveCount(0);
});

/** A phase 2 brain's answer: the same rows with their state (made-up
 *  options), and one `after` pipeline attached to no workspace. */
const LIST2 = {
  ...LIST,
  pipelines: [
    ...LIST.pipelines.map((p) => ({
      ...p,
      kind: 'reader',
      workspaces: 'all',
      after: null,
      tabs: [],
      options:
        p.id === 'drawing-pdf'
          ? [
              {
                name: 'box_width',
                spec: { type: 'number', label: 'Box width', default: 30, min: 5, max: 90 },
                value: 30,
              },
              {
                name: 'box_on',
                spec: { type: 'bool', label: 'Use the box', default: false },
                value: false,
              },
            ]
          : [],
    })),
    {
      id: 'site-tags',
      name: 'Site tags',
      version: '1.0.0',
      source: 'builtin',
      start: 'upload',
      kind: 'after',
      reads: ['dwg', 'pdf'],
      weight: 'light',
      shapes: [],
      workers: [],
      tools: [],
      workspaces: [],
      after: 'texts-v1',
      tabs: ['Site tags'],
      options: [
        {
          name: 'prefixes',
          spec: {
            type: 'words',
            label: 'Tag prefixes',
            default: [],
            maxItems: 50,
            maxChars: 8,
          },
          value: ['PT'],
        },
      ],
      files: 3,
      older: 2,
    },
  ],
};

/** Two workspaces as GET /api/workspaces gives them (made up). */
const WS = ['North site', 'South site'].map((name, i) => ({
  id: `0000000${i}-0000-4000-8000-000000000000`,
  name,
  description: '',
  contactNodeId: null,
  assistant: null,
  isAdmin: false,
  builtIn: false,
  adminModerated: false,
  archived: false,
  userCount: 1,
  resourceCount: 0,
  me: { member: true, moderator: false },
}));

type Sent = { method: string; path: string; body: unknown };

/** A phase 2 brain: the list, PATCH (the row back with no counts and the
 *  words upper case and sorted, as the brain gives them), the test, the
 *  workspaces and one file in the search. Keeps every write. */
async function routePhase2(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route(
    (u) => u.pathname.startsWith('/api/pipelines'),
    async (route: Route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'GET') return route.fulfill({ json: LIST2 });
      const body = req.postDataJSON() as Record<string, unknown>;
      sent.push({ method: req.method(), path, body });
      if (path.endsWith('/test')) {
        return route.fulfill({
          json: {
            status: 'ok',
            pipeline: 'site-tags',
            version: '1.0.0',
            ms: 42,
            tabs: [
              { name: 'Site tags', rows: 1, columns: ['Tag', 'Page'], first: [['FV-101', 1]] },
            ],
            shapes: [],
            warnings: [],
            writes: ['file_tabs_write'],
            word: null,
          },
        });
      }
      const row = LIST2.pipelines.find((p) => path.endsWith(`/${p.id}`))!;
      const opts = (body.options ?? {}) as Record<string, unknown>;
      return route.fulfill({
        json: {
          ...row,
          files: null,
          older: null,
          workspaces: body.workspaces ?? row.workspaces,
          options: row.options.map((o) =>
            o.name in opts
              ? {
                  ...o,
                  value: Array.isArray(opts[o.name])
                    ? [...new Set((opts[o.name] as string[]).map((w) => w.toUpperCase()))].sort()
                    : opts[o.name],
                }
              : o,
          ),
        },
      });
    },
  );
  await page.route(
    (u) => u.pathname === '/api/workspaces',
    (route) => route.fulfill({ json: { workspaces: WS } }),
  );
  await page.route(
    (u) => u.pathname === '/api/search',
    (route) =>
      route.fulfill({
        json: {
          results: [
            {
              id: 'file-1',
              type: 'file',
              title: 'Unit plan.dwg',
              path: '/Drawings',
              summary: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'file-2',
              type: 'file',
              title: 'Notes.md',
              path: '/Drawings',
              summary: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
  );
  return sent;
}

test('phase 2: a reader shows no ticks, and Save sends the changed option only', async ({
  page,
}) => {
  const sent = await routePhase2(page);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const table = page.getByRole('main').getByRole('table', { name: 'Pipelines' });
  await expect(table.getByText('Every workspace')).toHaveCount(5);
  await table.getByRole('button', { name: 'PDF drawing' }).click();

  const settings = page.getByRole('region', { name: 'Options and workspaces' });
  await expect(settings.getByText('Used in every workspace.')).toBeVisible();
  await expect(settings.getByRole('checkbox')).toHaveCount(0);
  const save = settings.getByRole('button', { name: 'Save pipeline' });
  await expect(save).toBeDisabled();

  await settings.getByLabel('Box width').fill('40');
  await save.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    method: 'PATCH',
    path: '/api/pipelines/drawing-pdf',
    body: { options: { box_width: 40 } },
  });
  await expect(save).toBeDisabled();
  // The counts stay those of the list: the PATCH answer has none.
  await expect(table.getByRole('row').filter({ hasText: 'Spreadsheet' })).toContainText('1');
});

test('phase 2: an after pipeline with no tick does nothing; ticks and words are saved', async ({
  page,
}) => {
  const sent = await routePhase2(page);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const table = page.getByRole('main').getByRole('table', { name: 'Pipelines' });
  const row = table.getByRole('row').filter({ hasText: 'Site tags' });
  await expect(row).toContainText('No workspace');
  await expect(row).toContainText('2 files were read by an older version or with other options');
  await row.getByRole('button', { name: 'Site tags' }).click();

  const settings = page.getByRole('region', { name: 'Options and workspaces' });
  await expect(settings.getByText('Attached to no workspace. It does nothing.')).toBeVisible();
  await settings.getByRole('checkbox', { name: 'North site' }).click();
  await expect(settings.getByText('Attached to no workspace. It does nothing.')).toHaveCount(0);
  const words = settings.getByRole('textbox', { name: 'Tag prefixes' });
  await words.fill('fv');
  await words.press('Enter');
  await settings.getByRole('button', { name: 'Save pipeline' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toEqual({
    options: { prefixes: ['PT', 'FV'] },
    workspaces: [WS[0]!.id],
  });
  // What the brain kept: sorted, upper case.
  await expect(settings.getByRole('button', { name: 'Remove FV' })).toBeVisible();
  await expect(row).toContainText('1 workspace');

  // The test sends the form's options, saved or not, and writes nothing.
  await words.fill('lt');
  await words.press('Enter');
  const testPart = page.getByRole('region', { name: 'Test' });
  await testPart.getByLabel('File').fill('unit');
  await testPart.getByRole('button', { name: /Unit plan\.dwg/ }).click();
  await expect(testPart.getByRole('button', { name: /Notes\.md/ })).toHaveCount(0);
  await testPart.getByRole('button', { name: 'Run test' }).click();
  await expect(testPart.getByText('Nothing was written.')).toBeVisible();
  await expect(testPart.getByRole('table', { name: 'Site tags' })).toContainText('FV-101');
  expect(sent[1]).toEqual({
    method: 'POST',
    path: '/api/pipelines/site-tags/test',
    body: { fileId: 'file-1', options: { prefixes: ['FV', 'PT', 'LT'] } },
  });
});
