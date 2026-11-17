'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { Shell } from '@mantle/client-types';
import { syncOffOf } from '@/lib/sync';

/**
 * Whether the brain says the Sync service is off (lib/sync.ts), from the
 * shell the app frame already fetched (GET /api/shell). Never fetches it again
 * from here; false until the frame has it, so nothing hides while it loads.
 */
export function useSyncOff(): boolean {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) => syncOffOf(d),
  });
  return data === true;
}
