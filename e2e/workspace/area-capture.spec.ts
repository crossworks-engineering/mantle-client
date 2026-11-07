import { expect, test, type Page } from '@playwright/test';
import {
  signIn,
  startMockWorkspaceApi,
  WORKSPACES,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * The area screenshot (replaced the element picker): drag a rectangle, see
 * the capture, then Attach to chat or Save. The desktop shell's capture is
 * stubbed for most of these; one runs the browser's own redraw of the page,
 * which never asks for a screen share. They drive the layer, the preview
 * and the save, and the
 * brain's answer says where the file landed: the workspace the switcher
 * shows, as an upload to Files lands.
 * In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL, page }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  // The desktop shell's API, with a capture that paints the asked area.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.mantleDesktop = {
      platform: 'darwin',
      notify: () => undefined,
      setBadge: () => undefined,
      capture: async (rect: { w: number; h: number }) => {
        w.__captured = rect;
        const c = document.createElement('canvas');
        c.width = rect.w;
        c.height = rect.h;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#3366ff';
        ctx.fillRect(0, 0, rect.w, rect.h);
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  });
});
test.afterEach(async () => {
  await api.close();
});

/** Pick a workspace in the switcher by its name. */
async function pickWorkspace(page: Page, name: string) {
  await page
    .getByRole('button', { name: /^Workspace:/ })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}( Moderator)?$`) }).click();
}

async function dragArea(page: Page) {
  const layer = page.getByRole('dialog', { name: 'Capture an area' });
  await expect(layer).toBeVisible();
  await page.mouse.move(200, 150);
  await page.mouse.down();
  await page.mouse.move(320, 220, { steps: 5 });
  await page.mouse.move(420, 300, { steps: 5 });
  await page.mouse.up();
  await expect(layer).toBeHidden();
}

test('an Admin user captures an area into the switcher workspace and attaches it to the chat', async ({
  page,
}) => {
  await signIn(page, 'admin');
  await pickWorkspace(page, 'Team');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await dragArea(page);

  const preview = page.getByRole('dialog', { name: 'Screenshot' });
  await expect(preview.getByRole('img', { name: 'The captured area' })).toBeVisible();
  // Saved where an upload goes, for the workspace's people; read by the
  // brain's image model.
  await expect(
    preview.getByText('It is saved to Files in the workspace you are in', { exact: false }),
  ).toBeVisible();
  await expect(preview.getByText('image model reads it', { exact: false })).toBeVisible();
  await expect(preview.getByText('only you can see it', { exact: false })).toHaveCount(0);
  // Nothing is saved before a choice.
  expect(api.screenshots).toHaveLength(0);
  await preview.getByRole('textbox', { name: 'Note' }).fill('the list is cut off');
  await preview.getByRole('button', { name: 'Attach to chat' }).click();

  await expect.poll(() => api.screenshots.length).toBe(1);
  const shot = api.screenshots[0]!;
  expect(shot.role).toBe('admin');
  // The switcher's workspace, as every create names it.
  expect(shot.ws).toBe(WORKSPACES.team.id);
  expect(shot.meta).toMatchObject({
    rect: { x: 200, y: 150, w: 220, h: 150 },
    shell: 'desktop',
    note: 'the list is cut off',
  });
  expect(
    await page.evaluate(() => (window as unknown as { __captured: unknown }).__captured),
  ).toEqual({ x: 200, y: 150, w: 220, h: 150 });
  await expect(preview).toBeHidden();
  // The saved file rides with the next turn as context, and the chat opens
  // (this brain answers no assistant routes, so the chip itself is not drawn).
  await expect(
    page.getByText(`Saved to Files in ${WORKSPACES.team.name} and attached to the chat.`),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle assistant (⌘I)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Esc cancels the selection and saves nothing', async ({ page }) => {
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await expect(page.getByRole('dialog', { name: 'Capture an area' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Capture an area' })).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Screenshot' })).toHaveCount(0);
  expect(api.screenshots).toHaveLength(0);
});

test('a member on All my workspaces saves one to its own home, with no attach', async ({
  page,
}) => {
  await signIn(page, 'member');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await dragArea(page);

  const preview = page.getByRole('dialog', { name: 'Screenshot' });
  // A workspace chat takes text only, so there is nothing to attach to.
  await expect(preview.getByRole('button', { name: 'Attach to chat' })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => api.screenshots.length).toBe(1);
  // No workspace named: the brain picks the member's own create home.
  expect(api.screenshots[0]).toMatchObject({ role: 'member', ws: null });
  await expect(page.getByText(`Saved to Files in ${WORKSPACES.own.name}.`)).toBeVisible();
});

test('a browser captures by redrawing the page, with no screen-share prompt', async ({ page }) => {
  // No desktop shell, and a getDisplayMedia that only records a call.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.mantleDesktop;
    w.__shareAsked = false;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        w.__shareAsked = true;
        throw new DOMException('no', 'NotAllowedError');
      };
    }
  });
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await dragArea(page);

  const preview = page.getByRole('dialog', { name: 'Screenshot' });
  const img = preview.getByRole('img', { name: 'The captured area' });
  await expect(img).toBeVisible();
  // The PNG is the dragged area at the device scale.
  const size = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return { w: el.naturalWidth, h: el.naturalHeight, dpr: window.devicePixelRatio };
  });
  expect(size).toEqual({
    w: Math.round(220 * size.dpr),
    h: Math.round(150 * size.dpr),
    dpr: size.dpr,
  });
  expect(
    await page.evaluate(() => (window as unknown as { __shareAsked: boolean }).__shareAsked),
  ).toBe(false);
  await preview.getByRole('button', { name: 'Save only' }).click();
  await expect.poll(() => api.screenshots.length).toBe(1);
  expect(api.screenshots[0]!.meta).toMatchObject({
    shell: 'web',
    rect: { x: 200, y: 150, w: 220, h: 150 },
  });
});
