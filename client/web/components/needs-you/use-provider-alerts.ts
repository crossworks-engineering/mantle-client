'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { useRealtime } from '@/components/realtime/use-realtime';
import {
  PROVIDER_ALERTS_KEY,
  PROVIDER_ALERTS_REALTIME_TYPE,
  RECOVER_PATH,
  providerAlertsOf,
  type ProviderAlert,
} from '@/lib/provider-alerts';

/** A safety net under the live event (it has no replay). */
const RECHECK_MS = 5 * 60_000;

/**
 * The open provider outages (GET /api/embedding/recover, admins only).
 * Every caller shares one React Query entry. Empty while loading, for a
 * member or a client (the brain refuses them), and on a brain before 0230.
 */
export function useProviderAlerts(): ProviderAlert[] {
  return useProviderAlertsState().alerts;
}

/** The same, with whether an answer has come (`loaded`): empty before it
 *  is not "no outage" yet. */
export function useProviderAlertsState(): { alerts: ProviderAlert[]; loaded: boolean } {
  const queryClient = useQueryClient();
  useRealtime([PROVIDER_ALERTS_REALTIME_TYPE], () => {
    void queryClient.invalidateQueries({ queryKey: PROVIDER_ALERTS_KEY });
  });
  const q = useQuery({
    queryKey: PROVIDER_ALERTS_KEY,
    queryFn: async (): Promise<ProviderAlert[]> => {
      try {
        return providerAlertsOf(await apiFetch<unknown>(RECOVER_PATH));
      } catch (err) {
        if (err instanceof ApiError && [401, 403, 404, 405].includes(err.status)) return [];
        throw err;
      }
    },
    refetchInterval: RECHECK_MS,
    refetchOnWindowFocus: true,
  });
  return { alerts: q.data ?? [], loaded: q.isSuccess };
}
