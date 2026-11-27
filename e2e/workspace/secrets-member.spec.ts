import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { MOCK_SECRET_NOTE, MOCK_SECRET_VALUE, SECRETS } from './mock-secrets';
import { wholeNav } from './shell-nav';

/**
 * Secrets for a member (Secrets sharing, part S3). A secret is shared like a
 * page: a member opens the ones its workspaces read, reveals a value with
 * one click, edits only where the grant has Write on, and shares or deletes
 * only what it manages. The screen shows what the brain says (the shell's
 * tree kinds and each row's caps); it adds no rule. Runs against the
 * in-memory brain (mock-secrets.ts): the member moderates Team, reads Field
 * crew and is not in Board room.
 */
let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const detail = (page: Page) => page.locator('[data-testid="detail"]');
const header = (page: Page) => detail(page).getByTestId('item-header');
const slot = (page: Page, name: string) => header(page).locator(`[data-slot="${name}"]`);

/** Open /secrets and one secret from its tree. */
async function openSecret(page: Page, title: string) {
  await page.goto('/secrets');
  await page.getByRole('treeitem', { name: title }).first().click();
  await expect(header(page).getByRole('heading', { level: 2 })).toContainText(title);
}

test('a member sees Secrets in the rail and only the secrets its workspaces read', async ({
  page,
}) => {
  await signIn(page, 'member');
  const nav = await wholeNav(page);
  await nav.getByRole('link', { name: 'Secrets', exact: true }).click();
  await expect(page).toHaveURL(/\/secrets$/);
  await expect(page.getByRole('treeitem', { name: SECRETS.team.title })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: SECRETS.field.title })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: SECRETS.board.title })).toHaveCount(0);
  // Nothing open yet: the empty pane, not a form.
  await expect(detail(page)).toContainText('Select a secret, or add a new one.');
});

test('one click reveals a shared secret; the value stays in a data-secret box', async ({
  page,
}) => {
  await signIn(page, 'member');
  await openSecret(page, SECRETS.field.title);
  await expect(detail(page)).toContainText('sealed');
  await expect(page.getByText(MOCK_SECRET_VALUE)).toHaveCount(0);

  await detail(page).getByRole('button', { name: 'Reveal' }).click();
  const value = detail(page).getByText(MOCK_SECRET_VALUE, { exact: true });
  await expect(value).toBeVisible();
  // Every revealed value, the note too, sits inside a data-secret box: an
  // agent's look paints those over.
  expect(await value.evaluate((el) => !!el.closest('[data-secret]'))).toBe(true);
  const note = detail(page).getByText(MOCK_SECRET_NOTE, { exact: true });
  expect(await note.evaluate((el) => !!el.closest('[data-secret]'))).toBe(true);
  // One reveal reached the brain, for this secret, by this login.
  expect(api.secrets.reveals).toEqual([{ role: 'member', id: SECRETS.field.id }]);
  // The value is in no address and no storage of the page.
  expect(page.url()).not.toContain(MOCK_SECRET_VALUE);
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain(MOCK_SECRET_VALUE);

  // While an agent's look takes its picture (the mark on <html>), the page
  // does not paint the revealed value or the note at all; the layout stays.
  const boxBefore = await value.boundingBox();
  await page.evaluate(() => document.documentElement.setAttribute('data-agent-look', ''));
  await expect(value).toBeHidden();
  await expect(note).toBeHidden();
  expect(await value.boundingBox()).toEqual(boxBefore);
  await page.evaluate(() => document.documentElement.removeAttribute('data-agent-look'));
  await expect(value).toBeVisible();

  await detail(page).getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText(MOCK_SECRET_VALUE)).toHaveCount(0);
});

test('Write off: a member reads and reveals, with no Edit, Delete or Access to change', async ({
  page,
}) => {
  await signIn(page, 'member');
  await openSecret(page, SECRETS.field.title);
  // The fixed slots stay in place, greyed.
  await expect(slot(page, 'edit').getByRole('button')).toBeDisabled();
  await expect(slot(page, 'delete').getByRole('button')).toBeDisabled();
  // Access shows who reads it, and is not a button.
  await expect(slot(page, 'access').getByRole('button')).toHaveCount(0);
  await expect(slot(page, 'access').getByTitle(/shared with Field crew/)).toBeVisible();
  // Reveal still works.
  await detail(page).getByRole('button', { name: 'Reveal' }).click();
  await expect(detail(page).getByText(MOCK_SECRET_VALUE, { exact: true })).toBeVisible();
  expect(api.secrets.patches).toEqual([]);
});

