import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';
import { openFromTree, treeRow } from '../lib/tree';

/**
 * `/apps`, on the folder view every workspace has since 2026-10-09: the item
 * tree in the list column (its folder menus, "New app inside", the search in
 * `?q=`), the picked app at its address (`/apps/<id>`) under the standard item header, and the
 * app's own screen at /apps/<id>.
 *
 * `/apps`, the last phase-2a screen — and the one that was blocked, because it
 * is the only ported screen with focus mode.
 *
 * The scaffold half is one row in `master-detail-screens.spec.ts`. What is here
 * is the capability that unblocked it, and it is worth stating precisely: in
 * focus mode the list column goes to zero width but is **still mounted**. The
 * cheap version of this feature is `{zen ? null : list}`, which looks identical
 * in a screenshot and silently throws away the user's search text, scroll
 * position and page every time they toggle. The whole point of the
 * `MasterDetail` change is that it does NOT do that, so that is what these
 * tests assert — not the width, which both versions would pass.
 */

/** The screen renders its preview (and the focus toggle) only with a selection,
 *  so every test needs one app to exist. Returns a cleanup. */
async function withApp(
  ownerApi: APIRequestContext,
  run: (app: { id: string; title: string }) => Promise<void>,
) {
  const name = `E2E app ${Date.now()}`;
  const created = await ownerApi.post('/api/apps', { data: { name } });
  expect(created.status(), 'could not create the fixture app').toBeLessThan(300);
  const { app } = (await created.json()) as { app: { id: string } };
  try {
    await run({ id: app.id, title: name });
  } finally {
    await ownerApi.delete(`/api/apps/${app.id}`);
  }
}

/** Give the app a published build: an app is shared (the Access slot is a
 *  button) only once it has one. A new app has no source, so it gets a
 *  one-file draft, then publish builds it. */
async function publish(ownerApi: APIRequestContext, id: string) {
  const draft = await ownerApi.put(`/api/apps/${id}/draft`, {
    data: {
      entry: 'App.tsx',
      files: { 'App.tsx': 'export default function App() { return <p>E2E</p>; }\n' },
    },
  });
  expect(draft.status(), 'could not save the draft').toBeLessThan(300);
  const published = await ownerApi.post(`/api/apps/${id}/publish`);
  expect(published.status(), 'could not publish').toBeLessThan(300);
  const { app } = (await published.json()) as { app: { hasBuild?: boolean } };
  expect(app.hasBuild, 'the app did not publish').toBe(true);
}

/** Switch an app's view (Builder, Code, History, Activity). They are picked
 *  from the header's View menu, not a tab bar, since v0.6.217. */
async function openView(page: Page, view: string) {
  await page.getByRole('button', { name: /^View:/ }).click();
  // The view switch is a header tool with a menu (item header contract).
  await page.getByRole('menuitem', { name: new RegExp(`^${view}`) }).click();
}

