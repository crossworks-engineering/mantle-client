'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OidcConfigDTO, OidcStatusDTO } from '@mantle/client-types';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { readOidcConfig } from './actions';
import { rememberCompanySignIn } from './linked-browser';

export const OIDC_STATUS_KEY = ['oidc-status'];
export const OIDC_CONFIG_KEY = ['oidc-config'];

/** The company sign-in mode and label, for the sign-in screen. Off until it
 *  answers, so that screen never changes on a box with it off. A read that
 *  failed is not an answer: it is asked again, and a refusal from the brain
 *  asks again at once (lib/oidc/actions.ts). */
export function useOidcConfig() {
  return (
    useQuery({
      queryKey: OIDC_CONFIG_KEY,
      queryFn: readOidcConfig,
      staleTime: 60_000,
      retry: 2,
    }).data ?? { mode: 'off' as const }
  );
}

/** What to call it when the brain has refused a password but the label could
 *  not be read: the refusal is the brain's answer, whatever the read said. */
export function companyLabel(config: OidcConfigDTO): string {
  return config.mode === 'off' ? 'your company sign-in' : config.label;
}

/** The status as it stands: undefined while it is not known. */
export function useOidcStatusKnown(): OidcStatusDTO | undefined {
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
    retry: 2,
  });
  const linked = data !== undefined && data.mode !== 'off' && data.linked;
  useEffect(() => {
    if (linked) rememberCompanySignIn();
  }, [linked]);
  return data;
}

/**
 * The signed-in login's company sign-in. Off while it loads, and on a brain
 * from before it (a 404). Any screen may ask: one query for the whole shell.
 */
export function useOidcStatus(): OidcStatusDTO {
  return useOidcStatusKnown() ?? { mode: 'off' };
}
