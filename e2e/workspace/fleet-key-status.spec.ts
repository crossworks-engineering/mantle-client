import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn, startMockWorkspaceApi, type MockWorkspaceApi } from './mock-workspace-api';
import { FLEET_BOX, FLEET_BOX_B, newMockFleet } from './mock-fleet';
import {
  keyBox,
  keyLine,
  keyStatusState,
  minAgo,
  PRINT_NEW,
  PRINT_OLD,
  withKeyStatus,
} from './mock-fleet-keys';

/**
 * Key status on the fleet (docs/control-center.md in the mantle repo, "Key
 * status on the fleet"): per box, the CC's own first, which provider keys it
 * holds, when each was set, whether its last test passed, and the key's
 * print (fixed-width, kept from agents). Test now for one box or all. In-
 * memory brain (mock-fleet.ts, mock-fleet-keys.ts).
 */

const SHOTS = process.env.CC_KEY_STATUS_SHOTS;

let api: MockWorkspaceApi;
test.beforeEach(async ({ baseURL }) => {
  api = await startMockWorkspaceApi(new URL(baseURL!).origin);
});
test.afterEach(async () => {
  await api.close();
});

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function open(page: Page, { ready = true } = {}) {
  await signIn(page, 'admin');
  await page.goto('/admin/fleet/key-status');
  const main = page.getByRole('main');
  if (ready) await expect(main.getByRole('list', { name: 'Boxes' })).toBeVisible();
  return main;
}

const cards = (main: Locator) => main.getByRole('list', { name: 'Boxes' }).getByRole('listitem');
/** A box's card, by its id (`self` for this box). */
const card = (main: Locator, id: string) => main.locator(`button[data-box="${id}"]`);
const row = (table: Locator, box: string, service: string) =>
  table.locator(`tr[data-box="${box}"][data-service="${service}"]`);

type Entry = { id?: string; role: string; name: string };

/** The agent's own screen read (lib/agent-ui), as agent-hands.spec.ts
 *  drives it. */
async function agentRead(page: Page): Promise<{ text: string; entries: Entry[] }> {
  await page.waitForFunction(() => '__mantleAgentHands' in window);
  return page.evaluate(async () => {
    const h = (window as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)
      .__mantleAgentHands!;
    await h.begin!('Lesson');
    const read = (await h.screen!()) as { screen: { entries: Entry[] } };
    h.end?.();
    return { text: JSON.stringify(read), entries: read.screen.entries };
  });
}

/** The roles the agent's screen read names by their text (lib/agent-ui/dom.ts,
 *  ROLES_WITH_NAME): no ancestor of a print may carry one, or its name
 *  would hold the print. */
const NAMED_ROLES = [
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'treeitem',
  'slider',
  'spinbutton',
  'row',
  'gridcell',
  'dialog',
  'alertdialog',
  'navigation',
  'frame',
];

