import { describe, expect, it } from 'vitest';
import { Bot, Palette, User, type LucideIcon } from 'lucide-react';
import type { NavGroup } from '@mantle/web-ui/layout/nav-items';
import {
  favoriteEntries,
  favoriteItemHref,
  favoriteItems,
  itemFavoriteHref,
  moved,
  pruned,
  readFavorites,
  toggleFavoriteIn,
  type FavoritesStore,
  type NavFavoriteItem,
} from './nav-favorites';
import { activeNavHref } from './nav-active';

/**
 * Favourites is a list of strings and a star, so almost nothing here is the
 * kind of mistake types catch — but three ARE the kind the user sees at once:
 * the list does not survive a reload, a star on a deleted screen becomes a
 * permanently-broken row, or the pinned row and its home row disagree about
 * being the current page.
 *
 * The hook itself is not tested: it is `useState` around these functions, the
 * suite runs in `node` with no DOM, and adding a React testing dependency to
 * assert that a `useEffect` calls `readFavorites` would test React.
 */

const icon = Bot as LucideIcon;
const KEY = 'mantle_nav_favorites_v1';

/** A localStorage stand-in — the whole reason the pure half takes a store. */
function fakeStore(seed?: string): FavoritesStore & { raw: () => string | null } {
  let value: string | null = seed ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    raw: () => value,
  };
}

describe('readFavorites', () => {
  it('reads what was written', () => {
    expect(readFavorites(fakeStore(JSON.stringify(['/pages', '/tasks'])))).toEqual([
      '/pages',
      '/tasks',
    ]);
  });

  it('returns empty when nothing is stored', () => {
    expect(readFavorites(fakeStore())).toEqual([]);
  });

  it('survives junk rather than throwing', () => {
    // The key is user-writable and outlives every release. A throw here takes
    // the sidebar down to protect a convenience.
    expect(readFavorites(fakeStore('{ not json'))).toEqual([]);
  });

  it('ignores a stored value that is not an array', () => {
    expect(readFavorites(fakeStore(JSON.stringify({ pages: true })))).toEqual([]);
  });

  it('drops non-strings individually, so one bad entry cannot discard the list', () => {
    expect(readFavorites(fakeStore(JSON.stringify(['/pages', 42, null, '/tasks'])))).toEqual([
      '/pages',
      '/tasks',
    ]);
  });
});

describe('toggleFavoriteIn', () => {
  it('adds, then removes, and persists both times', () => {
    const store = fakeStore();
    expect(toggleFavoriteIn(store, '/pages')).toEqual(['/pages']);
    expect(JSON.parse(store.raw()!)).toEqual(['/pages']);
    expect(toggleFavoriteIn(store, '/pages')).toEqual([]);
    expect(JSON.parse(store.raw()!)).toEqual([]);
  });

  it('appends, so a row stays where it was put', () => {
    // Any cleverer order — alphabetical, most-used — would move rows the owner
    // placed by hand, which is the one thing pinning promises not to do.
    const store = fakeStore();
    toggleFavoriteIn(store, '/tasks');
    toggleFavoriteIn(store, '/pages');
    toggleFavoriteIn(store, '/files');
    expect(readFavorites(store)).toEqual(['/tasks', '/pages', '/files']);
  });

  it('removes from the middle without disturbing the rest', () => {
    const store = fakeStore(JSON.stringify(['/a', '/b', '/c']));
    expect(toggleFavoriteIn(store, '/b')).toEqual(['/a', '/c']);
  });

  it('writes under the documented key', () => {
    // Pinned because changing it silently empties every existing owner's list.
    const store = fakeStore();
    let writtenKey = '';
    toggleFavoriteIn(
      {
        getItem: store.getItem,
        setItem: (k: string) => {
          writtenKey = k;
        },
      },
      '/pages',
    );
    expect(writtenKey).toBe(KEY);
  });
});

const GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { name: 'Pages', href: '/pages', icon },
      { name: 'Tasks', href: '/tasks', icon: Palette as LucideIcon },
    ],
  },
  {
    label: 'Settings',
    items: [{ name: 'Appearance', href: '/settings/appearance', icon: User as LucideIcon }],
  },
];

describe('favoriteItems', () => {
  it('keeps the owner’s order, not sidebar order', () => {
    expect(favoriteItems(['/tasks', '/pages'], GROUPS).map((i) => i.name)).toEqual([
      'Tasks',
      'Pages',
    ]);
  });

  it('silently drops a star on a screen that no longer exists', () => {
    // Stars are keyed by href and outlive the routes they name. Rendering one
    // anyway puts a permanently-404ing row at the top of the sidebar, with
    // nothing on it to explain what it was.
    expect(favoriteItems(['/pages', '/retired'], GROUPS).map((i) => i.name)).toEqual(['Pages']);
  });

  it('carries the real item, so the pinned row shows the same name and icon', () => {
    const pinned = favoriteItems(['/settings/appearance'], GROUPS);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.name).toBe('Appearance');
    expect(pinned[0]!.icon).toBe(User);
  });

  it('is empty when nothing is starred, so the group is not rendered at all', () => {
    expect(favoriteItems([], GROUPS)).toEqual([]);
  });
});

