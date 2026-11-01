'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { CombosClient } from './combos-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { combo?: string };

/**
 * Named full combinations — one decision instead of thirteen. The brain
 * derives three combos live from the curated pools and computes a diff
 * against what every agent and default worker actually runs; applying is an
 * explicit, reviewable one-shot (rows can be excluded before confirm).
 */
function ModelCombosPageView({ sp }: { sp: Query }) {
  return (
    <>
      <SetPageTitle title="Model combinations" />
      <CombosClient initialCombo={sp.combo?.trim() || 'cost-aware'} />
    </>
  );
}

export default function ModelCombosPage() {
  return <WithSearchParams render={(sp) => <ModelCombosPageView sp={sp as Query} />} />;
}