test('the own box first, the five states side by side, the print fixed-width and kept from agents', async ({
  page,
}) => {
  api.fleet = withKeyStatus(newMockFleet());
  const main = await open(page);

  // The CC's own box first, then the linked boxes in the brain's order.
  await expect(cards(main)).toHaveCount(3);
  await expect(cards(main).nth(0)).toContainText('This box');
  await expect(cards(main).nth(0)).toContainText('2 keys, 1 to test');
  await expect(cards(main).nth(1)).toContainText('Box A');
  await expect(cards(main).nth(1)).toContainText('3 keys, 1 failed');
  await expect(cards(main).nth(1)).toContainText('The last read failed.');
  await expect(cards(main).nth(2)).toContainText('box-b.example.invalid');
  await expect(cards(main).nth(2)).toContainText('Update this box to see its keys.');

  const table = main.getByRole('table', { name: 'Key status' });
  // Each box opens with a row of its own, this box first.
  const heads = table.locator('tr[data-box-head]');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(0)).toContainText('This box');
  await expect(heads.nth(1)).toContainText('Box A');
  await expect(heads.nth(1)).toContainText('the last read failed');

  // The five states, in plain words.
  await expect(row(table, 'self', 'openrouter')).toContainText('Works');
  await expect(row(table, 'self', 'openrouter')).toContainText('passed 5 min ago');
  await expect(
    row(table, 'self', 'openrouter').getByTitle('Works, tested 5 min ago'),
  ).toBeVisible();
  await expect(row(table, 'self', 'anthropic')).toContainText('Set again since its last test');
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('Failed');
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('failed 20 min ago');
  await expect(row(table, FLEET_BOX.id, 'elevenlabs')).toContainText('Never tested');
  await expect(row(table, FLEET_BOX.id, 'firecrawl')).toContainText('This service has no test');
  await expect(table.locator(`tr[data-box="${FLEET_BOX_B.id}"]`)).toContainText(
    'Update this box to see its keys.',
  );

  // Set as an age, the exact time on hover; another key than the one set
  // last is marked in neutral words, with where the last one is.
  await expect(row(table, 'self', 'openrouter').locator('time')).toHaveText('1 h ago');
  await expect(row(table, 'self', 'openrouter').locator('time')).toHaveAttribute('title', /\d/);
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('9 days ago');
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('different key');
  await expect(
    row(table, FLEET_BOX.id, 'openrouter').getByTitle(
      'Not the key set last (on This box, 1 h ago)',
    ),
  ).toBeVisible();
  await expect(row(table, 'self', 'openrouter')).not.toContainText('different key');
  // A print missing on one side cannot be compared: no mark.
  await expect(row(table, FLEET_BOX.id, 'elevenlabs')).not.toContainText('different key');
  await expect(main.getByText(/marked different key/)).toBeVisible();

  // The print: fixed-width, the plain words when there is none.
  const prints = table.getByTestId('key-print');
  await expect(row(table, 'self', 'openrouter').getByTestId('key-print')).toHaveText(PRINT_NEW);
  await expect(row(table, FLEET_BOX.id, 'openrouter').getByTestId('key-print')).toHaveText(
    PRINT_OLD,
  );
  await expect(row(table, FLEET_BOX.id, 'elevenlabs')).toContainText('not shown');
  await expect(row(table, FLEET_BOX.id, 'elevenlabs').getByTestId('key-print')).toHaveCount(0);
  const n = await prints.count();
  expect(n).toBe(4);
  for (let i = 0; i < n; i++) {
    const p = prints.nth(i);
    // data-secret: the agent's screen read names it (hidden), its picture
    // paints it over (lib/agent-ui).
    await expect(p).toHaveAttribute('data-secret', '');
    const font = await p.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toMatch(/mono/i);
    const named = await p.evaluate((el, roles) => {
      const out: string[] = [];
      for (let a = el.parentElement; a; a = a.parentElement) {
        const role = a.getAttribute('role')?.split(' ')[0];
        if (role && roles.includes(role)) out.push(role);
      }
      return out;
    }, NAMED_ROLES);
    expect(named).toEqual([]);
  }
  // No control on the screen names a print (a button, a card, a link).
  for (const role of ['button', 'link'] as const) {
    for (const text of await main.getByRole(role).allInnerTexts()) {
      expect(text).not.toContain('…wxyz');
      expect(text).not.toContain('…qrst');
    }
  }
  // The agent's own screen read holds no print, not even its tail. The work
  // area holds prints, so it is named by its id, never its text; the cards
  // hold none and keep their names.
  const { text: read, entries } = await agentRead(page);
  expect(read).toContain('"ok":true');
  expect(read).toContain('"name":"Test all"');
  for (const tail of ['wxyz', 'qrst', 'mnop', '9876', 'sk-or-v1', 'sk-ant', 'fc-1234']) {
    expect(read).not.toContain(tail);
  }
  expect(entries.find((e) => e.id === 'main')?.name).toBe('main');
  expect(entries.some((e) => e.role === 'button' && e.name.startsWith('Box A 3 keys'))).toBe(true);
  await shot(page, 'key-status-all-light');
});

