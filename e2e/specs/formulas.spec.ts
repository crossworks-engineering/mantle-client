import { expect, test } from '../lib/fixtures';
import { ARTIFACTS_DIR } from '../lib/env';
import { openFromTree } from '../lib/tree';

/**
 * `/formulas`, ported to the Tasks standard (phase 2a) — the last unblocked 2a
 * screen, and the only one with an editor of its own.
 *
 * The scaffold half is one row in `master-detail-screens.spec.ts`. This file
 * holds the three things the port CHANGED, each of which was silently wrong
 * before and each of which a typechecker cannot see:
 *
 *  1. the §8 detail header — the glyph inside the h2, delete an aria-labelled
 *     icon button rather than a `title=` tooltip on a rectangle;
 *  2. §6b on the evaluator — a required input left empty used to be a server
 *     round trip that named the SYMBOL in a result panel and left no box red;
 *  3. §6b on the editor's YAML view — a parse failure was a loose red `<p>`,
 *     never announced, with the textarea itself still looking fine.
 *
 * The domain (does the arithmetic come out right) is not this file's business;
 * `formula-eval` and `formula-spec` are unit-tested in the package.
 */

/** The seeded worked examples. Idempotent server-side, so re-running is free —
 *  and it means the screen is never asserted against an empty brain. */
async function seedFormulas(api: { post: (u: string) => Promise<{ ok: () => boolean }> }) {
  const res = await api.post('/api/formulas/seed');
  expect(res.ok(), 'could not seed the example formulas').toBeTruthy();
}

test.describe('formulas', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('the detail header follows §8 and the pane owns one scrollbar', async ({
    ownerApi,
    ownerPage,
  }) => {
    await seedFormulas(ownerApi);
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/formulas');

    const detail = ownerPage.locator('[data-testid="detail"]');
    const heading = detail.getByRole('heading', { level: 2 });
    await openFromTree(ownerPage, 'Ideal gas density', heading);
    await expect(heading).toContainText('Ideal gas density');

    // The glyph belongs INSIDE the h2 — parked outside it drifts the moment
    // the title wraps. Asserting on the DOM, not on how it looks.
    expect(
      await heading.evaluate((h) => h.querySelector('svg') !== null),
      'the icon is not inside the h2 (§8)',
    ).toBe(true);

    // Delete: no text label, an accessible name, and grey until hover — the
    // always-red idiom is retired. `icon-sm` is a SQUARE, which is the whole
    // point of the twin; `size="sm"` on a lone glyph gives 40x36.
    const del = detail.getByRole('button', { name: 'Delete formula' });
    await expect(del).toHaveText('');
    const box = (await del.boundingBox())!;
    expect(
      Math.abs(box.width - box.height),
      'delete is a rectangle, not the icon twin',
    ).toBeLessThan(2);

    // Landmine 9: the pane used to bring its own `h-full overflow-y-auto`
    // inside the one MasterDetail already owns, which paints two bars.
    const scrollers = await detail.evaluate(
      (pane) =>
        Array.from(pane.querySelectorAll('*')).filter((el) => {
          const s = getComputedStyle(el);
          return (
            (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight
          );
        }).length,
    );
    expect(scrollers, 'the detail pane grew a second scrollbar').toBeLessThanOrEqual(1);
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}formulas-detail.png` });
  });

  test('a required input left empty fails on the control, not in the result panel', async ({
    ownerApi,
    ownerPage,
  }) => {
    await seedFormulas(ownerApi);
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/formulas');

    const detail = ownerPage.locator('[data-testid="detail"]');
    await openFromTree(ownerPage, 'Ideal gas density', detail.getByRole('heading', { level: 2 }));
    await expect(detail.getByRole('heading', { level: 2 })).toContainText('Ideal gas density');

    // P, M and T are the required inputs of the `density` target. Located by
    // id, not by label text: a symbol is one character, and a substring match
    // on "T" also hits the "Delete formula" button.
    const pressure = detail.locator('#in-P');
    await expect(pressure).toBeVisible();
    // The label IS wired to the control, which is what makes `htmlFor` worth
    // having — the unit rides along in the accessible name.
    await expect(pressure).toHaveAccessibleName(/^P\b/);
    await expect(pressure).not.toHaveAttribute('aria-invalid', 'true');

    await detail.getByRole('button', { name: 'Evaluate formula' }).click();

    // All three §6b marks, and the message names the control it is standing on
    // rather than floating at the foot of the form.
    await expect(pressure).toHaveAttribute('aria-invalid', 'true');
    const error = detail.locator('[role="alert"]', { hasText: 'P is required' });
    await expect(error).toBeVisible();
    const describedBy = await pressure.getAttribute('aria-describedby');
    const errorId = await error.getAttribute('id');
    expect(describedBy?.split(' '), 'the control does not point at its own error').toContain(
      errorId,
    );
    // `data-invalid` is what turns the LABEL destructive; without it the field
    // reads as fine and only the border moves.
    const field = detail.locator('[data-slot="field"][data-invalid="true"]');
    expect(await field.count(), 'no Field marked data-invalid').toBeGreaterThan(0);

    // Typing clears this field's mark and leaves the others alone — the rest
    // are still empty and still wrong.
    await pressure.fill('101325');
    await expect(pressure).not.toHaveAttribute('aria-invalid', 'true');
    await expect(detail.locator('#in-T')).toHaveAttribute('aria-invalid', 'true');
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}formulas-evaluate-invalid.png` });

    // And a complete set still evaluates — the guard must not have replaced the
    // round trip, only fronted it. Air at 1 atm, 20 °C ≈ 1.2 kg/m3.
    await detail.locator('#in-M').fill('0.02896');
    await detail.locator('#in-T').fill('293.15');
    await detail.getByRole('button', { name: 'Evaluate formula' }).click();
    await expect(detail.getByText(/^1\.2/)).toBeVisible();
  });

  test('the editor announces a YAML parse failure on the textarea itself', async ({
    ownerApi,
    ownerPage,
  }) => {
    await seedFormulas(ownerApi);
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/formulas');
    const edit = ownerPage.locator('[data-testid="detail"]').getByRole('button', { name: 'Edit' });
    await openFromTree(ownerPage, 'Ideal gas density', edit);
    await edit.click();

    await expect(ownerPage.getByRole('button', { name: /^Done editing/ })).toBeVisible();
    await ownerPage.getByRole('tab', { name: 'YAML' }).click();

    const source = ownerPage.getByLabel('Spec source');
    await expect(source).toBeVisible();
    await expect(source).not.toHaveAttribute('aria-invalid', 'true');
    const save = ownerPage.getByRole('button', { name: 'Save formula' });
    await expect(save).toBeEnabled();

    // A tab character where YAML wants a space is the classic one, and it is
    // exactly the failure a red paragraph under the box explains badly.
    await source.fill('variables:\n\t- symbol: P\n');

    await expect(source).toHaveAttribute('aria-invalid', 'true');
    const error = ownerPage.locator('[role="alert"]').first();
    await expect(error).toBeVisible();
    expect(await source.getAttribute('aria-describedby')).toBe(await error.getAttribute('id'));
    // Broken source must not be savable — that is what `valid` is for.
    await expect(save).toBeDisabled();
    await ownerPage.screenshot({ path: `${ARTIFACTS_DIR}formulas-yaml-invalid.png` });
  });
});