test.describe('apps', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('focus mode collapses the list WITHOUT unmounting it', async ({ ownerApi, ownerPage }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      // The tree picks nothing by itself: the focus toggle is in the picked
      // app's header.
      await ownerPage.goto(`/apps?id=${app.id}`);

      const list = ownerPage.locator('[data-testid="list"]');
      // The item tree's search box (a brain that serves the tree for apps,
      // which the e2e brain always is). It is a plain textbox named "Search
      // apps" since Apps moved onto the item tree (a43663ca); the app-nav
      // tree before it was a `type="search"` box.
      const search = list.getByRole('textbox', { name: 'Search apps' });
      await expect(list).toBeVisible();
      await expect(search).toBeVisible();

      // Something typed into the column, so the column can be counted while it
      // is collapsed and its text checked when it comes back.
      await search.fill('half-typed query');
      const widthOf = () => list.evaluate((el) => (el as HTMLElement).offsetWidth);
      const expanded = await widthOf();
      expect(expanded, 'the list should start at its 340px column').toBeGreaterThan(300);

      await ownerPage.getByRole('button', { name: 'Focus mode' }).click();

      // Collapsed...
      await expect.poll(widthOf, 'the list did not collapse').toBeLessThanOrEqual(1);
      // ...but STILL THERE, with what the user typed. `count()` rather than
      // `toBeVisible()`: zero-width is correctly not visible, and that is the
      // whole distinction this test exists to draw.
      // `count()` is the guard. The tree's query is held by the SCREEN, not
      // inside the column, so a remounted column would get the same text back
      // and `inputValue()` alone would pass with `{zen ? null : list}` put back
      // (focus-mode.spec.ts says the same of Notes, Draw and Pages).
      expect(await search.count(), 'the list was UNMOUNTED, not collapsed').toBe(1);
      expect(await search.inputValue(), 'the search box lost its text').toBe('half-typed query');
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}apps-focus-collapsed.png` });

      await ownerPage.getByRole('button', { name: 'Exit focus mode' }).click();

      // And back, to the SAME width and the same text. Polled on the delta
      // rather than on "> 300": leaving focus gives the shell its chrome back,
      // so the panel group narrows (1600 → 1288 here) a frame or two after the
      // list reappears, and a width sampled in between is legitimately wider.
      await expect
        .poll(async () => Math.abs((await widthOf()) - expanded), {
          message: 'the list did not come back to the width it left at',
        })
        .toBeLessThan(3);
      expect(await search.inputValue()).toBe('half-typed query');

      // A collapse must not be PERSISTED. `onlySaveAfterUserInteractions` is
      // what stops it, and if it ever stopped working the list would be gone
      // after a reload with no handle left to drag it back — unrecoverable
      // without clearing localStorage.
      await ownerPage.reload();
      await expect(search).toBeVisible();
      await expect.poll(widthOf, 'a collapsed width was saved and reloaded').toBeGreaterThan(300);
    });
  });

  test('the preview fills the pane rather than stopping at a text measure', async ({
    ownerApi,
    ownerPage,
  }) => {
    await withApp(ownerApi, async () => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto('/apps');

      const group = ownerPage.locator('[data-slot="resizable-panel-group"]').first();
      const detail = ownerPage.locator('[data-testid="detail"]');
      await expect(detail).toBeVisible();

      // `detailFills`: no empty spacer panel, so the detail's right edge is the
      // group's right edge. With the 672px default an app viewport would be
      // capped at a reading measure and the rest of a 1600px window left blank.
      const groupBox = (await group.boundingBox())!;
      const detailBox = (await detail.boundingBox())!;
      const gap = groupBox.x + groupBox.width - (detailBox.x + detailBox.width);
      expect(gap, 'a spacer is still eating the right-hand side').toBeLessThan(4);
      expect(detailBox.width, 'the preview is capped near the 672px measure').toBeGreaterThan(900);
    });
  });

  test('the Code tab file tree is draggable, and remembers its width', async ({
    ownerApi,
    ownerPage,
  }) => {
    // It was a hard `grid-cols-[200px_minmax(0,1fr)]` — the one remaining
    // hand-written grid with no `md:` prefix, which is why the usual sweep
    // missed it. 200px is not enough for a nested path, and there was no way
    // to ask for more.
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto(`/apps/${app.id}?edit=1`);
      await openView(ownerPage, 'Code');

      // The code view's own file list, inside the detail pane (the apps tree
      // is the screen's list beside it).
      const list = ownerPage.locator('[data-testid="detail"] [data-testid="list"]');
      await expect(list, 'no list panel — still a hand-written grid?').toBeVisible();
      const widthOf = () => list.evaluate((el) => (el as HTMLElement).offsetWidth);
      // The 200px column it has always opened at, not MasterDetail's 340 default.
      await expect.poll(widthOf).toBeLessThan(260);

      // The scaffold's own divider: the app shell has a handle too, and the
      // Code tab's group is nested inside it.
      const handle = ownerPage
        .locator('[data-slot="resizable-panel-group"]:has([data-testid="list"])')
        .last()
        .locator(':scope > [data-slot="resizable-handle"]')
        .first();
      const grip = (await handle.boundingBox())!;
      await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2, {
        steps: 8,
      });
      await ownerPage.mouse.up();
      const widened = await widthOf();
      expect(widened, 'the divider did not move').toBeGreaterThan(260);

      await ownerPage.reload();
      await openView(ownerPage, 'Code');
      await expect(list).toBeVisible();
      await expect.poll(async () => Math.abs((await widthOf()) - widened)).toBeLessThan(3);
    });
  });

  test('creating an app with no name says so instead of doing nothing', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/apps');

    // The standard New button of the tree's toolbar, as on every workspace.
    await ownerPage
      .locator('[data-testid="list"]')
      .getByRole('button', { name: 'New', exact: true })
      .click();
    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New app' })).toBeVisible();

    const name = dialog.getByLabel('Name');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');

    // Was a bare `return` — the button appeared inert and nothing explained why.
    await dialog.getByRole('button', { name: 'Create app' }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    const error = dialog.getByRole('alert');
    await expect(error).toHaveText('A name is required');
    expect(await name.getAttribute('aria-describedby')).toBe(await error.getAttribute('id'));

    // Typing clears it, so the mark tracks the field rather than sticking.
    await name.fill('Weather');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  });
  test('picking an app in the tree opens it under the item header, at its address', async ({
    ownerApi,
    ownerPage,
  }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto('/apps');
      const detail = ownerPage.locator('[data-testid="detail"]');
      const heading = detail.getByRole('heading', { name: app.title });
      await openFromTree(ownerPage, app.title, heading);

      // The URL names it, so a reload or a shared link opens the same app.
      await expect.poll(() => new URL(ownerPage.url()).pathname).toBe(`/apps/${app.id}`);
      // The header's actions: the pencil edits it at its edit address.
      await expect(detail.getByRole('link', { name: 'Open app' })).toHaveAttribute(
        'href',
        `/apps/${app.id}?edit=1`,
      );
      await expect(detail.getByRole('button', { name: 'Delete app' })).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}apps-folder-view.png` });

      await ownerPage.reload();
      await expect(heading).toBeVisible();
    });
  });

  test('the tree search lives in ?q=', async ({ ownerApi, ownerPage }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto(`/apps?q=${encodeURIComponent(app.title)}`);
      const list = ownerPage.locator('[data-testid="list"]');
      await expect(list.getByRole('textbox', { name: 'Search apps' })).toHaveValue(app.title);
      await expect(treeRow(ownerPage, app.title).first()).toBeVisible();
    });
  });

  test('old links land on the folder view', async ({ ownerApi, ownerPage }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      // The paged list's params are dropped; `?selected=` opens the app at its
      // own address.
      await ownerPage.goto(`/apps?page=2&sort=title&selected=${app.id}`);
      await expect
        .poll(() => {
          const u = new URL(ownerPage.url());
          return `${u.pathname}${u.search}`;
        })
        .toBe(`/apps/${app.id}`);
      await expect(
        ownerPage.locator('[data-testid="detail"]').getByRole('heading', { name: app.title }),
      ).toBeVisible();
    });
  });

  test('a folder menu makes a new app inside that folder', async ({ ownerApi, ownerPage }) => {
    const folderName = `E2E apps folder ${Date.now()}`;
    const made = await ownerApi.post('/api/tree/apps/folders', {
      data: { parentId: null, name: folderName },
    });
    expect(made.status(), 'could not create the fixture folder').toBeLessThan(300);
    const { folder } = (await made.json()) as { folder: { id: string } };
    const appName = `E2E inside ${Date.now()}`;
    let appId: string | null = null;
    try {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto('/apps');
      await expect(treeRow(ownerPage, folderName).first()).toBeVisible();
      await ownerPage.getByRole('button', { name: `More actions for ${folderName}` }).click();
      await ownerPage.getByRole('menuitem', { name: 'New app inside' }).click();

      const dialog = ownerPage.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: `New app in “${folderName}”` }),
      ).toBeVisible();
      await dialog.getByLabel('Name').fill(appName);
      await dialog.getByRole('button', { name: 'Create app' }).click();

      // The app's own screen opens next, in its editor.
      await ownerPage.waitForURL(/\/apps\/[0-9a-f-]{36}\?edit=1$/);
      appId = new URL(ownerPage.url()).pathname.split('/apps/')[1]!;

      // And it is filed in the folder.
      await expect
        .poll(async () => {
          const res = await ownerApi.get(`/api/tree/apps?folder=${folder.id}`);
          const body = (await res.json()) as { items?: Array<{ id: string }> };
          return body.items?.some((i) => i.id === appId) ?? false;
        })
        .toBe(true);
    } finally {
      if (appId) await ownerApi.delete(`/api/apps/${appId}`);
      await ownerApi.delete(`/api/tree/apps/folders/${folder.id}`);
    }
  });

  test('phone width stacks the tree over the app', async ({ ownerApi, ownerPage }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await ownerPage.goto(`/apps?id=${app.id}`);
      // Stacked below `md`: no panels (and no list test id), the tree first.
      await expect(ownerPage.getByRole('textbox', { name: 'Search apps' })).toBeVisible();
      await expect(ownerPage.getByRole('heading', { name: app.title })).toBeVisible();
      // The running app gets real height, not the iframe's intrinsic 150px.
      const pane = ownerPage.getByTestId('app-preview-run');
      await expect.poll(async () => (await pane.boundingBox())?.height ?? 0).toBeGreaterThan(400);
      // No sideways scroll on a phone.
      const overflow = await ownerPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}apps-phone.png` });
    });
  });
  test('Open after picking an app in /apps opens its own screen (no crash)', async ({
    ownerApi,
    ownerPage,
  }) => {
    // The pane and the app's screen share one cache entry. It once held two
    // shapes, and Open landed on "Something went wrong on this screen".
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto('/apps');
      const detail = ownerPage.locator('[data-testid="detail"]');
      await openFromTree(ownerPage, app.title, detail.getByRole('heading', { name: app.title }));
      await detail.getByRole('link', { name: 'Open app' }).click();
      await ownerPage.waitForURL(new RegExp(`/apps/${app.id}\\?edit=1$`));
      await expect(ownerPage.getByRole('button', { name: /^View:/ })).toBeVisible();
      await expect(ownerPage.getByText('Something went wrong')).toHaveCount(0);
    });
  });

  test('the app header: words left, the icon-only group right, every icon named', async ({
    ownerApi,
    ownerPage,
  }) => {
    await withApp(ownerApi, async (app) => {
      await ownerPage.setViewportSize({ width: 1600, height: 900 });
      await ownerPage.goto(`/apps?id=${app.id}`);
      const header = ownerPage.getByTestId('app-item-header');
      await expect(header.getByRole('heading', { name: app.title })).toBeVisible();
      const icons = header.getByTestId('app-header-icon-actions');
      await expect(icons.getByRole('link', { name: 'Open app' })).toBeVisible();
      await expect(icons.getByRole('button', { name: 'Delete app' })).toBeVisible();
      await expect(icons.getByRole('button', { name: 'Focus mode' })).toBeVisible();
      for (const el of await icons.locator('button, a').all()) {
        expect(
          await el.getAttribute('aria-label'),
          'an icon-only button with no name',
        ).toBeTruthy();
        expect(await el.getAttribute('title'), 'an icon-only button with no tooltip').toBeTruthy();
      }
    });
  });

  test('no review: an old ?review= link is dropped and no member list shows (W5c)', async ({
    ownerPage,
    serverURL,
  }) => {
    // A brain that still answers the old member lists: the screen reads
    // them no more.
    let asked = 0;
    await ownerPage.route(`${serverURL}/api/apps/members**`, (route) => {
      asked += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ waiting: [], shared: [] }),
      });
    });
    await ownerPage.goto('/apps?review=00000000-0000-4000-8000-0000000000e2');
    await expect.poll(() => new URL(ownerPage.url()).searchParams.has('review')).toBe(false);
    const list = ownerPage.locator('[data-testid="list"]');
    await expect(list.getByRole('textbox', { name: 'Search apps' })).toBeVisible();
    await expect(ownerPage.getByText('Waiting for approval')).toHaveCount(0);
    await expect(ownerPage.getByText('Shared by members')).toHaveCount(0);
    expect(asked).toBe(0);
  });

  test('the app editor wears the same one-row header as the Apps pane', async ({
    ownerApi,
    ownerPage,
  }) => {
    await withApp(ownerApi, async (app) => {
      await publish(ownerApi, app.id);
      await ownerPage.setViewportSize({ width: 1600, height: 900 });

      await ownerPage.goto(`/apps?id=${app.id}`);
      const paneHeader = ownerPage.locator('[data-testid="detail"]').getByTestId('app-item-header');
      await expect(paneHeader.getByRole('heading', { name: app.title })).toBeVisible();
      const paneHeight = (await paneHeader.boundingBox())!.height;

      await ownerPage.goto(`/apps/${app.id}?edit=1`);
      const header = ownerPage.getByTestId('app-item-header');
      await expect(header).toHaveCount(1);
      await expect(header.getByRole('heading', { name: app.title })).toBeVisible();
      const words = header.getByTestId('app-header-text-actions');
      const icons = header.getByTestId('app-header-icon-actions');
      // Commit is the one word button; Preview and the view switch are the
      // app's tools, icons left of the fixed slots (item header contract).
      await expect(words.getByRole('button', { name: 'Commit' })).toBeVisible();
      await expect(icons.getByRole('button', { name: /^Preview/ })).toBeVisible();
      await expect(icons.getByRole('button', { name: /^View:/ })).toBeVisible();
      const w = (await words.boundingBox())!;
      const i = (await icons.boundingBox())!;
      expect(w.x + w.width, 'the worded buttons must sit left of the icons').toBeLessThanOrEqual(
        i.x,
      );
      for (const el of await icons.locator('button, a').all()) {
        expect(
          await el.getAttribute('aria-label'),
          'an icon-only button with no name',
        ).toBeTruthy();
        expect(await el.getAttribute('title'), 'an icon-only button with no tooltip').toBeTruthy();
      }
      // One row, the same height as the pane's header for the same app.
      const height = (await header.boundingBox())!.height;
      expect(Math.abs(height - paneHeight), 'the editor header is taller').toBeLessThanOrEqual(1);

      // The extra words behind Info; MCP access in the Access panel (W5b:
      // it left App settings, and Informational is each grant's Write).
      await icons.getByRole('button', { name: 'About this app' }).click();
      await expect(ownerPage.getByRole('dialog')).toContainText('It declares no tools.');
      await ownerPage.keyboard.press('Escape');
      await icons.getByRole('button', { name: 'Access' }).click();
      await expect(ownerPage.getByRole('switch', { name: 'MCP access' })).toBeVisible();
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}apps-editor-access.png` });
      await ownerPage.keyboard.press('Escape');
      await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}apps-editor-header.png` });
    });
  });
});
