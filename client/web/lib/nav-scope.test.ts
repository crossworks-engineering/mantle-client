import { describe, expect, it } from 'vitest';
import { Bot, type LucideIcon } from 'lucide-react';
import { NAV_GROUPS, type NavGroup } from '@mantle/web-ui/layout/nav-items';
import { railGroups, scopeGroups, storedScope, type NavScope } from './nav-scope';
import { navWithAreas } from './workspaces';

/**
 * The scope filter hides things on purpose, which makes it the kind of feature
 * that fails silently: a screen simply is not there, and nobody can tell
 * whether that was intended. These run against the REAL `NAV_GROUPS` rather
 * than a fixture, so the day someone adds a settings screen and forgets to
 * classify it, the omission shows up here instead of in a support message.
 */

const icon = Bot as LucideIcon;
const names = (groups: NavGroup[]) => groups.flatMap((g) => g.items).map((i) => i.name);
const labels = (groups: NavGroup[]) => groups.map((g) => g.label);
const hrefs = (groups: NavGroup[]) => groups.flatMap((g) => g.items).map((i) => i.href);

describe('settings', () => {
  const settings = scopeGroups(NAV_GROUPS, 'settings');
  const shown = names(settings);

  it('carries every setting, the Admin group and the System group, whole', () => {
    expect(labels(settings)).toEqual(['Settings', 'Admin', 'System']);
    for (const label of ['Settings', 'Admin', 'System']) {
      expect(settings.find((g) => g.label === label)).toEqual(
        NAV_GROUPS.find((g) => g.label === label),
      );
    }
  });

  it('carries every settings screen, and the plumbing', () => {
    expect(shown).toEqual(
      expect.arrayContaining([
        'Agents',
        'AI workers',
        'MCP',
        'Profile',
        'Appearance',
        'Workspaces',
        'Company sign-in',
        'Tools',
        'API keys',
        'Services',
        'Backups',
        'Updates',
        'Audit log',
        'Users',
        'Debug',
      ]),
    );
  });

  it('shows nothing Work shows', () => {
    const work = new Set(names(scopeGroups(NAV_GROUPS, 'work')));
    for (const name of shown) expect(work.has(name)).toBe(false);
    expect(shown).not.toContain('Pages');
    expect(shown).not.toContain('Models');
  });
});

describe('work and settings, together', () => {
  it('are the whole list, each row once, so no screen is lost', () => {
    const both = [
      ...hrefs(scopeGroups(NAV_GROUPS, 'work')),
      ...hrefs(scopeGroups(NAV_GROUPS, 'settings')),
    ];
    expect(new Set(both).size).toBe(both.length);
    expect(both.sort()).toEqual(hrefs(NAV_GROUPS).sort());
  });
});

describe('work', () => {
  const work = scopeGroups(NAV_GROUPS, 'work');

  it('shows Workspace and Review, and nothing else', () => {
    expect(labels(work)).toEqual(['Workspace', 'Review']);
  });

  it('keeps those groups WHOLE: it selects groups, it does not thin them', () => {
    const source = NAV_GROUPS.filter((g) => g.label === 'Workspace' || g.label === 'Review');
    expect(names(work)).toEqual(names(source));
  });

  it('carries the daily surfaces, and Review', () => {
    expect(names(work)).toEqual(
      expect.arrayContaining(['Pages', 'Tasks', 'Email', 'Pending', 'Models', 'Discover']),
    );
  });

  it('hides the machine', () => {
    expect(names(work)).not.toContain('Debug');
    expect(names(work)).not.toContain('Backups');
  });
});

describe('favorites', () => {
  it('shows no nav group: the sidebar puts the Favorites group there', () => {
    expect(scopeGroups(NAV_GROUPS, 'favorites')).toEqual([]);
  });
});

describe('a stored choice', () => {
  it('reads the three tabs as themselves', () => {
    for (const s of ['favorites', 'work', 'settings'] as const) expect(storedScope(s)).toBe(s);
  });

  it('reads the old Admin tab (2026-11-07 to 2026-11-09) as Settings', () => {
    expect(storedScope('admin')).toBe('settings');
  });

  it('reads anything else as no choice', () => {
    for (const v of [null, '', 'all', 'Work']) expect(storedScope(v)).toBe(null);
  });
});

describe('a group the scope empties', () => {
  it('is dropped rather than rendered as a bare heading', () => {
    const groups: NavGroup[] = [
      { label: 'Workspace', items: [{ name: 'Pages', href: '/pages', icon }] },
      { label: 'System', items: [{ name: 'Debug', href: '/debug', icon }] },
    ];
    expect(labels(scopeGroups(groups, 'work'))).toEqual(['Workspace']);
  });
});

describe('the rail (W5c: one shell for every login)', () => {
  const scopes: NavScope[] = ['favorites', 'work', 'settings'];

  it('a login that manages the brain gets the chosen scope', () => {
    for (const scope of scopes) {
      expect(railGroups(NAV_GROUPS, scope, true)).toEqual(scopeGroups(NAV_GROUPS, scope));
    }
  });

  it('before the stored scope is read, shows every screen', () => {
    expect(railGroups(NAV_GROUPS, null, true)).toBe(NAV_GROUPS);
  });

  it('a login without the settings area gets every screen it may open, flat, whatever the stored scope', () => {
    // A member or a client holds no area: the nav is what navWithAreas leaves.
    const permitted = navWithAreas(NAV_GROUPS, []);
    for (const scope of scopes) {
      expect(railGroups(permitted, scope, false)).toBe(permitted);
      expect(names(railGroups(permitted, scope, false))).toEqual(
        expect.arrayContaining(['Pages', 'Notes', 'Files', 'Tables', 'Draw', 'Apps', 'Workspaces']),
      );
    }
    // Under the Work scope Workspaces would be out of reach: it is a Settings row.
    expect(names(scopeGroups(permitted, 'work'))).not.toContain('Workspaces');
  });
});
