import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, CONTRACT_VERSION } from '@mantle/web-ui/version';
import { BuildCard } from './build-card';

/**
 * Both halves of the install, each with its own mark: the Mantle row wears
 * the Mantle badge, as the Jackdaw row wears Jackdaw's.
 */
describe('BuildCard', () => {
  it('names Mantle with its badge and the version the brain reports', () => {
    const client = new QueryClient();
    client.setQueryData(['server-version'], {
      version: '9.8.7',
      contractVersion: CONTRACT_VERSION,
    });
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client, children: createElement(BuildCard) }),
    );
    expect(html).toContain('src="/brand/mantleos-icon.svg"');
    expect(html).toContain('src="/brand/jackdaw-badge-light.png"');
    expect(html).toContain('v9.8.7');
    expect(html).toContain(`v${APP_VERSION}`);
  });
});
