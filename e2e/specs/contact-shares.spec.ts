import type { APIRequestContext, Page } from '@playwright/test';
import { makeDoc } from '../lib/doc';
import { ARTIFACTS_DIR } from '../lib/env';
import { expect, test } from '../lib/fixtures';

/**
 * Contact shares end to end (brain migration 0214; plan section 10, "UI
 * e2e"): enable sharing on a contact and copy the code from the shown-once
 * dialog; share an app and a page with two contacts through the Access
 * control's searchable multi-select; open the app link in a fresh browser:
 * a wrong code is refused, the right one opens it; the "Shared with you"
 * menu lists the app and the page; a write is refused without Can write and
 * runs with it; revoke the page on the contact's "Shared" tab and the menu
 * no longer lists it; Revoke all, and the next call fails.
 *
 * Needs a brain with contact shares (0214) that can build and publish an
 * app. It creates and deletes its own contacts, page and app.
 */

/** GET /api/grants/:nodeId: the contact shares ride on the Access panel's view. */
type AccessView = {
  contactShares?: Array<{ shareId: string; contactId: string; name: string; path: string }>;
};

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} answered ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Share the item open on `page` with the contacts named, through the
 *  Access control's "Share with contact" multi-select. */
async function shareInUi(page: Page, search: string, names: string[]) {
  await page.getByRole('button', { name: 'Access' }).first().click();
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await add.click();
  await page.getByRole('textbox', { name: 'Search contacts' }).fill(search);
  for (const name of names) {
    // The exact contact: the list may still show other rows while the
    // search settles.
    await page.getByRole('checkbox', { name: new RegExp(`^${name} ${search}\\b`) }).check();
  }
  await page.getByRole('button', { name: `Add ${names.length}` }).click();
  await expect(page.getByRole('list', { name: 'Contacts it is shared with' })).toContainText(
    names[0]!,
  );
  await page.keyboard.press('Escape');
}

