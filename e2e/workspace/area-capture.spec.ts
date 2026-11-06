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
 * stubbed (the browser's tab share asks the user, which a spec cannot
 * answer), so this drives the layer, the preview and the save, and the
 * brain's answer says where the file landed.
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

test('an Admin user captures an area and attaches it to the chat', async ({ page }) => {
  await signIn(page, 'admin');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await dragArea(page);

  const preview = page.getByRole('dialog', { name: 'Screenshot' });
  await expect(preview.getByRole('img', { name: 'The captured area' })).toBeVisible();
  // The brain keeps it private to this login, an Admin user's too.
  await expect(preview.getByText('Once saved, only you can see it.')).toBeVisible();
  // Nothing is saved before a choice.
  expect(api.screenshots).toHaveLength(0);
  await preview.getByRole('textbox', { name: 'Note' }).fill('the list is cut off');
  await preview.getByRole('button', { name: 'Attach to chat' }).click();

  await expect.poll(() => api.screenshots.length).toBe(1);
  const shot = api.screenshots[0]!;
  expect(shot.role).toBe('admin');
  // Never the switcher's workspace: the brain picks the private home.
  expect(shot.ws).toBeNull();
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
    page.getByText(
      `Screenshot saved in ${WORKSPACES.admin.name} and attached to the chat. Only you can see it.`,
    ),
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

test('a member saves a screenshot to its private workspace, with no attach', async ({ page }) => {
  await signIn(page, 'member');
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  await dragArea(page);

  const preview = page.getByRole('dialog', { name: 'Screenshot' });
  // A workspace chat takes text only, so there is nothing to attach to.
  await expect(preview.getByRole('button', { name: 'Attach to chat' })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => api.screenshots.length).toBe(1);
  expect(api.screenshots[0]).toMatchObject({ role: 'member', ws: null });
  await expect(
    page.getByText(`Screenshot saved in ${WORKSPACES.own.name}. Only you can see it.`),
  ).toBeVisible();
});