describe('the pinned row and its home row', () => {
  it('light together', () => {
    // The same href now appears twice. Both matching is intended: it is one
    // destination, and a dark pinned row beside a lit twin reads as a
    // different place.
    const withFavorites: NavGroup[] = [
      { label: 'Favorites', items: favoriteItems(['/settings/appearance'], GROUPS) },
      ...GROUPS,
    ];
    expect(activeNavHref(withFavorites, '/settings/appearance')).toBe('/settings/appearance');
  });

  it('still resolves most-specific-wins with a favourite in play', () => {
    const groups: NavGroup[] = [
      { label: 'Favorites', items: [{ name: 'Settings', href: '/settings', icon }] },
      { label: 'Settings', items: [{ name: 'Appearance', href: '/settings/appearance', icon }] },
    ];
    expect(activeNavHref(groups, '/settings/appearance')).toBe('/settings/appearance');
  });
});

describe('favourites per login', () => {
  /** Keyed, unlike `fakeStore` above: which key is read and written is the point. */
  function keyedStore(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it('a login with no list of its own starts from the browser-wide one: no stars are lost', () => {
    const store = keyedStore({ [KEY]: JSON.stringify(['/pages']) });
    expect(readFavorites(store, 'session-a')).toEqual(['/pages']);
  });

  it('its first change is written under its own key, inherited stars included', () => {
    const store = keyedStore({ [KEY]: JSON.stringify(['/pages']) });
    expect(toggleFavoriteIn(store, '/tasks', 'session-a')).toEqual(['/pages', '/tasks']);
    expect(JSON.parse(store.map.get(`${KEY}:session-a`)!)).toEqual(['/pages', '/tasks']);
    // The browser-wide list is what the NEXT login added here starts from.
    expect(JSON.parse(store.map.get(KEY)!)).toEqual(['/pages']);
  });

  it('two logins on one browser do not curate each other', () => {
    const store = keyedStore();
    toggleFavoriteIn(store, '/pages', 'session-a');
    toggleFavoriteIn(store, '/tasks', 'session-b');
    expect(readFavorites(store, 'session-a')).toEqual(['/pages']);
    expect(readFavorites(store, 'session-b')).toEqual(['/tasks']);
  });

  it('a login that unstarred everything stays empty rather than re-inheriting', () => {
    const store = keyedStore({ [KEY]: JSON.stringify(['/pages']) });
    toggleFavoriteIn(store, '/pages', 'session-a');
    expect(readFavorites(store, 'session-a')).toEqual([]);
  });
});

describe('favorite items (an app, a page, a file...)', () => {
  const PAGE = '11111111-1111-4111-8111-111111111111';
  const FILE = '22222222-2222-4222-8222-222222222222';
  const GONE = '33333333-3333-4333-8333-333333333333';
  const page: NavFavoriteItem = {
    href: itemFavoriteHref(PAGE),
    id: PAGE,
    kind: 'pages',
    title: 'Plan',
    icon: 'lucide:rocket',
    color: 'violet',
  };
  const file: NavFavoriteItem = { ...page, href: itemFavoriteHref(FILE), id: FILE, kind: 'files' };
  const groups: NavGroup[] = [
    { label: 'Settings', items: [{ name: 'Profile', href: '/settings/profile', icon }] },
  ];

  it('are stored as the /n/ link', () => {
    expect(itemFavoriteHref(PAGE)).toBe(`/n/${PAGE}`);
  });

  it('mix with screens in the login’s order, each resolved', () => {
    const list = [page.href, '/settings/profile', itemFavoriteHref(GONE), '/gone', file.href];
    const rows = favoriteEntries(list, groups, [file, page]);
    expect(rows.map((r) => r.entry)).toEqual([page.href, '/settings/profile', file.href]);
    expect(rows[0]?.item).toEqual(page);
    expect(rows[1]?.nav?.name).toBe('Profile');
  });

  it('open on their screen; a file on the /n/ link, which finds its folder', () => {
    expect(favoriteItemHref(page)).toBe(`/pages/${PAGE}`);
    expect(favoriteItemHref(file)).toBe(`/n/${FILE}`);
  });

  it('an item the brain did not send goes at the next save; a screen never does', () => {
    const list = ['/chats', page.href, itemFavoriteHref(GONE), '/settings/profile'];
    expect(pruned(list, [page])).toEqual(['/chats', page.href, '/settings/profile']);
  });

  it('nothing goes on a brain that resolves no items', () => {
    const list = [itemFavoriteHref(GONE), '/settings/profile'];
    expect(pruned(list, undefined)).toEqual(list);
  });
});

describe('moved', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves down and up', () => {
    expect(moved(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moved(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('changes nothing for an index outside the list', () => {
    expect(moved(list, -1, 2)).toEqual(list);
    expect(moved(list, 1, 4)).toEqual(list);
  });

  it('does not change the list it was given', () => {
    moved(list, 0, 3);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
});
