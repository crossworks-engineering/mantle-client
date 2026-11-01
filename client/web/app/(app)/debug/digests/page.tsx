'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { DigestsClient } from './digests-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { page?: string; q?: string };

/** Debug → Digests. Data-free: DigestsClient fetches GET /api/debug/digests. */
function DebugDigestsPageView({ sp }: { sp: Query }) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Digests" />
      <DigestsClient page={page} query={query} />
    </div>
  );
}

export default function DebugDigestsPage() {
  return <WithSearchParams render={(sp) => <DebugDigestsPageView sp={sp as Query} />} />;
}
