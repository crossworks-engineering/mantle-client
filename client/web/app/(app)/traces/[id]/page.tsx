'use client';

import { TracePageClient } from './trace-page-client';
import { useRouteParams } from '@/lib/route-params';

/** Deep link to one trace. Data-free — TracePageClient fetches it from
 *  GET /api/traces/[id] and reuses the shared TraceDetailView. */
export default function TraceDetailPage() {
  const { id = '' } = useRouteParams<{ id?: string }>('/traces/[id]');

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <TracePageClient id={id} />
    </div>
  );
}
