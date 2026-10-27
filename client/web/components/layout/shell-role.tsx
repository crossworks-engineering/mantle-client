'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import type { Shell, ShellRole } from '@mantle/client-types';
import { shellRoleOf } from '@/lib/workspaces';

export type { ShellRole };

/**
 * The login's role, from the shell the app frame already fetched (GET
 * /api/shell `role`, W5c contract). Never fetches it again from here; null
 * until the frame has it. One shell, one nav and one set of data routes for
 * every role (W6b): the role picks the chat, the app runner, the byte routes
 * and the MCP screen.
 */
export function useShellRole(): ShellRole | null {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) => shellRoleOf(d),
  });
  return data ?? null;
}

/**
 * A screen that differs by the brain's role (W6b: never for data; an app's
 * run screen): `children` for an admin, `member` for a member. A spinner
 * while the shell has not answered, which the frame's own gate makes rare: it
 * renders pages only after.
 */
export function RoleSwitch({ member, children }: { member: ReactNode; children: ReactNode }) {
  const role = useShellRole();
  switch (role) {
    case 'admin':
      return <>{children}</>;
    case 'member':
      return <>{member}</>;
    default:
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      );
  }
}

/** A client-side replace to `href`: a deep link that is a redirect for an
 *  admin, inside a RoleSwitch (a server redirect would run for every role). */
export function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}
