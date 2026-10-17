import { expect, test } from '../lib/fixtures';

/**
 * The sign-in screen wears the brain's own branding — an uploaded logo, else
 * the site name in the owner's chosen face, else the MantleOS wordmark (dev task
 * `db6b72e9`). The tab follows the same name (`b05a5f17`).
 *
 * ⚠ WHAT THIS FILE CAN AND CANNOT PROVE.
 *
 * The branding is resolved SERVER-side, from the public `GET /api/appearance`
 * that the root layout already fetches — so there is no request in the browser
 * for a test to intercept, and the two branded rungs cannot be driven from
 * here. (The mantle half HAS now shipped, so the payload does carry `siteName`,
 * `peerName` and the logo versions; what is still missing is a way for this
 * harness to SET them on the scratch brain mid-run.) The ladder itself is
 * therefore covered by `client/web/lib/brand.test.ts` — pure and exhaustive —
 * and what is covered HERE is everything that has to keep working on a brain
 * that has said nothing about itself:
 *
 *  - the MantleOS wordmark is the fallback, in both themes;
 *  - the tab says MantleOS rather than going blank;
 *  - the title is in the SERVER's HTML, not painted in after hydration;
 *  - the form still renders and HYDRATES after the page was split into a
 *    server component plus a client child;
 *  - the small footer mark stays AWAY, so the unbranded screen does not show
 *    the MantleOS mark twice.
 *
 * That last one is the real regression risk in this change and the reason this
 * file exists at all.
 *
 * ⚠ These have NOT been run: the scratch brain's Postgres container is gone
 * from the workstation, so the harness cannot bootstrap an owner and every
 * spec in the suite aborts in global setup. Every assertion below was instead
 * checked by hand against the same dev client at localhost:3100 — the DOM, the
 * 180px slot, the server-rendered <title>, the absent peer line, and React's
 * props on the email input. Run them for real when the box has a database
 * again; they are written to pass, not to be believed on trust.
 */
test.describe('login branding', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('an unbranded brain shows the MantleOS wordmark, in both themes', async ({
    visitorPage,
  }) => {
    await visitorPage.goto('/login');

    // ONE img: the MantleOS art reads on both grounds, so there is no
    // light/dark pair to swap (the old Jackdaw lockup had one).
    const mark = visitorPage.locator('h1 img[src="/brand/mantleos-logo.svg"]');
    await expect(mark).toHaveCount(1);

    await visitorPage.emulateMedia({ colorScheme: 'light' });
    await expect(mark).toBeVisible();

    await visitorPage.emulateMedia({ colorScheme: 'dark' });
    await expect(mark).toBeVisible();
  });

  test('the mark sits in a fixed slot, so a branded brain cannot move the form', async ({
    visitorPage,
  }) => {
    // An uploaded logo may be 180px tall and the product wordmark is not.
    // Without a floor on the slot the form would jump up the screen the moment
    // a brain is branded, and each mark would sit somewhere different.
    await visitorPage.goto('/login');
    const slot = visitorPage.locator('h1').first();
    await expect(slot).toBeVisible();
    expect((await slot.boundingBox())!.height).toBeGreaterThanOrEqual(180);
  });

  test('the tab title is in the SERVER html, not painted in after hydration', async ({
    visitorPage,
    clientURL,
  }) => {
    // The point of `generateMetadata` over a `document.title` write: someone
    // scanning tabs during a slow load is exactly who needs the title, and
    // that is the moment a client-side one is still wrong.
    const res = await visitorPage.request.get(`${clientURL}/login`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1];
    // A brain with NEITHER name ⇒ the product name. Never blank: a nameless tab
    // is worse than a generic one. (The site-name and peer-name rungs above it
    // need the mantle field, so they live in `lib/brand.test.ts`.)
    expect(title, 'no <title> in the server-rendered HTML').toBeTruthy();
    expect(title).toBe('MantleOS');

    await visitorPage.goto('/login');
    await expect(visitorPage).toHaveTitle('MantleOS');
  });

  test('an unbranded brain does not show the MantleOS mark twice', async ({ visitorPage }) => {
    // The footer credit exists for the case where the OWNER's branding has
    // taken the hero slot. With nothing set, the hero is already the MantleOS
    // wordmark, and repeating the same mark lower down reads as a bug rather
    // than a credit — so on this brain the footer must be absent entirely.
    await visitorPage.goto('/login');
    await expect(visitorPage.locator('main > footer')).toHaveCount(0);
    // ...while the hero it defers to is still there.
    await expect(visitorPage.locator('img[src="/brand/mantleos-logo.svg"]')).toHaveCount(1);
  });

  test('an unnamed brain shows no peer line at all', async ({ visitorPage }) => {
    // Rendering an empty line would reserve space for nothing and leave the
    // strapline sitting oddly low.
    await visitorPage.goto('/login');
    await expect(visitorPage.locator('.peer-name-login')).toHaveCount(0);
  });

  test('the form still renders and hydrates after the server/client split', async ({
    visitorPage,
    clientURL,
  }) => {
    // `page.tsx` became a SERVER component and the bounce, the first-run gate
    // and the form moved into a client child. This is the check that the seam
    // holds — the branding is server-resolved, but the form must still be a
    // live, controlled React input rather than inert server HTML.
    //
    // It stops short of submitting: what a wrong password renders is the login
    // FORM's business and is covered where that behaviour lives, and asserting
    // it from here would only duplicate it.
    await visitorPage.goto(`${clientURL}/login`);

    const email = visitorPage.getByLabel('Email');
    await expect(email).toBeVisible();
    // Exact: the SecretInput eye toggle is labelled "Show password", and a
    // substring match resolves to both it and the field.
    await expect(visitorPage.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(visitorPage.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    // The first-run gate resolves client-side and defaults to "sign in" — the
    // create-account copy is for a genuinely fresh install.
    await expect(visitorPage.getByText('Sign in to your data-aware workspace.')).toBeVisible();

    // Controlled input ⇒ the client child hydrated. Server HTML alone would
    // keep whatever was typed only in the DOM, never in React's state, and
    // `toHaveValue` would still pass — so check React actually claimed the
    // node too.
    await email.fill('hydration-check@example.invalid');
    await expect(email).toHaveValue('hydration-check@example.invalid');
    expect(
      await email.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__react'))),
      'the login form never hydrated — is it still inside a server component?',
    ).toBe(true);
  });
});
