import { describe, expect, it } from 'vitest';
import { Bot, type LucideIcon } from 'lucide-react';
import { NAV_GROUPS as SHARED_NAV_GROUPS } from '@mantle/share-ui/nav-items';
import {
  ADDED_NAV_ITEMS,
  ALL_NAV_ITEMS,
  NAV_GROUPS,
  matchNavItem,
  withAdded,
  withRenamed,
  withoutRetired,
  type NavGroup,
} from './nav-items';

/** The retired team portal (member logins Phase 6) must not be a sidebar row,
 *  a palette entry or a usage-ranking target while the shared list still
 *  names it. */
const icon = Bot as LucideIcon;
const hrefs = (groups: NavGroup[]) => groups.flatMap((g) => g.items).map((i) => i.href);
/** The hrefs this client adds itself (ADDED_NAV_ITEMS). */
const ADDED = new Set(ADDED_NAV_ITEMS.map((a) => a.item.href));
/** Only the Services entry, for the placement tests below. */
const SERVICES_ONLY = ADDED_NAV_ITEMS.filter((a) => a.item.href === '/settings/services');

describe('nav items without retired screens', () => {
  it('drops /team-portal and /team-admin from the groups, the flat list and the matcher', () => {
    for (const gone of ['/team-portal', '/team-admin']) {
      expect(hrefs(NAV_GROUPS)).not.toContain(gone);
      expect(ALL_NAV_ITEMS.map((i) => i.href)).not.toContain(gone);
      expect(matchNavItem(gone)).toBeUndefined();
    }
  });

  it('keeps everything else the shared list has, in order', () => {
    const shared = hrefs(SHARED_NAV_GROUPS).filter(
      (h) => h !== '/team-portal' && h !== '/team-admin',
    );
    expect(hrefs(NAV_GROUPS).filter((h) => !ADDED.has(h))).toEqual(
      shared.filter((h) => !ADDED.has(h)),
    );
  });

  it('drops a group left empty and a retired href from a cold-start head', () => {
    const groups: NavGroup[] = [
      { label: 'Gone', items: [{ name: 'Portal', href: '/team-portal', icon }] },
      {
        label: 'Kept',
        collapsible: true,
        defaultHead: ['/team-portal', '/tasks'],
        items: [
          { name: 'Portal', href: '/team-portal', icon },
          { name: 'Tasks', href: '/tasks', icon },
        ],
      },
    ];
    const out = withoutRetired(groups);
    expect(out.map((g) => g.label)).toEqual(['Kept']);
    expect(out[0]!.defaultHead).toEqual(['/tasks']);
    expect(hrefs(out)).toEqual(['/tasks']);
  });
});

describe('nav items this client adds before the shared list names them', () => {
  it('Settings > Services is in the Settings group, once, right after Updates', () => {
    const settings = NAV_GROUPS.find((g) => g.label === 'Settings')!;
    const list = settings.items.map((i) => i.href);
    expect(list.filter((h) => h === '/settings/services')).toHaveLength(1);
    expect(list[list.indexOf('/settings/updates') + 1]).toBe('/settings/services');
    expect(matchNavItem('/settings/services')?.name).toBe('Services');
  });

  it('Settings > API access is in the Settings group, once, right after MCP', () => {
    const settings = NAV_GROUPS.find((g) => g.label === 'Settings')!;
    const list = settings.items.map((i) => i.href);
    expect(list.filter((h) => h === '/settings/api-access')).toHaveLength(1);
    expect(list[list.indexOf('/settings/mcp') + 1]).toBe('/settings/api-access');
    expect(matchNavItem('/settings/api-access')?.name).toBe('API access');
  });

  it('Settings > Telegram is in the Settings group, once, right after API access (W7d)', () => {
    const settings = NAV_GROUPS.find((g) => g.label === 'Settings')!;
    const list = settings.items.map((i) => i.href);
    expect(list.filter((h) => h === '/settings/telegram')).toHaveLength(1);
    expect(list[list.indexOf('/settings/api-access') + 1]).toBe('/settings/telegram');
    expect(matchNavItem('/settings/telegram')?.name).toBe('Telegram');
  });

  const groups: NavGroup[] = [
    {
      label: 'Settings',
      items: [
        { name: 'Backups', href: '/settings/backups', icon },
        { name: 'Updates', href: '/settings/updates', icon },
        { name: 'Logins', href: '/settings/users', icon },
      ],
    },
  ];

  it('places an entry after its anchor', () => {
    expect(hrefs(withAdded(groups, SERVICES_ONLY))).toEqual([
      '/settings/backups',
      '/settings/updates',
      '/settings/services',
      '/settings/users',
    ]);
  });

  it('is a no-op once the shared list carries the href', () => {
    const carried: NavGroup[] = [
      {
        label: 'Settings',
        items: [...groups[0]!.items, { name: 'Services', href: '/settings/services', icon }],
      },
    ];
    expect(withAdded(carried, SERVICES_ONLY)).toEqual(carried);
  });

  it('appends when the anchor is gone, and leaves other groups alone', () => {
    const noAnchor: NavGroup[] = [
      { label: 'Settings', items: [{ name: 'Backups', href: '/settings/backups', icon }] },
      { label: 'System', items: [{ name: 'Debug', href: '/debug', icon }] },
    ];
    expect(hrefs(withAdded(noAnchor, SERVICES_ONLY))).toEqual([
      '/settings/backups',
      '/settings/services',
      '/debug',
    ]);
  });
});

describe('Shared links (W5c) in the nav', () => {
  it('adds Shared links after Workspaces in Settings, once', () => {
    const settings = NAV_GROUPS.find((g) => g.label === 'Settings')!;
    const list = settings.items.map((i) => i.href);
    expect(list.filter((h) => h === '/settings/shared-links')).toHaveLength(1);
    expect(list[list.indexOf('/settings/workspaces') + 1]).toBe('/settings/shared-links');
    expect(matchNavItem('/settings/shared-links')?.name).toBe('Shared links');
  });
});

describe('workspaces (W5a) in the nav', () => {
  it('adds Workspaces after Users in Settings', () => {
    const settings = NAV_GROUPS.find((g) => g.label === 'Settings')!;
    const at = settings.items.findIndex((i) => i.href === '/settings/users');
    expect(at).toBeGreaterThan(-1);
    expect(settings.items[at + 1]?.href).toBe('/settings/workspaces');
    expect(matchNavItem('/settings/workspaces')?.name).toBe('Workspaces');
  });

  it('names the logins screen Users', () => {
    expect(matchNavItem('/settings/users')?.name).toBe('Users');
    expect(matchNavItem('/')?.name).toBe('Desk');
    const groups: NavGroup[] = [
      { label: 'Settings', items: [{ name: 'Logins', href: '/settings/users', icon }] },
    ];
    expect(withRenamed(groups)[0]!.items[0]!.name).toBe('Users');
    expect(withRenamed(groups, {})).toEqual(groups);
  });
});
