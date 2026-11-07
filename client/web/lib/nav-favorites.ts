'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { NavGroup, NavItem } from '@mantle/web-ui/layout/nav-items';
import { activeSession } from '@mantle/web-ui/session-registry';
import { NAV_FAVORITES_MAX, type AppTint } from '@mantle/client-types/app-nav';
import type { TreeKind } from '@mantle/web-ui/types/tree';
import { deskItemHref } from '@/lib/home-desk';

/**
 * The destinations this login has starred: the sidebar's Favorites tab (the
 * Favorites group at the top of the list for a login with no tabs).
 *
 * An entry is a screen's href (`/settings/agents`), or `/n/<id>` for a
 * workspace item (an app, a page, a canvas, a file...). `/n/<id>` is the one
 * link that opens any item for any login, and it outlives a screen's URL
 * changing. The brain says what the rail shows for each item it may open now
 * (`navFavoriteItems`: title, icon, colour); an item entry it leaves out (the
 * item deleted, or no longer read) is hidden, and goes at the next save.
 *
 * Stored on the LOGIN's profile (PUT /api/profile/nav-favorites, read back in
 * GET /api/shell as `navFavorites`), so favourites follow the person to
 * another browser, another machine and the desktop app. They used to live in
 * this browser's localStorage only; the first load against a brain that
 * stores them moves that list up once (see `useNavFavorites`).
 *
 * A brain on an older release doesn't send `navFavorites` at all. Against one
 * of those this falls back to localStorage exactly as before, which is why the
 * storage half below is still here.
 *
 * ── Why this one is LIVE ──────────────────────────────────────────────────
 * The nav's old usage ranking deliberately froze per mount, because a menu that
 * reorders under the cursor moves the row you were aiming at. (That ranking is
 * gone — it fed the group fold, which Jason removed.) The reasoning does not
 * transfer here, and copying it would be a bug: starring is a DELIBERATE act,
 * and the whole feedback for it is the row appearing under Favorites. So a star
 * fills and the group updates in the same frame (optimistically, then saved).
 */
const KEY = 'mantle_nav_favorites_v1';

/** Set once this browser's local list has been moved to the server. */
const MIGRATED_KEY = 'mantle_nav_favorites_migrated_v1';

/**
 * The LOCAL list (a brain from before favourites were saved to the profile)
 * belongs to the LOGIN, now that a device can hold several: two people sharing
 * a browser should not curate each other's sidebar. `scope` is the active
 * session's id; without one (a cookie sign-in from before sessions, or a test)
 * the list is the browser-wide one it always was. On a brain that saves them to
 * the profile, favourites are the login's there and this does not apply.
 *
 * Nobody's stars are lost to this. A login with no list of its own yet reads
 * the browser-wide one, and its first toggle writes that inherited list, plus
 * the change, under its own key. The browser-wide list is never deleted: it is
 * what the next login added to this device starts from.
 */
function keyFor(scope?: string | null): string {
  return scope ? `${KEY}:${scope}` : KEY;
}

/** Same-tab notification. `storage` only fires in OTHER tabs, so a click would
 *  update localStorage and leave the star in this one unfilled until reload. */
const EVENT = 'mantle:nav-favorites';

/** Just enough of the Storage interface to be faked in a test. The pure half of
 *  this module takes one, so the rules below can be pinned without a DOM. */
export type FavoritesStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The starred hrefs, tolerating anything that is not the shape we wrote.
 *
 * Junk is not hypothetical: this key is user-writable, survives every release,
 * and a throw here would take the whole sidebar down rather than lose a
 * convenience. Non-strings are dropped individually so ONE bad entry cannot
 * discard a list the owner curated.
 */
