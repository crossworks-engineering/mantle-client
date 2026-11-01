'use client';

import { HeartbeatDetailClient } from './heartbeat-detail-client';
import { useRouteParams } from '@/lib/route-params';

/**
 * /heartbeats/[id] — single-heartbeat biography. Data-free:
 * HeartbeatDetailClient fetches the summary, fires, and profile-formatted date
 * labels from GET /api/heartbeats/[id]/detail.
 */
export default function HeartbeatDetailPage() {
  const { id = '' } = useRouteParams<{ id?: string }>('/heartbeats/[id]');
  return <HeartbeatDetailClient id={id} />;
}
