import { expect, test } from '../lib/fixtures';

/**
 * `/pages/[id]` is a full-page route with no list beside it, so it had nothing
 * to drag against. It chose a `max-w-3xl` cap plus a "Full width" button —
 * `mx-auto` and two positions standing in for a measure the reader should just
 * set. Centred prose on a wide display, and a binary escape hatch.
 *
 * `MeasurePane` gives the route a measure of its own: a column that opens at a
 * width, CENTRED with the margins splitting the slack equally, carrying a
 * handle on its right edge with nothing capping it.
 *
 * ⚠️ This file used to assert the body tucked LEFT, against a panel-plus-spacer
 * cut that `MeasurePane` no longer uses — it is a centred `mx-auto` column with
 * its own `role="separator"`, not a `ResizablePanelGroup`, so the old assertions
 * looked for a panel group that was never going to be there and reported
 * "MeasurePane is gone" while it sat two lines away in the source. The earlier
 * cut pinned the page against the left edge of the WINDOW, which is why it went.
 *
 * Four assertions, four different regressions. Bring the button back and (1)
 * fails. Take the centring off and (2) fails. Lose the handle and (3) fails.
 * Put a `max-w-*` back inside the column and (4) fails — the measure widens and
 * the prose does not follow.
 */
test.describe('pages editor width', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('the editor brings its own measure — centred, draggable, uncapped', async ({
    ownerApi,
    ownerPage,
  }) => {
    const title = `E2E editor width ${Date.now()}`;
    const created = await ownerApi.post('/api/pages', { data: { title } });
    expect(created.ok()).toBeTruthy();
    const { page: row } = (await created.json()) as { page: { id: string } };

    try {
      // No headings: a heading raises the `xl:` outline rail and puts a second
      // box in the geometry below.
      const seeded = await ownerApi.put(`/api/pages/${row.id}/draft`, {
        data: {
          doc: {
            type: 'doc',
            content: Array.from({ length: 8 }, () => ({
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'The measure of this paragraph is whatever the drag leaves it. '.repeat(6),
                },
              ],
            })),
          },
          if_rev: 0,
        },
      });
      expect(seeded.ok(), 'could not seed a body to measure').toBeTruthy();

      // Wide enough that a 920px opening measure leaves real slack to eat.
      await ownerPage.setViewportSize({ width: 1920, height: 1080 });
      await ownerPage.goto(`/pages/${row.id}?edit=1`);

      const prose = ownerPage.locator('.ProseMirror').first();
      await expect(prose).toBeVisible({ timeout: 20_000 });

      // 1. The two-position stand-in is gone.
      await expect(
        ownerPage.getByRole('button', { name: /Full width/ }),
        'the narrow/wide toggle is back — the drag is meant to be the only measure',
      ).toHaveCount(0);

      // 3. The measure's own edge. Keyed on the separator's ROLE and NAME
      //    rather than on `MeasurePane`'s internals, so a re-implementation of
      //    the component cannot quietly take this assertion with it — which is
      //    exactly what happened to the panel-group selector this replaced.
      const handle = ownerPage.getByRole('separator', { name: 'Page width' });
      await expect(handle, 'no edge to drag — the measure lost its handle').toHaveCount(1);

      // 2. CENTRED, with the margins splitting the slack equally. The route
      //    fills the window, so the column's own box is what the margins are
      //    measured against.
      const outer = (await ownerPage.locator('main').first().boundingBox())!;
      const before = (await prose.boundingBox())!;
      const left = before.x - outer.x;
      const right = outer.x + outer.width - (before.x + before.width);
      expect(
        Math.abs(left - right),
        'the measure is not centred — the margins do not split the slack',
      ).toBeLessThan(24);
      expect(left, 'the measure is flush against the edge — is the centring gone?').toBeGreaterThan(
        24,
      );

      // 4. Dragging the edge widens the prose, past anything a `max-w-3xl`
      //    (768px) would have allowed.
      const grip = (await handle.boundingBox())!;
      await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(1900, grip.y + grip.height / 2, { steps: 12 });
      await ownerPage.mouse.up();

      await expect
        .poll(async () => (await prose.boundingBox())!.width, {
          message: 'the prose ignored the drag — capped from inside the pane?',
          timeout: 10_000,
        })
        .toBeGreaterThan(before.width + 200);
    } finally {
      const del = await ownerApi.delete(`/api/pages/${row.id}`);
      expect(del.ok()).toBeTruthy();
    }
  });
});
