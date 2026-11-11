'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NavGroup } from '@mantle/web-ui/layout/nav-items';

/**
 * How much of the menu to show at once.
 *
 * Fifty-odd destinations in four groups is a complete map and a poor daily
 * list. Say which JOB you are here to do and the map narrows to it.
 *
 *  - `favorites` the login's own short list (nav-favorites.ts): starred
 *                screens and workspace items, in the login's order.
 *  - `work`      the daily surfaces: Workspace and Review, whole.
 *  - `settings`  everything else: every setting and the System group.
 *  - `cc`        the Control Center group, alone. Offered only on a box that
 *                is a Control Center (owner, 2026-11-11).
 *
 * The third tab was called Admin from 2026-11-07 to 2026-11-09 (Jason:
 * "lets change Admin to Settings"). Work and Settings are two SLICES of the
 * one list and together they are the whole of it; Favorites is a view over
 * that list, not a third slice.
 */
export type NavScope = 'favorites' | 'work' | 'settings' | 'cc';

export const NAV_SCOPES: Array<{ id: NavScope; label: string }> = [
  { id: 'favorites', label: 'Favorites' },
  { id: 'work', label: 'Work' },
  { id: 'settings', label: 'Settings' },
];

/** The fourth tab, on a Control Center only. */
export const CC_SCOPE: { id: NavScope; label: string } = { id: 'cc', label: 'CC' };

/** The tabs a box offers: CC last, on a Control Center. */
export function navScopes(controlCenter: boolean): Array<{ id: NavScope; label: string }> {
  return controlCenter ? [...NAV_SCOPES, CC_SCOPE] : NAV_SCOPES;
}

/** The scope in play: a stored `cc` on a box that is not a Control Center
 *  (or whose answer is not here yet) reads as `work`. */
export function scopeInPlay(scope: NavScope | null, controlCenter: boolean): NavScope | null {
  return scope === 'cc' && !controlCenter ? 'work' : scope;
}

const KEY = 'mantle_nav_scope_v1';

/** Groups shown whole under `work`, matched by LABEL, which is what the
 *  shared nav list gives us to key on. */
const WORK_GROUPS = new Set(['Workspace', 'Review']);

/** The one group `cc` shows (CONTROL_CENTER_GROUP in the nav list). */
const CC_GROUP = 'Control Center';

/**
 * The groups a scope shows. `favorites` shows none of them: the sidebar
 * puts the Favorites group there.
 *
 * `settings` is the complement of `work` (less the Control Center group, which
 * has its own tab) rather than a list of its own, so a screen nobody
 * classified (a new settings row, say) lands in `settings` and is never out of
 * reach. Empty groups are dropped rather than rendered as a
 * bare heading.
 */
export function scopeGroups<G extends NavGroup>(groups: G[], scope: NavScope): G[] {
  if (scope === 'favorites') return [];
  if (scope === 'cc') return groups.filter((group) => group.label === CC_GROUP);
  return groups.filter(
    (group) => group.label !== CC_GROUP && WORK_GROUPS.has(group.label) === (scope === 'work'),
  );
}

/**
 * The groups the rail shows (phase W5c: one shell for every login).
 *
 * The Favorites / Work / Settings choice is for a login that manages the brain
 * (the settings area). A login without it (a member, a client) may open a
 * few screens only, so it gets them all, flat, and no choice to make: a
 * choice between near-empty slices only hides screens it may use.
 *
 * A `null` scope (not read from storage yet, see useNavScope) shows them all.
 */
export function railGroups<G extends NavGroup>(
  groups: G[],
  scope: NavScope | null,
  scoped: boolean,
): G[] {
  return scoped && scope ? scopeGroups(groups, scope) : groups;
}

/** A stored choice. `admin` was the third tab's id from 2026-11-07 to
 *  2026-11-09: it reads as `settings`. Anything else is not a choice. */
export function storedScope(v: unknown): NavScope | null {
  if (v === 'admin') return 'settings';
  return v === 'favorites' || v === 'work' || v === 'settings' || v === 'cc' ? v : null;
}

/**
 * The chosen scope, remembered per browser.
 *
 * ⚠ Starts at `null` — no scope, the whole list — on the server and on first
 * paint, and adopts the stored choice on mount. That order is deliberate in
 * both directions: the server has no localStorage, so seeding from it would be
 * a hydration mismatch — and the whole list is the only safe thing to render
 * before we know. Starting at any one slice would blink the other two out of
 * existence on every single load for anyone who had chosen otherwise. (That
 * used to be `admin`, when `admin` still meant everything.)
 *
 * The DEFAULT for someone who has never chosen is `work`, applied on mount. It
 * is the scope the feature exists for, and the control sits directly above the
 * list, labelled, so a narrowed menu explains itself.
 */
export function useNavScope(): { scope: NavScope | null; setScope: (s: NavScope) => void } {
  const [scope, setScopeState] = useState<NavScope | null>(null);

  useEffect(() => {
    try {
      setScopeState(storedScope(window.localStorage.getItem(KEY)) ?? 'work');
    } catch {
      setScopeState('work');
    }
  }, []);

  const setScope = useCallback((next: NavScope) => {
    setScopeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* quota / private mode — the choice just won't persist */
    }
  }, []);

  return { scope, setScope };
}
