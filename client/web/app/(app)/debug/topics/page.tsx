'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { TopicsClient } from './topics-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { page?: string; q?: string };

/** Debug → Topics. Data-free: TopicsClient fetches GET /api/debug/topics. */
function DebugTopicsPageView({ sp }: { sp: Query }) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Topics" />
      <TopicsClient page={page} query={query} />
    </div>
  );
}

export default function DebugTopicsPage() {
  return <WithSearchParams render={(sp) => <DebugTopicsPageView sp={sp as Query} />} />;
}
