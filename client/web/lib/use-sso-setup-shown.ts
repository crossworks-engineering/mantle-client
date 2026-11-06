'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { hasArea } from '@/lib/workspaces';
import { SSO_SETUP_KEY, SSO_SETUP_PATH, type SsoSetupStatus } from '@/lib/sso-setup';

/** The one read of the status, for the sidebar and the screen. */
export async function readSsoSetup(): Promise<SsoSetupStatus> {
  try {
    return await apiFetch<SsoSetupStatus>(SSO_SETUP_PATH);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { mode: 'off' };
    throw err;
  }
}

/** Whether the sidebar offers Company sign-in: a login with the users area, on
 *  a box whose mode is on. A brain before the screen answers 404, which reads as
 *  off. Hidden while it loads or fails. With the mode off the brain reads
 *  nothing to answer this. */
export function useSsoSetupShown(areas: readonly string[] | null | undefined): boolean {
  const { data } = useQuery({
    queryKey: SSO_SETUP_KEY,
    queryFn: readSsoSetup,
    enabled: hasArea(areas, 'users'),
    staleTime: 60_000,
    retry: false,
  });
  return data !== undefined && data.mode !== 'off';
}
