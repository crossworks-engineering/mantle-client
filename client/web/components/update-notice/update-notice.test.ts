import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTICE_HEADING, NOTICE_TEXT, UpdateNoticeBody } from './update-notice-body';

/**
 * The update notice: what it shows (rendered; the Radix portal itself needs a
 * DOM, so the dialog's settings are pinned from its source), and that it
 * cannot be closed or answered.
 */
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('UpdateNoticeBody', () => {
  it.each(['on', 'down', 'done'] as const)(
    '%s: logo, heading, text, a bar and its stage',
    (phase) => {
      const html = renderToStaticMarkup(createElement(UpdateNoticeBody, { phase }));
      expect(html).toContain('/brand/mantleos-logo-stacked.svg');
      expect(html).toContain(NOTICE_HEADING);
      expect(html).toContain(NOTICE_TEXT);
      expect(html).toContain('role="progressbar"');
      expect(html).toContain('aria-live="polite"');
    },
  );

  it('the stage says where it is', () => {
    const at = (phase: 'on' | 'down' | 'done') =>
      renderToStaticMarkup(createElement(UpdateNoticeBody, { phase }));
    expect(at('on')).toContain('Getting ready');
    expect(at('down')).toContain('Restarting services');
    expect(at('done')).toContain('All done');
  });

  it('offers nothing to press, follow or type', () => {
    const html = renderToStaticMarkup(createElement(UpdateNoticeBody, { phase: 'on' }));
    expect(html).not.toMatch(/<button|<a |<input|<textarea|<select|tabindex/);
  });
});

describe('UpdateNotice dialog', () => {
  const dialog = src('./update-notice.tsx');

  it('refuses every way out', () => {
    for (const prop of [
      'onEscapeKeyDown',
      'onInteractOutside',
      'onPointerDownOutside',
      'onFocusOutside',
    ]) {
      expect(dialog).toContain(`${prop}={stay}`);
    }
    expect(dialog).toContain('const stay = (e: Event) => e.preventDefault();');
    expect(dialog).toContain('hideClose');
    expect(dialog).toContain('<Dialog open modal>');
    expect(dialog).not.toContain('onOpenChange');
  });

  it('covers the whole window, above the menus and the responsive dialog (z-[9999])', () => {
    expect(dialog).toContain('z-[10000]');
    expect(dialog).toMatch(/inset-0 .*h-dvh .*w-screen .*bg-background/);
  });

  it('sits beside the shell gate and on the sign-in page', () => {
    const shell = src('../app-shell.tsx');
    expect(shell).toMatch(/<UpdateNotice \/>\s*<ShellGate/);
    expect(src('../../app/login/page.tsx')).toContain('<UpdateNotice />');
  });

  it('polls with a raw fetch, never apiFetch (no bounce to sign-in mid-restart)', () => {
    const hook = src('../../lib/update-notice/use-update-notice.ts');
    expect(hook).toContain("fetch(apiUrl('/api/update-notice'), {");
    expect(hook).toContain('signal: AbortSignal.timeout(POLL_TIMEOUT_MS)');
    expect(hook).not.toMatch(/apiFetch[<(]|bounceToLogin/);
  });
});