test('Write on: the same member edits the secret', async ({ page }) => {
  api.secrets.fieldWrite = true;
  await signIn(page, 'member');
  await openSecret(page, SECRETS.field.title);
  const edit = slot(page, 'edit').getByRole('button');
  await expect(edit).toBeEnabled();
  // Write gives edit, not manage: Delete and Access stay closed.
  await expect(slot(page, 'delete').getByRole('button')).toBeDisabled();
  await expect(slot(page, 'access').getByRole('button')).toHaveCount(0);

  await edit.click();
  const title = detail(page).getByLabel('Title');
  await expect(title).toHaveValue(SECRETS.field.title);
  await title.fill('Field gate code 2');
  await detail(page).getByRole('button', { name: 'Save secret' }).click();
  await expect(header(page).getByRole('heading', { level: 2 })).toContainText('Field gate code 2');
  expect(api.secrets.patches).toEqual([{ role: 'member', id: SECRETS.field.id, status: 200 }]);
  // The caps stay as they were after the save: still no Delete.
  await expect(slot(page, 'delete').getByRole('button')).toBeDisabled();
});

test('a Moderator of the home shares it: the Access panel of a page, on a secret', async ({
  page,
}) => {
  await signIn(page, 'member');
  await openSecret(page, SECRETS.team.title);
  await expect(slot(page, 'delete').getByRole('button')).toBeEnabled();
  await slot(page, 'access').getByRole('button').click();
  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('Team');
  await expect(panel).toContainText('can reveal its value');
  // A secret never has a public link.
  await expect(panel.getByText(/public link/i)).toHaveCount(0);
});

test('a secret of a workspace the member is not in is not there', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto(`/secrets/${SECRETS.board.id}`);
  await expect(page.getByRole('main')).toContainText(
    'This secret is not there, or it is no longer shared with you.',
  );
  await expect(page.getByText(SECRETS.board.title)).toHaveCount(0);
  expect(api.secrets.reveals).toEqual([]);
});

test('a brain before shared secrets: no Secrets row for a member, and a plain refusal', async ({
  page,
}) => {
  api.secretsKind = false;
  await signIn(page, 'member');
  const nav = await wholeNav(page);
  await expect(nav.getByRole('link', { name: 'Secrets', exact: true })).toHaveCount(0);
  await page.goto('/secrets');
  await expect(page.getByRole('main')).toContainText(
    'You have no access to secrets on this brain.',
  );
});

test('phone width: the header, the reveal and the fields fit, with no sideways scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'member');
  await page.goto(`/secrets/${SECRETS.field.id}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2 })).toContainText(SECRETS.field.title);
  await main.getByRole('button', { name: 'Reveal' }).click();
  await expect(main.getByText(MOCK_SECRET_VALUE, { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await test.info().attach('phone', { body: await page.screenshot(), contentType: 'image/png' });
});

test("a person's area screenshot paints over a revealed value", async ({ page }) => {
  await signIn(page, 'member');
  await openSecret(page, SECRETS.field.title);
  await detail(page).getByRole('button', { name: 'Reveal' }).click();
  const value = detail(page).getByText(MOCK_SECRET_VALUE, { exact: true });
  await expect(value).toBeVisible();
  const box = (await value.boundingBox())!;
  // Note whether the page stopped painting its secret boxes at any moment.
  await page.evaluate(() => {
    const w = window as unknown as { lookMarked: boolean };
    w.lookMarked = false;
    new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-agent-look')) w.lookMarked = true;
    }).observe(document.documentElement, { attributes: true });
  });

  // An area around the value, 40 px wider on each side.
  await page.getByRole('button', { name: 'Capture an area for the assistant' }).click();
  const layer = page.getByRole('dialog', { name: 'Capture an area' });
  await expect(layer).toBeVisible();
  const a = { x: box.x - 40, y: box.y - 40 };
  const b = { x: box.x + box.width + 40, y: box.y + box.height + 40 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect(layer).toBeHidden();

  // The picture: the middle of the value's box is the paint-over grey.
  const img = page
    .getByRole('dialog', { name: 'Screenshot' })
    .getByRole('img', { name: 'The captured area' });
  await expect(img).toBeVisible();
  const rgb = await img.evaluate(
    async (el, at) => {
      const picture = el as HTMLImageElement;
      await picture.decode();
      const c = document.createElement('canvas');
      c.width = picture.naturalWidth;
      c.height = picture.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(picture, 0, 0);
      const k = picture.naturalWidth / at.w;
      const d = ctx.getImageData(Math.round(at.cx * k), Math.round(at.cy * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    { w: b.x - a.x, cx: box.x - a.x + box.width / 2, cy: box.y - a.y + box.height / 2 },
  );
  expect(rgb).toEqual([128, 128, 128]);
  expect(await page.evaluate(() => (window as unknown as { lookMarked: boolean }).lookMarked)).toBe(
    true,
  );
  // The mark is off again and the person still sees the value.
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-agent-look'))).toBe(
    false,
  );
  await expect(value).toBeVisible();
});
