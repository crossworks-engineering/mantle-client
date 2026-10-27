'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
import type { HomeDeskPutBody, HomeDeskState, Shell } from '@mantle/client-types';
import { fetchFolderPage, fetchMarks, folderKey, marksKey } from '@/components/item-tree/tree-api';
import { treeKindsOf } from '@/components/item-tree/use-tree-kinds';
import {
  DESK_KINDS,
  defaultDesk,
  deskFrom,
  deskItemsFor,
  deskToWire,
  parseDesk,
  type DeskPrefs,
} from '@/lib/home-desk';
import { createDeskSaver, statusOf, type DeskSaver } from '@/lib/home-desk-saver';
import { forgetStored, readStored, writeStored } from '@/lib/safe-storage';

/**
 * The desk's data: the login it belongs to, where it is kept, and what each
 * widget lists. Every list rides the item tree's own queries (same keys), so
 * a pin or an edit anywhere in the app refreshes the desk and the tree
 * together.
 */

/** The shell AppShell already fetched (same key, never a second request):
 *  the login and the kinds it is served. */
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
 *  another's, and the same person keeps a desk per brain. The desk's query
 *  key, and its localStorage key on a brain before the desk's route. */
export function deskStorageKey(brainOrigin: string, loginId: string): string {
  return `${PREFIX}${encodeURIComponent(brainOrigin)}:${encodeURIComponent(loginId)}`;
}

export function deskQueryKey(storageKey: string) {
  return ['home-desk', storageKey] as const;
}

/**
 * What GET /api/profile/home-desk said: the stored desk and its version, or
 * `local` on a brain from before the route (404, or 405 from a build that
 * had only the PUT): the desk is kept in this browser's storage there, per
 * brain and login, and nothing is sent.
 */
export type DeskRead = { local: false; state: HomeDeskState } | { local: true };

/** Read the desk. A read older than a save that landed meanwhile is the
 *  saver's to refuse (`DeskSaver.read`). */
export async function readDesk(): Promise<DeskRead> {
  try {
    return { local: false, state: await apiFetch<HomeDeskState>('/api/profile/home-desk') };
  } catch (err) {
    const status = statusOf(err);
    if (status === 404 || status === 405) return { local: true };
    throw err;
  }
}

/**
 * The desk a release before desk saving v2 kept in this browser only (v0.8.2:
 * localStorage, under this desk's own key), carried up ONCE into a profile
 * that has never had one (`homeDesk` null, version 0). Null otherwise: a
 * desk on the profile, saved from anywhere, always wins.
 */
export function carriedDesk(state: HomeDeskState, stored: string | null): DeskPrefs | null {
  return state.homeDesk === null && state.version === 0 ? parseDesk(stored) : null;
}

/** keepalive caps a request body at 64 KB (all in flight together); a
 *  desk is at most 32 KB, so this only guards a desk the brain would
 *  refuse anyway. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

/**
 * PUT the desk. Always with keepalive (the body is small), so a save on its
 * way when the page goes still reaches the brain. A desk named for another
 * login (the login in use changed in another tab) is the brain's 403
 * `login-mismatch`: the saver stops, and nobody is signed out.
 */
export function putDesk(body: HomeDeskPutBody): Promise<HomeDeskState> {
  const text = JSON.stringify(body);
  return apiFetch<HomeDeskState>('/api/profile/home-desk', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: text,
    keepalive: new TextEncoder().encode(text).length <= KEEPALIVE_MAX_BYTES,
  });
}

/**
 * Carry the desk this browser kept before desk saving v2 up into the
 * profile (carriedDesk): saved now, from version 0. This browser's copy is
 * forgotten once the save settles, unless it waits to go again (it failed on
 * the way) or the saver stopped: so a desk the brain refuses (a 400, a 413)
 * is not sent again on every visit.
 */
export async function carryUp(saver: DeskSaver, desk: DeskPrefs, forget: () => void) {
  saver.save(desk);
  await saver.flush();
  if (!saver.busy && !saver.stopped) forget();
}

/** The quiet toast for a desk saved as another login, once a page. */
let stoppedShown = false;

/** The saver of one login's desk, for the page's life (until it reloads),
 *  and what it tells the Desk on screen. */
type DeskSaving = {
  saver: DeskSaver;
  conflict: () => void;
  failed: () => void;
  stopped: () => void;
};

const savings = new Map<string, DeskSaving>();

/**
 * One saver per brain and login, kept outside the component: leaving the
 * Desk and coming back keeps one save in flight at a time and the version
 * it saved. What the brain answered goes into the desk's own query. Each
 * save names the login the desk belongs to; the brain refuses it for any
 * other (a 403: the saver stops), so a desk changed here after the login in
 * use changed in another tab is never saved over that login's.
 */
