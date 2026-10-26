import { LayoutDashboard, Layers, Link2, Power, Send } from 'lucide-react';
import {
  NAV_GROUPS as SHARED_NAV_GROUPS,
  navItemMatches,
  type NavGroup,
  type NavItem,
} from '@mantle/share-ui/nav-items';

export * from '@mantle/share-ui/nav-items';

/**
 * Screens the shared nav list still names but this client no longer has.
 * `/team-portal` was the owner's signpost to the team-code portal, retired in
 * member logins Phase 6; `/team-admin` was Team admin, gone in workspaces W5c
 * (its settings are on the Team workspace, its links in Settings > Shared
 * links). The list comes from @crossworks/share-ui (the mantle repo), which
 * still carries the rows, so they are dropped here rather than rendered as
 * links to a 404. Remove an entry once the shared list drops it.
 */
export const RETIRED_NAV_HREFS: ReadonlySet<string> = new Set(['/team-portal', '/team-admin']);

/** Pure, so the filter is unit-tested against any list. A group left with no
 *  items goes too, and a retired href leaves a collapsible group's cold-start
 *  head as well. */
export function withoutRetired(groups: readonly NavGroup[]): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !RETIRED_NAV_HREFS.has(i.href)),
      ...(g.defaultHead
        ? { defaultHead: g.defaultHead.filter((h) => !RETIRED_NAV_HREFS.has(h)) }
        : {}),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Screens this client has that the pinned shared list does not name yet, each
 * placed after an existing href in a named group (an empty `after`: first). Settings > Services (the
 * optional-service switches) joins the shared list in mantle's next release;
 * an entry is skipped when the list already has its href, so this is a no-op
 * once the pin carries it. Remove an entry after the pin moves past it.
 */
export const ADDED_NAV_ITEMS: ReadonlyArray<{ group: string; after: string; item: NavItem }> = [
  {
    group: 'Settings',
    after: '/settings/updates',
    item: { name: 'Services', href: '/settings/services', icon: Power },
  },
  {
    // Workspaces (plan 4887b8e7, W5a): the list and the one workspace screen.
    group: 'Settings',
    after: '/settings/users',
    item: { name: 'Workspaces', href: '/settings/workspaces', icon: Layers },
  },
  {
    // Shared links (W5c): every live share link, from Team admin. After
    // Workspaces, so this entry comes after the one that adds it.
    group: 'Settings',
    after: '/settings/workspaces',
    item: { name: 'Shared links', href: '/settings/shared-links', icon: Link2 },
  },
  {
    // The brain health Dashboard (task d78e7bde): `/` is every login's
    // landing page now, so the Dashboard has its own screen, first in System.
    group: 'System',
    after: '',
    item: { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  },
  {
    // Telegram per user (W7d): pair your own chat, list your own chats.
    group: 'Settings',
    after: '/settings/api-access',
    item: { name: 'Telegram', href: '/settings/telegram', icon: Send },
  },
];

/**
 * Rows this client names differently from the pinned shared list. Logins is
 * Users since workspaces (W5a): a user is a login, and the screen holds
 * account actions only. `/` is Desk (owner decision, 2026-10-26; Home since
 * task d78e7bde): the landing page of the current workspace (the Dashboard
 * moved to /dashboard). Remove an
 * entry once the shared list carries the name.
 */
export const RENAMED_NAV_ITEMS: Readonly<Record<string, string>> = {
  '/settings/users': 'Users',
  '/': 'Desk',
};

/** Pure, so the renames are unit-tested against any list. */
export function withRenamed(
  groups: readonly NavGroup[],
  renamed: Readonly<Record<string, string>> = RENAMED_NAV_ITEMS,
): NavGroup[] {
  return groups.map((g) => ({
    ...g,
    items: g.items.map((i) => {
      const name = renamed[i.href];
      return name ? { ...i, name } : i;
    }),
  }));
}

/** Pure, so the placement is unit-tested against any list. */
export function withAdded(
  groups: readonly NavGroup[],
  added: typeof ADDED_NAV_ITEMS = ADDED_NAV_ITEMS,
): NavGroup[] {
  const known = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  return groups.map((g) => {
    const mine = added.filter((a) => a.group === g.label && !known.has(a.item.href));
    if (mine.length === 0) return g;
    const items = [...g.items];
    for (const a of mine) {
      // An empty `after` puts the item first.
      const at = a.after === '' ? -1 : items.findIndex((i) => i.href === a.after);
      items.splice(a.after === '' ? 0 : at === -1 ? items.length : at + 1, 0, a.item);
    }
    return { ...g, items };
  });
}

// These three shadow the shared module's own exports of the same names (a
// local export wins over `export *`), so every consumer gets the filtered list.
export const NAV_GROUPS: NavGroup[] = withRenamed(withAdded(withoutRetired(SHARED_NAV_GROUPS)));

/** Flat list of every nav item, in sidebar order. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The canonical nav item for a pathname (most specific href wins). */
export function matchNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (navItemMatches(item, pathname) && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best;
}
