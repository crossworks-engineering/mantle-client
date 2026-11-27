'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { Shell } from '@mantle/client-types';
import { secretsOfferedOf } from '@/lib/secrets-screen';

/**
 * Whether the brain offers the Secrets screen to this login
 * (lib/secrets-screen.ts), from the shell the app frame already fetched
 * (GET /api/shell). Never fetches it again from here; true until the frame
 * has it, so nothing hides while it loads.
 */
export function useSecretsOffered(): boolean {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) => secretsOfferedOf(d),
  });
  return data !== false;
}