export function readFavorites(store: FavoritesStore, scope?: string | null): string[] {
  try {
    const raw = store.getItem(keyFor(scope)) ?? (scope ? store.getItem(KEY) : null);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Add or remove one href, returning the new list.
 *
 * New stars APPEND. Ordering by anything cleverer — most used, alphabetical —
 * would move rows the owner placed deliberately, and the point of pinning is
 * that the row stays where it was put.
 */
export function toggleFavoriteIn(
  store: FavoritesStore,
  href: string,
  scope?: string | null,
): string[] {
  const next = toggledList(readFavorites(store, scope), href);
  writeFavoritesIn(store, next, scope);
  return next;
}

/** Store a whole list (a move, on a brain from before the profile kept it). */
export function writeFavoritesIn(
  store: FavoritesStore,
  list: readonly string[],
  scope?: string | null,
): void {
  try {
    store.setItem(keyFor(scope), JSON.stringify(list));
  } catch {
    /* quota / private mode: the list just won't persist */
  }
}

/**
 * The starred hrefs resolved against the nav list actually being rendered.
 *
 * Resolving rather than storing the items is what keeps a star on a
 * since-retired screen from becoming a permanently-404ing row at the top of the
 * sidebar: the href outlives the route it names, so an href with no live item
 * simply drops out.
 *
 * Favorites is a VIEW, not a place items move to — a starred screen keeps its
 * home row too, exactly as pinning works elsewhere.
 */
export function favoriteItems<I extends NavItem>(
  favorites: string[],
  groups: Array<{ items: I[] }>,
): I[] {
  const byHref = new Map(groups.flatMap((g) => g.items).map((i) => [i.href, i]));
  return favorites.map((href) => byHref.get(href)).filter((i): i is I => i !== undefined);
}

/** Narrowing helper so callers can build the group without repeating the type. */
export type FavoritesGroup = Pick<NavGroup, 'label' | 'items'>;

/** Toggle one href in a list (pure; new stars append, see toggleFavoriteIn). */
export function toggledList(list: readonly string[], href: string): string[] {
  return list.includes(href) ? list.filter((h) => h !== href) : [...list, href];
}

/** One favorite workspace item, as the brain's shell sends it. */
export type NavFavoriteItem = {
  /** The stored entry: `/n/<id>`. */
  href: string;
  id: string;
  kind: TreeKind;
  title: string;
  icon: string | null;
  color: AppTint | null;
};

/** The entry an item is stored as. */
export const itemFavoriteHref = (id: string): string => `/n/${id}`;

const isItemEntry = (href: string) => href.startsWith('/n/');

/** Where a favorite item's row goes: its screen, or for a file (whose
 *  address needs its folder) the `/n/` link, which finds it. */
export function favoriteItemHref(item: Pick<NavFavoriteItem, 'kind' | 'id' | 'href'>): string {
  return deskItemHref(item.kind, item.id) ?? item.href;
}

/** One row of the Favorites group: a screen of the nav, or an item. */
export type FavoriteEntry<I extends NavItem> =
  | { entry: string; nav: I; item?: undefined }
  | { entry: string; item: NavFavoriteItem; nav?: undefined };

/**
 * The favorites in the login's order, each resolved: a screen against the
 * nav list being rendered (favoriteItems), an item against what the brain
 * sent. An entry that resolves to neither is left out.
 */
export function favoriteEntries<I extends NavItem>(
  favorites: readonly string[],
  groups: Array<{ items: I[] }>,
  items: readonly NavFavoriteItem[],
): FavoriteEntry<I>[] {
  const byHref = new Map(groups.flatMap((g) => g.items).map((i) => [i.href, i]));
  const itemByHref = new Map(items.map((i) => [i.href, i]));
  const out: FavoriteEntry<I>[] = [];
  for (const entry of favorites) {
    const item = itemByHref.get(entry);
    if (item) {
      out.push({ entry, item });
      continue;
    }
    const nav = byHref.get(entry);
    if (nav) out.push({ entry, nav });
  }
  return out;
}

/**
 * The list without the item entries the brain did not send (the item is
 * deleted, or the login no longer reads it). Applied on every save, so a
 * hidden entry does not hold one of the 40 places for long. `items`
 * undefined: a brain that resolves no items, where nothing is dropped.
 * A screen's href is never dropped here: a row can hide for a while (Chats
 * on a brain before the messenger) and come back.
 */
export function pruned(
  list: readonly string[],
  items: readonly NavFavoriteItem[] | undefined,
): string[] {
  if (!items) return [...list];
  const live = new Set(items.map((i) => i.href));
  return list.filter((h) => !isItemEntry(h) || live.has(h));
}

/** The list with the entry at `from` moved to index `to`. An index outside
 *  the list (an entry not in it) changes nothing. */
export function moved(list: readonly string[], from: number, to: number): string[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

/** What a full list says when one more is added. */
export const FAVORITES_FULL = `You have ${NAV_FAVORITES_MAX} favorites. Remove one first.`;

type ShellFavorites = { navFavorites?: string[]; navFavoriteItems?: NavFavoriteItem[] };

/**
 * The list, and what changes it.
 *
 * Reads the shell query AppShell already runs (same key, so no second
 * request). Until it lands the list is EMPTY, the honest shared state for the
 * first paint; the server has no localStorage and the shell has no data yet.
 *
 * `itemsSupported`: the brain resolves item entries (sends
 * `navFavoriteItems`). Only then is an item offered a favorite.
 */
export function useNavFavorites(): {
  favorites: string[];
  items: NavFavoriteItem[];
  itemsSupported: boolean;
  isFavorite: (href: string) => boolean;
  /** Add or remove one entry. `item`: the look of an item being added, so
   *  its row shows at once, before the brain answers. */
  toggleFavorite: (href: string, item?: NavFavoriteItem) => void;
  /** Move `entry` to where `to` is now (both stored entries). */
  moveFavorite: (entry: string, to: string) => void;
} {
  const qc = useQueryClient();
  const toast = useToast();
  const shell = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<ShellFavorites>('/api/shell'),
    staleTime: Infinity,
    // Same rule as the shell's own observer of this query: retry once.
    retry: 1,
    select: (d: ShellFavorites) => ({ list: d.navFavorites, items: d.navFavoriteItems }),
  });
  const loaded = shell.isSuccess;
  const server = shell.data?.list; // undefined once loaded ⇒ a brain that predates this
  const serverItems = shell.data?.items;
  const legacy = loaded && server === undefined;

  // Legacy path: this browser's localStorage, live across tabs, as before.
  const [local, setLocal] = useState<string[]>([]);
  useEffect(() => {
    if (!legacy) return;
    const sync = () => setLocal(readFavorites(window.localStorage, activeSession()?.id));
    sync();
    // Both: `storage` for other tabs, the custom event for this one.
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, [legacy]);

  const save = useCallback(
    async (next: string[], prev: string[], nextItems?: NavFavoriteItem[]) => {
      const before = qc.getQueryData<ShellFavorites>(['shell'])?.navFavoriteItems;
      qc.setQueryData<ShellFavorites>(['shell'], (d) =>
        d ? { ...d, navFavorites: next, ...(nextItems ? { navFavoriteItems: nextItems } : {}) } : d,
      );
      try {
        const res = await apiSend<{ navFavorites: string[]; navFavoriteItems?: NavFavoriteItem[] }>(
          '/api/profile/nav-favorites',
          'PUT',
          { navFavorites: next },
        );
        qc.setQueryData<ShellFavorites>(['shell'], (d) =>
          d
            ? {
                ...d,
                navFavorites: res.navFavorites,
                ...(res.navFavoriteItems ? { navFavoriteItems: res.navFavoriteItems } : {}),
              }
            : d,
        );
      } catch {
        qc.setQueryData<ShellFavorites>(['shell'], (d) =>
          d ? { ...d, navFavorites: prev, navFavoriteItems: before } : d,
        );
        toast.error('Could not save your favorites');
      }
    },
    [qc, toast],
  );

  // One-time move of a pre-sync local list up to the profile. Only into an
  // EMPTY server list: if this login already has favourites (starred on
  // another device), those win and the stale local copy is just retired.
  useEffect(() => {
    if (!loaded || server === undefined) return;
    try {
      if (window.localStorage.getItem(MIGRATED_KEY)) return;
      const localList = readFavorites(window.localStorage, activeSession()?.id);
      window.localStorage.setItem(MIGRATED_KEY, '1');
      if (localList.length > 0 && server.length === 0) void save(localList, server);
    } catch {
      /* private mode: nothing stored locally to move */
    }
  }, [loaded, server, save]);

  const favorites = useMemo(() => (legacy ? local : (server ?? [])), [legacy, local, server]);
  const items = useMemo(() => serverItems ?? [], [serverItems]);

  const toggleFavorite = useCallback(
    (href: string, item?: NavFavoriteItem) => {
      const adding = !favorites.includes(href);
      if (legacy) {
        if (adding && favorites.length >= NAV_FAVORITES_MAX) return toast.error(FAVORITES_FULL);
        setLocal(toggleFavoriteIn(window.localStorage, href, activeSession()?.id));
        window.dispatchEvent(new CustomEvent(EVENT));
        return;
      }
      if (server === undefined) return; // not loaded yet
      const base = pruned(server, serverItems);
      if (adding && base.length >= NAV_FAVORITES_MAX) return toast.error(FAVORITES_FULL);
      const next = toggledList(base, href);
      const nextItems =
        serverItems && item && adding
          ? [...serverItems.filter((i) => i.href !== href), item]
          : undefined;
      void save(next, server, nextItems);
    },
    [favorites, legacy, server, serverItems, save, toast],
  );

  const moveFavorite = useCallback(
    (entry: string, to: string) => {
      // By entry, not by row: a hidden entry between two rows must not shift
      // the move by one.
      const at = (list: readonly string[]) => [list.indexOf(entry), list.indexOf(to)] as const;
      if (legacy) {
        const next = moved(local, ...at(local));
        writeFavoritesIn(window.localStorage, next, activeSession()?.id);
        setLocal(next);
        window.dispatchEvent(new CustomEvent(EVENT));
        return;
      }
      if (server === undefined) return;
      void save(pruned(moved(server, ...at(server)), serverItems), server);
    },
    [legacy, local, server, serverItems, save],
  );

  const isFavorite = useCallback((href: string) => favorites.includes(href), [favorites]);

  return {
    favorites,
    items,
    itemsSupported: serverItems !== undefined,
    isFavorite,
    toggleFavorite,
    moveFavorite,
  };
}
