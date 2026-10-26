'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { runtimeApiBase } from '@mantle/web-ui/runtime-env';
import {
  TREE_KIND_SPECS,
  type TreeItem,
  type TreeKind,
  type TreeMarkList,
  type TreeSort,
} from '@mantle/web-ui/types/tree';
import type { HubData } from '@mantle/share-ui/app-bridge-protocol';
import type { Shell } from '@/lib/contract/shell';
import { fetchFolderPage, fetchMarks, folderKey, marksKey } from '@/components/item-tree/tree-api';
import { treeKindsOf } from '@/components/item-tree/use-tree-kinds';
import { DESK_KINDS, defaultDesk, deskItemsFor, parseDesk, type DeskPrefs } from '@/lib/home-desk';

/**
 * The desk's data: the login it belongs to, where it is kept, and what each
 * widget lists. Every list rides the item tree's own queries (same keys), so
 * a pin or an edit anywhere in the app refreshes the desk and the tree
 * together.
 */

/** The shell AppShell already fetched (same key, never a second request). */
export function useDeskShell() {
  return useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    staleTime: Infinity,
    retry: 1,
  });
}

/** The kinds a desk can show on this brain, for this login, in nav order. */
export function deskKindsOf(shell: Shell | undefined): TreeKind[] {
  const served = treeKindsOf(shell);
  return DESK_KINDS.filter((k) => served.includes(k));
}

const PREFIX = 'mantle_home_desk_v1:';

function brain(): string {
  return runtimeApiBase() || (typeof window === 'undefined' ? '' : window.location.origin);
}

/** Per brain and per login: on a shared device one login's desk is never
 *  another's, and the same person keeps a desk per brain. */
