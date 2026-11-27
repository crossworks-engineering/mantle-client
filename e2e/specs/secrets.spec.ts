import { request as playwrightRequest } from '@playwright/test';
import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR, MEMBER_EMAIL, MEMBER_PASSWORD, SERVER_URL } from '../lib/env';
import { clickUntilOpen } from '../lib/hydration';
import { openFromTree } from '../lib/tree';

/**
 * `/secrets`, ported to the Tasks standard (phase 2a).
 *
 * The owner tests pin the port: the scaffold, the boxed composer shared by
 * create and edit, the item header (contract 2026-10-21), and that the form's
 * raw Kind `<select>` is a real Select now. (The list's kind filter, the
 * other raw `<select>` the port replaced, belongs to the paged list; on the
 * item tree the tree's own filter menu does that job.)
 *
 * The member test (Secrets sharing, part S3) needs a brain from migration
 * 0400 on and a member login (E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD; skipped
 * without them): the owner shares a secret with a workspace of the member,
 * who reads it, reveals it, cannot edit it with Write off, and can with
 * Write on. Its value is made up for the test.
 */

test.describe('secrets', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('scaffold, boxed composer, and Kind is a real Select', async ({ ownerPage }) => {
    await ownerPage.goto('/secrets');
    const list = ownerPage.locator('[data-testid="list"]');
    const detail = ownerPage.locator('[data-testid="detail"]');
    await expect(list).toBeVisible();
    await expect(detail).toBeVisible();

    // The composer: boxed card hugging the pane's leading edge (§6c).
    await clickUntilOpen(
      list.getByRole('button', { name: 'New', exact: true }),
      detail.getByRole('heading', { name: 'New secret' }),
    );
    const card = detail.locator('[data-slot="form-shell"]').first();
    const paneBox = (await detail.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const leftGap = cardBox.x - paneBox.x;
    const rightGap = paneBox.x + paneBox.width - (cardBox.x + cardBox.width);
    expect(leftGap).toBeLessThan(40);
    expect(Math.abs(leftGap - rightGap), 'still centred, not left-aligned').toBeLessThan(8);

    // The form's Kind control, formerly a native `<select>`: `combobox` is
    // itself the assertion that it is the kit's now.
    await expect(detail.getByRole('combobox', { name: 'Kind' })).toBeVisible();

    // §6b: the title failure is on the title, not a loose red <p>.
    await detail.getByRole('button', { name: 'Save secret' }).click();
    await expect(detail.getByRole('alert')).toHaveText('Title is required');
    await expect(detail.getByLabel('Title')).toHaveAttribute('aria-invalid', 'true');
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}secrets-composer.png` });
  });

  test('detail header follows §8, and edit reuses the same boxed form', async ({
    ownerApi,
    ownerPage,
  }) => {
    const marker = `E2E secret ${Date.now()}`;
    const created = await ownerApi.post('/api/secrets', {
      data: {
        title: marker,
        description: 'an e2e fixture',
        kind: 'token',
        tags: ['e2e'],
        note: 'sealed note',
        fields: [{ label: 'username', value: 'someone' }],
      },
    });
    expect(created.status()).toBe(201);
    const { secret } = (await created.json()) as { secret: { id: string } };

    try {
      await ownerPage.goto('/secrets');
      const detail = ownerPage.locator('[data-testid="detail"]');
      const heading = detail.getByRole('heading', { level: 2 });
      await openFromTree(ownerPage, marker, heading);
      await expect(heading).toContainText(marker);
      // The item header: the glyph inside the h2, the kind as its one pill.
      await expect(heading.locator('svg')).toHaveCount(1);
      await expect(heading).toContainText('token');

      // The fixed slots: Delete, then Edit (the pencil), then More. Icons
      // only, and every one a person's own act for an agent.
      const header = detail.getByTestId('item-header');
      await expect(header).toHaveAttribute('data-agent-risk', 'person');
      const edit = header.getByRole('button', { name: 'Edit secret' });
      const del = header.getByRole('button', { name: 'Delete secret' });
      await expect(del).toHaveText('');
      await expect(edit).toHaveText('');
      expect((await del.boundingBox())!.x).toBeLessThan((await edit.boundingBox())!.x);
      await expect(header.locator('[data-slot="access"]')).toBeVisible();

      // Edit is the same boxed composer as create, not a bare form.
      await edit.click();
      await expect(detail.getByRole('heading', { name: 'Edit secret' })).toBeVisible();
      await expect(detail.locator('[data-slot="form-shell"]').first()).toBeVisible();
      await expect(detail.getByRole('combobox', { name: 'Kind' })).toHaveText('token');
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}secrets-edit.png` });
    } finally {
      await ownerApi.delete(`/api/secrets/${secret.id}`);
    }
  });
  test('a folder of secrets offers the Access panel a folder of pages has', async ({
    ownerApi,
    ownerPage,
  }) => {
    const name = `E2E vault ${Date.now()}`;
    const made = await ownerApi.post('/api/tree/secrets/folders', {
      data: { parentId: null, name },
    });
    expect(made.status()).toBe(201);
    const { folder } = (await made.json()) as { folder: { id: string } };

    try {
      await ownerPage.goto('/secrets');
      const list = ownerPage.locator('[data-testid="list"]');
      const row = list.getByRole('treeitem', { name }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.hover();
      await list.getByRole('button', { name: `More actions for ${name}` }).click();
      await ownerPage.getByRole('menuitem', { name: 'Access…' }).click();
      const panel = ownerPage.getByRole('dialog');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(name);
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}secrets-folder-access.png` });
    } finally {
      await ownerApi.delete(`/api/tree/secrets/folders/${folder.id}`);
    }
  });

  test('a member reads a shared secret, reveals it, and edits it only with Write on', async ({
    ownerApi,
    visitorPage,
  }) => {
    test.skip(!MEMBER_EMAIL || !MEMBER_PASSWORD, 'set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD');
    const page = visitorPage;
    const marker = `E2E shared secret ${Date.now()}`;
    const value = `e2e-made-up-${Date.now()}`;

    // A workspace the member is a user of, as its own shell names it: the
    // first that is not its private one.
    const memberApi = await playwrightRequest.newContext({ baseURL: SERVER_URL });
    const token = await memberApi.post('/api/auth/token', {
      data: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD },
    });
    expect(token.status()).toBe(200);
    const bearer = ((await token.json()) as { token: string }).token;
    const shell = (await (
      await memberApi.get('/api/shell', { headers: { Authorization: `Bearer ${bearer}` } })
    ).json()) as { workspaces?: { id: string; private?: boolean }[] };
    await memberApi.dispose();
    const ws = shell.workspaces?.find((w) => !w.private);
    test.skip(!ws, 'the member is in no shared workspace on this brain');

    const created = await ownerApi.post('/api/secrets', {
      data: {
        title: marker,
        kind: 'password',
        note: '',
        fields: [{ label: 'password', value }],
      },
    });
    expect(created.status()).toBe(201);
    const { secret } = (await created.json()) as { secret: { id: string } };

    try {
      // Shared with the member's workspace, Write off.
      const granted = await ownerApi.post(`/api/grants/${secret.id}`, {
        data: { wsId: ws!.id, write: false },
      });
      expect(granted.status()).toBeLessThan(300);

      await page.goto('/login');
      await page.locator('#email').fill(MEMBER_EMAIL);
      await page.locator('#password').fill(MEMBER_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL((u) => u.pathname === '/', { timeout: 60_000 });

      // The member has the Secrets screen and reads the shared secret.
      await expect(
        page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: 'Secrets', exact: true }),
      ).toBeVisible();
      await page.goto(`/secrets/${secret.id}`);
      const main = page.getByRole('main');
      const header = main.getByTestId('item-header');
      await expect(header.getByRole('heading', { level: 2 })).toContainText(marker);

      // One click reveals it, inside a data-secret box.
      await main.getByRole('button', { name: 'Reveal' }).click();
      const shown = main.getByText(value, { exact: true });
      await expect(shown).toBeVisible();
      expect(await shown.evaluate((el) => !!el.closest('[data-secret]'))).toBe(true);
      expect(page.url()).not.toContain(value);
      await page.screenshot({ path: `${ARTIFACTS_DIR}secrets-member-revealed.png` });

      // Write off: no Edit, no Delete, and the brain refuses the write too.
      await expect(header.locator('[data-slot="edit"]').getByRole('button')).toBeDisabled();
      await expect(header.locator('[data-slot="delete"]').getByRole('button')).toBeDisabled();
      const refused = await page.request.patch(`${SERVER_URL}/api/secrets/${secret.id}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        data: { title: `${marker} refused` },
      });
      expect(refused.status()).toBe(403);

      // Write on: the same member edits it.
      const write = await ownerApi.patch(`/api/grants/${secret.id}/${ws!.id}`, {
        data: { write: true },
      });
      expect(write.status()).toBeLessThan(300);
      await page.reload();
      const edit = header.locator('[data-slot="edit"]').getByRole('button');
      await expect(edit).toBeEnabled();
      await edit.click();
      await page.screenshot({ path: `${ARTIFACTS_DIR}secrets-member-edit.png` });
      await main.getByLabel('Title').fill(`${marker} edited`);
      await main.getByRole('button', { name: 'Save secret' }).click();
      await expect(header.getByRole('heading', { level: 2 })).toContainText(`${marker} edited`);
      // Write gives edit, not manage.
      await expect(header.locator('[data-slot="delete"]').getByRole('button')).toBeDisabled();
    } finally {
      await ownerApi.delete(`/api/secrets/${secret.id}`);
    }
  });
});
