import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_LABEL } from '@mantle/web-ui/version';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { ChangelogLink } = await import('./changelog-link');

/** The visible text, without tags or the screen-reader-only words. */
function visibleText(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * The rail's version footer is one line: the icon, this build, an arrow and
 * the brain (as `/api/version` reports it). The names go in the hover title.
 */
describe('ChangelogLink', () => {
  it('shows the icon, then this build → the brain version', () => {
    const client = new QueryClient();
    client.setQueryData(['server-version'], { version: '9.8.7' });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(ChangelogLink) }),
    );
    expect(visibleText(html)).toBe(`${VERSION_LABEL}v9.8.7`);
    expect(html).toContain('lucide-arrow-right');
    expect(html).toContain('src="/brand/mantleos-icon.svg"');
    expect(html).not.toContain('>MantleOS Desktop');
    expect(html).toContain(`title="MantleOS Desktop ${VERSION_LABEL}`);
    expect(html).toContain('Brain v9.8.7');
  });

  it('shows this build alone before the brain answers', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(ChangelogLink) }),
    );
    expect(visibleText(html)).toBe(VERSION_LABEL);
    expect(html).not.toContain('lucide-arrow-right');
    expect(html).toMatch(/Brain (…|unavailable)/);
  });

  it('links the changelog for a login with the settings area', () => {
    const client = new QueryClient();
    client.setQueryData(['shell'], { areas: ['settings'] });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(ChangelogLink) }),
    );
    expect(html).toContain('href="/changelog"');
  });

  it('a login without the settings area gets the line as plain text, no link and no dot', () => {
    // GET /api/changelog answers an admin only: /changelog stays the
    // settings area's, so the rail does not offer it.
    const client = new QueryClient();
    client.setQueryData(['shell'], { areas: [] });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(ChangelogLink) }),
    );
    expect(html).toContain(VERSION_LABEL);
    expect(html).not.toContain('href="/changelog"');
    expect(html).not.toContain('What&#x27;s new?');
    expect(html).not.toContain("What's new?");
  });
});
