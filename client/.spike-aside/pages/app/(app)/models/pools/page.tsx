import { SetPageTitle } from '@/components/layout/page-title';
import { PoolsClient } from './pools-client';

/**
 * Curated model pools — the curator behind /models. Pools ('agents' + one per
 * worker kind) come from GET /api/model-pools (server-driven vocabulary);
 * entries are drafted here and exported as the repo-shipped template. Models
 * are usually ADDED from the /models explorer's detail pane ("Add to pool"),
 * which copies the pricing snapshot in.
 */
export default async function ModelPoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <SetPageTitle title="Curated pools" />
      <PoolsClient initialPool={sp.pool?.trim() || 'agents'} />
    </>
  );
}
