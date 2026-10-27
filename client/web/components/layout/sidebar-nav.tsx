'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, Star, X } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Input } from '@mantle/web-ui/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@mantle/web-ui/ui/tooltip';
import { useRealtime } from '@/components/realtime/use-realtime';
import { activeNavHref } from '@/lib/nav-active';
import { favoriteItems, useNavFavorites } from '@/lib/nav-favorites';
import { NAV_SCOPES, railGroups, useNavScope } from '@/lib/nav-scope';
import { hasArea, navWithAreas } from '@/lib/workspaces';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { useMessengerUnread } from '@/components/messenger/messenger-shell';
import { withChats } from '@/lib/messenger/nav';
import {
  NAV_GROUPS,
  type NavGroup as BaseNavGroup,
  type NavItem as BaseNavItem,
} from '@mantle/web-ui/layout/nav-items';

/** A rendered nav item may carry a live badge (e.g. Pending approvals). */
type NavItem = BaseNavItem & { badge?: number };

type NavGroup = BaseNavGroup & { items: NavItem[] };

export function SidebarNav({
  pendingApprovals,
  onNavigate,
  collapsed = false,
}: {
  pendingApprovals: number;
  onNavigate?: () => void;
  /** Icon-rail mode: hide the filter box + labels, show a tooltip hint per item.
   *  The mobile drawer always passes false (it renders expanded). */
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  // Live pending-approval badge: when a tool call is queued/approved/rejected
  // anywhere (a chat turn, a heartbeat fire, a Telegram tap), the realtime
  // bridge pings us and we refetch the server-computed count. No polling.
  // The count lives in the ['shell'] query (app-shell.tsx), which a
  // router.refresh() never refetched: invalidate the query itself.
  const queryClient = useQueryClient();
  useRealtime(['pending_tool_call'], () => {
    void queryClient.invalidateQueries({ queryKey: ['shell'] });
  });

  const { favorites, isFavorite, toggleFavorite } = useNavFavorites();
  const { scope, setScope } = useNavScope();

  // The shared nav list, with the live pending-approvals badge injected onto
  // the Pending item at render time.
  //
  // Every screen is a row again. Thirteen of them were briefly folded behind a
  // single "Settings" row pointing at a card hub; that is undone, so the menu
  // filter finds "Backups" or "Audit log" by typing again rather than only ⌘K.
  //
  // Screens the login may not manage are not offered (plan 7.1: they hide by
  // the areas /api/shell names; a brain before W5a names none, so all show).
  const areas = useShellWorkspaces()?.areas;
  // The Work / Settings / Admin choice is the settings area's (nav-scope.ts,
  // railGroups): a member or a client sees what it may open, flat.
  const scoped = hasArea(areas, 'settings');
  // Chats (Messenger V1 Phase 2): hidden when the brain answers its unread
  // count with 404 (a brain before the messenger), else with that count,
  // the one sum of people, groups and assistant replies.
  const messenger = useMessengerUnread();
  const groups: NavGroup[] = withChats(
    navWithAreas(NAV_GROUPS, areas),
    // Hidden only on a 404: a count still loading (or failing) leaves the
    // entry where it is, so the rows below it do not jump.
    messenger.available !== 'no',
  ).map((g) => ({
    ...g,
    items: g.items.map((item) =>
      item.href === '/pending'
        ? { ...item, badge: pendingApprovals }
        : item.href === '/chats'
          ? { ...item, badge: messenger.total }
          : item,
    ),
  }));

  // Favorites is a VIEW over the groups above, not a place items move to: a
  // starred screen keeps its home row, exactly as pinning works everywhere
  // else. `favoriteItems` resolves each href against the LIVE list, which is
  // what stops a star on a since-retired route becoming a dead row.
  // Favourites resolve against the FULL list, never the scoped one: a starred
  // screen must survive the narrowing, which is the whole reason narrowing is
  // safe. Scoping first would make a star silently stop working in Work mode.
  const pinned = favoriteItems(favorites, groups);
  // Favorites is not collapsible: a list the owner curated by hand is already
  // the short list. Absent entirely when nothing is starred — an empty heading
  // is worse than none, and it is how this stays invisible until it is used.
  const withFavorites = (gs: NavGroup[]): NavGroup[] =>
    pinned.length > 0 ? [{ label: 'Favorites', items: pinned }, ...gs] : gs;

  // Two bases, and which one is in play depends on whether you are TYPING.
  //
  // Browsing shows the scope you chose. Searching ignores it and looks at
  // everything, because a filter that only finds what is already on screen is
  // not a filter — in Work mode, typing "backups" found nothing at all, and
  // the box gave no hint that it was answering for a subset. A search box that
  // can return "no matches" for something that plainly exists teaches people
  // not to trust it.
  //
  // Nothing has to be said about where a hit came from: results keep their
  // group heading, so a match under "System" is visibly outside Work.
  const browseGroups = withFavorites(railGroups(groups, scope, scoped));
  const searchGroups = withFavorites(groups);

  // Most-specific-wins rather than a per-item match: "Settings" at `/settings`
  // is a prefix of every other settings route, so an independent test would
  // light it beside Agents on `/settings/agents`.
  const activeHref = activeNavHref(browseGroups, pathname);
  const isActive = (item: NavItem) => item.href === activeHref;

  // Filter by item name (case-insensitive substring), dropping now-empty groups.
  // The filter is an expanded-only affordance — at icon-rail width there's no
  // box to type in, so a collapsed rail is never filtered.
  const q = query.trim().toLowerCase();
  const filtering = !collapsed && q.length > 0;
  const visibleGroups = filtering
    ? searchGroups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.name.toLowerCase().includes(q)) }))
        .filter((g) => g.items.length > 0)
    : browseGroups;

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    const hasBadge = item.badge != null && item.badge > 0;
    const className = cn(
      'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:gap-0 group-data-[nav-collapsed=true]/shell:px-0',
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
    );
    const inner = (
      <>
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate group-data-[nav-collapsed=true]/shell:hidden">
          {item.name}
        </span>
        {hasBadge && (
          <>
            <Badge
              variant="secondary"
              className="h-5 min-w-5 justify-center px-1.5 text-[11px] group-data-[nav-collapsed=true]/shell:hidden"
            >
              {item.badge! > 99 ? '99+' : item.badge}
            </Badge>
            {/* Collapsed: a dot stands in for the count. */}
            <span
              className="absolute right-1.5 top-1.5 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[nav-collapsed=true]/shell:block"
              aria-hidden
            />
          </>
        )}
      </>
    );

    const trigger = (
      <Link
        href={item.href}
        data-tour={`nav:${item.href}`}
        onClick={() => onNavigate?.()}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? undefined : item.name}
        className={cn(className, !collapsed && 'min-w-0 flex-1')}
      >
        {inner}
      </Link>
    );

    // Collapsed rail: the label lives in a shadcn tooltip on hover/focus, and
    // there is no star — an icon column has no room for a second control, and
    // the gesture belongs where the labels are.
    if (collapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {item.name}
            {hasBadge && (
              <span className="rounded bg-primary-foreground/20 px-1 text-[10px] tabular-nums">
                {item.badge! > 99 ? '99+' : item.badge}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    const starred = isFavorite(item.href);
    return (
      // A SIBLING of the link, never inside it: nested interactive elements are
      // invalid, and a star within the anchor would navigate as well as toggle.
      <div key={item.href} className="group/nav-row flex items-center gap-0.5">
        {trigger}
        <Button
          variant="ghost"
          size="icon-2xs"
          type="button"
          onClick={() => toggleFavorite(item.href)}
          aria-pressed={starred}
          aria-label={
            starred ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`
          }
          title={starred ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'shrink-0 rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            // Quiet until wanted: fifty always-lit stars would compete with the
            // labels they sit beside. It still occupies its space when hidden,
            // so no row jumps when the pointer arrives.
            starred
              ? 'text-foreground/70 hover:text-foreground'
              : 'text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/nav-row:opacity-100',
          )}
        >
          <Star className={cn('size-3.5', starred && 'fill-current')} aria-hidden />
        </Button>
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        className="flex flex-col gap-4 px-3 py-3 group-data-[nav-collapsed=true]/shell:px-2"
        aria-label="Primary"
      >
        {/* Quick filter — expanded mode only (hidden at icon-rail width). While a
            query is live it reaches into folded groups too, so this is also how
            you see the whole map without unfolding anything by hand. */}
        {!collapsed && (
          // `bg-sidebar/60 backdrop-blur`, not solid: the rail's generated
          // backdrop should read through this block like everywhere else in
          // the rail; the blur keeps rows scrolling under it from fighting
          // the filter text.
          <div className="sticky top-0 z-10 -mt-3 -mx-3 bg-sidebar/60 px-3 pb-2 pt-3 backdrop-blur group-data-[nav-collapsed=true]/shell:hidden">
            <div className="group/filter relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder="Filter menu…"
                aria-label="Filter navigation"
                // The webkit reset kills the input's NATIVE clear x — the custom
                // button below is the only clear control, revealed on hover/focus.
                className="h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 transition group-hover/filter:opacity-100 group-focus-within/filter:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>

            {/* How much of the map to show. Directly under the filter because
                the two are the same question at different scales — one narrows
                by NAME, this one by JOB — and a narrowed menu that cannot
                explain itself is just a menu with things missing.

                `type="single"` with no deselect: `onValueChange` fires with ''
                when the pressed item is clicked again, and honouring that would
                leave the sidebar in no scope at all. Only for a login that
                manages the brain: the rest see their few screens flat. */}
            {scoped ? (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={scope}
                onValueChange={(v) => v && setScope(v as typeof scope)}
                aria-label="How much of the menu to show"
                className="mt-2 grid w-full grid-cols-3"
              >
                {NAV_SCOPES.map((s) => (
                  <ToggleGroupItem key={s.id} value={s.id} className="text-xs">
                    {s.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
          </div>
        )}

        {visibleGroups.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matches.</p>
        ) : (
          visibleGroups.map((group) => (
            <NavGroupBlock key={group.label} group={group} renderItem={renderItem} />
          ))
        )}
      </nav>
    </TooltipProvider>
  );
}

/**
 * One group: its label, then every item in it.
 *
 * ── There is no fold any more ─────────────────────────────────────────────
 * Groups used to collapse to a usage-ranked HEAD — the few destinations you
 * return to — with the rest behind a "Show all 24" row. Jason: nothing should
 * hide behind a count. So every item in the group renders, always.
 *
 * The fold existed because fifty-one rows in one column is a poor daily list.
 * That problem did not go away; it moved to a better control. The SCOPE
 * selector answers it by asking which job you are here to do, and Favorites
 * answers it for the handful you personally return to. Both are explicit and
 * both are visible, which is what the fold was not: a ranked head silently
 * decided which rows you deserved, and the ranking changed under you between
 * loads.
 *
 * Losing it also removes the `mantle_nav_groups` cookie, the server-side seed
 * that stopped a fold flashing open, and the icon rail's "show all" affordance
 * — the icon rail now simply lists the scope it is in.
 */
function NavGroupBlock({
  group,
  renderItem,
}: {
  group: NavGroup;
  renderItem: (item: NavItem) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* Hidden at icon-rail width, where a text label has nowhere to go. The
          group's items still render — losing the heading is not losing them. */}
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden">
        {group.label}
      </p>
      {group.items.map(renderItem)}
    </div>
  );
}
