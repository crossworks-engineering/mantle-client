import { SetPageTitle } from '@/components/layout/page-title';
import { CombosClient } from './combos-client';

/**
 * Named full combinations — one decision instead of thirteen. The brain
 * derives three combos live from the curated pools and computes a diff
 * against what every agent and default worker actually runs; applying is an
 * explicit, reviewable one-shot (rows can be excluded before confirm).
 */
export default async function ModelCombosPage({
  searchParams,
}: {
  searchParams: Promise<{ combo?: string }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <SetPageTitle title="Model combinations" />
      <CombosClient initialCombo={sp.combo?.trim() || 'cost-aware'} />
    </>
  );
}
