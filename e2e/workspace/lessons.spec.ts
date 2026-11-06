import { expect, test, type Page } from '@playwright/test';
import {
  LESSONS,
  signIn,
  startMockWorkspaceApi,
  type MockWorkspaceApi,
} from './mock-workspace-api';

/**
 * Lessons (components/lessons, plan page 596dbe4d phase 2): a lesson page
 * in the Lessons folder plays in the user's own window with the agent's
 * hands. A link only offers one, a page outside the folder is refused, and
 * a step that changes a setting stays the user's to do.
 * In-memory brain, no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.lessons = true;
});
test.afterEach(async () => {
  await api.close();
});

const card = (page: Page) => page.getByRole('region', { name: `Lesson: ${LESSONS.lesson.title}` });

test('an Admin user plays a lesson from the profile menu', async ({ page }) => {
  await signIn(page, 'admin');
  await page
    .getByRole('button', { name: /Ada Admin/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Lessons' }).click();
  await page.getByRole('button', { name: LESSONS.lesson.title }).click();

  await expect(card(page)).toContainText('step 1 of 3');
  await expect(page.getByText(`${LESSONS.lesson.title} is using this window.`)).toBeVisible();
  await card(page).getByRole('button', { name: 'Show me' }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await card(page).getByRole('button', { name: 'Next' }).click();

  // Step 2 points at the switch, then its click waits for the user.
  await expect(card(page)).toContainText('step 2 of 3');
  await expect(page.getByRole('note')).toHaveText('Sounds turns the app sounds on or off.');
  await card(page).getByRole('button', { name: 'Show me' }).click();
  const held = page.getByRole('alertdialog', { name: /wants to change a setting/ });
  await held.getByRole('button', { name: 'Not now' }).click();
  // Blocked, the step is the user's; its check already holds, so it passes.
  await expect(card(page)).toContainText('That is it.');
  expect(api.asked('admin')).not.toContain('PUT /api/profile/sounds');
  await card(page).getByRole('button', { name: 'Next' }).click();

  await card(page).getByRole('button', { name: 'Show me' }).click();
  await expect(page).toHaveURL(/\/$/);
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(`${LESSONS.lesson.title} is using this window.`)).toHaveCount(0);
});

test('a link only offers a lesson, and a page outside the folder is refused', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto(`/?lesson=${LESSONS.stray.id}`);
  const offer = page.getByRole('dialog', { name: 'Start this lesson?' });
  await expect(offer).toBeVisible();
  // Nothing plays before Start.
  await expect(page.getByText('is using this window.')).toHaveCount(0);
  await offer.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('dialog', { name: 'This lesson cannot be played' })).toContainText(
    'not in the Lessons folder',
  );
  await expect(card(page)).toHaveCount(0);
});

test('a member plays a lesson it cannot change, and Stop ends it', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto(`/?lesson=${LESSONS.lesson.id}`);
  await page
    .getByRole('dialog', { name: 'Start this lesson?' })
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(card(page)).toContainText('step 1 of 3');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(card(page)).toHaveCount(0);
});

test('a lesson tags its writes; one the brain refuses is held, and Allow sends it untagged', async ({
  page,
}) => {
  api.refuseAgentWrites = /^\/api\/notes$/;
  await signIn(page, 'admin');
  await page.goto(`/?lesson=${LESSONS.note.id}`);
  await page
    .getByRole('dialog', { name: 'Start this lesson?' })
    .getByRole('button', { name: 'Start' })
    .click();
  const noteCard = page.getByRole('region', { name: `Lesson: ${LESSONS.note.title}` });
  await noteCard.getByRole('button', { name: 'Show me' }).click();
  const held = page.getByRole('alertdialog', {
    name: `${LESSONS.note.title} wants to do something only you may do`,
  });
  await expect(held.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  await held.getByRole('button', { name: 'Allow once' }).click();
  await expect(noteCard.getByRole('button', { name: 'Done' })).toBeVisible();
  const posts = api.requests.filter((r) => r.method === 'POST' && r.path === '/api/notes');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.agentCall).toMatch(/^lesson:[0-9a-f-]{36}$/);
  expect(posts[1]!.agentCall).toBeUndefined();
});

test('a Lessons folder that is not the Admin workspace’s offers nothing, to anyone', async ({
  page,
}) => {
  api.lessonsHome = 'team';
  await signIn(page, 'admin');
  await page
    .getByRole('button', { name: /Ada Admin/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Lessons' }).click();
  await expect(page.getByRole('dialog', { name: 'Lessons' })).toContainText('No lessons yet.');
  await page.keyboard.press('Escape');

  await page.goto(`/?lesson=${LESSONS.lesson.id}`);
  await page
    .getByRole('dialog', { name: 'Start this lesson?' })
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(page.getByRole('dialog', { name: 'This lesson cannot be played' })).toContainText(
    'not in the Lessons folder of the Admin workspace',
  );
  await expect(card(page)).toHaveCount(0);
});

test('a brain before homeIsAdmin offers a member nothing', async ({ page }) => {
  api.sendsHomeIsAdmin = false;
  await signIn(page, 'member');
  await page
    .getByRole('button', { name: /Mo Member/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Lessons' }).click();
  await expect(page.getByRole('dialog', { name: 'Lessons' })).toContainText('No lessons yet.');
});

test('a brain before homeIsAdmin: an Admin user still plays by the home it names', async ({
  page,
}) => {
  api.sendsHomeIsAdmin = false;
  await signIn(page, 'admin');
  await page.goto(`/?lesson=${LESSONS.lesson.id}`);
  await page
    .getByRole('dialog', { name: 'Start this lesson?' })
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(card(page)).toContainText('step 1 of 3');
});