test('Test now on one box: busy, then its answer and fresh lines', async ({ page }) => {
  api.fleet = withKeyStatus(newMockFleet());
  const main = await open(page);
  await card(main, FLEET_BOX.id).click();
  await expect(page).toHaveURL(/box=f1f1f1f1/);
  // The last read failed: why, with the old lines kept below.
  await expect(main.getByText('The last read failed', { exact: true })).toBeVisible();
  await expect(
    main.getByText(
      'Could not reach the box over HTTPS. The lines below are from the read before, 45 min ago.',
    ),
  ).toBeVisible();
  const table = main.getByRole('table', { name: 'Keys on Box A' });
  await expect(table.locator('tr[data-service="elevenlabs"]')).toContainText('Never tested');
  await expect(main.getByText(/Last key set here/)).toBeVisible();
  await shot(page, 'key-status-box-light');

  // Hold the answer a moment, to see the busy state.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/fleet/keys/test', async (route) => {
    await held;
    await route.continue();
  });
  // The busy line is on the page, empty, before the test: a screen reader
  // hears its text come.
  const busyLine = main.getByTestId('busy-line');
  await expect(busyLine).toHaveCount(1);
  await expect(busyLine).toHaveText('');
  expect(await busyLine.evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
  await main.getByRole('button', { name: 'Test now' }).click();
  await expect(main.getByRole('button', { name: /Testing/ }).first()).toBeDisabled();
  await expect(busyLine).toHaveText(/can take up to 25 seconds/);
  await expect(main.getByText(/can take up to 25 seconds/)).toBeVisible();
  release();
  await expect(main.getByText('Tested just now.').first()).toBeVisible();
  expect(keyStatusState(api.fleet!).sent).toEqual([{ boxIds: [FLEET_BOX.id] }]);
  await expect(table.locator('tr[data-service="elevenlabs"]')).toContainText('passed just now');
  await expect(card(main, FLEET_BOX.id)).toContainText('Tested just now.');
  // A failed key stays failed: a failed test changes nothing.
  await expect(table.locator('tr[data-service="openrouter"]')).toContainText('Failed');
});

test('Test all: each box answers in plain words; pending reads again later', async ({ page }) => {
  api.fleet = withKeyStatus(newMockFleet());
  const s = keyStatusState(api.fleet);
  s.testAnswers[FLEET_BOX.id] = 'pending';
  s.testAnswers[FLEET_BOX_B.id] = 'bad-call';
  // Box A's run comes after the wait: the next read has its fresh lines.
  s.afterPending[FLEET_BOX.id] = keyBox({
    ...s.boxes[1]!,
    at: minAgo(0),
    reason: null,
    keys: [keyLine({ setAt: minAgo(1), test: { ok: true, at: minAgo(0) } })],
  });
  const main = await open(page);
  // The page's clock from here: the reads again run when the spec says.
  await page.clock.install();
  await main.getByRole('button', { name: 'Test all' }).click();
  await expect(card(main, 'self')).toContainText('Tested just now.');
  await expect(card(main, FLEET_BOX.id)).toContainText('No answer yet. Reading again shortly.');
  await expect(card(main, FLEET_BOX_B.id)).toContainText('update the box');
  expect(s.sent).toEqual([{}]);
  const reads = s.reads;
  // The read again, a little later: Box A's fresh line.
  await page.clock.runFor(8_500);
  const table = main.getByRole('table', { name: 'Key status' });
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('passed just now');
  await expect.poll(() => s.reads).toBe(reads + 1);
  await expect(card(main, FLEET_BOX.id)).toContainText('1 key, all fine');
  // One more read, then the pending mark goes and nothing reads again.
  await page.clock.runFor(12_000);
  await expect.poll(() => s.reads).toBe(reads + 2);
  await expect(card(main, FLEET_BOX.id)).not.toContainText('No answer yet');
  await page.clock.runFor(120_000);
  await page.waitForTimeout(1_000);
  expect(s.reads).toBe(reads + 2);
});

