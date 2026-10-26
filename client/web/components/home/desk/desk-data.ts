'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useFlushOnLeave } from '@mantle/web-ui/use-flush-on-leave';
import { useToast } from '@mantle/web-ui/ui/toast';
import { runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { activeSession } from '@mantle/web-ui/session-registry';
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
  deskFromRead,
  deskItemsFor,
  deskRoams,
  deskToWire,
  parseDesk,
  roamingDesk,
  type DeskPrefs,
} from '@/lib/home-desk';
import {
  createDeskSaver,
  moveUpAnswered,
  shellReadIsOld,
  type DeskSaveOutcome,
  type DeskSaver,
} from '@/lib/home-desk-saver';
import { readStored, writeStored } from '@/lib/safe-storage';

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

const MIGRATED_PREFIX = 'mantle_home_desk_migrated_v1:';

/** Set once this browser has moved its local desk up to the login's profile
 *  (per brain and per login, as the desk itself): the move is offered once,
 *  never again on a later visit (lib/home-desk `roamingDesk`). Set only once
 *  the brain answered the move (lib/home-desk-saver `moveUpAnswered`). */
export function deskMigratedKey(brainOrigin: string, loginId: string): string {
  return `${MIGRATED_PREFIX}${encodeURIComponent(brainOrigin)}:${encodeURIComponent(loginId)}`;
}

const SHELL_KEY = ['shell'] as const;

function isShellKey(key: readonly unknown[]): boolean {
  return key.length === 1 && key[0] === 'shell';
}

/** GET /api/shell, as AppShell asks it (the same key: one request). */
function fetchShell(): Promise<Shell> {
  return apiFetch<Shell>('/api/shell');
}

/** Read the shell again now, through the shell query: a read already on its
 *  way (AppShell's own, on focus) is joined, never sent twice. Sent even
 *  offline (`networkMode: 'always'`): the query's default would pause it
 *  until the network came back, and the Desk would wait on it; this way it
 *  fails at once and the desk falls back to the copy in the cache. */
export function readShellNow(qc: QueryClient): Promise<Shell> {
  return qc.fetchQuery({
    queryKey: SHELL_KEY,
    queryFn: fetchShell,
    staleTime: 0,
    networkMode: 'always',
  });
}

/** When the shell was last read from the brain, per query client: set by
 *  `watchShell` on every read that lands, never by a write of our own
 *  (setQueryData bumps `dataUpdatedAt`, so that cannot say how old the
 *  brain's copy is). */
const shellReads = new WeakMap<QueryClient, number>();

/** When the shell was last read from the brain (0: never). Before the
 *  watcher saw a read, the cached read's own time: nothing of ours wrote the
 *  shell before the watcher started. */
export function shellReadAt(qc: QueryClient): number {
  return shellReads.get(qc) ?? qc.getQueryState(SHELL_KEY)?.dataUpdatedAt ?? 0;
}

/** PUT the desk to the login's profile. `keepalive` on the way out, so the
 *  request outlives a closing tab. */
function sendDesk(desk: DeskPrefs, opts: { keepalive: boolean }) {
  return apiFetch<{ homeDesk: unknown }>('/api/profile/home-desk', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ homeDesk: deskToWire(desk) }),
    keepalive: opts.keepalive,
  });
}

/**
 * One login's desk for the visit (until the page reloads), per brain and
 * login (deskStorageKey). Kept outside the component, so leaving the Desk
 * and coming back keeps the saver, the desk on show and what the visit
 * learned.
 */
type DeskVisit = {
  saver: DeskSaver;
  /** The desk on show, or last shown: what this browser believes it is. */
  desk: DeskPrefs | null;
  /** The desk was kept on the profile at some point this visit: it stays
   *  so (lib/home-desk `deskRoams`). */
  roamed: boolean;
  /** The brain refused a save (403): the desk stays in this browser. */
  refused: boolean;
  /** The Desk on screen: show a desk read from the profile; the refusal. */
  view: { show: (desk: DeskPrefs) => void; refused: () => void } | null;
  /** Warn that a save failed (kept after the Desk is left: a save on the
   *  way out can fail too). */
  warn: () => void;
};

const visits = new Map<string, DeskVisit>();
/** The desk the shell's reads are for: the last one opened. */
let activeKey: string | null = null;

