/**
 * A Sync screen closes while the brain says the service is off, and only
 * then: on, a missing field and an older brain all show the screen.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { SYNC_OFF_TEXT, SYNC_OFF_TITLE } from '@/lib/sync';
import { SyncGate } from './sync-gate';

function render(shell: unknown): string {
  const client = new QueryClient();
  client.setQueryData(['shell'], shell);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client,
      children: createElement(SyncGate, null, createElement('p', null, 'SCREEN')),
    }),
  );
}

describe('SyncGate', () => {
  it('off: the card, with the way to Settings > Services', () => {
    const html = render({ features: { sync: false } });
    expect(html).not.toContain('SCREEN');
    expect(html).toContain(SYNC_OFF_TITLE);
    expect(html).toContain(SYNC_OFF_TEXT.replace('>', '&gt;'));
    expect(html).toContain('href="/settings/services"');
  });

  it('on: the screen', () => {
    expect(render({ features: { sync: true } })).toBe('<p>SCREEN</p>');
  });

  it('a brain that sends no field: the screen', () => {
    expect(render({ features: { recallV2: true } })).toBe('<p>SCREEN</p>');
    expect(render({ siteName: null })).toBe('<p>SCREEN</p>');
  });
});