test('every tested code, an unknown one, and a 429', async ({ page }) => {
  api.fleet = withKeyStatus(newMockFleet());
  const s = keyStatusState(api.fleet);
  const codes: Record<string, string> = {
    scope: 'This box refuses the Control Center. Nothing was tested.',
    unreachable: 'Could not reach the box. Nothing was tested.',
    'http-500': 'A test could not run on that box.',
    busy: 'The box is busy: 10 calls already wait. Try again later.',
    'keys-area': "You need the Keys area to test this box's keys.",
    error: 'The test failed on this box.',
    'http-503': 'The box did not finish the test.',
  };
  const main = await open(page);
  for (const [code, text] of Object.entries(codes)) {
    s.testAnswers.self = code;
    await card(main, 'self').click();
    await main.getByRole('button', { name: 'Test now' }).click();
    await expect(card(main, 'self')).toContainText(text);
  }
  // Too many presses: the route answers 429. Test now on this box: beside
  // its result, and in the list.
  const fail = 'Too many tests. Try again in a few minutes.';
  s.limited = true;
  await main.getByRole('button', { name: 'Test now' }).click();
  await expect(main.getByRole('status').filter({ hasText: fail }).first()).toBeVisible();
  await expect(main.getByText(fail)).toHaveCount(2);
  // Another box does not show it.
  await card(main, FLEET_BOX.id).click();
  await expect(main.getByRole('heading', { name: 'Box A', exact: true })).toBeVisible();
  await expect(main.getByText(fail)).toHaveCount(1);
  // Test all: on All boxes, not on a box.
  s.limited = true;
  await main.getByRole('button', { name: 'Test all' }).click();
  await expect(main.getByText(fail)).toHaveCount(1);
  // The list's line is read aloud while a box is open on the right.
  await expect(main.getByRole('status').filter({ hasText: fail })).toHaveCount(1);
  await main.getByRole('button', { name: /All boxes/ }).click();
  await expect(main.getByRole('status').filter({ hasText: fail }).first()).toBeVisible();
  await expect(main.getByText(fail)).toHaveCount(2);
});

test('a box with no lines says why; Test now only where it can help', async ({ page }) => {
  api.fleet = newMockFleet();
  const s = keyStatusState(api.fleet);
  s.on = true;
  const reasons = {
    'old-box': 'Update this box to see its keys.',
    scope: 'This box refuses the Control Center.',
    'no-facts': 'Not read yet.',
    error: 'Key status failed on this box.',
    'bad-reply': 'This box sent key lines the Control Center cannot read.',
  } as const;
  s.boxes = [
    keyBox({ id: 'self', keys: null, keysReason: 'keys-area' }),
    ...Object.keys(reasons).map((r, i) =>
      keyBox({
        id: `a0a0a0a0-0000-4000-8000-0000000000a${i}`,
        url: `https://box-${i}.example.invalid`,
        keys: null,
        keysReason: r as keyof typeof reasons,
      }),
    ),
    keyBox({
      id: 'b0b0b0b0-0000-4000-8000-000000000000',
      url: 'https://box-z.example.invalid',
      keys: [],
    }),
  ];
  const main = await open(page);
  const table = main.getByRole('table', { name: 'Key status' });
  await expect(table.locator('tr[data-box="self"]')).toContainText(
    "You need the Keys area to see this box's keys.",
  );
  for (const [i, text] of Object.values(reasons).entries()) {
    await expect(
      table.locator(`tr[data-box="a0a0a0a0-0000-4000-8000-0000000000a${i}"]`),
    ).toContainText(text);
  }
  await expect(table.locator('tr[data-box^="b0b0"]')).toContainText('Holds no keys.');
  // Test now: not on this box without the Keys area, a box that refuses, or one behind.
  const id = (i: number) => `a0a0a0a0-0000-4000-8000-0000000000a${i}`;
  const no: [string, string][] = [
    ['self', 'This box'],
    [id(0), 'box-0.example.invalid'],
    [id(1), 'box-1.example.invalid'],
  ];
  for (const [box, name] of no) {
    await card(main, box).click();
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Test now' })).toHaveCount(0);
  }
  const yes: [string, string][] = [
    [id(2), 'box-2.example.invalid'],
    [id(3), 'box-3.example.invalid'],
    ['b0b0b0b0-0000-4000-8000-000000000000', 'box-z.example.invalid'],
  ];
  for (const [box, name] of yes) {
    await card(main, box).click();
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Test now' })).toBeVisible();
  }
});

