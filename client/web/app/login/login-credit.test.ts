import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginCredit } from './login-credit';

/**
 * The sign-in footer credits MantleOS only under the owner's own branding. An
 * unbranded brain already wears the MantleOS wordmark as its hero, so the
 * footer stays empty rather than showing it twice.
 */
describe('LoginCredit', () => {
  it('unbranded brain: no credit, the hero is already the mark', () => {
    const html = renderToStaticMarkup(createElement(LoginCredit, { show: false }));
    expect(html).toBe('');
  });

  it('branded brain: the MantleOS wordmark', () => {
    const html = renderToStaticMarkup(createElement(LoginCredit, { show: true }));
    expect(html).toContain('src="/brand/mantleos-logo.svg"');
    expect(html).toContain('alt="MantleOS"');
  });
});
