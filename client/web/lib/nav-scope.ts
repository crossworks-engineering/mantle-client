'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NavGroup } from '@mantle/web-ui/layout/nav-items';

/**
 * How much of the menu to show at once.
 *
 * Fifty-one destinations in four groups is a complete map and a poor daily
 * list. The folding heads already helped; this is the other half — say which
 * JOB you are here to do and the map narrows to it.
 *
 *  - `work`     the daily surfaces: Workspace and Review, whole.
 *  - `settings` what you configure to make the brain do its job — the agents,
 *               the tools they can reach, the accounts they read, and who you
 *               are. Not the machine's plumbing.
 *  - `admin`    what is left: the machine's plumbing and the System group.
 *               Not everything: Jason asked for the admin features only, so
 *               it repeats nothing Work or Settings already shows.
 *
 * Three SLICES, not three nesting levels: `settings` does not also show
 * Workspace, and `admin` shows neither, or each would be the next one with
 * extra steps. The three together are the whole list. Anything reached often
 * enough for that to chafe wants a star instead — Favorites renders in every
 * scope, which is what stops the narrowing from ever being a trap.
 */
export type NavScope = 'work' | 'settings' | 'admin';

export const NAV_SCOPES: Array<{ id: NavScope; label: string }> = [
  { id: 'work', label: 'Work' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Admin' },
];

const KEY = 'mantle_nav_scope_v1';

/** Groups shown whole under `work` — matched by LABEL, which is what the
 *  shared nav list gives us to key on. */
const WORK_GROUPS = new Set(['Workspace', 'Review']);

/**
 * What `settings` shows, by href.
 *
 * The line drawn is **capability versus plumbing**: things you change to make
 * the brain do a new job, against things you touch when operating the box it
 * runs on. Agents, the tools and skills they can reach, the accounts and keys
 * they authenticate with, how text is embedded, when heartbeats fire, and who
 * you are — those are capability. Backups, updates, audit, logins, peers, the
 * local network, entity merges and stored PDF passwords are plumbing, and they
 * live in `admin` with the System group.
 *
 * ⚠ Jason named agents, AI workers, MCP and profile and said he was probably
 * missing obvious ones; the rest of this list is a PROPOSAL. It is a flat set
 * of hrefs for exactly that reason — moving one line between here and admin is
 * the whole edit.
 */
const SETTINGS_HREFS = new Set([
  // Who you are, and what it looks like.
  '/settings/profile',
  '/settings/appearance',
  // Who works in the brain, and what each group of them reads (W5c).
  '/settings/workspaces',
  // The things that act on your behalf.
  '/settings/agents',
  '/settings/ai-workers',
  '/settings/worker-groups',
  '/settings/heartbeats',
  // What they can reach.
  '/settings/mcp',
  '/settings/api-access',
  '/settings/telegram',
  '/settings/tools',
  '/settings/tool-groups',
  '/settings/skills',
  '/models',
  // What they read, and what they authenticate with.
  '/settings/accounts',
  '/settings/keys',
  '/settings/microsoft',
  '/settings/calendar',
  '/settings/embedding',
  // Which optional services the agents can use (sandboxes, media): it
  // changes what the brain can do, so it is capability, not plumbing.
  '/settings/services',
]);

/**
 * The groups a scope shows.
 *
 * Empty groups are dropped rather than rendered as a bare heading, so a scope
 * never shows a label with nothing under it.
 *
 * `admin` is the complement of the other two rather than a list of its own, so
 * a screen nobody classified (a new settings row, say) lands in `admin` and is
 * never out of reach in every scope.
 */
export function scopeGroups<G extends NavGroup>(groups: G[], scope: NavScope): G[] {
  return groups
    .map((group) => {
      if (scope === 'work') {
        return WORK_GROUPS.has(group.label) ? group : { ...group, items: [] };
      }
      if (scope === 'admin') {
        if (WORK_GROUPS.has(group.label)) return { ...group, items: [] };
        return { ...group, items: group.items.filter((i) => !SETTINGS_HREFS.has(i.href)) };
      }
      return { ...group, items: group.items.filter((i) => SETTINGS_HREFS.has(i.href)) };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * The groups the rail shows (phase W5c: one shell for every login).
 *
 * The Work / Settings / Admin choice is for a login that manages the brain
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

function isScope(v: unknown): v is NavScope {
  return v === 'work' || v === 'settings' || v === 'admin';
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
      const raw = window.localStorage.getItem(KEY);
      setScopeState(isScope(raw) ? raw : 'work');
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
