import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { DATA_FILE, routeFileDb, type FileDbMock, type FileDbOptions } from './mock-file-db';

/**
 * A file's read-only database in Files (file-data.tsx): the whole content
 * area beside the folder tree, in the Tables tab bar and grid. A made-up
 * database of 40 columns, answered in the browser (mock-file-db.ts); the rest
 * is the in-memory brain.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

async function openData(page: Page, view = 'data', opts?: FileDbOptions): Promise<FileDbMock> {
  const seen = await routeFileDb(page, opts);
  await signIn(page, 'member');
  await page.goto(`/files?path=${DATA_FILE.parentPath}&file=${DATA_FILE.id}&view=${view}`);
  return seen;
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Database tabs' });

test('a wide tab shows every column, scrolls sideways, and keeps its header on top', async ({
  page,
}) => {
  await openData(page);
  const grid = page.getByRole('region', { name: 'Points: rows' });
  await expect(grid.getByText('P-0001', { exact: true })).toBeVisible();
  await expect(tabs(page).getByRole('tab', { name: /Points/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Every column is in the grid: no "more" cut.
  await expect(grid.getByRole('columnheader')).toHaveCount(40);
  // (The file's own header keeps its "More" menu: the cut is about the rows.)
  await expect(grid.getByText(/\bmore\b/i)).toHaveCount(0);
  await expect(tabs(page).getByText(/\bmore\b/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /load more|show more|more columns/i })).toHaveCount(
    0,
  );

  // The last column is past the right edge until the grid scrolls sideways.
  const last = grid.getByRole('columnheader', { name: /Last remark/ });
  await expect(last).not.toBeInViewport();
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await grid.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(last).toBeInViewport();
  await expect(grid.getByText('End of row 1', { exact: true })).toBeInViewport();

  // Down the rows, the header row stays on top.
  await grid.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 2000;
  });
  await expect(grid.getByText('P-0001', { exact: true })).not.toBeInViewport();
  await expect(grid.getByRole('columnheader', { name: /Point id/ })).toBeInViewport();

  // The scroll area takes the focus, for the arrow keys.
  await grid.focus();
  await expect(grid).toBeFocused();
});

test('the pager steps through the rows, and a sort asks the brain for every row', async ({
  page,
}) => {
  const seen = await openData(page);
  const grid = page.getByRole('region', { name: 'Points: rows' });
  const text = page.getByTestId('db-page-text');
  await expect(text).toHaveText('Rows 1 to 100 of 1,234');

  // Scrolled to the bottom of page one, the next page starts at its top.
  await grid.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(text).toHaveText('Rows 101 to 200 of 1,234');
  await expect(grid.getByText('P-0101', { exact: true })).toBeInViewport();
  expect(seen.sql.at(-1)).toContain('LIMIT 100 OFFSET 100');

  await page.getByRole('button', { name: 'Last page' }).click();
  await expect(text).toHaveText('Rows 1,201 to 1,234 of 1,234');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

  await page.getByRole('combobox', { name: 'Rows per page' }).click();
  await page.getByRole('option', { name: '250' }).click();
  await expect(text).toHaveText('Rows 1 to 250 of 1,234');

  // Sort on a column: page one again, ordered by the brain over all rows.
  await grid
    .getByRole('columnheader', { name: /Point id/ })
    .getByRole('button', { name: /sort options/ })
    .click();
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await expect(grid.getByText('P-1234', { exact: true })).toBeVisible();
  expect(seen.sql.at(-1)).toContain('ORDER BY "Point id" DESC, "_pos" LIMIT 250 OFFSET 0');
});

test('a tab is in the URL: a switch changes it and a reload keeps it', async ({ page }) => {
  await openData(page);
  await tabs(page).getByRole('tab', { name: /Lines/ }).click();
  await expect(page).toHaveURL((u) => u.searchParams.get('dbtab') === 'Lines');
  const lines = page.getByRole('region', { name: 'Lines: rows' });
  await expect(lines.getByText('L-0001', { exact: true })).toBeVisible();
  await expect(tabs(page).getByRole('tab', { name: /Lines/ })).toContainText('87');

  await page.reload();
  await expect(tabs(page).getByRole('tab', { name: /Lines/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(lines.getByText('L-0001', { exact: true })).toBeVisible();

  // Back to the file clears it.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page).toHaveURL((u) => !u.searchParams.has('view') && !u.searchParams.has('dbtab'));
});

test('the query tab highlights SQL, runs on Ctrl or Cmd + Enter, and shows the result grid', async ({
  page,
}) => {
  await openData(page);
  await tabs(page).getByRole('tab', { name: 'Query' }).click();
  await expect(page).toHaveURL((u) => u.searchParams.get('view') === 'query');

  const box = page.getByRole('textbox', { name: 'SQL query' });
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(
    'SELECT "Point id", "Field 02"\nFROM "Points" -- made-up\nWHERE "Field 02" > 1.5\nLIMIT 50',
  );
  // The highlighter's tokens: keywords, a number, a comment.
  const view = page.locator('.code-view');
  await expect(view.locator('.hljs-keyword', { hasText: 'SELECT' })).toBeVisible();
  await expect(view.locator('.hljs-keyword', { hasText: 'WHERE' })).toBeVisible();
  await expect(view.locator('.hljs-number', { hasText: '50' })).toBeVisible();
  await expect(view.locator('.hljs-comment', { hasText: '-- made-up' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Enter');
  const result = page.getByRole('region', { name: 'Query result' });
  await expect(result.getByText('P-0001', { exact: true })).toBeVisible();
  await expect(result.getByRole('columnheader')).toHaveCount(2);
  await expect(page.getByTestId('db-query-meta')).toHaveText('50 rows in 3 ms');

  // A name from the list goes in at the caret.
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('SELECT count(*) FROM ');
  await page
    .getByRole('navigation', { name: 'Tabs and columns' })
    .getByRole('button', { name: /^Lines/ })
    .click();
  await expect(box).toHaveValue('SELECT count(*) FROM "Lines"');

  // The last query stays for the session.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toHaveValue(
    'SELECT count(*) FROM "Lines"',
  );
});

test('a bad query shows the brain’s error in place', async ({ page }) => {
  await openData(page, 'query');
  const box = page.getByRole('textbox', { name: 'SQL query' });
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('SELECT bogus FROM "Points"');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'The query did not run.' });
  await expect(alert).toContainText('no such column: bogus');
  await expect(page.getByRole('region', { name: 'Query result' })).toHaveCount(0);
});

test('the top row says which pipeline read the database, and nothing before stamps', async ({
  page,
}) => {
  await openData(page, 'data', {
    row: { dataView: true },
    readBy: { pipeline: 'sheet', version: '1.0.0' },
  });
  await expect(page.getByText('Read by sheet 1.0.0.', { exact: true })).toBeVisible();
  await expect(page.getByText('3 tabs, read only.')).toBeVisible();

  // A database made before stamps: no line, not an empty label.
  await page.unrouteAll({ behavior: 'wait' });
  await routeFileDb(page, { row: { dataView: true }, readBy: null });
  await page.reload();
  await expect(page.getByText('3 tabs, read only.')).toBeVisible();
  await expect(page.getByText(/^Read by/)).toHaveCount(0);
});

test('the brain decides the Data view: a PDF it marks has one, a CSV it does not has none', async ({
  page,
}) => {
  const data = () => page.getByRole('button', { name: 'Data', exact: true });
  const loaded = () => page.getByRole('button', { name: 'About this file' });
  await routeFileDb(page, {
    row: { dataView: true, extension: 'pdf', mimeType: 'application/pdf' },
  });
  await signIn(page, 'member');
  await page.goto(`/files?path=${DATA_FILE.parentPath}&file=${DATA_FILE.id}`);
  await expect(loaded()).toBeVisible();
  await expect(data()).toBeVisible();

  await page.unrouteAll({ behavior: 'wait' });
  await routeFileDb(page, { row: { dataView: false } });
  await page.reload();
  await expect(loaded()).toBeVisible();
  await expect(data()).toHaveCount(0);
});
