import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginCredit } from './login-credit';

/**
 * The sign-in footer carries one mark: Mantle under the Jackdaw hero of an
 * unbranded brain, Jackdaw under the owner's own branding. Never both.
 */
describe('LoginCredit', () => {
  it('unbranded brain: the Mantle mark alone', () => {
    const html = renderToStaticMarkup(createElement(LoginCredit, { showJackdaw: false }));
    expect(html).toContain('src="/brand/mantleos-logo.svg"');
    expect(html).not.toContain('jackdaw-row');
  });

  it('branded brain: the Jackdaw mark alone', () => {
    const html = renderToStaticMarkup(createElement(LoginCredit, { showJackdaw: true }));
    expect(html).toContain('/brand/jackdaw-row-light.png');
    expect(html).not.toContain('mantleos-logo');
  });
});
