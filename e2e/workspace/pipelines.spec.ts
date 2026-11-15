import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { scopedNav } from './shell-nav';

/**
 * Settings > Pipelines, a card per pipeline with the open one's detail on
 * the right. Phase 1: the readers that make a file's database, read only.
 * Phase 2: each card wears its role, a card opens its detail, Save sends a
 * PATCH with the changed values only, and a test runs on one file. The pipelines routes,
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

/** The two panes, once the scaffold has settled: `MasterDetail` swaps its
 *  grid for panels once on mount, and the handle exists only after. */
async function panes(page: Page) {
  await page
    .locator('[data-slot="resizable-panel-group"]:has([data-testid="list"])')
    .last()
    .locator(':scope > [data-slot="resizable-handle"]')
    .first()
    .waitFor();
  return { list: page.getByTestId('list'), detail: page.getByTestId('detail') };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pipeline's card in the list: a button whose name starts with its name. */
function card(list: Locator, name: string): Locator {
  return list.getByRole('button', { name: new RegExp(`^${esc(name)} `) });
}

/** The detail's header: the h2 of its ItemHeader, the open pipeline's name. */
const header = (detail: Locator) =>
  detail.getByTestId('item-header').getByRole('heading', { level: 2 });

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

  const { list, detail } = await panes(page);
  await expect(list.getByRole('button', { name: /^(?!Clear$|Add$)/ })).toHaveCount(5);
  const sheet = card(list, 'Spreadsheet');
  await expect(sheet).toContainText('1.0.0');
  await expect(sheet).toContainText('.xlsx, .xls, .csv');
  await expect(sheet).toContainText('1 file');
  await expect(sheet).toContainText('1 file was read by an older version or with other options');
  await expect(list.getByText(/read by an older version/)).toHaveCount(1);
  await expect(list.getByText('5 pipelines')).toBeVisible();
  await expect(page.getByText(/counts are partial/)).toHaveCount(0);
  // A phase 1 row has no role: no pill, and no switch in the list.
  await expect(list.locator('[data-role]')).toHaveCount(0);
  await expect(list.getByRole('switch')).toHaveCount(0);
  // The first card is open: its plain facts on the right, nothing to press.
  await expect(sheet).toHaveAttribute('data-selected', 'true');
  await expect(header(detail)).toHaveText('Spreadsheet');
  const facts = detail.getByRole('region', { name: 'Overview' });
  await expect(facts).toContainText('A pipeline reads a file into its database');
  await expect(facts).toContainText('StateOn');
  // The one button is the header's Info; nothing to change under it.
  await expect(detail.getByRole('button')).toHaveCount(1);
  await expect(detail.getByRole('button', { name: 'About this pipeline' })).toBeVisible();
  await expect(detail.getByRole('switch')).toHaveCount(0);
  // Another card opens its own facts.
  await card(list, 'CAD drawing').click();
  await expect(header(detail)).toHaveText('CAD drawing');
  await expect(facts).toContainText('.dwg, .dxf, .dgn');
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
  const { list } = await panes(page);
  await expect(list.getByText(/· -$/)).toHaveCount(5);
  await expect(list.getByText(/The counts are partial/)).toBeVisible();
});

