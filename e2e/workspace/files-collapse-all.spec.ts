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

  await collapseAll(page).click();
  await expect(folderRow(page, alpha.name)).toHaveCount(0);
  await expect(folderRow(page, drawings.name)).toHaveCount(0);
  await expect(folderRow(page, projects.name)).toBeVisible();
  await expect(folderRow(page, archive.name)).toBeVisible();
  await expect(tree(page).getByRole('button', { name: `Unfold ${projects.name}` })).toBeVisible();
  await expect(tree(page)).toHaveJSProperty('scrollTop', 0);
  await test.info().attach('after', { body: await page.screenshot(), contentType: 'image/png' });

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

test('Collapse all is off outside the Folders view', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/files');
  await expect(collapseAll(page)).toBeEnabled();
  await page
    .getByRole('radiogroup', { name: 'How to list files' })
    .getByRole('radio', { name: 'Recent' })
    .click();
  await expect(collapseAll(page)).toBeDisabled();
  await expect(collapseAll(page)).toHaveAttribute('title', /in the Folders view/);
});
