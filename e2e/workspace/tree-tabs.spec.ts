import { expect, test, type Page } from '@playwright/test';
import { PAGES, signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * The tree's view tabs (Folders, Recent, Most used, A to Z) never overlap:
 * when the list is dragged narrow they fold to icons, each named by its
 * label (tooltip and accessible name), and the labels come back when it is
 * dragged wide again. Checked at the smallest, the default and the largest
 * font size, since the fold is measured in the user's font
 * (components/item-tree/view-tabs.ts). In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const LABELS = ['Folders', 'Recent', 'Most used', 'A to Z'];

/** Drag the list's divider to `width` px from the list's left edge. The
 *  list clamps at its own min (220px) and max; 200 stops at the min without
 *  collapsing it. */
async function dragList(page: Page, width: number) {
  const main = page.getByRole('main');
  const left = (await main.locator('aside').first().boundingBox())!.x;
  const box = (await main.getByRole('separator').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(left + width, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Every tab's content fits inside it, and no tab runs into the next. */
async function expectNoOverlap(page: Page) {
  const group = page.getByRole('radiogroup', { name: 'How to list pages' });
  const boxes = await group.getByRole('radio').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        fits: el.scrollWidth <= el.clientWidth,
      };
    }),
  );
  expect(boxes).toHaveLength(4);
  for (const b of boxes) expect(b.fits, JSON.stringify(boxes)).toBe(true);
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 1);
}

for (const size of ['xsmall', 'medium', 'large'] as const) {
  test(`the view tabs fold to icons when narrow and never overlap (${size} font)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'member');
    await page.goto('/pages');
    const main = page.getByRole('main');
    await expect(main.getByText(PAGES.handbook.title, { exact: true })).toBeVisible();
    // 'medium' is the absence of the attribute (app.css).
    await page.evaluate((s) => {
      if (s === 'medium') delete document.documentElement.dataset.fontSize;
      else document.documentElement.dataset.fontSize = s;
    }, size);

    const group = page.getByRole('radiogroup', { name: 'How to list pages' });
    const tab = (name: string) => group.getByRole('radio', { name, exact: true });

    // Narrowest: icons, each named by its label.
    await dragList(page, 200);
    for (const name of LABELS) {
      await expect(tab(name)).toHaveAttribute('title', name);
      await expect(tab(name).locator('svg')).toBeVisible();
      await expect(tab(name)).not.toContainText(name);
    }
    await expectNoOverlap(page);
    await test
      .info()
      .attach(`narrow-${size}`, { body: await group.screenshot(), contentType: 'image/png' });

    // Widest: the labels again, no tooltip.
    await dragList(page, 600);
    for (const name of LABELS) {
      await expect(tab(name)).toHaveText(name);
      await expect(tab(name)).not.toHaveAttribute('title');
    }
    await expectNoOverlap(page);

    // Back and forth through the whole range: never an overlap on the way.
    for (const width of [520, 480, 440, 400, 370, 340, 310, 280, 250, 220]) {
      await dragList(page, width);
      await expectNoOverlap(page);
    }
  });
}
