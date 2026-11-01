'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { FactsClient } from './facts-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { page?: string; q?: string };

/** Debug → Facts. Data-free: FactsClient fetches GET /api/debug/facts. */
function DebugFactsPageView({ sp }: { sp: Query }) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Facts" />
      <FactsClient page={page} query={query} />
    </div>
  );
}

export default function DebugFactsPage() {
  return <WithSearchParams render={(sp) => <DebugFactsPageView sp={sp as Query} />} />;
}