function visitFor(key: string, qc: QueryClient): DeskVisit {
  const known = visits.get(key);
  if (known) return known;
  const visit: DeskVisit = {
    saver: createDeskSaver(sendDesk, {
      onRefused: (status) => {
        // 401: the session expired, on its way to sign-in. Nothing is kept
        // in this browser for a login that is signing out.
        if (status === 401) return;
        // 403: keep what the person sees, in this browser, and stop roaming
        // quietly for the rest of the visit.
        visit.refused = true;
        if (visit.desk) writeStored(key, JSON.stringify(deskToWire(visit.desk)));
        visit.view?.refused();
      },
      onFailed: () => visit.warn(),
      // A desk is saved only as the login it was changed as: a switch (or
      // another tab's) between the change and the send drops it.
      session: () => activeSession()?.id ?? null,
      onSaved: (answer, gen) => {
        // The brain's copy of the desk it kept, into the shell; unless a
        // change came since, which the shell already holds.
        if (gen !== visit.saver.gen || visit.saver.pending) return;
        if (!answer || typeof answer !== 'object' || !('homeDesk' in answer)) return;
        const homeDesk = (answer as { homeDesk: Shell['homeDesk'] }).homeDesk;
        qc.setQueryData<Shell>(SHELL_KEY, (d) => (d ? { ...d, homeDesk } : d));
      },
    }),
    desk: null,
    roamed: false,
    refused: false,
    view: null,
    warn: () => {},
  };
  visits.set(key, visit);
  return visit;
}

/** The desk on show, put back into the shell's copy. */
function keepInShell(qc: QueryClient, visit: DeskVisit) {
  if (!visit.desk) return;
  const homeDesk = deskToWire(visit.desk);
  qc.setQueryData<Shell>(SHELL_KEY, (d) => (d ? { ...d, homeDesk } : d));
}

const watched = new WeakSet<QueryClient>();

/**
 * Every read of the shell passes here: the Desk's own, and AppShell's on
 * focus and on its interval. A read that started before the last change, or
 * while a save was on its way (lib/home-desk-saver `readStart`, `readFresh`),
 * would put an older desk in the shell's copy: the desk on show is put back.
 * So is one that leaves the desk out (the brain could not read the row that
 * time). A fresh read with a desk in it (arranged on another device, say)
 * is shown. Once per query client, for the visit.
 */
export function watchShell(qc: QueryClient) {
  if (watched.has(qc)) return;
  watched.add(qc);
  const first = qc.getQueryState(SHELL_KEY);
  if (first?.dataUpdatedAt) shellReads.set(qc, first.dataUpdatedAt);
  let token: number | null = null;
  qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !isShellKey(event.query.queryKey)) return;
    const { action } = event;
    // `manual`: a write of our own (setQueryData), not a read.
    const landed = action.type === 'success' && !action.manual;
    if (landed) shellReads.set(qc, event.query.state.dataUpdatedAt);
    const visit = activeKey ? visits.get(activeKey) : undefined;
    if (!visit) return;
    if (action.type === 'fetch') {
      token = visit.saver.readStart();
      return;
    }
    if (!landed) return;
    if (!visit.roamed || visit.refused) return;
    const fresh = event.query.state.data as Shell | undefined;
    if (!fresh) return;
    if (!visit.saver.readFresh(token) || !('homeDesk' in fresh)) {
      keepInShell(qc, visit);
      return;
    }
    const read = deskFromRead(fresh);
    if (read === 'keep') return;
    visit.desk = read.show;
    visit.view?.show(read.show);
  });
}

/**
 * The login's desk, and the two ways to change it.
 *
 * Kept on the LOGIN's profile (PUT /api/profile/home-desk, read back in GET
 * /api/shell as `homeDesk`), so the Desk follows the login to another
 * browser, another machine and the desktop app, as nav favourites do. A
 * change shows at once and is saved a moment later (lib/home-desk-saver:
 * the debounce, one save at a time, the flush and the failures); leaving the
 * Desk, hiding the tab or closing it saves what is still waiting. The first
 * visit to a brain that keeps the desk moves a desk this browser kept before
 * up to an empty profile, once per brain and login (lib/home-desk
 * `roamingDesk`, the migrated flag), and only after reading the shell again
 * first, so a stale "no desk" never sends an old desk over a newer one.
 *
 * A save replaces the whole desk, so the last save wins across devices.
 * Opening the Desk on a shell read more than DESK_REFRESH_AFTER_MS ago, or
 * coming back to the window after that long with nothing waiting, reads the
 * desk again first, so a desk arranged on another device is shown before
 * this one can overwrite it. A read that started before a change here is
 * dropped (`watchShell`).
 *
 * The desk stays in this browser's storage, per brain and per login, as it
 * was before it roamed, when: the brain is on an older release (no
 * `homeDesk` in the shell); the brain could not read the login's row on the
 * first read this visit (`homeDesk` left out, never taken for "never
 * saved"); or the brain refused a save (403), for the rest of the visit,
 * without a toast. Once the desk roamed this visit it keeps roaming: a later
 * read that leaves it out keeps the desk on show. Null until the shell names
 * the login and the desk has been read, which only happens after hydration,
 * so the server and the first client render agree. Blocked or junk storage
 * falls back to the default.
 */
