import { expect, test } from '../lib/fixtures';

/**
 * `keys` and `peers`, §6b. Between them they had every bad delivery this
 * rollout has met:
 *
 *   • keys: TWO toasts ("Paste the key value.", the custom-service pattern),
 *     on top of `required` — so the browser bubble AND a corner message for
 *     the same field.
 *   • keys' rotate dialog: a SILENT `return` on an empty value. The button
 *     appeared broken and said nothing at all.
 *   • peers: one toast reading "Name and base URL are required" — a single
 *     message for two controls, naming neither one on screen.
 *
 * All of them land on their control now, with the rules unchanged.
 */
test.describe('settings → API keys', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('an empty key value fails on the control, not in a corner', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings/keys');
    await ownerPage.getByRole('button', { name: /^New$/ }).click();

    const control = ownerPage.locator('#plaintext');
    await expect(control).toBeVisible();
    await ownerPage.getByRole('button', { name: /Save key/i }).click();

    await expect(control).toHaveAttribute('aria-invalid', 'true');
    await expect(ownerPage.locator('[data-slot="field"]:has(#plaintext)')).toHaveAttribute(
      'data-invalid',
      'true',
    );
    const error = ownerPage.locator('#plaintext-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    expect((await control.getAttribute('aria-describedby')) ?? '').toContain('plaintext-error');
    await expect(control).toBeFocused();
  });

  test('a custom service name is checked against its own rule', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings/keys');
    await ownerPage.getByRole('button', { name: /^New$/ }).click();

    // The custom-service input only appears once "Custom / other API…" is the
    // chosen provider — it is a Select now, not a raw <select> (§6d).
    await ownerPage.locator('#service').click();
    await ownerPage.getByRole('option', { name: /Custom \/ other API/ }).click();

    const custom = ownerPage.locator('#custom-service');
    await expect(custom).toBeVisible();
    await custom.fill('Not A Service');
    await ownerPage.locator('#plaintext').fill('sk-test-value');
    await ownerPage.getByRole('button', { name: /Save key/i }).click();

    await expect(custom).toHaveAttribute('aria-invalid', 'true');
    await expect(ownerPage.locator('#custom-service-error')).toContainText(/lower-case/i);
    await expect(ownerPage.locator('#custom-service-error')).toHaveAttribute('role', 'alert');
  });
});

test.describe('settings → peers', () => {
  test.skip(({ topology }) => topology === 'same-origin', 'owner UI lives on the client app');

  test('one toast for two controls becomes one message per control', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 1600, height: 900 });
    await ownerPage.goto('/settings/peers');
    // "Link a brain" opens the create form, whether or not peers exist.
    const nameField = ownerPage.locator('#peer-name');
    await ownerPage.getByRole('button', { name: 'Link a brain' }).click();
    await expect(nameField).toBeVisible();

    await ownerPage.getByRole('button', { name: /^Add brain$/i }).click();

    for (const id of ['peer-name', 'peer-url']) {
      const control = ownerPage.locator(`#${id}`);
      await expect(control, `${id} is not marked invalid`).toHaveAttribute('aria-invalid', 'true');
      const error = ownerPage.locator(`#${id}-error`);
      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute('role', 'alert');
      expect((await control.getAttribute('aria-describedby')) ?? '').toContain(`${id}-error`);
    }
    // The optional token was never required and must not be marked.
    await expect(ownerPage.locator('#peer-token')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
