import { expect, test } from '../lib/fixtures';

/**
 * The thirteen single-panel settings screens — Profile, Appearance, Backups… —
 * and the pane they sit in.
 *
 * ── What this file used to be ─────────────────────────────────────────────
 * `settings-hub.spec.ts`: a card per screen at `/settings`, the open card
 * selected, a stat line under five of them, and one collapsed "Settings" row
 * standing in for all thirteen in the sidebar. That hub is undone (c7af6a6).
 * The screens are flat sidebar rows again — so the menu FILTER finds them,
 * which the collapsed row had broken — `/settings` redirects to Profile, and
 * the cards are gone.
 *
 * What SURVIVED is the pane, because the pane was the good half of the hub.
 * `MeasuredPane` is `MasterDetail` minus the list: one measured column with a
 * draggable right edge, remembered per screen, and an empty spacer whose only
 * job is to give the content an edge to pull against. This file holds exactly
 * that, plus the two sidebar rules the revert leaned on.
 *
 * Not a row in `master-detail-screens.spec.ts`, deliberately: there is no
 * `[data-testid="list"]` to find. That absence is asserted below rather than
 * assumed, because a list coming back would mean the hub had.
 *
 * ⚠ Selectors. `react-resizable-panels` mirrors each panel's `id` onto
 * `data-testid`, so the content panel is `[data-testid="content"]`, the spacer
 * `[data-testid="spacer"]`, and the group carries the persistence id —
 * `measured-pane:settings:/settings/<name>`. Scope everything to that group:
 * the app shell has a resizable handle of its own for the nav rail.
 */

/** Every screen under `settings/(hub)/`, by path. */
const SCREENS = [
  '/settings/profile',
  '/settings/appearance',
  '/settings/microsoft',
  '/settings/calendar',
  '/settings/discover',
  '/settings/mcp',
  '/settings/embedding',
  '/settings/network',
  '/settings/entities',
  '/settings/pdf-passwords',
  '/settings/backups',
  '/settings/updates',
  '/settings/audit',
];

/** `max-w-2xl` — the measure a form opens at. */
const FORM_WIDTH = 672;
/** Appearance is a GALLERY, not a form, and opens at double the measure. */
const GALLERY_WIDTH = 1344;

type Page = import('@playwright/test').Page;

/** The settings pane on the current screen: the panel group, keyed on the path. */
function pane(page: Page) {
  return page.locator(
    '[data-slot="resizable-panel-group"][data-testid^="measured-pane:settings:"]',
  );
}

function content(page: Page) {
  return pane(page).locator('[data-testid="content"]');
}

/** The pane's OWN divider — a direct child, never the app shell's nav-rail handle. */
function handle(page: Page) {
  return pane(page).locator(':scope > [data-slot="resizable-handle"]');
}

