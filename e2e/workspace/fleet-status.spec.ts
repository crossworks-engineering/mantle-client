import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet, type MockFleet } from './mock-fleet';
import { newMockStatus, statusAnswer } from './mock-status';
import { CC_SCOPE, scopedNav } from './shell-nav';

/**
 * Control Center > Fleet status: the Status screen of each box. Three parts:
 * the boxes (this box first), the status sections, the chosen section's
 * cards. A linked box is read with its own box_status over the admin
 * channel (POST /api/fleet/tool), one call per box; this box with GET
 * /api/box-status. Three made-up boxes: Box A answers, box B refuses (its
 * scope is none), Box C is late. In-memory brain (mock-fleet.ts).
 *
 * E2E_SHOTS=<dir> also saves screenshots there.
 */

const BOX_C = {
  ...FLEET_BOX,
  id: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3',
  url: 'https://box-c.example.invalid',
  label: 'Box C',
};

function withFleetStatus(f: MockFleet): MockFleet {
  f.toolOn = true;
  f.boxes.push({ ...BOX_C });
  const own = statusAnswer('/api/box-status', newMockStatus()) as { box: Record<string, unknown> };
  f.boxStatus[FLEET_BOX.id] = {
    ...own.box,
    build: { version: '0.602.0', gitSha: 'abcdef1', buildTime: null },
  };
  f.toolRefused[FLEET_BOX_B.id] = 'scope';
  f.toolDelay[BOX_C.id] = 99;
  return f;
}

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
  api.fleet = withFleetStatus(newMockFleet());
});
test.afterEach(async () => {
  await api.close();
});
test.use({ viewport: { width: 1440, height: 900 } });

const STATUS = '/admin/fleet/status';
const SHOTS = process.env.E2E_SHOTS || '';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const boxes = (page: Page) => page.getByRole('main').getByRole('list', { name: 'Boxes' });
const box = (page: Page, name: string) =>
  boxes(page).getByRole('listitem').filter({ hasText: name });
const sections = (page: Page) =>
  page.getByRole('main').getByRole('navigation', { name: 'Status sections' });
const reads = () => api.fleet!.toolSent.filter((b) => b.name === 'box_status');

test('the nav opens Fleet status: every box with its version and mark', async ({ page }) => {
  await signIn(page, 'admin');
  const nav = await scopedNav(page, CC_SCOPE);
  await nav.getByRole('link', { name: 'Fleet status', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${STATUS}$`));

  await expect(boxes(page).getByRole('listitem')).toHaveCount(4);
  await expect(boxes(page).getByRole('listitem').first()).toContainText('This box');
  await expect(box(page, 'This box')).toContainText('v0.500.19');
  await expect(box(page, 'Box A')).toContainText('v0.602.0 · All normal');
  await expect(box(page, 'box-b.example.invalid')).toContainText('Refuses calls');
  await expect(box(page, 'Box C')).toContainText('Late');

  // One call per linked box, in parallel, each with its own box id (next
  // dev mounts twice, so each box may be read twice here).
  await expect.poll(() => new Set(reads().flatMap((b) => b.boxIds as string[])).size).toBe(3);
  for (const b of reads()) {
    expect(b.boxIds).toHaveLength(1);
    expect(b.args).toEqual({});
  }
  // The sections are the Status screen's own, in its order.
  await expect(sections(page).getByRole('listitem')).toHaveText([
    /Overview/,
    /Compute/,
    /Brain/,
    /Spend/,
    /Queues and workers/,
    /Sidecars/,
    /Providers/,
    /Version and updates/,
  ]);
});

test('pick a box and a section: its cards, and the address keeps both', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(STATUS);
  await box(page, 'Box A').getByRole('button').first().click();
  await expect(page).toHaveURL(new RegExp(`box=${FLEET_BOX.id}`));
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'All systems normal' })).toBeVisible();
  await expect(main.getByText('Spend today')).toBeVisible();
  await shot(page, 'fleet-status-healthy-overview');

  await sections(page)
    .getByRole('button', { name: /Compute/ })
    .click();
  await expect(page).toHaveURL(/section=compute/);
  await expect(main.getByText('Cache hit')).toBeVisible();
  await expect(main.getByText('Brain process', { exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'All systems normal' })).toHaveCount(0);
  await shot(page, 'fleet-status-healthy-compute');

  // A link opens the same view; the board shows no links to this box's own pages.
  await page.reload();
  await expect(main.getByText('Cache hit')).toBeVisible();
  await sections(page).getByRole('button', { name: /Spend/ }).click();
  await expect(main.getByText('Last 30 days')).toBeVisible();
  await expect(main.getByText(/Spend by day: not in the box status/)).toBeVisible();
  await expect(main.getByRole('link', { name: 'By model and agent' })).toHaveCount(0);
});

test('a box that refuses says so; a late box says it; Refresh reads again', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(`${STATUS}?box=${FLEET_BOX_B.id}`);
  const main = page.getByRole('main');
  await expect(main.getByText('No status from this box')).toBeVisible();
  await expect(main.getByText(/MANTLE_CONTROL_CENTER_SCOPE=none/)).toBeVisible();
  await shot(page, 'fleet-status-refused');

  await box(page, 'Box C').getByRole('button').first().click();
  await expect(main.getByText('The box did not answer in time.')).toBeVisible();

  // Box C answers now: Refresh reads that box only.
  api.fleet!.toolDelay[BOX_C.id] = 0;
  api.fleet!.boxStatus[BOX_C.id] = api.fleet!.boxStatus[FLEET_BOX.id];
  const before = reads().length;
  await main.getByRole('button', { name: 'Refresh Box C' }).click();
  await expect(box(page, 'Box C')).toContainText('All normal');
  await expect(main.getByRole('heading', { name: 'All systems normal' })).toBeVisible();
  expect(reads().slice(before)).toEqual([{ boxIds: [BOX_C.id], name: 'box_status', args: {} }]);
});

test('an older box with fewer fields shows dashes, never a crash', async ({ page }) => {
  api.fleet!.boxStatus[FLEET_BOX.id] = { schema: 1, build: { version: '0.500.1' } };
  await signIn(page, 'admin');
  await page.goto(`${STATUS}?box=${FLEET_BOX.id}&section=compute`);
  const main = page.getByRole('main');
  await expect(box(page, 'Box A')).toContainText('v0.500.1');
  await expect(main.getByText('Cache hit')).toBeVisible();
  await expect(main.getByText('n/a').first()).toBeVisible();
});

test('at phone width the parts stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin');
  await page.goto(`${STATUS}?box=${FLEET_BOX.id}`);
  const list = await boxes(page).boundingBox();
  const nav = await sections(page).boundingBox();
  expect(list && nav && nav.y > list.y).toBe(true);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