export function useDeskPrefs(loginId: string | null, kinds: readonly TreeKind[] | null) {
  const qc = useQueryClient();
  const toast = useToast();
  const shell = useDeskShell();
  const key = loginId ? deskStorageKey(brain(), loginId) : null;
  const visit = key && typeof window !== 'undefined' ? visitFor(key, qc) : null;
  // A refusal this visit (this mount or an earlier one): the desk stays local.
  const [refused, setRefused] = useState(false);
  const local = refused || (visit?.refused ?? false);
  // Null until the shell lands; false on a brain that does not keep the desk
  // for this login this visit.
  const roams =
    shell.data && visit ? deskRoams('homeDesk' in shell.data, visit.roamed, local) : null;
  const [prefs, setPrefs] = useState<DeskPrefs | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const kindsKey = kinds ? kinds.join(',') : null;

  useEffect(() => {
    if (!visit || !key) return;
    activeKey = key;
    watchShell(qc);
    visit.view = { show: setPrefs, refused: () => setRefused(true) };
    visit.warn = () => toastRef.current.error('Could not save your desk');
    return () => {
      visit.view = null;
    };
  }, [visit, key, qc]);

  const save = useCallback(
    (desk: DeskPrefs, onSettled?: (outcome: DeskSaveOutcome) => void) => {
      if (!visit) return;
      // The shell's copy at once: the Desk opened again this visit starts
      // from it.
      visit.desk = desk;
      keepInShell(qc, visit);
      visit.saver.save(desk, onSettled);
    },
    [qc, visit],
  );

  // Every way out (leaving the Desk, the tab hidden or closed, the session
  // ending): what is still waiting is saved now, not dropped. The promise
  // lets a session switch wait for the save before the login changes.
  useFlushOnLeave(() => visit?.saver.flush({ keepalive: true }));

  useEffect(() => {
    if (!key || !visit || !loginId || kindsKey === null || roams === null) return;
    const kindList = kindsKey ? (kindsKey.split(',') as TreeKind[]) : [];
    const show = (desk: DeskPrefs) => {
      visit.desk = desk;
      setPrefs(desk);
    };
    if (!roams) {
      show(parseDesk(readStored(key)) ?? defaultDesk(kindList));
      return;
    }
    visit.roamed = true;
    const migratedKey = deskMigratedKey(brain(), loginId);
    // Read from the cache, not a dependency: a save writes it, and that must
    // not lay the desk out again.
    const plan = () => {
      const cached = qc.getQueryData<Shell>(SHELL_KEY);
      if (!cached || !('homeDesk' in cached)) {
        // The read left the desk out: the desk on show stays, never this
        // browser's old copy.
        return { prefs: visit.desk ?? defaultDesk(kindList), upload: false };
      }
      const migrated = readStored(migratedKey) !== null;
      return roamingDesk(cached.homeDesk, readStored(key), kindList, migrated);
    };
    const moveUp = (desk: DeskPrefs) => {
      // Offered once: marked done when the brain answered it (saved, or
      // refused for good), so an outage retries on a later visit and a
      // stale local desk is never moved up again after that.
      save(desk, ({ status }) => {
        if (moveUpAnswered(status)) writeStored(migratedKey, '1');
      });
      visit.saver.flush();
    };
    const first = plan();
    const readAt = shellReadAt(qc);
    if (!first.upload && !shellReadIsOld(readAt, Date.now())) {
      show(first.prefs);
      return;
    }
    // An old read, or a move-up: read the shell again first.
    let cancelled = false;
    const startGen = visit.saver.gen;
    const begin = (read: boolean) => {
      if (cancelled) return;
      const { prefs: desk, upload } = plan();
      show(desk);
      // No move-up on a failed read, nor once a change was made meanwhile.
      if (upload && read && visit.saver.gen === startGen) moveUp(desk);
    };
    readShellNow(qc).then(
      () => begin(true),
      () => begin(false),
    );
    return () => {
      cancelled = true;
    };
  }, [key, visit, loginId, kindsKey, roams, qc, save]);

  // Back to the window after a long idle, nothing waiting: read the desk
  // again, so one arranged on another device shows before a change here
  // replaces it (the last save wins). Through the shell query (`watchShell`
  // shows it, or drops it when a change came since).
  useEffect(() => {
    if (!roams || !visit) return;
    const onBack = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!visit.saver.needsRefresh(now)) return;
      visit.saver.synced(now);
      readShellNow(qc).catch(() => {
        // Offline: the desk shown stays; the next return tries again.
      });
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [roams, qc, visit]);

  const update = useCallback(
    (fn: (p: DeskPrefs) => DeskPrefs) => {
      const prev = visit?.desk;
      if (!visit || !prev) return;
      const next = fn(prev);
      visit.desk = next;
      setPrefs(next);
      if (roams) {
        save(next);
        return;
      }
      if (key) writeStored(key, JSON.stringify(deskToWire(next)));
    },
    [key, roams, save, visit],
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