test.describe('contact shares', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('share an app and a page with two contacts; the contact opens, writes, loses them', async ({
    ownerApi,
    ownerPage,
    visitorPage,
    serverURL,
  }) => {
    test.setTimeout(240_000);
    const marker = `CS${Date.now()}`;
    const contact = async (first: string) =>
      (
        await json<{ contact: { id: string } }>(
          await ownerApi.post('/api/contacts', {
            data: {
              first_name: first,
              last_name: marker,
              emails: [`${first.toLowerCase()}@example.invalid`],
            },
          }),
        )
      ).contact.id;
    const ann = await contact('Ann');
    const ben = await contact('Ben');
    const { page: pageRow } = await json<{ page: { id: string } }>(
      await ownerApi.post('/api/pages', {
        data: { title: `${marker} page`, doc: makeDoc(`${marker} page`, 'For one contact.') },
      }),
    );
    const { app } = await json<{ app: { id: string } }>(
      await ownerApi.post('/api/apps', { data: { name: `${marker} app` } }),
    );

    try {
      // A published app: a link serves the published build only. A new app
      // has no source, so it gets a one-file draft, then publish builds it.
      await json(
        await ownerApi.put(`/api/apps/${app.id}/draft`, {
          data: {
            entry: 'App.tsx',
            files: { 'App.tsx': 'export default function App() { return <p>Orders</p>; }\n' },
          },
        }),
      );
      const published = await json<{ app: { hasBuild?: boolean } }>(
        await ownerApi.post(`/api/apps/${app.id}/publish`),
      );
      expect(published.app.hasBuild, 'the app did not publish').toBe(true);

      // 1. Enable sharing on Ann in the UI: the code shows once, with Copy.
      await ownerPage.goto(`/contacts?id=${ann}`);
      const detail = ownerPage.locator('[data-testid="detail"]');
      await detail.getByRole('switch', { name: 'Enable sharing' }).click();
      const codeBox = ownerPage.getByLabel('Sharing code');
      await expect(codeBox).toBeVisible();
      const code = (await codeBox.innerText()).trim();
      expect(code).toMatch(/^[A-Za-z2-9]{8}$/);
      await expect(ownerPage.getByText('Shown once. Send it apart from the links.')).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}contact-shares-code.png` });
      await ownerPage.getByRole('button', { name: 'Done' }).click();
      await expect(codeBox).toBeHidden();
      // Ben by the API: the UI path is the one above.
      await json(
        await ownerApi.post(`/api/contacts/${ben}/sharing`, { data: { action: 'enable' } }),
      );

      // 2. Share the page and the app with both, searching and ticking two.
      await ownerPage.goto(`/pages/${pageRow.id}`);
      await shareInUi(ownerPage, marker, ['Ann', 'Ben']);
      await ownerPage.goto(`/apps/${app.id}`);
      await shareInUi(ownerPage, marker, ['Ann', 'Ben']);

      const linkOf = async (nodeId: string) => {
        const view = await json<AccessView>(await ownerApi.get(`/api/grants/${nodeId}`));
        const mine = view.contactShares?.find((s) => s.contactId === ann);
        expect(mine, `no share for Ann on ${nodeId}`).toBeTruthy();
        expect(view.contactShares).toHaveLength(2);
        return mine!;
      };
      const appShare = await linkOf(app.id);
      const pageShare = await linkOf(pageRow.id);
      const appUrl = `${serverURL}${appShare.path}`;
      const appToken = appShare.path.slice('/s/'.length);

      // 3. A fresh browser: the prompt, a wrong code, the right code.
      await visitorPage.goto(appUrl);
      await expect(visitorPage.getByRole('heading', { name: 'Enter your code' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(visitorPage.getByText(`${marker} app`)).toHaveCount(0);
      await visitorPage.getByLabel('Code').fill('wrongcod');
      await visitorPage.getByRole('button', { name: 'Continue' }).click();
      await expect(
        visitorPage.getByText('That code was not recognised.', { exact: false }),
      ).toBeVisible();
      await visitorPage.getByLabel('Code').fill(code);
      await visitorPage.getByRole('button', { name: 'Continue' }).click();

      // 4. In: the menu lists the app and the page.
      const pill = visitorPage.locator('[data-contact-menu="pill"]');
      await expect(pill).toBeVisible({ timeout: 20_000 });
      await expect(pill).toContainText('Shared with you (2)');
      await pill.locator('summary').click();
      await expect(pill.getByRole('link', { name: `${marker} page` })).toBeVisible();
      await expect(pill.getByRole('link', { name: `${marker} app` })).toBeVisible();
      await visitorPage.screenshot({ path: `${ARTIFACTS_DIR}contact-shares-menu.png` });

      // 5. A write: refused without Can write, runs with it. A share writes
      // rows only, never the schema, so the owner makes the table.
      await json(
        await ownerApi.post(`/api/apps/${app.id}/db-broker`, {
          data: { op: 'exec', sql: 'create table if not exists e2e_cs (x text)' },
        }),
      );
      const exec = () =>
        visitorPage.request.post(`${serverURL}/s/${appToken}/db-broker`, {
          data: { op: 'exec', sql: "insert into e2e_cs (x) values ('a')" },
        });
      const refused = await exec();
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toMatchObject({ reason: 'read-only' });
      await json(
        await ownerApi.patch(`/api/shares/${appShare.shareId}`, { data: { canWrite: true } }),
      );
      expect((await exec()).status()).toBe(200);

      // 6. Revoke the page on Ann's "Shared" tab; the menu drops it.
      await ownerPage.goto(`/contacts?id=${ann}`);
      await detail.getByRole('tab', { name: /Shared/ }).click();
      const sharedList = detail.getByRole('list', { name: 'Shared' });
      await expect(sharedList).toContainText(`${marker} page`);
      await expect(sharedList).toContainText('Can write');
      await sharedList.getByRole('button', { name: `Revoke "${marker} page"` }).click();
      await ownerPage.getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(sharedList).not.toContainText(`${marker} page`);
      expect((await visitorPage.request.get(`${serverURL}${pageShare.path}`)).status()).toBe(404);
      await visitorPage.reload();
      await expect(pill).toContainText('Shared with you (1)');

      // 7. Revoke all: the contact's next call fails.
      await detail.getByRole('tab', { name: 'Details' }).click();
      await detail.getByRole('button', { name: 'Revoke all' }).click();
      await ownerPage.getByRole('button', { name: 'Revoke 1' }).click();
      await expect(detail.getByRole('button', { name: 'Revoke all' })).toBeDisabled();
      expect((await exec()).status()).toBe(404);
      expect((await visitorPage.request.get(appUrl)).status()).toBe(404);
    } finally {
      await ownerApi.delete(`/api/apps/${app.id}`);
      await ownerApi.delete(`/api/pages/${pageRow.id}`);
      await ownerApi.delete(`/api/contacts/${ann}`);
      await ownerApi.delete(`/api/contacts/${ben}`);
    }
  });
});
