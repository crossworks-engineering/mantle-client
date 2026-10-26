'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useFlushOnLeave } from '@mantle/web-ui/use-flush-on-leave';
import { useToast } from '@mantle/web-ui/ui/toast';
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
import {
  DESK_KINDS,
  defaultDesk,
  deskFrom,
  deskItemsFor,
  parseDesk,
  roamingDesk,
  type DeskPrefs,
} from '@/lib/home-desk';
import { createDeskSaver, type DeskSaver } from '@/lib/home-desk-saver';

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

const MIGRATED_PREFIX = 'mantle_home_desk_migrated_v1:';

/** Set once this browser has moved its local desk up to the login's profile
 *  (per brain and per login, as the desk itself): the move is offered once,
 *  never again on a later visit (lib/home-desk `roamingDesk`). */
export function deskMigratedKey(brainOrigin: string, loginId: string): string {
  return `${MIGRATED_PREFIX}${encodeURIComponent(brainOrigin)}:${encodeURIComponent(loginId)}`;
}

/** The desks (brain and login, deskStorageKey) whose save the brain refused
 *  this visit: they stay in this browser's storage until the page reloads,
 *  even when Home is left and opened again. */
const refusedThisVisit = new Set<string>();

function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or blocked storage: the desk holds for this visit only.
  }
}

/** PUT the desk to the login's profile. `keepalive` on the way out, so the
 *  request outlives a closing tab. */
function sendDesk(desk: DeskPrefs, opts: { keepalive: boolean }) {
  return apiFetch<{ homeDesk: unknown }>('/api/profile/home-desk', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ homeDesk: desk }),
    keepalive: opts.keepalive,
  });
}

/**
 * The login's desk, and the two ways to change it.
 *
 * Kept on the LOGIN's profile (PUT /api/profile/home-desk, read back in GET
 * /api/shell as `homeDesk`), so the desk follows the person to another
 * browser, another machine and the desktop app, as nav favourites do. A
 * change shows at once and is saved a moment later (lib/home-desk-saver:
 * the debounce, the flush and the failures); leaving Home, hiding the tab or
 * closing it saves what is still waiting. The first visit to a brain that
 * keeps the desk moves a desk this browser kept before up to an empty
 * profile, once per brain and login (lib/home-desk `roamingDesk`, the
 * migrated flag).
 *
 * A save replaces the whole desk, so the last save wins across devices; when
 * the window comes back after a long idle with nothing waiting, the desk is
 * read again first (DESK_REFRESH_AFTER_MS), so a desk arranged on another
 * device is shown before this one can overwrite it.
 *
 * The desk stays in this browser's storage, per brain and per login, as it
 * was before it roamed, when: the brain is on an older release (no
 * `homeDesk` in the shell); the brain could not read the login's row this
 * time (`homeDesk` left out, never taken for "never saved"); or the brain
 * refused a save (401 or 403), for the rest of the visit, without a toast.
 * Null until the shell names the login and the desk has been read, which
 * only happens after hydration, so the server and the first client render
 * agree. Blocked or junk storage falls back to the default.
 */
export function useDeskPrefs(loginId: string | null, kinds: readonly TreeKind[] | null) {
  const qc = useQueryClient();
  const toast = useToast();
  const shell = useDeskShell();
  const key = loginId ? deskStorageKey(brain(), loginId) : null;
  // A refusal this visit (this mount or an earlier one): the desk stays local.
  const [refused, setRefused] = useState(false);
  const local = refused || (key !== null && refusedThisVisit.has(key));
  // Null until the shell lands; false on a brain that does not keep the desk
  // for this login this visit.
  const roams = shell.data ? 'homeDesk' in shell.data && !local : null;
  const [prefs, setPrefs] = useState<DeskPrefs | null>(null);
  // The desk as last set, for `update` to build on outside a state updater
  // (a save touches the shell query, which must not happen mid-render).
  const current = useRef<DeskPrefs | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const saverRef = useRef<DeskSaver | null>(null);
  saverRef.current ??= createDeskSaver(sendDesk, {
    onRefused: () => {
      // Keep what the person sees, in this browser, and stop roaming quietly.
      const k = keyRef.current;
      if (k) {
        refusedThisVisit.add(k);
        if (current.current) writeStored(k, JSON.stringify(current.current));
      }
      setRefused(true);
    },
    onFailed: () => toastRef.current.error('Could not save your desk'),
  });
  const saver = saverRef.current;
  const kindsKey = kinds ? kinds.join(',') : null;

  const save = useCallback(
    (desk: DeskPrefs) => {
      // The shell's copy at once: Home opened again this visit starts from it.
      qc.setQueryData<Shell>(['shell'], (d) => (d ? { ...d, homeDesk: desk } : d));
      saver.save(desk);
    },
    [qc, saver],
  );

  // Every way out (leaving Home, the tab hidden or closed, the session
  // ending): what is still waiting is saved now, not dropped.
  useFlushOnLeave(() => saver.flush({ keepalive: true }));

  useEffect(() => {
    if (!key || kindsKey === null || roams === null) return;
    const kindList = kindsKey ? (kindsKey.split(',') as TreeKind[]) : [];
    const stored = readStored(key);
    if (!roams) {
      current.current = parseDesk(stored) ?? defaultDesk(kindList);
      setPrefs(current.current);
      return;
    }
    // Read from the cache, not a dependency: a save writes it, and that must
    // not lay the desk out again.
    const profile = qc.getQueryData<Shell>(['shell'])?.homeDesk ?? null;
    const migratedKey = loginId ? deskMigratedKey(brain(), loginId) : null;
    const migrated = migratedKey ? readStored(migratedKey) !== null : true;
    const { prefs: desk, upload } = roamingDesk(profile, stored, kindList, migrated);
    current.current = desk;
    setPrefs(desk);
    if (upload) {
      // Offered once, whatever the save answers: a stale local desk is never
      // moved up again on a later visit.
      if (migratedKey) writeStored(migratedKey, '1');
      save(desk);
    }
  }, [key, loginId, kindsKey, roams, qc, save]);

  // Back to the window after a long idle, nothing waiting: read the desk
  // again, so one arranged on another device shows before a change here
  // replaces it (the last save wins). Only the desk is taken from the read;
  // one that leaves it out (the brain could not read the row) changes nothing.
  useEffect(() => {
    if (!roams) return;
    const onBack = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!saver.needsRefresh(now)) return;
      saver.synced(now);
      apiFetch<Shell>('/api/shell').then(
        (fresh) => {
          if (!('homeDesk' in fresh) || saver.pending || saver.stopped) return;
          const desk = fresh.homeDesk == null ? null : deskFrom(fresh.homeDesk);
          if (!desk) return;
          qc.setQueryData<Shell>(['shell'], (d) => (d ? { ...d, homeDesk: fresh.homeDesk } : d));
          current.current = desk;
          setPrefs(desk);
        },
        () => {
          // Offline: the desk shown stays; the next return tries again.
        },
      );
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [roams, qc, saver]);

  const update = useCallback(
    (fn: (p: DeskPrefs) => DeskPrefs) => {
      const prev = current.current;
      if (!prev) return;
      const next = fn(prev);
      current.current = next;
      setPrefs(next);
      if (roams) {
        save(next);
        return;
      }
      if (key) writeStored(key, JSON.stringify(next));
    },
    [key, roams, save],
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
