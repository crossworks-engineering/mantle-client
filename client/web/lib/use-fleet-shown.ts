'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { hasArea } from '@/lib/workspaces';
import { FLEET_KEY, FLEET_PATH, type FleetOverview } from '@/lib/fleet';

/** The one read of the Fleet, for the sidebar and the screen. Null: this box
 *  is not a Control Center (404), or is a brain before the Fleet (404 or 405). */
export async function readFleet(): Promise<FleetOverview | null> {
  try {
    return await apiFetch<FleetOverview>(FLEET_PATH);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

/** One set of options for the one key: the sidebar, the palette and the screen. */
export const fleetQuery = {
  queryKey: FLEET_KEY,
  queryFn: readFleet,
  staleTime: 30_000,
  retry: 1,
  refetchOnWindowFocus: true,
};

/** Whether the sidebar offers the CC tab and its Control Center group: a login with the settings area, on a
 *  Control Center. Hidden while it loads or fails. */
export function useFleetShown(areas: readonly string[] | null | undefined): boolean {
  // Asked only once the shell has said what this login holds.
  const enabled = areas != null && hasArea(areas, 'settings');
  const { data } = useQuery({ ...fleetQuery, enabled });
  return enabled && data != null;
}
