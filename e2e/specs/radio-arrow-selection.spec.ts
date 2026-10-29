import type { Locator } from '@playwright/test';

import { expect, test } from '../lib/fixtures';

/**
 * Arrow keys must move the SELECTION, not just the focus, in anything wearing
 * `role="radio"`. Native radios do it, the WAI-ARIA radio pattern requires it,
 * and both of the kit's radio-shaped primitives used to get it wrong — for two
 * different upstream reasons (docs/handover-audit-remainder.md §15).
 *
 * `RadioGroup` selects the newly focused item behind an "arrow key is down"
 * flag that a document-level `keyup` clears, while `react-roving-focus` moves
 * the focus from a `setTimeout` ~50–60 ms later. Whoever wins that race decides
 * whether the selection moves. `ToggleGroup type="single"` — which Radix gives
 * `role="radiogroup"` and `aria-checked` items — never attempted it at all.
 *
 * ⚠ This spec is a RELIABLE ratchet rather than a flaky one, and the reason is
 * worth knowing before anyone "stabilises" it. `keyboard.press()` sends `keyup`
 * 0 ms after `keydown`, so it loses that race EVERY time — the bug was 100%
 * reproducible here while a human tapping the key usually squeaked through. Do
 * not add a `keyboard.down`/`waitForTimeout`/`keyboard.up` sequence to make it
 * "more realistic": that would hide exactly the failure this guards.
 */

/**
 * The invariant that costs most to break. A single-select ToggleGroup treats a
 * press on its OWN checked item as a DESELECT, so a fix that re-asserts the
 * selection too eagerly empties the group instead of doing nothing.
 */
async function expectExactlyOneChecked(group: Locator, when: string) {
  await expect(group.locator('[role="radio"][aria-checked="true"]'), when).toHaveCount(1);
}

test.describe('arrow keys move the selection in role=radio groups', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('RadioGroup: ArrowRight/ArrowLeft select, wrapping at both ends', async ({ ownerPage }) => {
    // The appearance screen renders a second, hidden copy of each picker for
    // the narrow layout, so every locator here has to be `:visible`.
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await ownerPage.goto('/settings/appearance');

    const group = ownerPage.locator('[role="radiogroup"][aria-labelledby="mode-heading"]:visible');
    await expect(group).toHaveCount(1);
    const items = group.locator('[role="radio"]');
    await expect(items).toHaveCount(3);

    const values = await items.evaluateAll((els) => els.map((el) => el.getAttribute('value')));
    const originalValue = await group
      .locator('[role="radio"][aria-checked="true"]')
      .getAttribute('value');

    try {
      // A real mouse click is the baseline: it has always worked, and it is
      // what puts focus and the selection on a known item to arrow away from.
      await items.nth(0).click();
      await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');

      await ownerPage.keyboard.press('ArrowRight');
      // Focus moving was never the broken half — assert it anyway, so a failure
      // says WHICH half went, rather than just "not checked".
      await expect(items.nth(1)).toBeFocused();
      await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
      await expect(items.nth(0)).toHaveAttribute('aria-checked', 'false');
      await expectExactlyOneChecked(group, 'after ArrowRight');

      await ownerPage.keyboard.press('ArrowRight');
      await expect(items.nth(2)).toHaveAttribute('aria-checked', 'true');

      // Radix loops by default; the wrap is where an off-by-one in the
      // navigation would show up as a selection that stops dead at the end.
      await ownerPage.keyboard.press('ArrowRight');
      await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
      await ownerPage.keyboard.press('ArrowLeft');
      await expect(items.nth(2)).toHaveAttribute('aria-checked', 'true');
      await expectExactlyOneChecked(group, 'after wrapping both ways');

      // Tab leaves the group. It must not select on the way out — only the
      // arrow keys carry the selection.
      const checkedBeforeTab = await group
        .locator('[role="radio"][aria-checked="true"]')
        .getAttribute('value');
      await ownerPage.keyboard.press('Tab');
      await expect(group.locator('[role="radio"][aria-checked="true"]')).toHaveAttribute(
        'value',
        checkedBeforeTab ?? '',
      );
    } finally {
      // This picker persists the owner's theme — hand the brain back as found,
      // by clicking rather than arrowing, so the restore holds even when the
      // behaviour under test is the thing that regressed.
      const index = values.indexOf(originalValue);
      if (index >= 0) await items.nth(index).click();
    }
  });

  test('ToggleGroup type="single": arrows select, and never empty the group', async ({
    ownerPage,
  }) => {
    await ownerPage.setViewportSize({ width: 1280, height: 900 });
    await ownerPage.goto('/dashboard');

    // The spend chart's range picker, chosen deliberately: it is a single-select
    // ToggleGroup that holds its own component state, keeps its DOM across every
    // change, and persists nothing. The /tasks view toggle looks like the
    // obvious target and is not — switching view REMOUNTS it, so focus is gone
    // before the second arrow key and the spec fails for a reason that has
    // nothing to do with what it is guarding.
    const group = ownerPage
      .locator('[data-slot="toggle-group"]:visible')
      .filter({ has: ownerPage.locator('[role="radio"]', { hasText: /^7d$/ }) });
    await expect(group).toHaveCount(1);
    const items = group.locator('[role="radio"]');
    await expect(items).toHaveCount(3);
    // The card's own caption is written from the picked range, so it is the
    // cheapest proof that the selection reached the APP and not just the ARIA.
    const caption = ownerPage.getByText(/over last \d+ days/);

    await items.nth(0).click();
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(caption).toHaveText(/over last 7 days/);

    await ownerPage.keyboard.press('ArrowRight');
    await expect(items.nth(1)).toBeFocused();
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'false');
    await expectExactlyOneChecked(group, 'after ArrowRight');
    await expect(caption).toHaveText(/over last 14 days/);

    await ownerPage.keyboard.press('ArrowRight');
    await expect(items.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(caption).toHaveText(/over last 30 days/);

    // Wrapping past the last item is the case that would silently DESELECT
    // instead: a toggle group reads a press on its own checked item as "turn me
    // off", so a fix that re-asserts the selection too eagerly empties the
    // group rather than doing nothing.
    await ownerPage.keyboard.press('ArrowRight');
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expectExactlyOneChecked(group, 'after wrapping past the last item');
    await expect(caption).toHaveText(/over last 7 days/);

    await ownerPage.keyboard.press('ArrowLeft');
    await expect(items.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expectExactlyOneChecked(group, 'after wrapping back past the first');
  });
});
