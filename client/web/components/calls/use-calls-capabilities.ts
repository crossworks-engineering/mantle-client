'use client';

/**
 * Whether this brain shows a Call button: GET /api/messenger/capabilities,
 * cached a minute (plan section 9). A 404 (a brain before calls) and any
 * failure read as calls off: no button anywhere until the brain says so.
 */
import { useQuery } from '@tanstack/react-query';
import { CAPABILITIES_FRESH_MS, callsApi, callsKeys } from '@/lib/calls/api';
import type { MessengerCapabilities } from '@/lib/messenger/dto';

/** Calls on, as the answer says; off on a 404, a failure, or no answer yet. */
export function callsOn(q: { data?: MessengerCapabilities; error?: unknown }): boolean {
  return q.data?.calls === true;
}

export function useCallsCapabilities(): { calls: boolean } {
  const q = useQuery({
    queryKey: callsKeys.capabilities,
    queryFn: callsApi.capabilities,
    staleTime: CAPABILITIES_FRESH_MS,
    // A brain before calls (404) is asked once per load, not every minute.
    refetchInterval: (query) =>
      (query.state.error as { status?: number } | null)?.status === 404
        ? false
        : CAPABILITIES_FRESH_MS,
    retry: (n, err) => (err as { status?: number } | null)?.status !== 404 && n < 2,
  });
  return { calls: callsOn({ data: q.data, error: q.error }) };
}
