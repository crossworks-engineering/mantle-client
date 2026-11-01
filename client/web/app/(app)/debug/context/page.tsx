'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { ContextClient } from './context-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { page?: string; q?: string };

/**
 * /debug/context — per-turn retrieval audit. Data-free: ContextClient fetches
 * GET /api/debug/context (question · context sent · response), so you can judge
 * whether the retrieved context matched the question.
 */
function DebugContextPageView({ sp }: { sp: Query }) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Context" />
      <ContextClient page={page} query={query} />
    </div>
  );
}

export default function DebugContextPage() {
  return <WithSearchParams render={(sp) => <DebugContextPageView sp={sp as Query} />} />;
}