async function dragHandle(page: Page, dx: number) {
  const grip = (await handle(page).boundingBox())!;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('settings pane', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  for (const path of SCREENS) {
    test(`${path} sits in a MeasuredPane keyed on its own path, with a remembered width`, async ({
      ownerPage,
    }) => {
      // Explicit, not `test.use`: `ownerPage` comes from a hand-built context
      // that does not read the fixture's viewport option.
      //
      // 1920, not 1600, for the reason the Appearance test below already gives:
      // the nav rail takes 256px, and Appearance opens at DOUBLE the measure.
      // At 1600 that leaves its spacer at zero and its 1px divider jammed under
      // the Activity column — a `fixed right-0 z-30` aside that takes the
      // pointerdown, so the drag below moved nothing in EITHER direction. Not a
      // layout constraint and not hydration: `elementFromPoint` at the grip
      // returns the aside. Every other screen passed here by luck of opening
      // narrow enough to keep its divider clear of it.
      await ownerPage.setViewportSize({ width: 1920, height: 900 });

      // The pane has to survive a SERVER render. `MeasuredPane` hands
      // `useDefaultLayout` a no-op storage on the server for the same reason
      // `MasterDetail` does — the hook's `localStorage` default is not a global
      // Node has — and a regression there throws out of the server snapshot and
      // drops the whole route to client rendering.
      const bailouts: string[] = [];
      ownerPage.on('pageerror', (err) => {
        if (/Switched to client rendering/.test(err.message)) bailouts.push(err.message);
      });

      await ownerPage.goto(path);

      const group = pane(ownerPage);
      await expect(
        group,
        'no MeasuredPane — is the screen still under the (hub) layout?',
      ).toBeVisible();
      // Per SCREEN, not per section: one shared key made every screen adopt
      // whatever width was last dragged on another one.
      await expect(group).toHaveAttribute('data-testid', `measured-pane:settings:${path}`);
      // Two panels — the content and the empty spacer — and no list. A third
      // panel, or a list, means the card hub has crept back.
      await expect(group.locator(':scope > [data-slot="resizable-panel"]')).toHaveCount(2);
      await expect(
        group.locator('[data-testid="list"]'),
        'a list panel inside the settings pane — the card hub is back?',
      ).toHaveCount(0);
      expect(bailouts, 'the server render threw and the route fell back to the client').toEqual([]);

      // Exactly one scrollbar in the content pane: the pane's own. A screen
      // that keeps its old `h-full overflow-y-auto` nests a second.
      const body = content(ownerPage);
      // Only PANE-HEIGHT scrollers count. The failure this guards is a screen
      // that kept its old `h-full overflow-y-auto` and nested a second full
      // pane inside the scaffold's own — two scrollbars down the same edge. A
      // child that deliberately CAPS itself is a bounded region the design
      // asked for: the same check in `master-detail-screens.spec.ts` failed
      // `/models` over a `max-h-[480px]` <pre>. No settings screen trips it
      // today; this keeps the two copies of the assertion honest together.
      const scrollers = await body.evaluate((el) => {
        const full = (el as HTMLElement).clientHeight;
        return Array.from(el.querySelectorAll('*')).filter((node) => {
          const n = node as HTMLElement;
          const s = getComputedStyle(n);
          return (
            (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            n.scrollHeight > n.clientHeight &&
            n.clientHeight >= full - 8
          );
        }).length;
      });
      expect(scrollers, 'the content pane should have at most one scrollbar').toBeLessThanOrEqual(
        1,
      );

      // The width is saved under this screen's OWN key, and only after a real
      // interaction, hence the drag. Drag LEFT: it is always possible, whereas
      // a drag to the right has nowhere to go on Appearance at this viewport —
      // 1344px plus the nav rail already fills 1600, so its spacer is at zero.
      const before = (await body.boundingBox())!;
      await dragHandle(ownerPage, -120);
      const dragged = (await body.boundingBox())!;
      expect(before.width - dragged.width, 'the divider did not move').toBeGreaterThan(20);

      const key = await ownerPage.evaluate(
        (id) =>
          Object.keys(window.localStorage).find(
            (k) => k.includes('measured-pane') && k.includes(id),
          ) ?? null,
        `settings:${path}`,
      );
      expect(key, `no saved layout under a key naming "settings:${path}"`).toBeTruthy();

      await ownerPage.reload();
      await expect
        .poll(async () => Math.abs((await content(ownerPage).boundingBox())!.width - dragged.width))
        .toBeLessThan(3);
    });
  }

  test('a form opens at its measure, and Appearance at double it', async ({ ownerPage }) => {
    // 1920 wide, not 1600: the nav rail is 256px and Activity opens collapsed,
    // so there is room for 1344px AND a spacer beside it. At 1600 there is not,
    // the panel is clamped to what is left, and the reading says nothing about
    // the default. Nothing is saved yet in this fresh context, so these are the
    // opening widths and not remembered ones.
    await ownerPage.setViewportSize({ width: 1920, height: 1080 });

    await ownerPage.goto('/settings/profile');
    await expect(pane(ownerPage)).toBeVisible();
    await expect
      .poll(async () => (await content(ownerPage).boundingBox())!.width, {
        message: 'Profile did not open at the form measure',
      })
      .toBeGreaterThan(FORM_WIDTH - 4);
    expect((await content(ownerPage).boundingBox())!.width).toBeLessThan(FORM_WIDTH + 4);

    // Appearance is ~40 theme swatches and ~34 avatar styles in columns. At a
    // form's measure it rendered as a cramped strip beside several hundred
    // pixels of empty spacer, so it is the one screen that opens wide. Still
    // draggable from there, still remembered; only where it OPENS differs.
    await ownerPage.goto('/settings/appearance');
    await expect(pane(ownerPage)).toBeVisible();
    await expect
      .poll(async () => (await content(ownerPage).boundingBox())!.width, {
        message: 'Appearance did not open at double the measure — is WIDE_SCREENS still there?',
      })
      .toBeGreaterThan(GALLERY_WIDTH - 4);
    expect((await content(ownerPage).boundingBox())!.width).toBeLessThan(GALLERY_WIDTH + 4);
  });

  test('a width dragged on one screen does not follow to another', async ({ ownerPage }) => {
    // The bug the per-screen key exists for: with one shared key, dragging
    // Appearance wide silently widened Profile too, which reads as a bug rather
    // than as a remembered preference.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings/profile');
    await expect(pane(ownerPage)).toBeVisible();
    await dragHandle(ownerPage, -150);
    const narrowed = (await content(ownerPage).boundingBox())!.width;
    expect(narrowed).toBeLessThan(FORM_WIDTH - 100);

    await ownerPage.goto('/settings/backups');
    await expect(pane(ownerPage)).toBeVisible();
    await expect
      .poll(async () => (await content(ownerPage).boundingBox())!.width, {
        message: 'Backups opened at the width dragged on Profile — a shared key?',
      })
      .toBeGreaterThan(FORM_WIDTH - 4);
  });

  test('/settings is a redirect to Profile, not a landing page', async ({ ownerPage }) => {
    // The hub's `/settings` was an explainer that lit no card and said to pick
    // one. With no cards to pick there is nothing for the URL to show, and it
    // has been a real linkable address, so it lands on Profile rather than
    // 404ing — the first entry in the group, and the one screen every owner
    // has a reason to open.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings');
    await expect(ownerPage).toHaveURL(/\/settings\/profile$/);
    await expect(pane(ownerPage)).toHaveAttribute(
      'data-testid',
      'measured-pane:settings:/settings/profile',
    );
    await expect(ownerPage.getByText('Pick a setting on the left.')).toHaveCount(0);
  });

  test('the drag can run to the window edge, not a 1100px cap', async ({ ownerPage }) => {
    // `maxSize="100%"` lets the drag run the spacer down to nothing, so the
    // ceiling is the window minus the rail rather than `MasterDetail`'s 1100px
    // default. Profile, not Appearance: Appearance already opens above 1150,
    // which would make this assertion pass without any drag at all.
    await ownerPage.setViewportSize({ width: 1920, height: 1080 });
    await ownerPage.goto('/settings/profile');
    await expect(pane(ownerPage)).toBeVisible();

    const grip = (await handle(ownerPage).boundingBox())!;
    await ownerPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(1900, grip.y + grip.height / 2, { steps: 12 });
    await ownerPage.mouse.up();

    await expect
      .poll(async () => (await content(ownerPage).boundingBox())!.width, {
        message: 'the pane stopped short — is maxSize back at an 1100px ceiling?',
      })
      .toBeGreaterThan(1150);
  });

  test('the screens fill the pane instead of centring in it', async ({ ownerPage }) => {
    // All thirteen once carried an `mx-auto max-w-*` of their own. A pane that
    // is ALREADY a measure and draggable, with a second cap inside it, leaves
    // the drag with nothing to do. The caps went with the hub and must stay
    // gone now the pane is what remains of it.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings/profile');
    await expect(pane(ownerPage)).toBeVisible();

    // The screen's own form: a block that fills whatever it is given, so its
    // box is a faithful reading of the measure it actually gets.
    const form = content(ownerPage).locator('form').first();
    await expect(form).toBeVisible();

    const paneBox = (await content(ownerPage).boundingBox())!;
    const formBox = (await form.boundingBox())!;
    // Tucked against the divider, not floated to the middle of the pane. The
    // padding is `px-6`, so allow for it and nothing more.
    expect(
      formBox.x - paneBox.x,
      'the content is centred in the pane — an inner mx-auto survived',
    ).toBeLessThan(40);

    // And widening the divider actually widens the content, which is what a
    // surviving `max-w-2xl` would silently prevent.
    await dragHandle(ownerPage, 200);
    await expect
      .poll(async () => (await form.boundingBox())!.width, {
        message: 'the content ignored the divider — it is still capped from inside',
      })
      .toBeGreaterThan(formBox.width + 100);
  });

  test('the screens keep real padding against the divider', async ({ ownerPage }) => {
    // The other half of dropping the centring caps: `mx-auto` used to supply
    // the visual gap, so a screen whose own padding was `p-1` (or absent) went
    // flush against the divider the moment it stopped being centred.
    // `embedding` was 4px and `appearance` was 0.
    //
    // Measured as the gap between the pane's left edge and the first block of
    // content — NOT the pane's `firstElementChild`, which is the pane's own
    // scroll wrapper and is unpadded by design. The locator also waits out the
    // loading spinner for free: these screens render one before their data
    // arrives, and it has no section.
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    for (const path of ['/settings/embedding', '/settings/appearance']) {
      await ownerPage.goto(path);
      const body = content(ownerPage);
      await expect(body).toBeVisible();
      const block = body.locator('section, header, form').first();
      await expect(block).toBeVisible();
      const paneBox = (await body.boundingBox())!;
      const blockBox = (await block.boundingBox())!;
      expect(blockBox.x - paneBox.x, `${path} is flush against the divider`).toBeGreaterThanOrEqual(
        16,
      );
    }

    // `audit` is the one screen built as a full-height table rather than a
    // column of sections, so it has no `section`/`header`/`form` to measure.
    // Its three regions — filter bar, table, pager — each get the same 24px,
    // while the rules between them still span the pane as dividers should.
    await ownerPage.goto('/settings/audit');
    const audit = content(ownerPage);
    await expect(audit.locator('th').first()).toBeVisible();
    const auditBox = (await audit.boundingBox())!;
    for (const [region, selector] of [
      ['filter bar', 'label'],
      ['table', 'th'],
      ['pager', 'span.tabular-nums'],
    ] as const) {
      const box = (await audit.locator(selector).first().boundingBox())!;
      expect(box.x - auditBox.x, `audit's ${region} is not inset`).toBeGreaterThanOrEqual(16);
    }
  });

  test('the sidebar lists the screens again, and the menu filter finds them', async ({
    ownerPage,
  }) => {
    // The reason the hub was undone. Folding thirteen screens behind one
    // "Settings" row meant the filter box had nothing to match: typing
    // "backups" found nothing, because the item it reads was no longer in the
    // sidebar's copy of the list. ⌘K always still found them; the menu did not.
    //
    // The filter searches the FULL list regardless of the scope selector, so
    // this holds in the default Work scope, which hides the Settings group.
    await ownerPage.setViewportSize({ width: 1600, height: 1100 });
    await ownerPage.goto('/settings/profile');
    const rail = ownerPage.locator('nav[aria-label="Primary"]');
    await expect(rail).toBeVisible();

    // No row points at `/settings` itself: that was the hub's collapsed row,
    // and today the URL is only a redirect.
    await expect(
      rail.locator('a[href="/settings"]'),
      'a row pointing at /settings — the collapsed hub row is back?',
    ).toHaveCount(0);

    const filter = rail.getByLabel('Filter navigation');
    for (const [query, name, href] of [
      ['backups', 'Backups', '/settings/backups'],
      ['audit', 'Audit log', '/settings/audit'],
    ] as const) {
      await filter.fill(query);
      const row = rail.locator(`a[href="${href}"]`);
      await expect(row, `typing "${query}" no longer finds ${name}`).toBeVisible();
      await expect(row).toContainText(name);
    }
  });

  test('one row lights, and it is the most specific one', async ({ ownerPage }) => {
    // `activeNavHref` outlived the hub: it was never really about the collapsed
    // row, but the general rule for a nav list where one href can be a prefix
    // of another. Sub-routes belong to their screen — `/settings/network/
    // connect` is still Local network — and `/settings` itself lands on
    // Profile, so Profile is what lights.
    //
    // Each row under the scope that shows it, because the default Work scope
    // hides the Settings group entirely and a row that is not rendered cannot
    // light: Profile and Agents are Settings rows, Local network is Admin's.
    // Nothing is starred in this fresh context; a starred screen lights TWICE
    // by design, once pinned and once in its home group, and that is not what
    // this measures.
    await ownerPage.setViewportSize({ width: 1600, height: 1100 });
    await ownerPage.goto('/settings/profile');
    const rail = ownerPage.locator('nav[aria-label="Primary"]');
    await expect(rail).toBeVisible();

    for (const [scope, rows] of [
      [
        'Settings',
        [
          ['/settings/profile', 'Profile'],
          ['/settings/agents', 'Agents'],
          ['/settings', 'Profile'],
        ],
      ],
      ['Admin', [['/settings/network/connect', 'Local network']]],
    ] as const) {
      await rail.getByRole('radio', { name: scope }).click();
      for (const [path, expected] of rows) {
        await ownerPage.goto(path);
        await expect(rail).toBeVisible();
        const lit = rail.locator('a[aria-current="page"]');
        await expect(lit, `${path} lit more than one row`).toHaveCount(1);
        await expect(lit).toContainText(expected);
      }
    }
  });
});