test('a box before pipelines (404) gets one calm line, not an error', async ({ page }) => {
  // No route: the in-memory brain answers 404, as an older brain does.
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  await expect(page.getByText('This box does not list its pipelines yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByTestId('list')).toHaveCount(0);
});

/** A phase 2 brain's answer: the same rows with their state (made-up
 *  options), on in every workspace, and one `after` pipeline that is off in
 *  South site (WS[1] below). */
const LIST2 = {
  ...LIST,
  pipelines: [
    ...LIST.pipelines.map((p) => ({
      ...p,
      kind: 'reader',
      workspaces: 'all',
      offIn: [] as string[],
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
      workspaces: 'all',
      offIn: ['00000001-0000-4000-8000-000000000000'],
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
          // The server refuses `workspaces` since the off list: the
          // screen never sends it (the tests check the bodies).
          offIn: body.offIn ?? row.offIn,
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

test('phase 2: a reader is on in every workspace, Save sends the changed option only, then its off list', async ({
  page,
}) => {
  const sent = await routePhase2(page);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);
  // Only the Transformer is off somewhere.
  await expect(list.getByText(/^Off in/)).toHaveCount(1);
  await card(list, 'PDF drawing').click();
  await expect(header(detail)).toHaveText('PDF drawingReader');

  const settings = page.getByRole('region', { name: 'Options and workspaces' });
  await expect(settings.getByText('On in every workspace')).toBeVisible();
  const switches = settings.getByRole('switch', { name: /^Toggle / });
  await expect(switches).toHaveCount(2);
  for (const ws of WS) {
    await expect(settings.getByRole('switch', { name: `Toggle ${ws.name}` })).toBeChecked();
  }
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
  await expect(card(list, 'PDF drawing')).toContainText('0 files');
  await expect(card(list, 'PDF drawing')).not.toContainText(/· -/);

  // A reader too can be switched off in a workspace.
  await settings.getByRole('switch', { name: 'Toggle North site' }).click();
  await expect(settings.getByText('Off in 1 workspace')).toBeVisible();
  await save.click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toEqual({ offIn: [WS[0]!.id] });
  await expect(card(list, 'PDF drawing')).toContainText('Off in 1');
});

test('no click, an edit on the first card, a search that hides it: the detail and the edit stay', async ({
  page,
}) => {
  // PDF drawing first, so the card open at the start has an option.
  const pdf = LIST2.pipelines.find((p) => p.id === 'drawing-pdf')!;
  const seen = await routePipelines(page, {
    ...LIST2,
    pipelines: [pdf, ...LIST2.pipelines.filter((p) => p !== pdf)],
  });
  await page.route(
    (u) => u.pathname === '/api/workspaces',
    (route) => route.fulfill({ json: { workspaces: WS } }),
  );
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);
  await expect(card(list, 'PDF drawing')).toHaveAttribute('data-selected', 'true');
  const settings = page.getByRole('region', { name: 'Options and workspaces' });
  await settings.getByLabel('Box width').fill('40');

  await list.getByRole('textbox', { name: 'Search pipelines' }).fill('spreadsheet');
  await expect(card(list, 'PDF drawing')).toHaveCount(0);
  await expect(header(detail)).toHaveText('PDF drawingReader');
  await expect(settings.getByLabel('Box width')).toHaveValue('40');
  await expect(settings.getByRole('button', { name: 'Save pipeline' })).toBeEnabled();
  expect(seen.every((m) => m === 'GET')).toBe(true);
});

test('phase 2: a Transformer shows its role and its off count; switches and words are saved as offIn', async ({
  page,
}) => {
  const sent = await routePhase2(page);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);
  const row = card(list, 'Site tags');
  await expect(row).toContainText('Off in 1');
  await expect(row).toContainText('2 files were read by an older version or with other options');
  // The role a person reads: the data says `after`, the screen says Transformer.
  await expect(row.locator('[data-role="after"]')).toHaveText('Transformer');
  await row.click();
  await expect(header(detail)).toHaveText('Site tagsTransformer');

  const overview = page.getByRole('region', { name: 'Overview' });
  await expect(overview).toContainText('Transformer, on texts-v1');
  await expect(overview).not.toContainText('After a reader');

  const settings = page.getByRole('region', { name: 'Options and workspaces' });
  await expect(settings.getByText('Off in 1 workspace')).toBeVisible();
  const north = settings.getByRole('switch', { name: 'Toggle North site' });
  const south = settings.getByRole('switch', { name: 'Toggle South site' });
  await expect(north).toBeChecked();
  await expect(south).not.toBeChecked();
  await south.click();
  await expect(settings.getByText('On in every workspace')).toBeVisible();
  await north.click();
  await expect(settings.getByText('Off in 1 workspace')).toBeVisible();
  const words = settings.getByRole('textbox', { name: 'Tag prefixes' });
  await words.fill('fv');
  await words.press('Enter');
  await settings.getByRole('button', { name: 'Save pipeline' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toEqual({
    options: { prefixes: ['PT', 'FV'] },
    offIn: [WS[0]!.id],
  });
  // What the brain kept: sorted, upper case.
  await expect(settings.getByRole('button', { name: 'Remove FV' })).toBeVisible();
  await expect(row).toContainText('Off in 1');
  await expect(north).not.toBeChecked();
  await expect(south).toBeChecked();

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

/** An M8 brain: LIST2 with a description, the runs and the files by version
 *  on each row (made up). CAD drawing is at 1.1.0 with 43 older files. */
const LIST3 = {
  ...LIST2,
  pipelines: LIST2.pipelines.map((p) =>
    p.id === 'drawing-cad'
      ? {
          ...p,
          version: '1.1.0',
          description: 'Reads a CAD drawing into its texts, lines and symbols.',
          files: 163,
          older: 43,
          versions: [
            { version: '1.1.0', files: 120 },
            { version: '1.0.0', files: 40 },
            { version: null, files: 3 },
          ],
          runs: 1234,
          lastRunAt: '2026-11-02T09:30:00.000Z',
        }
      : { ...p, description: `Reads a ${p.name} file.`, versions: [], runs: 0, lastRunAt: null },
  ),
};

test('M8: the description, the runs, the files by version, and the re-read of the older files', async ({
  page,
}) => {
  let gets = 0;
  const sent: unknown[] = [];
  await page.route(
    (u) => u.pathname.startsWith('/api/pipelines'),
    async (route: Route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        gets++;
        return route.fulfill({ json: LIST3 });
      }
      expect(new URL(req.url()).pathname).toBe('/api/pipelines/drawing-cad/reread');
      const body = req.postDataJSON() as { apply?: boolean; after?: string };
      sent.push(body);
      const choices = [{ pipeline: 'drawing-cad', name: 'CAD drawing', files: 43, refused: null }];
      return route.fulfill({
        json: {
          apply: body.apply === true,
          busy: false,
          choices,
          queued: body.apply ? (body.after ? 3 : 40) : 0,
          skipped: {},
          next: body.apply && !body.after ? 'n-40' : null,
        },
      });
    },
  );
  await page.route(
    (u) => u.pathname === '/api/workspaces',
    (route) => route.fulfill({ json: { workspaces: WS } }),
  );
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);
  const row = card(list, 'CAD drawing');
  await expect(row).toContainText('Reads a CAD drawing into its texts, lines and symbols.');
  await row.click();
  await expect(header(detail)).toHaveText('CAD drawingReader');

  const overview = page.getByRole('region', { name: 'Overview' });
  await expect(overview).toContainText('Reads a CAD drawing into its texts, lines and symbols.');
  await expect(overview).toContainText('Runs: 1,234. Last run: ');
  await expect(overview).toContainText('120 files read with 1.1.0 (current)');
  await expect(overview).toContainText('40 files read with 1.0.0 (older)');
  await expect(overview).toContainText('3 files read before versions were recorded');
  await expect(overview).toContainText(
    '43 files were read by an older version or with other options',
  );

  // It asks first: the dry run, with the one choice picked.
  const before = gets;
  await overview.getByRole('button', { name: 'Read the 43 older files again' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('CAD drawing: 43 files');
  expect(sent).toEqual([{}]);
  await dialog.getByRole('button', { name: 'Run pipeline' }).click();
  await expect(dialog).toContainText('40 files are queued.');
  expect(sent[1]).toEqual({ apply: true });
  // After a run, the list is read again.
  await expect.poll(() => gets).toBeGreaterThan(before);
  await dialog.getByRole('button', { name: 'Run the next 100' }).click();
  await expect(dialog).toContainText('3 files are queued.');
  expect(sent[2]).toEqual({ apply: true, after: 'n-40' });
  await expect(dialog.getByRole('button', { name: 'Run the next 100' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toHaveCount(0);

  // A pipeline that never ran, with no older file: no button.
  await card(list, 'Microsoft Project plan').click();
  await expect(header(detail)).toHaveText('Microsoft Project planReader');
  const sheet = page.getByRole('region', { name: 'Overview' });
  await expect(sheet).toContainText('No run yet.');
  await expect(sheet.getByRole('button', { name: /older files? again/ })).toHaveCount(0);
});

/** A router brain: LIST3 with the router row and the PDF reader's claims, as
 *  the server gives them (mantle feat/router-2r; made-up counts). */
const LIST4 = {
  ...LIST3,
  pipelines: [
    ...LIST3.pipelines.map((p) =>
      p.id === 'drawing-pdf' ? { ...p, claims: ['pid', 'scan'] } : { ...p, claims: [] },
    ),
    {
      id: 'pdf-router',
      name: 'PDF router',
      description: 'Names the kind of a PDF.',
      version: '1.0.0',
      source: 'builtin',
      start: 'upload',
      kind: 'router',
      reads: ['pdf'],
      names: [
        { kind: 'pid', decider: false },
        { kind: 'table', decider: true },
      ],
      claims: [],
      weight: 'light',
      shapes: [],
      workers: ['decider'],
      tools: [],
      workspaces: 'all',
      offIn: [],
      after: null,
      tabs: [],
      options: [],
      files: null,
      older: null,
      versions: [],
      runs: 12,
      lastRunAt: '2026-11-02T09:30:00.000Z',
    },
  ],
};

test('a router: its row and its detail are read only; a reader shows the kinds it claims', async ({
  page,
}) => {
  const seen = await routePipelines(page, LIST4);
  await page.route(
    (u) => u.pathname === '/api/workspaces',
    (route) => route.fulfill({ json: { workspaces: WS } }),
  );
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);
  const row = card(list, 'PDF router');
  await expect(row).toContainText('Names the kind of a PDF.');
  await expect(row).toContainText('.pdf');
  await expect(row.locator('[data-role="router"]')).toHaveText('Router');
  await expect(row.getByText(/Off in/)).toHaveCount(0);
  // A router has no files of its own: no count, not even a dash.
  await expect(row).not.toContainText('files');
  await row.click();
  await expect(header(detail)).toHaveText('PDF routerRouter');

  const overview = page.getByRole('region', { name: 'Overview' });
  await expect(overview).toContainText('Router');
  await expect(overview).toContainText('Runs: 12. Last run: ');
  await expect(overview).toContainText('May ask');
  await expect(overview).toContainText('decider');
  const names = overview.getByRole('list', { name: 'Kinds it can name' });
  await expect(names.getByRole('listitem')).toHaveText([
    'pid',
    "table (only by the decider's answer)",
  ]);
  await expect(overview.getByRole('button')).toHaveCount(0);
  await expect(overview).toContainText('A router is used wherever its readers are.');
  await expect(overview.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Options and workspaces' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Test' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save pipeline' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run test' })).toHaveCount(0);

  // The PDF reader names the kinds it claims, in one line.
  await card(list, 'PDF drawing').click();
  await expect(header(detail)).toHaveText('PDF drawingReader');
  await expect(overview).toContainText(
    'Reads a file only when the router names one of these kinds: pid, scan.',
  );
  // A reader with no claims says nothing of the router.
  await card(list, 'Spreadsheet').click();
  await expect(header(detail)).toHaveText('SpreadsheetReader');
  await expect(overview).not.toContainText('the router names');
  expect(seen.every((m) => m === 'GET')).toBe(true);
});

test('the cards: a role pill each, the first one open, a search that narrows them by name or role', async ({
  page,
}) => {
  await routePipelines(page, LIST4);
  await page.route(
    (u) => u.pathname === '/api/workspaces',
    (route) => route.fulfill({ json: { workspaces: WS } }),
  );
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);

  // Every card in the server's order, each with its role.
  const all = list.getByRole('button', { name: /^(?!Clear$|Add$)/ });
  await expect(all).toHaveCount(7);
  await expect(list.getByText('7 pipelines')).toBeVisible();
  await expect(list.locator('[data-role="reader"]')).toHaveCount(5);
  await expect(list.locator('[data-role="after"]')).toHaveText(['Transformer']);
  await expect(list.locator('[data-role="router"]')).toHaveText(['Router']);

  // The first card is open at the start.
  await expect(card(list, 'Spreadsheet')).toHaveAttribute('data-selected', 'true');
  await expect(header(detail)).toHaveText('SpreadsheetReader');

  // A click shows that card's detail on the right.
  await card(list, 'PDF router').click();
  await expect(card(list, 'PDF router')).toHaveAttribute('data-selected', 'true');
  await expect(card(list, 'Spreadsheet')).not.toHaveAttribute('data-selected', 'true');
  await expect(header(detail)).toHaveText('PDF routerRouter');

  // The role word finds the readers; the count says how many of all.
  const search = list.getByRole('textbox', { name: 'Search pipelines' });
  await search.fill('reader');
  await expect(all).toHaveCount(5);
  await expect(list.getByText('5 of 7 pipelines')).toBeVisible();
  await expect(card(list, 'PDF router')).toHaveCount(0);
  await expect(page).toHaveURL((u) => u.searchParams.get('q') === 'reader');
  // The open card hidden by the search stays open, as on Tools.
  await expect(header(detail)).toHaveText('PDF routerRouter');

  await search.fill('transformer');
  await expect(all).toHaveCount(1);
  await expect(card(list, 'Site tags')).toBeVisible();

  // An extension, and a miss with its way back.
  await search.fill('.dgn');
  await expect(all).toHaveCount(1);
  await expect(card(list, 'CAD drawing')).toBeVisible();
  await search.fill('nothing like this');
  await expect(list.getByText('No pipelines match')).toBeVisible();
  await list.getByRole('button', { name: 'Clear' }).click();
  await expect(all).toHaveCount(7);
});

// ---------------------------------------------------------------------------
// Own pipelines (P3-3): Add from a folder, the Own pill, Download, Remove,
// a refusal's sentence, and a row whose files are not on disk. The brain is
// a small in-browser one with state: the list, the install, the package,
// the remove and the test (mantle feat/pipelines-p3-1, as built).

/** The manifest of the made-up Bun template (mantle
 *  docs/pipeline-template/bun/pipeline.json), as it is. */
const TEMPLATE_MANIFEST = {
  id: 'lx9-logger',
  name: 'LX-9 data logger',
  description: 'Reads an LX-9 logger export and writes its readings and its header as tabs.',
  version: '1.0.0',
  api: 1,
  kit: 1,
  runtime: 'bun',
  entry: 'step.ts',
  start: 'upload',
  match: { ext: ['lx9'] },
  produces: {},
  needs: { weight: 'light', timeMs: 60000, tools: ['file_tabs_write'] },
  options: {},
};

/** Write a package folder under the test's output, as a person has it on
 *  disk: the template's manifest, a step, and one binary file. */
function packageFolder(dir: string, manifest: Record<string, unknown>): string {
  const files: Record<string, string | Buffer> = {
    'pipeline.json': JSON.stringify(manifest, null, 2),
    'step.ts': 'export async function step() {\n  return { status: "ok", calls: [] };\n}\n',
    'bin/marker': Buffer.from([0xff, 0x00, 0xfe, 0x01]),
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const NOT_ON_DISK =
  'The files of this package are not on disk. Install it again with the same files.';
const INSTALL_NOTE =
  'This runs code on files of this box. You install it as you would a library. It reads new uploads from now on; for the files that are there, use pipeline_run on their folder.';

type OwnState = {
  files: Record<string, unknown>;
  problem: string | null;
};

/** The row of an own package, as the brain lists it. */
function ownRow(own: OwnState) {
  const m = JSON.parse(own.files['pipeline.json'] as string) as typeof TEMPLATE_MANIFEST;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    source: 'own',
    problem: own.problem,
    start: 'upload',
    kind: 'reader',
    reads: m.match.ext,
    names: [],
    claims: [],
    weight: 'light',
    shapes: [],
    workers: [],
    tools: ['file_tabs_write'],
    workspaces: 'all',
    offIn: [],
    after: null,
    tabs: [],
    options: [],
    files: 0,
    older: 0,
    versions: [],
    runs: 0,
    lastRunAt: null,
  };
}

/** A P3-1 brain with state. `own` holds the installed packages by id. A
 *  manifest whose id is a built-in's is refused with the brain's sentence;
 *  `noInstall` answers the install 405, as a brain before own pipelines. */
async function routeOwn(
  page: Page,
  own: Map<string, OwnState>,
  opts: { noInstall?: boolean } = {},
): Promise<Sent[]> {
  const sent: Sent[] = [];
  const builtins = LIST2.pipelines.map((p) => ({ ...p, problem: null }));
  await page.route(
    (u) => u.pathname.startsWith('/api/pipelines'),
    async (route: Route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const method = req.method();
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null;
      sent.push({ method, path, body });
      if (path === '/api/pipelines' && method === 'GET') {
        const rows = [...own.values()].map(ownRow);
        return route.fulfill({ json: { ...LIST2, pipelines: [...builtins, ...rows] } });
      }
      if (path === '/api/pipelines' && method === 'POST') {
        if (opts.noInstall)
          return route.fulfill({ status: 405, json: { error: 'method not allowed' } });
        const files = (body!.files ?? {}) as Record<string, unknown>;
        const m = JSON.parse(files['pipeline.json'] as string) as { id: string };
        if (builtins.some((b) => b.id === m.id)) {
          return route.fulfill({
            status: 400,
            json: { error: `The id ${m.id} is a built-in's. Give your pipeline another id.` },
          });
        }
        const was = own.get(m.id);
        own.set(m.id, { files, problem: null });
        return route.fulfill({
          json: {
            row: ownRow(own.get(m.id)!),
            note: was?.problem ? 'The files of version 1.0.0 are on disk again.' : INSTALL_NOTE,
          },
        });
      }
      const id = decodeURIComponent(path.split('/')[3] ?? '');
      if (path.endsWith('/package') && method === 'GET') {
        const o = own.get(id);
        if (!o) return route.fulfill({ status: 400, json: { error: `${id} is a built-in.` } });
        return route.fulfill({ json: { id, version: '1.0.0', files: o.files } });
      }
      if (path.endsWith('/test')) {
        return route.fulfill({
          json: {
            status: 'ok',
            pipeline: id,
            version: '1.0.0',
            ms: 12,
            tabs: [
              {
                name: 'Readings',
                rows: 2,
                columns: ['TIME', 'TAG', 'VALUE'],
                first: [['2026-01-04T08:00:00', 'PT-101', 412.5]],
              },
            ],
            shapes: [],
            warnings: [],
            writes: ['file_tabs_write'],
            word: null,
          },
        });
      }
      if (method === 'DELETE') {
        own.delete(id);
        return route.fulfill({
          json: {
            row: null,
            note: `Removed ${id}. The databases it wrote stay; a new upload of its file types gets none.`,
          },
        });
      }
      return route.fulfill({ status: 404, json: { error: 'not found' } });
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
              id: 'file-lx9',
              type: 'file',
              title: 'Bench log.lx9',
              path: '/Logs',
              summary: null,
              updatedAt: '2026-01-04T00:00:00.000Z',
            },
          ],
        },
      }),
  );
  return sent;
}

test('own: add the Bun template from a folder, see Reader and Own, test it, download it, remove it', async ({
  page,
}, info) => {
  const own = new Map<string, OwnState>();
  const sent = await routeOwn(page, own);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list, detail } = await panes(page);

  // A built-in has no Download and no Remove.
  await expect(header(detail)).toHaveText('SpreadsheetReader');
  await expect(detail.getByRole('button', { name: 'Download package' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: /^Remove / })).toHaveCount(0);

  await list.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a pipeline' });
  await expect(dialog.getByRole('button', { name: 'Install' })).toBeDisabled();
  await dialog
    .getByTestId('pipeline-folder-input')
    .setInputFiles(packageFolder(info.outputPath('bun'), TEMPLATE_MANIFEST));
  const pkg = dialog.getByRole('region', { name: 'Package' });
  await expect(pkg).toContainText('NameLX-9 data logger');
  await expect(pkg).toContainText('Version1.0.0');
  await expect(pkg).toContainText('Reads.lx9');
  await expect(pkg).toContainText('RoleReader');
  await expect(pkg).toContainText('3 files');
  await expect(pkg).toContainText(
    'This runs code on files of this box. You install it as you would a library.',
  );
  await expect(pkg).not.toContainText('Replaces');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog).toHaveCount(0);

  // The install: the package as the brain takes it, text as text and the
  // binary file as base64; nothing else in the body.
  const install = sent.find((s) => s.method === 'POST' && s.path === '/api/pipelines')!;
  expect(Object.keys(install.body as object)).toEqual(['files']);
  const files = (install.body as { files: Record<string, unknown> }).files;
  expect(Object.keys(files).sort()).toEqual(['bin/marker', 'pipeline.json', 'step.ts']);
  expect(JSON.parse(files['pipeline.json'] as string)).toEqual(TEMPLATE_MANIFEST);
  expect(files['bin/marker']).toEqual({ base64: '/wD+AQ==' });

  // The list is read again and the new card is open, with Reader and Own.
  const lx9 = card(list, 'LX-9 data logger');
  await expect(lx9).toHaveAttribute('data-selected', 'true');
  await expect(lx9.locator('[data-role="reader"]')).toHaveText('Reader');
  await expect(lx9).toContainText('Own');
  await expect(header(detail)).toHaveText('LX-9 data loggerReaderOwn');

  // Adding it again says what it replaces.
  await list.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog
    .getByTestId('pipeline-folder-input')
    .setInputFiles(
      packageFolder(info.outputPath('bun2'), { ...TEMPLATE_MANIFEST, version: '1.1.0' }),
    );
  await expect(dialog.getByRole('region', { name: 'Package' })).toContainText(
    'Replaces version 1.0.0',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The Test part, as it is.
  const testPart = detail.getByRole('region', { name: 'Test' });
  await testPart.getByRole('textbox', { name: 'File' }).fill('bench');
  await testPart.getByRole('button', { name: /Bench log\.lx9/ }).click();
  await testPart.getByRole('button', { name: 'Run test' }).click();
  await expect(testPart.getByRole('table', { name: 'Readings' })).toContainText('PT-101');

  // Download: the package, saved as <id>-<version>.json.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    detail.getByRole('button', { name: 'Download package' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('lx9-logger-1.0.0.json');
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
  expect(saved).toEqual({ id: 'lx9-logger', version: '1.0.0', files });

  // Remove: one confirm, which says the databases stay.
  await detail.getByRole('button', { name: 'Remove LX-9 data logger' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('The databases this pipeline wrote stay');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(card(list, 'LX-9 data logger')).toHaveCount(0);
  expect(sent.filter((s) => s.method === 'DELETE').map((s) => s.path)).toEqual([
    '/api/pipelines/lx9-logger',
  ]);
  await expect(header(detail)).toHaveText('SpreadsheetReader');
});

test("own: a refusal shows the brain's sentence, and the dialog stays open", async ({
  page,
}, info) => {
  const sent = await routeOwn(page, new Map());
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list } = await panes(page);
  await list.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a pipeline' });
  await dialog
    .getByTestId('pipeline-folder-input')
    .setInputFiles(packageFolder(info.outputPath('clash'), { ...TEMPLATE_MANIFEST, id: 'sheet' }));
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    "The id sheet is a built-in's. Give your pipeline another id.",
  );
  await expect(dialog).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

test('own: a brain before own pipelines answers the install 405, and the dialog says so', async ({
  page,
}, info) => {
  await routeOwn(page, new Map(), { noInstall: true });
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines');
  const { list } = await panes(page);
  await list.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a pipeline' });
  await dialog
    .getByTestId('pipeline-folder-input')
    .setInputFiles(packageFolder(info.outputPath('old'), TEMPLATE_MANIFEST));
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This box cannot add pipelines yet.');
});

test('own: a row whose files are not on disk shows its line; Write the files again sends the install', async ({
  page,
}) => {
  const files = {
    'pipeline.json': JSON.stringify(TEMPLATE_MANIFEST),
    'step.ts': 'export async function step() {}\n',
  };
  const own = new Map<string, OwnState>([['lx9-logger', { files, problem: NOT_ON_DISK }]]);
  const sent = await routeOwn(page, own);
  await signIn(page, 'admin');
  await page.goto('/settings/pipelines?selected=lx9-logger');
  const { list, detail } = await panes(page);
  const lx9 = card(list, 'LX-9 data logger');
  await expect(lx9.getByRole('img', { name: 'Does not run: see its detail' })).toBeVisible();
  await expect(card(list, 'Spreadsheet').getByRole('img', { name: /Does not run/ })).toHaveCount(0);
  const problem = detail.getByRole('region', { name: 'Problem' });
  await expect(problem).toContainText(NOT_ON_DISK);
  await problem.getByRole('button', { name: 'Write the files again' }).click();
  await expect(page.getByText('The files of version 1.0.0 are on disk again.')).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Problem' })).toHaveCount(0);
  await expect(lx9.getByRole('img', { name: /Does not run/ })).toHaveCount(0);
  // The row's own package, sent to the install route as it is.
  const writes = sent.filter((s) => s.method !== 'GET' || s.path.endsWith('/package'));
  expect(writes.map((s) => `${s.method} ${s.path}`)).toEqual([
    'GET /api/pipelines/lx9-logger/package',
    'POST /api/pipelines',
  ]);
  expect(writes[1]!.body).toEqual({ files });
});