export function deskStorageKey(brainOrigin: string, loginId: string): string {
  return `${PREFIX}${encodeURIComponent(brainOrigin)}:${encodeURIComponent(loginId)}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The login's desk, kept in this browser like the rail width or the last
 * opened item (a per-device convenience: the person's desk on this
 * machine). Null until the shell names the login and storage has been read,
 * which only happens after hydration, so the server and the first client
 * render agree. Blocked or junk storage falls back to the default desk.
 */
export function useDeskPrefs(loginId: string | null, kinds: readonly TreeKind[] | null) {
  const key = loginId ? deskStorageKey(brain(), loginId) : null;
  const [prefs, setPrefs] = useState<DeskPrefs | null>(null);
  const kindsKey = kinds ? kinds.join(',') : null;

  useEffect(() => {
    if (!key || kindsKey === null) return;
    let stored: string | null;
    try {
      stored = storage()?.getItem(key) ?? null;
    } catch {
      stored = null;
    }
    setPrefs(parseDesk(stored) ?? defaultDesk(kindsKey ? (kindsKey.split(',') as TreeKind[]) : []));
  }, [key, kindsKey]);

  const update = useCallback(
    (fn: (p: DeskPrefs) => DeskPrefs) => {
      setPrefs((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        try {
          if (key) storage()?.setItem(key, JSON.stringify(next));
        } catch {
          // Quota or blocked storage: the desk holds for this visit only.
        }
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    update(() => defaultDesk(kinds ?? []));
  }, [update, kinds]);

  return { prefs, update, reset };
}

export type DeskListItem = TreeItem & { pinned: boolean };

/**
 * The key of a kind widget's newest items (one plain page of the kind's top
 * level). Never the tree's own folderKey: the tree keeps an infinite query
 * (pages of items) there, and one plain page under the same key would break
 * the tree's view of it. Still under ['tree', kind], so a tree refresh
 * reaches the desk too.
 */
export function deskNewestKey(kind: TreeKind, sort: TreeSort, ws: string | null) {
  return [...folderKey(kind, null, sort, 'owner', ws), 'desk'] as const;
}

/**
 * A kind widget's items (lib/home-desk `deskItemsFor`): the login's pins,
 * then what it opened last, then the newest in the kind's top level when
 * those two do not fill the widget. `hubNewest`: the landing page's own
 * newest items of the kind in the switcher's workspace (pages, apps); those
 * come straight after the pins, so a workspace's home leads with its own
 * work. `ws`: the switcher's workspace (pins and recent are the login's own,
 * in every workspace).
 */
export function useKindItems(
  kind: TreeKind,
  count: number,
  ws: string | null,
  hubNewest?: readonly TreeItem[],
  /** False: pins and recent only (the sticky notes read their own newest). */
  withNewest = true,
) {
  const pinned = useQuery({
    queryKey: marksKey(kind, 'pinned'),
    queryFn: () => fetchMarks(kind, 'pinned'),
  });
  const recent = useQuery({
    queryKey: marksKey(kind, 'recent'),
    queryFn: () => fetchMarks(kind, 'recent'),
  });
  const sort = TREE_KIND_SPECS[kind].sorts.includes('updated')
    ? 'updated'
    : (TREE_KIND_SPECS[kind].sorts[0] ?? 'name');
  const marked = (pinned.data?.items.length ?? 0) + (recent.data?.items.length ?? 0);
  const settled = !pinned.isPending && !recent.isPending;
  const needNewest = withNewest && !hubNewest && settled && marked < count;
  const newest = useQuery({
    queryKey: deskNewestKey(kind, sort, ws),
    queryFn: () => fetchFolderPage(kind, null, sort, null, 'owner', ws),
    enabled: needNewest,
  });
  const items = useMemo(() => {
    const pins = pinned.data?.items ?? [];
    const opened = recent.data?.items ?? [];
    return hubNewest
      ? deskItemsFor(count, pins, hubNewest, opened)
      : deskItemsFor(count, pins, opened, newest.data?.items ?? []);
  }, [count, pinned.data, recent.data, newest.data, hubNewest]);
  return {
    items,
    isPending: hubNewest
      ? items.length === 0 && !settled
      : !settled || (needNewest && newest.isPending),
  };
}

/** The landing page's newest pages and apps as tree items, for the kind
 *  widgets (`useKindItems` `hubNewest`). */
export function hubNewestOf(
  hub: Pick<HubData, 'sections' | 'apps'> | null,
): Partial<Record<TreeKind, TreeItem[]>> {
  if (!hub) return {};
  const base = {
    icon: null,
    color: null,
    subtype: null,
    state: null,
    workspaces: [],
    hasLink: false,
  };
  return {
    pages: hub.sections.map((s) => ({
      ...base,
      id: s.token,
      title: s.title,
      icon: s.icon,
      updatedAt: s.updatedAt,
    })),
    apps: hub.apps.map((a) => ({ ...base, id: a.token, title: a.title, updatedAt: a.updatedAt })),
  };
}

export type DeskPin = { kind: TreeKind; item: TreeItem };

/**
 * Every pinned item of every kind on the desk, for the desk icons. Undefined
 * until all have answered, so an icon is never dropped because its kind's
 * list was merely slow; `complete` false when one failed, so its icons are
 * kept rather than dropped (lib/home-desk `withPins`).
 */
export function useDeskPins(kinds: readonly TreeKind[], enabled: boolean) {
  const results = useQueries({
    queries: kinds.map((kind) => ({
      queryKey: marksKey(kind, 'pinned'),
      queryFn: () => fetchMarks(kind, 'pinned'),
      enabled,
    })),
  });
  const done = enabled && results.every((r) => r.isSuccess || r.isError);
  const complete = results.every((r) => r.isSuccess);
  const lists = results.map((r) => r.data as TreeMarkList | undefined);
  return useMemo(() => {
    if (!done) return undefined;
    const pins: DeskPin[] = [];
    lists.forEach((list, i) => {
      const kind = kinds[i];
      if (!kind) return;
      for (const item of list?.items ?? []) pins.push({ kind, item });
    });
    return { pins, complete };
    // `lists` is rebuilt every render; its members are the stable query data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, complete, kinds, ...lists]);
}
