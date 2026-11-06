'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { hasArea } from '@/lib/workspaces';
import { SSO_SETUP_KEY, SSO_SETUP_PATH, type SsoSetupStatus } from '@/lib/sso-setup';

/** The one read of the status, for the sidebar and the screen. A brain before
 *  the screen reads as off: its answer is 405, because the path matches
 *  /api/users/:id, or 404. */
export async function readSsoSetup(): Promise<SsoSetupStatus> {
  try {
    return await apiFetch<SsoSetupStatus>(SSO_SETUP_PATH);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      return { mode: 'off' };
    }
    throw err;
  }
}

/** One set of options for the one key: the sidebar, the palette and the screen. */
export const ssoSetupQuery = {
  queryKey: SSO_SETUP_KEY,
  queryFn: readSsoSetup,
  staleTime: 60_000,
  retry: 1,
  // An open tab learns a mode change when the person comes back to it.
  refetchOnWindowFocus: true,
};

/** Whether the sidebar offers Company sign-in: a login with the users area, on
 *  a box whose mode is on. Hidden on a brain before the screen, and while it
 *  loads or fails. With the mode off the brain reads
 *  nothing to answer this. */
export function useSsoSetupShown(areas: readonly string[] | null | undefined): boolean {
  // Asked only once the shell has said what this login holds.
  const enabled = areas != null && hasArea(areas, 'users');
  const { data } = useQuery({ ...ssoSetupQuery, enabled });
  return enabled && data !== undefined && data.mode !== 'off';
}
