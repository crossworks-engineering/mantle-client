import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';
import { clickUntilOpen } from '../lib/hydration';
import { openFromTree, treeRow } from '../lib/tree';
import type { APIRequestContext } from '@playwright/test';

/**
 * `/events`, the first screen ported to the Tasks standard (phase 2a of
 * `docs/plans/workspace-screen-consistency.md`).
 *
 * The port is what this pins, not the event domain: the `<MasterDetail>`
 * scaffold in place of a hand-written grid, the §6c boxed composer that used to
 * be centred with `mx-auto max-w-2xl`, the §8 detail header, and §6b's
 * validation triple — which events exercises harder than Tasks does, because it
 * has four separate ways to be wrong and each has to mark ITS OWN control.
 *
 * It doubles as the proof the pattern travels. 23 screens follow this one, so if
 * something here is load-bearing and undocumented, it is cheaper to find now.
 */

type Event = { id: string; title: string };

async function createEvent(
  api: APIRequestContext,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await api.post('/api/events', { data });
  expect(res.status(), `POST /api/events ${JSON.stringify(data)}`).toBe(201);
  return ((await res.json()) as { event: Event }).event;
}

/** Comfortably in the future, so the row lands in the default `upcoming` window
 *  and the countdown hero renders its ring rather than the ended state. */
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test.describe('events', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('the screen is a real master-detail, and the composer hugs the list', async ({
    ownerPage,
  }) => {
    await ownerPage.goto('/events');
    const list = ownerPage.locator('[data-testid="list"]');
    const detail = ownerPage.locator('[data-testid="detail"]');
    await expect(list).toBeVisible();
    await expect(detail).toBeVisible();

    // The tree opens nothing by itself (a84d10ab), so the composer is New's.
    // §6c says it is a boxed card pinned to the pane's leading edge. The old
    // layout centred it, which on a draggable pane meant the form drifted away
    // from the list the wider you pulled it.
    const card = detail.locator('[data-slot="form-shell"]').first();
    await clickUntilOpen(
      list.getByRole('button', { name: 'New', exact: true }),
      detail.getByRole('heading', { name: 'New event' }),
    );
    const paneBox = (await detail.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const leftGap = cardBox.x - paneBox.x;
    const rightGap = paneBox.x + paneBox.width - (cardBox.x + cardBox.width);
    expect(leftGap, 'the composer should sit against the pane edge, not float').toBeLessThan(40);
    expect(
      Math.abs(leftGap - rightGap),
      'equal gaps mean it is still centred, not left-aligned in a full-width pane',
    ).toBeLessThan(8);

    // The tree lists every event by start, so the Upcoming / Past / All window
    // filter is hidden while it shows (a84d10ab). It lives on only in the
    // paged list a brain before the tree gets.
    await expect(list.getByRole('combobox', { name: 'Filter events' })).toHaveCount(0);
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}events-master-detail.png` });
  });

  test('validation marks the control at fault, not the foot of the form', async ({ ownerPage }) => {
    // §6b is the `data-invalid` / `aria-invalid` / `role="alert"` triple. The
    // point of anchoring it is that a screen-reader user is told WHICH field to
    // fix; a single message under the buttons says only that something is wrong.
    await ownerPage.goto('/events');
    const detail = ownerPage.locator('[data-testid="detail"]');
    const title = detail.getByLabel('Title');
    const save = detail.getByRole('button', { name: 'Save event' });
    await clickUntilOpen(
      ownerPage.locator('[data-testid="list"]').getByRole('button', { name: 'New', exact: true }),
      save,
    );

    // Empty title → the title is the invalid control.
    await save.click();
    const alert = detail.getByRole('alert');
    await expect(alert).toHaveText('Title is required');
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    // Announced, not merely coloured: the input points AT the message.
    const describedBy = await title.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(detail.locator(`#${describedBy}`)).toHaveText('Title is required');

    // Title filled but no start → the failure MOVES to the start field, and the
    // title stops being marked. A form that leaves the last red field red is
    // the failure mode a single shared error message hides.
    await title.fill('E2E validation probe');
    await save.click();
    await expect(alert).toHaveText('Start time is required');
    await expect(title).not.toHaveAttribute('aria-invalid', 'true');
    // The picker's trigger is a <button> wired to the "Starts" FieldLabel, so
    // its accessible name is the label — not the "Pick a start" placeholder.
    await expect(detail.getByLabel('Starts')).toHaveAttribute('aria-invalid', 'true');
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}events-validation.png` });
  });

  test('detail header: long title truncates, actions stay in the pane, edit after delete', async ({
    ownerApi,
    ownerPage,
  }) => {
    const marker = `E2E event header ${Date.now()}`;
    const title = `${marker} ${'long'.repeat(28)}`.slice(0, 130);
    const event = await createEvent(ownerApi, { title, startsAt: soon(3) });

    try {
      await ownerPage.goto('/events');
      const detail = ownerPage.locator('[data-testid="detail"]');
      const heading = detail.getByRole('heading', { name: title });
      await openFromTree(ownerPage, marker, heading);

      const clipped = await heading
        .getByText(title, { exact: true })
        .evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(clipped, 'the title should truncate, not push the actions out').toBeTruthy();

      const paneBox = (await detail.boundingBox())!;
      const edit = detail.getByRole('button', { name: 'Edit event' });
      // Icon-only and aria-labelled, per §8 — the old one carried a "Delete"
      // text label, which is the idiom being retired.
      const del = detail.getByRole('button', { name: 'Delete event' });
      for (const [name, button] of [
        ['Edit event', edit],
        ['Delete event', del],
      ] as const) {
        const box = (await button.boundingBox())!;
        expect(box.x + box.width, `${name} overflows the detail pane`).toBeLessThanOrEqual(
          paneBox.x + paneBox.width,
        );
      }
      await expect(del).toHaveText('');
      // The item header's fixed slots: Delete, then Edit, then More.
      expect((await edit.boundingBox())!.x).toBeGreaterThan((await del.boundingBox())!.x);

      // Editing opens the same boxed composer as create, not a bare form,
      // under the same header, pencil pressed.
      await edit.click();
      await expect(
        detail.getByRole('button', { name: 'Done editing: discard unsaved' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(detail.locator('[data-slot="form-shell"]').first()).toBeVisible();
      await detail.getByRole('button', { name: 'Cancel' }).click();
      await expect(heading).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}events-detail-header.png` });
    } finally {
      await ownerApi.delete(`/api/events/${event.id}`);
    }
  });

  test('delete confirms, then removes the event from the list', async ({ ownerApi, ownerPage }) => {
    const marker = `E2E event delete ${Date.now()}`;
    const title = `${marker} doomed`;
    const event = await createEvent(ownerApi, { title, startsAt: soon(4) });
    let deleted = false;

    try {
      await ownerPage.goto('/events');
      const row = treeRow(ownerPage, title);
      const detail = ownerPage.locator('[data-testid="detail"]');
      const del = detail.getByRole('button', { name: 'Delete event' });
      await openFromTree(ownerPage, marker, del);
      await del.click();
      // Always through an AlertDialog (§8) — and the dialog says what is lost.
      const dialog = ownerPage.getByRole('alertdialog');
      await expect(dialog).toContainText(title);
      await expect(dialog).toContainText(/reminder won.t fire/i);
      await dialog.getByRole('button', { name: 'Delete' }).click();

      await expect(row).toHaveCount(0);
      await expect
        .poll(async () => (await ownerApi.get(`/api/events/${event.id}`)).status())
        .toBe(404);
      deleted = true;
    } finally {
      if (!deleted) await ownerApi.delete(`/api/events/${event.id}`);
    }
  });
});
