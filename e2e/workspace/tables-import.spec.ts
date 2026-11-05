import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  WORKSPACES,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';
import { scopedNav } from './shell-nav';

/**
 * The Tables screen's Import (a spreadsheet becomes a new table), and the
 * upload dock's line for a spreadsheet in Files. In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const CSV = { mimeType: 'text/csv', buffer: Buffer.from('Name\nFirst row\n') };
const NEEDS_UPDATE = 'This brain needs an update before it can import a table.';
const MAY_LAND =
  'The file was sent, but the answer was lost. The table may still appear. Check the list before you try again.';

async function openImport(page: Page) {
  await page.goto('/tables');
  await page.getByRole('main').getByRole('button', { name: 'Import a table', exact: true }).click();
  return page.getByRole('dialog', { name: 'Import a table' });
}

async function pickAndSend(page: Page, name = 'stock-list.csv') {
  await page.locator('#table-import-file').setInputFiles({ name, ...CSV });
  await page.getByRole('button', { name: 'Import table' }).click();
}

/** The brain still making the table, until the spec lets it answer. */
function holdTheAnswer() {
  let answer = () => {};
  api.tableImportHold = new Promise((resolve) => (answer = resolve));
  return answer;
}

/** A slow line, so an upload is really under way when the spec acts. */
async function slowLine(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 64 * 1024,
  });
}

/** Send a file big enough for the slow line, and wait until it is part way. */
async function sendPartWay(page: Page, dialog: Locator) {
  await page.locator('#table-import-file').setInputFiles({
    name: 'big.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(2 * 1024 * 1024, 'a'),
  });
  await dialog.getByRole('button', { name: 'Import table' }).click();
  const bar = dialog.getByRole('progressbar');
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
}

/** Whether a reload or a tab close would ask first. */
const unloadGuarded = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

