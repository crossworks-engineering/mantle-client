import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SHARES_KEY, SHARES_PATH, invalidateLinkQueries } from './shared-links';

/**
 * Shared links (Settings > Shared links): the kept route, and what a revoke
 * reloads. No level is read or shown since W5b2 (contract 30), and there are
 * no retired client links to list since W5c.
 */
describe('shared links', () => {
  it('reads the kept route', () => {
    expect(SHARES_PATH).toBe('/api/team-admin/shares');
  });

  it('a revoke reloads the links only', () => {
    const qc = new QueryClient();
    qc.setQueryData(SHARES_KEY, { shares: [] });
    qc.setQueryData(['other'], {});
    invalidateLinkQueries(qc);
    expect(qc.getQueryState(SHARES_KEY)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['other'])?.isInvalidated).toBe(false);
  });
});
