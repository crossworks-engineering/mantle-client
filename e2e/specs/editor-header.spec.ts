import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';
import { openFromTree, treeRow } from '../lib/tree';

/**
 * The pages/draw editors wear THE item header (contract 2026-10-21): one row,
 * the title edited in place in it, tags and the description behind Info, the
 * pressed pencil to leave editing. It used to be a toolbar row plus a title
 * band; this pins the one row with a height budget and checks nothing sits
 * under it. Also covers the draw icon end to end (PATCH → header trigger →
 * list row), since draws only just learned icons.
 */

/** The one row is 44px at the default text size; a second row would double it. */
const HEADER_MAX_PX = 56;

test.describe('editor header layout', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('pages: one row, the title in it, tags behind Info', async ({ ownerApi, ownerPage }) => {
    const created = await ownerApi.post('/api/pages', {
      data: { title: `E2E header page ${Date.now()}`, tags: ['alpha', 'beta'] },
    });
    const { page: row } = (await created.json()) as { page: { id: string } };

    try {
      await ownerPage.goto(`/pages/${row.id}?edit=1`);
      const title = ownerPage.locator('input[aria-label="Page title"]');
      await expect(title).toBeVisible();

      const header = ownerPage.getByTestId('item-header');
      await expect(header.locator('input[aria-label="Page title"]')).toBeVisible();
      const box = await header.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeLessThan(HEADER_MAX_PX);

      // Tags are edited behind Info, not in a row under the title.
      await header.getByRole('button', { name: 'About this page' }).click();
      await expect(ownerPage.getByRole('dialog').getByText('alpha')).toBeVisible();
      await ownerPage.keyboard.press('Escape');

      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}editor-header-page.png` });

      // Focus mode: the shell chrome (the rail — brand, nav, its bottom
      // toolbar — and the activity column) disappears. The editor toolbar
      // stays, so its own button is the only control — it flips to "Exit
      // focus mode" and brings the chrome back. The rail toolbar is asserted
      // VISIBLE first: the shell has no <footer> any more, and asserting a
      // never-rendered element hidden passes vacuously, guarding nothing.
      const railToolbar = ownerPage.getByRole('toolbar', { name: 'Shell controls' });
      await expect(railToolbar).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Focus mode' }).click();
      await expect(ownerPage.getByRole('link', { name: /home$/ })).toBeHidden();
      await expect(railToolbar).toBeHidden();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}editor-zen-page.png` });
      await ownerPage.getByRole('button', { name: 'Exit focus mode' }).click();
      await expect(ownerPage.getByRole('link', { name: /home$/ })).toBeVisible();

      // The pressed pencil leaves editing: back to the page in the list.
      await header.getByRole('link', { name: /^Done editing/ }).click();
      // The e2e client is `next dev`, and nothing before this spec has opened
      // the /pages list, so the first visit compiles the route. On a CI runner
      // that alone can outlast the default 5s.
      await expect(ownerPage).toHaveURL(new RegExp(`/pages/${row.id}$`), { timeout: 30_000 });
      await expect(ownerPage.getByRole('link', { name: /home$/ })).toBeVisible();
    } finally {
      await ownerApi.delete(`/api/pages/${row.id}`);
    }
  });

  test('draw: same compact row, and the icon persists to header + list', async ({
    ownerApi,
    ownerPage,
  }) => {
    const title = `E2E header draw ${Date.now()}`;
    const created = await ownerApi.post('/api/draws', { data: { title, tags: ['alpha'] } });
    const { draw } = (await created.json()) as { draw: { id: string } };

    try {
      // Icon + description save like the rest of the metadata and round-trip.
      const patched = await ownerApi.patch(`/api/draws/${draw.id}`, {
        data: { icon: '🎨', description: 'A canary description' },
      });
      expect(patched.ok()).toBeTruthy();
      const patchedRow = (
        (await patched.json()) as {
          draw: { icon: string | null; description: string | null };
        }
      ).draw;
      expect(patchedRow.icon).toBe('🎨');
      expect(patchedRow.description).toBe('A canary description');

      await ownerPage.goto(`/draw/${draw.id}?edit=1`);
      const titleInput = ownerPage.locator('input[aria-label="Drawing title"]');
      await expect(titleInput).toBeVisible();

      const header = ownerPage.getByTestId('item-header');
      await expect(header.locator('input[aria-label="Drawing title"]')).toBeVisible();
      const box = await header.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeLessThan(HEADER_MAX_PX);

      // The description and tags are edited behind Info.
      await header.getByRole('button', { name: 'About this drawing' }).click();
      await expect(ownerPage.locator('input[aria-label="Drawing description"]')).toHaveValue(
        'A canary description',
      );
      await ownerPage.keyboard.press('Escape');

      // The picker trigger shows the chosen emoji…
      await expect(ownerPage.getByRole('button', { name: 'Change drawing icon' })).toHaveText('🎨');
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}editor-header-draw.png` });

      // …and so does the list row: the tree's item carries the drawing's own
      // icon, as a page's does. The preview pane is the pages-style shell:
      // description line + Edit/export/delete actions, the snapshot unboxed.
      await ownerPage.goto('/draw');
      const detail = ownerPage.locator('[data-testid="detail"]');
      await openFromTree(ownerPage, title, detail.getByRole('heading', { name: title }));
      await expect(treeRow(ownerPage, title).getByText('🎨')).toBeVisible();
      await expect(ownerPage.getByRole('link', { name: 'Edit drawing' })).toBeVisible();
      await expect(ownerPage.getByRole('button', { name: 'Delete drawing' })).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}draw-list-preview.png` });
    } finally {
      await ownerApi.delete(`/api/draws/${draw.id}`);
    }
  });

  test('an uncommitted draft is announced, not silently invisible', async ({
    ownerApi,
    ownerPage,
  }) => {
    // A draft is never rendered anywhere (rendering happens at commit), so
    // without a marker the preview shows the last commit — or nothing at all —
    // and the user reasonably concludes their work was lost. It wasn't; the
    // screen has to SAY so.
    const title = `E2E draft badge ${Date.now()}`;
    const created = await ownerApi.post('/api/draws', { data: { title } });
    const { draw } = (await created.json()) as { draw: { id: string } };

    try {
      // Never committed, one autosaved draft — the exact "did it save?" case.
      const saved = await ownerApi.put(`/api/draws/${draw.id}/draft`, {
        data: {
          scene: { elements: [{ id: 'd1', type: 'text', text: 'unsaved?', isDeleted: false }] },
          if_rev: 0,
        },
      });
      expect(saved.ok()).toBeTruthy();

      // The list row carries hasDraft, so the API is the source of the badge.
      const list = await ownerApi.get(`/api/draws?q=${encodeURIComponent(title)}`);
      const { draws } = (await list.json()) as { draws: { id: string; hasDraft: boolean }[] };
      expect(draws.find((d) => d.id === draw.id)?.hasDraft).toBe(true);

      // Announced where the drawing is opened: the header's state pill, and
      // the note in place of the snapshot that is not there yet.
      await ownerPage.goto('/draw');
      const detail = ownerPage.locator('[data-testid="detail"]');
      await openFromTree(
        ownerPage,
        title,
        detail.getByTestId('item-header').getByText('uncommitted', { exact: true }),
      );
      await expect(detail.getByText(/uncommitted edits are saved/i)).toBeVisible();

      // Committing clears it — the badge tracks state, it isn't sticky.
      const committed = await ownerApi.post(`/api/draws/${draw.id}/commit`, {
        data: {
          scene: { elements: [{ id: 'd1', type: 'text', text: 'unsaved?', isDeleted: false }] },
        },
      });
      expect(committed.ok()).toBeTruthy();
      const after = await ownerApi.get(`/api/draws?q=${encodeURIComponent(title)}`);
      const { draws: afterRows } = (await after.json()) as {
        draws: { id: string; hasDraft: boolean }[];
      };
      expect(afterRows.find((d) => d.id === draw.id)?.hasDraft).toBe(false);
    } finally {
      await ownerApi.delete(`/api/draws/${draw.id}`);
    }
  });
});
