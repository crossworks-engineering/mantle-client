import { expect, test } from '@playwright/test';
import { PAGES, signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * A page link card (the `childPage` block) on a page opened to READ, not
 * edited. The read view renders the document as static HTML, where the
 * schema writes each card as an empty div; it showed as an empty bordered
 * box. The read view now draws the editor's own card in it: the title, and
 * a link that opens the page. In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('a page link card shows its page and opens it, read', async ({ page }) => {
  api.pageDocs[PAGES.handbook.id] = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Field work' }] },
      // The snapshot is old: the card shows the page's live title (and its
      // live icon, none).
      {
        type: 'childPage',
        attrs: { pageId: PAGES.survey.id, title: 'Old survey name', icon: '📐' },
      },
    ],
  };
  api.pageDocs[PAGES.survey.id] = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The survey itself.' }] }],
  };

  await signIn(page, 'admin');
  await page.goto(`/pages/${PAGES.handbook.id}`);
  const doc = page.locator('.ProseMirror');
  await expect(doc.getByRole('heading', { name: 'Field work' })).toBeVisible();

  const host = doc.locator('[data-child-page]');
  const card = host.locator('a[data-child-page-card]');
  await expect(card).toHaveText(/Site survey/);
  await expect(card).toHaveAttribute('href', `/pages/${PAGES.survey.id}`);
  // One box, not the card inside the empty div's own border.
  await expect(host).toHaveCSS('border-top-width', '0px');

  await card.click();
  await expect(page).toHaveURL((u) => u.pathname === `/pages/${PAGES.survey.id}`);
  await expect(page.getByText('The survey itself.')).toBeVisible();
});
