import {
  Activity,
  Bot,
  Building2,
  Grid3x3,
  History,
  KeyRound,
  Layers,
  Link2,
  Megaphone,
  MessagesSquare,
  Power,
  Radar,
  Send,
  Server,
  ShieldBan,
  SquareStack,
  Users,
  UsersRound,
} from 'lucide-react';
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
    // Status: the whole box at a glance (vitals, brain, spend, queues,
    // sidecars, providers, version), first in System. It replaced the
    // Dashboard, which `/dashboard` now redirects to.
    group: 'System',
    after: '',
    item: { name: 'Status', href: '/status', icon: Activity },
  },
  {
    // The messenger (Messenger V1 Phase 2): every login's chats, after Home.
    group: 'Workspace',
    after: '/',
    item: { name: 'Chats', href: '/chats', icon: MessagesSquare },
  },
  {
    // Telegram per user (W7d): pair your own chat, list your own chats.
    group: 'Settings',
    after: '/settings/api-access',
    item: { name: 'Telegram', href: '/settings/telegram', icon: Send },
  },
];

/** The Control Center's group and its address (client/web/lib/fleet.ts). */
export const CONTROL_CENTER_GROUP = 'Control Center';
const CC = '/admin/fleet';

/**
 * Groups this client has that the pinned shared list does not name, each
 * placed after a named group. Admin (owner, 2026-11-09) holds Company
 * sign-in, shown only while the brain says the mode is on
 * (client/web/lib/sso-setup.ts). Control Center (owner, 2026-11-11) holds one
 * row per Control Center screen, shown only on a Control Center
 * (client/web/lib/fleet.ts), under its own CC tab (client/web/lib/nav-scope.ts).
 * A group the shared list already has is skipped.
 */
export const ADDED_NAV_GROUPS: ReadonlyArray<{ after: string; group: NavGroup }> = [
  {
    after: 'Settings',
    group: {
      label: 'Admin',
      items: [{ name: 'Company sign-in', href: '/admin/company-sign-in', icon: Building2 }],
    },
  },
  {
    after: 'Admin',
    group: {
      label: CONTROL_CENTER_GROUP,
      items: [
        { name: 'Overview', href: CC, icon: Radar },
        { name: 'Linked boxes', href: `${CC}/boxes`, icon: Server },
        { name: 'Fleet users', href: `${CC}/users`, icon: Users },
        { name: 'Fleet matrix', href: `${CC}/matrix`, icon: Grid3x3 },
        { name: 'Bans', href: `${CC}/bans`, icon: ShieldBan },
        { name: 'Provider keys', href: `${CC}/keys`, icon: KeyRound },
        { name: 'Agent models', href: `${CC}/models`, icon: Bot },
        { name: 'Pool entry', href: `${CC}/pools`, icon: SquareStack },
        { name: 'Worker groups', href: `${CC}/groups`, icon: UsersRound },
        { name: 'Update notice', href: `${CC}/notice`, icon: Megaphone },
        { name: 'Fleet changes', href: `${CC}/changes`, icon: History },
      ],
    },
  },
];

/** Pure, so the placement is unit-tested against any list. A group placed
 *  after one the list lacks goes last. */
export function withAddedGroups(
  groups: readonly NavGroup[],
  added: typeof ADDED_NAV_GROUPS = ADDED_NAV_GROUPS,
): NavGroup[] {
  const out = [...groups];
  for (const a of added) {
    if (out.some((g) => g.label === a.group.label)) continue;
    const at = out.findIndex((g) => g.label === a.after);
    out.splice(at === -1 ? out.length : at + 1, 0, a.group);
  }
  return out;
}

/**
 * Rows this client names differently from the pinned shared list. Logins is
 * Users since workspaces (W5a): a user is a login, and the screen holds
 * account actions only. Remove an entry once the shared list carries the
 * name.
 */
export const RENAMED_NAV_ITEMS: Readonly<Record<string, string>> = {
  '/settings/users': 'Users',
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
export const NAV_GROUPS: NavGroup[] = withAddedGroups(
  withRenamed(withAdded(withoutRetired(SHARED_NAV_GROUPS))),
);

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
