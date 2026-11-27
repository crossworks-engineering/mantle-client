import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { fillCsp } from '../../client/host/src/static-host';
import { SERVER_URL } from '../lib/env';
import { expect, test } from '../lib/fixtures';

/**
 * Excalidraw's fonts come from this origin and nowhere else.
 *
 * Upstream lists a CDN source (esm.sh) after the self-hosted one for every
 * font face, and Chromium CSP-checks every source of a FontFace up front, so
 * an unpatched package logged one `font-src` violation per face (about 230 in
 * a drawing session) even though the self-hosted copy was the one that
 * loaded. patches/@excalidraw__excalidraw@0.18.1.patch keeps the CDN out of
 * the list once EXCALIDRAW_ASSET_PATH is set. This drives the real editor
 * (draw, type, Commit) in both themes and asserts that no request, console
 * message or CSP violation names esm.sh, and that the committed SVG still
 * carries its fonts inline.
 */

const CDN = /esm\.sh/;

type Violation = { directive: string; blockedURI: string };

/** Records CSP violations into the page, from before any app code runs. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: { directive: string; blockedURI: string }[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({ directive: e.effectiveDirective, blockedURI: e.blockedURI });
    });
  });
}

/**
 * Put the static host's policy on the editor's page.
 *
 * The policy is the host's header (client/host/src/static-host.ts): the
 * build's template, public/_mantle/csp.txt, filled with the brain. `next dev`
 * serves the UI for this suite and sends no policy at all, so without this
 * the page runs with none: no font-src violation can fire, for esm.sh or for
 * the control below. The template is the one the boot script wrote before
 * `next dev` started, and `fillCsp` is the host's own function.
 *
 * It goes in as a <meta> at the top of <head>, before any script of the page
 * runs, and not as a header on an answer this spec makes itself: Chromium
 * takes a page it did not load from the network as a public one and refuses
 * its requests to localhost, the brain's among them. A <meta> carries every
 * directive but frame-ancestors, which no font load reads.
 */
async function applyHostCsp(page: Page) {
  const template = readFileSync(
    new URL('../../client/web/public/_mantle/csp.txt', import.meta.url),
    'utf8',
  );
  await page.addInitScript(
    (policy) => {
      const add = () => {
        if (!document.head) return false;
        const meta = document.createElement('meta');
        meta.httpEquiv = 'Content-Security-Policy';
        meta.content = policy;
        document.head.prepend(meta);
        return true;
      };
      if (add()) return;
      const head = new MutationObserver(() => {
        if (add()) head.disconnect();
      });
      head.observe(document, { childList: true, subtree: true });
    },
    fillCsp(template, SERVER_URL),
  );
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);

test.describe('draw editor fonts', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('fonts load from this origin only, in light and dark, through Commit', async ({
    ownerApi,
    ownerPage,
  }) => {
    const created = await ownerApi.post('/api/draws', {
      data: { title: `E2E draw fonts ${Date.now()}` },
    });
    const { draw } = (await created.json()) as { draw: { id: string } };

    const cdnRequests: string[] = [];
    const cdnConsole: string[] = [];
    ownerPage.on('request', (req) => {
      if (CDN.test(req.url())) cdnRequests.push(req.url());
    });
    ownerPage.on('console', (msg) => {
      if (CDN.test(msg.text())) cdnConsole.push(msg.text());
    });
    await recordViolations(ownerPage);
    await applyHostCsp(ownerPage);

    try {
      for (const [i, scheme] of (['light', 'dark'] as const).entries()) {
        await ownerPage.emulateMedia({ colorScheme: scheme });
        await ownerPage.goto(`/draw/${draw.id}?edit=1`);
        await expect(ownerPage.locator('.excalidraw .Island').first()).toBeVisible({
          timeout: 30_000,
        });

        // Prove the recorder hears font-src violations before trusting a
        // quiet result: a deaf listener reads exactly like a clean page.
        await ownerPage.evaluate(() => {
          document.fonts.add(
            new FontFace('csp-control', 'url(https://csp-control.invalid/x.woff2)'),
          );
        });
        await expect
          .poll(async () =>
            (await violations(ownerPage)).some((v) => v.blockedURI.includes('csp-control')),
          )
          .toBe(true);

        // A shape and a line of text (Excalifont, the default), then Commit,
        // which exports the SVG snapshot and inlines the glyphs it uses.
        const canvas = ownerPage.locator('.excalidraw canvas.interactive');
        const box = (await canvas.boundingBox())!;
        const x = box.x + box.width / 3 + i * 40;
        const y = box.y + box.height / 3 + i * 40;
        await ownerPage.keyboard.press('r');
        await ownerPage.mouse.move(x, y);
        await ownerPage.mouse.down();
        await ownerPage.mouse.move(x + 160, y + 90, { steps: 5 });
        await ownerPage.mouse.up();
        await ownerPage.keyboard.press('t');
        await ownerPage.mouse.click(x, y + 160);
        await ownerPage.keyboard.type(`Fonts ${scheme}`);
        await ownerPage.keyboard.press('Escape');

        const commit = ownerPage.getByRole('button', { name: 'Commit' });
        await expect(commit).toBeEnabled({ timeout: 10_000 });
        await commit.click();
        // The toast, exactly: "Committed, but the preview could not be
        // generated" means the export failed.
        await expect(
          ownerPage.getByRole('status').getByText('Committed', { exact: true }),
        ).toBeVisible({ timeout: 20_000 });

        const res = await ownerApi.get(`/api/draws/${draw.id}/svg`);
        const svg = ((await res.json()) as { svg: string | null }).svg ?? '';
        expect(svg).toContain(`Fonts ${scheme}`);
        // The glyphs are subset from the self-hosted woff2 and inlined; a
        // failed fetch would leave a URL here instead.
        expect(svg).toMatch(/@font-face\s*\{\s*font-family:\s*Excalifont;\s*src:\s*url\(data:/);
        expect(svg).not.toMatch(CDN);

        const unexpected = (await violations(ownerPage)).filter(
          (v) => !v.blockedURI.includes('csp-control'),
        );
        expect(unexpected, `CSP violations in ${scheme}`).toEqual([]);
      }

      expect(cdnRequests, 'requests to the package CDN').toEqual([]);
      expect(cdnConsole, 'console messages naming the package CDN').toEqual([]);
    } finally {
      await ownerApi.delete(`/api/draws/${draw.id}`);
    }
  });
});
