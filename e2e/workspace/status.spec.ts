import { expect, test } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';

/**
 * Status, the box's health screen (it replaced the full-screen Dashboard):
 * the standard master-detail layout with a drag handle, every sidecar of
 * the compose file with a link to its switch on Services (or "Always on"),
 * the brain's processes as docker reports them, and the old /dashboard
 * address landing here. In-memory brain (mock-status.ts), no real one.
 */

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

test('the board sits in the resizable content area, with every sidecar', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/status');
  const main = page.getByRole('main');
  // The scaffold's divider: the same handle every list screen has.
  await expect(main.locator('[data-slot="resizable-handle"]').first()).toBeVisible();
  await expect(main.getByRole('navigation', { name: 'Status sections' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'All systems normal' })).toBeVisible();

  const sidecars = main.locator('#status-sidecars');
  for (const name of [
    'Documents',
    'Local embedder',
    'Sandboxes',
    'Calls',
    'Browser',
    'Database',
    'Object store',
    'Parser',
    'Tailnet',
    'Front door',
    'Updater',
    'Autoheal',
  ]) {
    await expect(sidecars.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(sidecars.getByText('Gotenberg', { exact: true })).toBeVisible();
  // A switchable one links to its own card on Services; an off one says so.
  await expect(sidecars.getByRole('link', { name: 'Switch on' }).first()).toHaveAttribute(
    'href',
    /\/settings\/services#service-(local-embedder|calls)$/,
  );
  // The full box: the browser has no switch here (only a core box's does),
  // so eight run always.
  await expect(sidecars.locator('li').filter({ hasText: 'Always on' })).toHaveCount(8);

  // The link lands on that service's card on Services.
  await sidecars
    .locator('li', { has: page.getByText('Documents', { exact: true }) })
    .getByRole('link', { name: 'Switch' })
    .click();
  await expect(page).toHaveURL(
    (u) => u.pathname === '/settings/services' && u.hash === '#service-documents',
  );
  await expect(page.locator('#service-documents')).toBeInViewport();
});

test('a worker docker calls unhealthy is a problem, named on the board and the list', async ({
  page,
}) => {
  api.status.containers.worker_email = {
    container: 'running',
    health: 'unhealthy',
    restarts: 2,
    startedAt: '2026-11-04T06:00:00Z',
  };
  await signIn(page, 'admin');
  await page.goto('/status');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: '1 problem' })).toBeVisible();
  await main.getByRole('button', { name: /The Email process is unhealthy/ }).click();
  await expect(main.locator('#status-queues')).toBeInViewport();
  await expect(main.locator('#status-queues').getByText('2 restarts')).toBeVisible();
  const queuesCard = main
    .getByRole('navigation', { name: 'Status sections' })
    .getByRole('button', { name: /Queues and workers/ });
  await expect(queuesCard).toHaveAttribute('data-accent', 'warning');
});

test('the old Dashboard address opens Status', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/dashboard');
  await expect(page).toHaveURL((u) => u.pathname === '/status');
});
