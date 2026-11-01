'use client';

import { SecretDetailClient } from './secret-detail-client';
import { useRouteParams } from '@/lib/route-params';

/** Deep-link to one secret. Data-free — SecretDetailClient fetches the metadata
 *  from GET /api/secrets/[id] and reuses the shared SecretDetail. */
export default function SecretDetailPage() {
  const { id = '' } = useRouteParams<{ id?: string }>('/secrets/[id]');
  return (
    <div className="mx-auto max-w-3xl py-2">
      <SecretDetailClient id={id} />
    </div>
  );
}
