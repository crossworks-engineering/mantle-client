import { expect, test, type Page } from '@playwright/test';
import {
  FILE_FOLDERS,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * "Collapse all folders" in the item tree (components/item-tree): one click
 * shuts every folder at every depth, so a long tree becomes its top level.
 * The open folders are this browser's (localStorage), so a reload keeps the
 * tree shut; opening one folder again shows its children. The folder on
 * screen stays on screen, and the tree does not unfold to it again. Checked
 * on Files, over made-up nested folders in the in-memory brain.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.fileFolders = true;
});
test.afterEach(async () => {
  await api.close();
});

const { projects, alpha, drawings, archive } = FILE_FOLDERS;

const tree = (page: Page) => page.getByRole('tree', { name: 'Files and folders' });
const folderRow = (page: Page, name: string) =>
  tree(page).getByRole('treeitem', { name, exact: true });
const collapseAll = (page: Page) => page.getByRole('button', { name: 'Collapse all folders' });

test('Collapse all shuts every folder, a reload keeps it shut, one folder opens again', async ({
  page,
}) => {
  // Thirty empty folders after Archive: the tree is long enough to scroll,
  // shut or open.
  api.fileShelves = 30;
  await signIn(page, 'admin');
  await page.goto('/files');
  await expect(folderRow(page, projects.name)).toBeVisible();
  await expect(folderRow(page, archive.name)).toBeVisible();

  // Open two levels by their chevrons.
  await tree(page)
    .getByRole('button', { name: `Unfold ${projects.name}` })
    .click();
  await tree(page)
    .getByRole('button', { name: `Unfold ${alpha.name}` })
    .click();
  await expect(folderRow(page, drawings.name)).toBeVisible();
  await test.info().attach('before', { body: await page.screenshot(), contentType: 'image/png' });
  // Scrolled down, away from the top.
  await tree(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => tree(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await collapseAll(page).click();
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
  await expect(folderRow(page, drawings.name)).toHaveCount(0);
  await expect(folderRow(page, projects.name)).toBeVisible();
  await expect(folderRow(page, archive.name)).toBeVisible();
  await expect(tree(page).getByRole('button', { name: `Unfold ${projects.name}` })).toBeVisible();
  // Back at the top, though the shut tree still scrolls.
  await expect(tree(page)).toHaveJSProperty('scrollTop', 0);
  expect(await tree(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await test.info().attach('after', { body: await page.screenshot(), contentType: 'image/png' });

  // Alpha was shut too, not only hidden under Projects.
  await tree(page)
    .getByRole('button', { name: `Unfold ${projects.name}` })
    .click();
  await expect(folderRow(page, alpha.name)).toBeVisible();
  await expect(folderRow(page, drawings.name)).toHaveCount(0);
  await collapseAll(page).click();
  await expect(folderRow(page, alpha.name)).toHaveCount(0);

  await page.reload();
  await expect(folderRow(page, projects.name)).toBeVisible();
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
  await expect(folderRow(page, drawings.name)).toHaveCount(0);

  await tree(page)
    .getByRole('button', { name: `Unfold ${projects.name}` })
    .click();
  await expect(folderRow(page, alpha.name)).toBeVisible();
  await expect(folderRow(page, drawings.name)).toHaveCount(0);
});

test('the folder on screen stays on screen and is not unfolded again; keys work', async ({
  page,
}) => {
  await signIn(page, 'admin');
  // The page shows Alpha: the tree unfolds the way to it (Projects).
  await page.goto('/files?path=files.projects.alpha');
  await expect(folderRow(page, alpha.name)).toHaveAttribute('aria-selected', 'true');
  await tree(page)
    .getByRole('button', { name: `Unfold ${alpha.name}` })
    .click();
  await expect(folderRow(page, drawings.name)).toBeVisible();

  // Enter on the focused button.
  await collapseAll(page).focus();
  await page.keyboard.press('Enter');
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
  await expect(folderRow(page, drawings.name)).toHaveCount(0);
  // Still Alpha's page, and the tree leaves Projects shut.
  await expect(page).toHaveURL(/path=files\.projects\.alpha/);
  // The tree has no Alpha row now, so this is the folder pane's header.
  await expect(
    page
      .getByRole('main')
      .getByText(/^alpha$/i)
      .first(),
  ).toBeVisible();
  // Give the tree's unfold-to-the-page effect time to (wrongly) run.
  await page.waitForTimeout(500);
  await expect(folderRow(page, alpha.name)).toHaveCount(0);

  // Space works too.
  await tree(page)
    .getByRole('button', { name: `Unfold ${projects.name}` })
    .click();
  await expect(folderRow(page, alpha.name)).toBeVisible();
  await collapseAll(page).focus();
  await page.keyboard.press('Space');
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
});

test('from another view, Collapse all goes back to Folders, shut', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/files');
  await tree(page)
    .getByRole('button', { name: `Unfold ${projects.name}` })
    .click();
  await expect(folderRow(page, alpha.name)).toBeVisible();
  const tabs = page.getByRole('radiogroup', { name: 'How to list files' });
  await tabs.getByRole('radio', { name: 'Recent' }).click();
  await expect(tabs.getByRole('radio', { name: 'Recent' })).toBeChecked();

  await collapseAll(page).click();
  await expect(tabs.getByRole('radio', { name: 'Folders' })).toBeChecked();
  await expect(folderRow(page, projects.name)).toBeVisible();
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
});