/** Into Tables from Files, so Back leaves the screen. */
async function openImportFromFiles(page: Page) {
  await page.goto('/files');
  const nav = await scopedNav(page, 'Work');
  await nav.getByRole('link', { name: 'Tables', exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/tables');
  await page.getByRole('main').getByRole('button', { name: 'Import a table', exact: true }).click();
  return page.getByRole('dialog', { name: 'Import a table' });
}

const importFailed = (page: Page) =>
  page.waitForEvent('requestfailed', (r) => r.url().includes('/api/tables/import'));

const importsWs = () =>
  api.requests
    .filter((r) => r.method === 'POST' && r.path === '/api/tables/import')
    .map((r) => new URLSearchParams(r.query).get('ws'));

test('a member imports a spreadsheet: the new table opens, in the workspace picked', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page.goto('/tables');
  await page
    .getByRole('button', { name: /^Workspace:/ })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: /^Team( Moderator)?$/ }).click();

  const dialog = await openImport(page);
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeDisabled();
  await pickAndSend(page);

  await expect(dialog).toBeHidden();
  await expect
    .poll(() => api.importedTables.map((t) => [t.title, t.ws]))
    .toEqual([['stock-list', 'team']]);
  expect(importsWs()).toEqual([WORKSPACES.team.id]);
  await expect(page).toHaveURL((u) => u.pathname === `/tables/${api.importedTables[0]!.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('treeitem', { name: /stock-list/ })).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('First row');
});

test('another type is refused before anything is sent', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);

  await page
    .locator('#table-import-file')
    .setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await expect(dialog.getByRole('alert')).toHaveText('This takes an .xlsx, .xls or .csv file.');
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeDisabled();
  const choose = dialog.getByRole('button', { name: 'Spreadsheet Choose file', exact: true });
  await expect(choose).toHaveAttribute('aria-invalid', 'true');

  // Each of the three types is taken.
  for (const name of ['a.xlsx', 'b.xls', 'c.csv']) {
    await page.locator('#table-import-file').setInputFiles({ name, ...CSV });
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByText(name)).toBeVisible();
  }
  await expect(choose).not.toHaveAttribute('aria-invalid', 'true');
  expect(importsWs()).toEqual([]);
});

test('a refusal shows the server words; the file stays to try again', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);

  api.tableImportAnswer = { status: 400, body: { error: 'no tabular data found' } };
  await pickAndSend(page);
  await expect(dialog.getByRole('alert')).toHaveText('no tabular data found');

  api.tableImportAnswer = {
    status: 413,
    body: { error: 'This request is too large (at most 64 MB).' },
  };
  await dialog.getByRole('button', { name: 'Import table' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This request is too large (at most 64 MB).');

  api.tableImportAnswer = null;
  await dialog.getByRole('button', { name: 'Import table' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => api.importedTables.length).toBe(1);
});

test('a brain with no such route says it needs an update', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);

  api.tableImportAnswer = { status: 404, body: { error: 'not found' } };
  await pickAndSend(page);
  await expect(dialog.getByRole('alert')).toHaveText(NEEDS_UPDATE);

  api.tableImportAnswer = { status: 405, body: {} };
  await dialog.getByRole('button', { name: 'Import table' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(NEEDS_UPDATE);
});

const listReads = () =>
  api.requests.filter((r) => r.method === 'GET' && r.path === '/api/tree/tables').length;

/** How often the list was read, once the screen has read it the first time. */
async function readsSoFar() {
  await expect.poll(listReads).toBeGreaterThan(0);
  return listReads();
}

test('a proxy answer after all the bytes: check the list first', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const before = await readsSoFar();

  api.tableImportAnswer = { status: 504, body: '<html>Gateway Timeout</html>' };
  await pickAndSend(page);
  await expect(dialog.getByRole('alert')).toHaveText(MAY_LAND);
  await expect.poll(listReads).toBeGreaterThan(before);
  // The file goes: a second try starts with a pick, not one stray click.
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeDisabled();
  await expect(dialog.getByText('No file chosen')).toBeVisible();

  await page.locator('#table-import-file').setInputFiles({ name: 'again.csv', ...CSV });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeEnabled();
});

test('Cancel part way through stops the upload; nothing lands', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);

  await slowLine(page);
  const stopped = importFailed(page);

  await sendPartWay(page, dialog);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  await expect(dialog.getByText('Making the table')).toHaveCount(0);

  // Only the buttons are a way out: Escape, a stray click and the X stop nothing.
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await stopped).failure()?.errorText).toBe('net::ERR_ABORTED');
  await expect(page.getByText('The import stopped')).toHaveCount(0);
  expect(api.importedTables).toEqual([]);
});

test('while the brain builds, Close only hides the dialog', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const answer = holdTheAnswer();

  await pickAndSend(page);
  await expect(dialog.getByText('Making the table')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  const before = await readsSoFar();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(api.importedTables).toEqual([]);

  // The late answer: the table lands, the list hears of it, and nobody is moved.
  answer();
  await expect.poll(() => api.importedTables.length).toBe(1);
  await expect.poll(listReads).toBeGreaterThan(before);
  await expect(page.getByText('Imported stock-list')).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === '/tables');
});

test('leaving the screen while the brain builds stops nothing; the answer is a toast', async ({
  page,
}) => {
  await signIn(page, 'admin');
  const dialog = await openImportFromFiles(page);
  const answer = holdTheAnswer();

  await pickAndSend(page);
  await expect(dialog.getByText('Making the table')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === '/files');
  await expect(dialog).toBeHidden();

  answer();
  await expect.poll(() => api.importedTables.length).toBe(1);
  await expect(page.getByText('Imported stock-list')).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === '/files');
});

test('leaving the screen during the bytes stops them, and a toast says so', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImportFromFiles(page);
  await slowLine(page);
  const stopped = importFailed(page);

  expect(await unloadGuarded(page)).toBe(false);
  await sendPartWay(page, dialog);
  expect(await unloadGuarded(page)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === '/files');
  await expect(page.getByText('The import stopped because you left the screen.')).toBeVisible();
  expect((await stopped).failure()?.errorText).toBe('net::ERR_ABORTED');
  expect(api.importedTables).toEqual([]);
});

test('a late refusal is a toast, not a line in a dialog opened since', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const answer = holdTheAnswer();
  api.tableImportAnswer = { status: 400, body: { error: 'no tabular data found' } };

  await pickAndSend(page);
  await expect(dialog.getByText('Making the table')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('main').getByRole('button', { name: 'Import a table', exact: true }).click();
  await expect(dialog).toBeVisible();
  answer();
  await expect(page.getByText('no tabular data found')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('No file chosen')).toBeVisible();
});

test('a late lost answer leaves the file of a dialog opened since', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const answer = holdTheAnswer();
  api.tableImportAnswer = { status: 504, body: '<html>Gateway Timeout</html>' };

  await pickAndSend(page);
  await expect(dialog.getByText('Making the table')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('main').getByRole('button', { name: 'Import a table', exact: true }).click();
  await page.locator('#table-import-file').setInputFiles({ name: 'next.csv', ...CSV });
  answer();
  await expect(page.getByText(MAY_LAND)).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('next.csv')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeEnabled();
});

test('a network fault after all the bytes: check the list first', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const answer = holdTheAnswer();
  api.tableImportCut = true;
  const cut = importFailed(page);

  await pickAndSend(page);
  await expect(dialog.getByText('Making the table')).toBeVisible();
  answer();
  await cut;
  await expect(dialog.getByRole('alert')).toHaveText(MAY_LAND);

  // The way out is back, and closing looks at the list again.
  const before = await readsSoFar();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  // The first: the X in the corner has the same name.
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toBeHidden();
  await expect.poll(listReads).toBeGreaterThan(before);
});

test('a double click sends one upload', async ({ page }) => {
  await signIn(page, 'admin');
  const dialog = await openImport(page);
  const answer = holdTheAnswer();

  await page.locator('#table-import-file').setInputFiles({ name: 'once.csv', ...CSV });
  await dialog.getByRole('button', { name: 'Import table' }).dblclick();
  await expect(dialog.getByRole('button', { name: 'Import table' })).toBeDisabled();
  answer();
  await expect(dialog).toBeHidden();
  expect(importsWs()).toHaveLength(1);
  expect(api.importedTables).toHaveLength(1);
});

test('an expired session goes to login, back to here afterwards', async ({ page }) => {
  await signIn(page, 'admin');
  await openImport(page);
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.accept();
  });

  api.tableImportAnswer = { status: 401, body: { error: 'unauthorized' } };
  await pickAndSend(page);
  await expect(page).toHaveURL((u) => u.pathname === '/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/tables');
  expect(asked).toBe(false);
});

const HINT =
  'Spreadsheets stay in Files. For a Table, use the upload button next to New on the Tables screen.';

async function uploadToFiles(page: Page, name: string) {
  await page.goto('/files');
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({ name, ...CSV });
  await expect(page.getByText(name)).toBeVisible();
}

test('the dock says where a spreadsheet went, only on a box with the line', async ({ page }) => {
  await signIn(page, 'admin');

  // An older brain sends no field: no line.
  await uploadToFiles(page, 'old.csv');
  await expect(page.getByText('Uploaded 1 file')).toBeVisible();
  await expect(page.getByText(HINT)).toHaveCount(0);

  // With the line, but not a spreadsheet: none.
  api.noAutoTables = true;
  await uploadToFiles(page, 'readme.txt');
  await expect(page.getByText('Uploaded 1 file')).toBeVisible();
  await expect(page.getByText(HINT)).toHaveCount(0);

  await uploadToFiles(page, 'sheet.xlsx');
  await expect(page.getByText(HINT)).toBeVisible();
});
