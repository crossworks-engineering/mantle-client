/**
 * Shared links (Settings > Shared links) and the link revoke the Access
 * control reuses. Every live link is an open one; a link follows no level
 * since W5b2 (contract 30), so none is shown or asked for.
 */
import type { QueryClient } from '@tanstack/react-query';
import { apiSend } from '@mantle/web-ui/api-fetch';

/** The kept Shared links route (W5c brain contract): every live link. */
export const SHARES_PATH = '/api/team-admin/shares';

/** The Shared links screen's query (GET /api/team-admin/shares). */
export const SHARES_KEY = ['shared-links'] as const;

/** Revoke one link (DELETE /api/shares/:id). The item's grants and their
 *  Write switches do not change. */
export async function revokeShareLink(shareId: string): Promise<void> {
  await apiSend(`/api/shares/${encodeURIComponent(shareId)}`, 'DELETE');
}

/** After a revoke or a link change: Shared links reloads. */
export function invalidateLinkQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: SHARES_KEY });
}
