import { expect, test, type Page, type Route } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { scopedNav } from './shell-nav';

/**
 * Settings > Pipelines (pipelines phase 1): the readers that make a file's
 * database, read only. The list is a fixed answer of GET /api/pipelines,
 * answered in the browser; the rest is the in-memory brain, which answers
 * the route 404 like a brain before pipelines.
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
  await expect(sheet).toContainText('1 file was read by an older version');
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
