'use client';

import { BackLink } from '@mantle/web-ui/layout/back-link';
import { JourneyDetailClient } from './journey-detail-client';
import { useRouteParams } from '@/lib/route-params';

/**
 * Journey detail — the reaction story for one action. Data-free:
 * JourneyDetailClient fetches it from GET /api/debug/journey/[traceId] and
 * renders the step timeline + brain layers.
 */
export default function JourneyDetailPage() {
  const { traceId = '' } = useRouteParams<{ traceId?: string }>('/debug/journey/[traceId]');

  return (
    <div className="space-y-6 px-6 py-8">
      <BackLink href="/debug/journey">Back to activity</BackLink>
      <JourneyDetailClient traceId={traceId} />
    </div>
  );
}
