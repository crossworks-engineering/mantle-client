'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { grantsKey, grantsUrl, type GrantsView } from '@/lib/grants';
import { looksById } from '@/lib/workspace-look';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { useWorkspaces } from '@/components/workspaces/workspace-queries';
import { GrantAccessControl } from './grant-access';
import { AccessStack, accessStackLabel } from './access-stack';

/**
 * The share marks of a row that carries none (an item opened by its detail
 * route, a deep link, a detail that never had a list row): the item's grants,
 * each workspace in its own look from the shell's and the workspace list.
 * Null while there is nothing to read yet.
 */
function useGrantMarks(nodeId: string, needed: boolean): unknown {
  const shell = useShellWorkspaces();
  const listed = useWorkspaces();
  const q = useQuery({
    queryKey: grantsKey(nodeId),
    queryFn: () => apiFetch<GrantsView>(grantsUrl(nodeId)),
    enabled: needed,
    retry: false,
  });
  if (!needed || !q.data) return null;
  const looks = looksById(shell?.workspaces, listed.data);
  return {
    workspaces: q.data.rows
      .filter((r) => !r.excluded)
      .map((r) => ({ ...looks.get(r.wsId), id: r.wsId, name: r.name })),
    hasLink: q.data.hasLink,
  };
}

/**
 * The item header's Access slot (item header contract, 2026-10-21): the
 * Grant Access button with who it is shared with, for a login that may
 * share it; the same stack, not clickable, for one that may not. Either way
 * the slot is there, so the slots right of it never move.
 *
 * `shares` is the list row the item came from when it has one; a row with no
 * share marks falls back to the item's grants.
 */
export function AccessSlot({
  nodeId,
  type,
  canShare,
  shares,
  beforeEnable,
  hint,
}: {
  nodeId: string;
  type: string;
  canShare: boolean;
  /** The row whose workspaces and open link the stack shows
   *  (`shareMarksOf`). */
  shares: unknown;
  beforeEnable?: () => Promise<void> | void;
  /** Kind-specific consequence, shown under the panel. */
  hint?: string;
}) {
  const carries = !!shares && typeof shares === 'object' && 'workspaces' in shares;
  const marks = useGrantMarks(nodeId, !carries) ?? shares;
  if (canShare) {
    return (
      <GrantAccessControl
        type={type}
        nodeId={nodeId}
        stackOf={marks}
        beforeEnable={beforeEnable}
        hint={hint}
      />
    );
  }
  return (
    <span
      className="inline-flex h-9 items-center px-2 text-muted-foreground"
      title={accessStackLabel(marks)}
    >
      <AccessStack item={marks} />
    </span>
  );
}
