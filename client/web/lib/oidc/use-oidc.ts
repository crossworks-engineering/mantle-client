'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OidcStatusDTO } from '@mantle/client-types';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { readOidcConfig } from './actions';
import { rememberCompanySignIn } from './linked-browser';

export const OIDC_STATUS_KEY = ['oidc-status'];

/** The company sign-in mode and label, for the sign-in screen. Off until it
 *  answers, so that screen never changes on a box with it off. */
export function useOidcConfig() {
  return (
    useQuery({
      queryKey: ['oidc-config'],
      queryFn: readOidcConfig,
      staleTime: 60_000,
      retry: false,
    }).data ?? { mode: 'off' as const }
  );
}

/**
 * The signed-in login's company sign-in. Off while it loads, and on a brain
 * from before it (a 404). Any screen may ask: one query for the whole shell.
 */
export function useOidcStatus(): OidcStatusDTO {
  const { data } = useQuery({
    queryKey: OIDC_STATUS_KEY,
    queryFn: async (): Promise<OidcStatusDTO> => {
      try {
        return await apiFetch<OidcStatusDTO>('/api/auth/oidc/status');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return { mode: 'off' };
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const status = data ?? { mode: 'off' as const };
  const linked = status.mode !== 'off' && status.linked;
  useEffect(() => {
    if (linked) rememberCompanySignIn();
  }, [linked]);
  return status;
}