test('off a Control Center, and on one a release behind', async ({ page }) => {
  api.fleet = null;
  const main = await open(page, { ready: false });
  await expect(main.getByText('This box is not a Control Center.')).toBeVisible();
  await expect(main.getByRole('table')).toHaveCount(0);

  api.fleet = newMockFleet();
  await page.reload();
  await expect(
    main.getByText('This brain is a release behind: it does not have the key status yet.'),
  ).toBeVisible();
});

test('after a key set from Provider keys, the key status reads again once the box answers', async ({
  page,
}) => {
  api.fleet = withKeyStatus(newMockFleet());
  api.fleet.keysOn = true;
  const s = keyStatusState(api.fleet);
  await signIn(page, 'admin');
  await page.goto('/admin/fleet/keys');
  const main = page.getByRole('main');
  await main.locator('#fleet-key-value').fill('a-made-up-key');
  await main.getByRole('checkbox', { name: 'Box A' }).click();
  await main.getByRole('button', { name: 'Set key on 1 box' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Set key' }).click();
  await expect.poll(() => api.fleet!.keySent.length).toBe(1);
  // Box A holds its answer until the key status is open and read. A count
  // of reads (`-3`, a few Fleet reads 3 s apart) raced the screen's own
  // Fleet read right after the set: 14 s or 17 s, against the wait below.
  const boxA = api.fleet.keyState[FLEET_BOX.id]!;
  boxA.reads = -1_000;
  // While Box A still waits on the key, open the key status.
  await main.getByRole('link', { name: 'Key status' }).click();
  await expect(main.getByRole('list', { name: 'Boxes' })).toBeVisible();
  const table = main.getByRole('table', { name: 'Key status' });
  await expect(row(table, FLEET_BOX.id, 'elevenlabs')).toContainText('Never tested');
  const reads = s.reads;
  // The box's run: its new lines are what the next read gives.
  s.boxes[1] = keyBox({
    ...s.boxes[1]!,
    reason: null,
    keys: [keyLine({ setAt: minAgo(0), test: { ok: true, at: minAgo(0) } })],
  });
  // Box A answers on the next Fleet read (at most 3 s away); the key status
  // then reads again.
  boxA.reads = 1;
  await expect(row(table, FLEET_BOX.id, 'openrouter')).toContainText('passed just now', {
    timeout: 10_000,
  });
  await expect(row(table, FLEET_BOX.id, 'elevenlabs')).toHaveCount(0);
  expect(s.reads).toBeGreaterThan(reads);
});

test('Provider keys links to the key status, and back', async ({ page }) => {
  api.fleet = withKeyStatus(newMockFleet());
  api.fleet.keysOn = true;
  await signIn(page, 'admin');
  await page.goto('/admin/fleet/keys');
  const main = page.getByRole('main');
  // The key field (a SecretInput) is in the work area: the agent's read
  // names the area by its id; the form's controls keep their names.
  const { entries } = await agentRead(page);
  expect(entries.find((e) => e.id === 'main')?.name).toBe('main');
  expect(entries.some((e) => e.role === 'link' && e.name === 'Key status')).toBe(true);
  expect(entries.some((e) => e.role === 'combobox' && e.name === 'Provider')).toBe(true);
  expect(entries.find((e) => e.role === 'textbox' && e.name === '(hidden)')).toBeDefined();
  await main.getByRole('link', { name: 'Key status' }).click();
  await expect(page).toHaveURL(/\/admin\/fleet\/key-status$/);
  await main.getByRole('link', { name: 'Set a key' }).click();
  await expect(page).toHaveURL(/\/admin\/fleet\/keys$/);
});

test('dark: all boxes and one box', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only');
  await page.emulateMedia({ colorScheme: 'dark' });
  api.fleet = withKeyStatus(newMockFleet());
  const main = await open(page);
  await expect(main.getByRole('table', { name: 'Key status' })).toBeVisible();
  await shot(page, 'key-status-all-dark');
  await card(main, FLEET_BOX.id).click();
  await expect(main.getByRole('table', { name: 'Keys on Box A' })).toBeVisible();
  await shot(page, 'key-status-box-dark');
});