function savingFor(storageKey: string, loginId: string, qc: QueryClient): DeskSaving {
  const known = savings.get(storageKey);
  if (known) return known;
  const queryKey = deskQueryKey(storageKey);
  const keep = (state: HomeDeskState) => {
    const read: DeskRead = { local: false, state };
    qc.setQueryData<DeskRead>(queryKey, read);
    // The profile holds a desk now: this browser's copy from before desk
    // saving v2, if any, is retired (carriedDesk).
    forgetStored(storageKey);
  };
  const saving: DeskSaving = {
    saver: createDeskSaver(
      (desk, version) =>
        putDesk({ homeDesk: deskToWire(desk) as HomeDeskPutBody['homeDesk'], version, loginId }),
      {
        onSaved: keep,
        onConflict: (state) => {
          keep(state);
          saving.conflict();
        },
        onFailed: () => saving.failed(),
        onStopped: (status) => {
          if (status !== 403 || stoppedShown) return;
          stoppedShown = true;
          saving.stopped();
        },
      },
    ),
    conflict: () => {},
    failed: () => {},
    stopped: () => {},
  };
  savings.set(storageKey, saving);
  return saving;
}

/**
 * The login's desk, and the two ways to change it.
 *
 * Kept on the LOGIN's profile (GET and PUT /api/profile/home-desk), so the
 * Desk follows the login to another browser, another machine and the
 * desktop app, as nav favourites do. Read when the Desk opens and again when
 * the window comes back (its own query, refetched on focus): a desk arranged
 * on another device shows when nothing here is waiting to be saved. A
 * change shows at once and is saved a moment later, compare-and-set on the
 * version last read or saved (lib/home-desk-saver); leaving the Desk, hiding
 * the tab or closing it saves what is still waiting. When another device
 * saved first, its desk is shown and one quiet toast says so. A save that
 * fails keeps its desk and goes again with the next change or on the
 * way out. A profile that never had a desk takes the one this browser kept
 * before desk saving v2, once (carriedDesk).
 *
 * On a brain from before the desk's route the desk stays in this browser's
 * storage, per brain and per login. Null until the shell names the login
 * and the desk has been read, which only happens after hydration, so the
 * server and the first client render agree. A read that fails shows the
 * default desk, saved nowhere until a read lands.
 */
export function useDeskPrefs(loginId: string | null, kinds: readonly TreeKind[] | null) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = loginId ? deskStorageKey(brain(), loginId) : null;
  const read = useQuery({
    queryKey: deskQueryKey(key ?? ''),
    queryFn: readDesk,
    enabled: key !== null,
    staleTime: 0,
    // This query only (the app's default is off): coming back to the window
    // shows a desk arranged on another device meanwhile.
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const saving =
    key && loginId && typeof window !== 'undefined' ? savingFor(key, loginId, qc) : null;
  const [prefs, setPrefs] = useState<DeskPrefs | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const kindsKey = kinds ? kinds.join(',') : null;

  useEffect(() => {
    if (!saving) return;
    // Kept after the Desk is left: a save on the way out can lose or fail too.
    saving.conflict = () => toastRef.current.info('Your Desk changed on another device');
    saving.failed = () => toastRef.current.error('Could not save your desk');
    saving.stopped = () =>
      toastRef.current.info('Your Desk is no longer saved here: another login is in use');
  }, [saving]);

  const show = useCallback((desk: DeskPrefs) => {
    prefsRef.current = desk;
    setPrefs(desk);
  }, []);

  useEffect(() => {
    if (!key || !saving || kindsKey === null) return;
    const kindList = kindsKey ? (kindsKey.split(',') as TreeKind[]) : [];
    const data = read.data;
    const first = prefsRef.current === null;
    if (!data) {
      if (read.isError && first) show(defaultDesk(kindList));
      return;
    }
    if (data.local) {
      if (first) show(parseDesk(readStored(key)) ?? defaultDesk(kindList));
      return;
    }
    // A read is shown only when the saver has nothing on its way and the
    // read is not older than it. Else the first paint (the Desk opened
    // again) shows the desk the saver holds: a change still on its way, or
    // kept from a save that failed, is never replaced by the brain's older
    // one.
    if (!saving.saver.read(data.state)) {
      if (first) {
        show(saving.saver.latest ?? deskFrom(data.state.homeDesk) ?? defaultDesk(kindList));
      }
      return;
    }
    // A profile that never had a desk takes the one this browser kept
    // before desk saving v2, once: shown, and saved from version 0 (carryUp).
    const carried = first ? carriedDesk(data.state, readStored(key)) : null;
    show(carried ?? deskFrom(data.state.homeDesk) ?? defaultDesk(kindList));
    if (carried) void carryUp(saving.saver, carried, () => forgetStored(key));
  }, [key, saving, kindsKey, read.data, read.isError, show]);

  // Every way out (leaving the Desk, the tab hidden or closed, the session
  // ending): what is still waiting is saved now, not dropped. The promise
  // lets a session switch wait for the save before the login changes.
  useFlushOnLeave(() => saving?.saver.flush());

  const update = useCallback(
    (fn: (p: DeskPrefs) => DeskPrefs) => {
      const prev = prefsRef.current;
      if (!prev || !key) return;
      const next = fn(prev);
      show(next);
      const data = qc.getQueryData<DeskRead>(deskQueryKey(key));
      if (data?.local) writeStored(key, JSON.stringify(deskToWire(next)));
      else if (data) saving?.saver.save(next);
    },
    [key, qc, saving, show],
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
  // Never `custom` (every kind's first sort since the contract named it):
  // the newest are asked of a brain that may not serve it.
  const sorts = TREE_KIND_SPECS[kind].sorts.filter((s) => s !== 'custom');
  const sort = sorts.includes('updated') ? 'updated' : (sorts[0] ?? 'name');
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
