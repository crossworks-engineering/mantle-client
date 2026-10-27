'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { Shell } from '@mantle/client-types';
import {
  isAdminUserShell,
  isOwnerShell,
  shellAreasOf,
  shellWorkspacesOf,
  type ShellWorkspace,
} from '@/lib/workspaces';

export type ShellWorkspaceInfo = {
  /** The login's workspaces, as the shell names them ([] when it names none). */
  workspaces: ShellWorkspace[];
  /** Whether this brain sends workspaces at all (W5a and later). */
  hasWorkspaces: boolean;
  /** The areas the login holds; undefined from a brain that sends none. */
  areas: string[] | undefined;
  /** Who is signed in, to key the switcher's choice by login. */
  login: string | null;
  /** The login's id (GET /api/shell `loginId`): who is looking, to tell
   *  their own row on a workspace screen. Null from a shell without it. */
  loginId: string | null;
};

/**
 * The workspaces and areas from the shell the app frame already fetched
 * (GET /api/shell). Never fetches it again from here; undefined until the
 * frame has it.
 */
export function useShellWorkspaces(): ShellWorkspaceInfo | undefined {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell): ShellWorkspaceInfo => ({
      workspaces: shellWorkspacesOf(d),
      hasWorkspaces: Array.isArray(d?.workspaces),
      areas: shellAreasOf(d),
      login: d?.email ?? null,
      loginId: typeof d?.loginId === 'string' && d.loginId ? d.loginId : null,
    }),
  });
  return data;
}

/** The areas the login holds, from the shell (undefined from a brain that
 *  names none: before W5a it served the shell to admins only). */
export function useViewerAreas(): string[] | undefined {
  return useShellWorkspaces()?.areas;
}

/**
 * Whether the login is an Admin user (isAdminUserShell in lib/workspaces.ts):
 * false until the shell has answered. Since W6b every login has the same
 * screens; this hides what only an Admin user may do there (the owner-only
 * routes: export, the app editor and app nav, the trash list, history).
 */
export function useIsAdminUser(): boolean {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) => isAdminUserShell(d),
  });
  return data === true;
}

/**
 * Whether the login is the brain's owner (isOwnerShell in lib/workspaces.ts):
 * false until the shell has answered. Only the owner's app deletes are
 * removed after 30 days; anyone else's stay in the trash until the owner
 * deletes them for good.
 */
export function useIsBrainOwner(): boolean {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) => isOwnerShell(d),
  });
  return data === true;
}

/**
 * Who is signed in, from the shell: the login (the actor, never the anchor)
 * and whether it is the brain's owner. Undefined until the shell has
 * answered. For the screens that tell the viewer's own things from another
 * user's (a heartbeat's maker, W7a). `ownerStated`: the brain said whether
 * the login is its owner (`isOwner`); without it `isOwner` is read from the
 * role (isOwnerShell), which a screen hiding what only the owner may do
 * must not trust (the pending card, lows round 2).
 */
export function useViewerLogin():
  { loginId: string; isOwner: boolean; ownerStated: boolean } | undefined {
  const { data } = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
    select: (d: Shell) =>
      d && typeof d.loginId === 'string'
        ? {
            loginId: d.loginId,
            isOwner: isOwnerShell(d),
            ownerStated: typeof d.isOwner === 'boolean',
          }
        : null,
  });
  return data ?? undefined;
}
