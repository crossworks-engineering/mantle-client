'use client';

import { useItemAddress } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MapPin, Plus, Repeat, Search } from 'lucide-react';
import { useRealtime } from '@/components/realtime/use-realtime';
import { FormShell } from '@mantle/web-ui/ui/form-shell';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { useListNav } from '@/lib/use-list-nav';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { useNow } from '@/components/use-now';
import {
  dayGroup,
  eventState,
  formatRelativeShort,
  type DayGroup,
} from '@mantle/client-types/lib/event-time';
import { EventForm, emptyEventForm, type EventPayload } from './event-form';
import { EventDetail, type EventRow } from './event-detail';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { eventsAdapter } from '@/components/item-tree/kinds/dated';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';

/** `in`: "New event inside" a tree folder, where it goes once saved. */
type Selection = { mode: 'create'; in?: TreeFolder } | { mode: 'view'; id: string } | null;

const GROUP_ORDER: DayGroup[] = ['today', 'tomorrow', 'this_week', 'later', 'past'];
const GROUP_LABEL: Record<DayGroup, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
  past: 'Past',
};

/** Date label for a card — pinned to en-GB so SSR matches the client. */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

type EventsListResponse = {
  events: EventRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function EventsClient() {
  // Maximise from the item header collapses the list.
  const { zen } = useZenMode();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { pending: navPending, go } = useListNav();
  const toast = useToast();
  const now = useNow(60_000); // minute tick drives live badges + grouping
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // URL is the source of truth (matches the old SSR page).
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const windowParam = searchParams.get('window');
  const window: 'upcoming' | 'past' | 'all' =
    windowParam === 'past' || windowParam === 'all' ? windowParam : 'upcoming';

  // The item tree when this brain serves it for events (docs/folder-tree.md);
  // the paged list for a brain before it, or if a tree call 404s. The tree
  // lists every event by start, so the upcoming/past window is the list's only.
  const treeServes = useTreeServes('events');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  const listQuery = useQuery({
    queryKey: ['events', { q: query, window, page }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (window !== 'upcoming') qs.set('window', window);
      if (page > 1) qs.set('page', String(page));
      const s = qs.toString();
      return apiFetch<EventsListResponse>(`/api/events${s ? `?${s}` : ''}`);
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 50;

  // null = "not yet defaulted"; the effect below selects the first event (or
  // create mode) once the list loads.
  const [sel, setSel] = useState<Selection>(null);
  // The event in the address (`/events/<id>`, `?edit=1` to edit): copy it to
  // share it. Picking an event opens its address.
  const address = useItemAddress('events');
  useEffect(() => {
    if (address.id) setSel({ mode: 'view', id: address.id });
  }, [address.id]);
  const view = (id: string) => {
    setSel({ mode: 'view', id });
    if (id !== address.id || address.editing) address.open(id);
  };
  const { fileNew, confirm: fileConfirm } = useFileNewItem('events', 'event');

  // The tree's rows are not events, so the open one is fetched on its own
  // (the same call and key as the /events/[id] deep link).
  const openEventId = showTree && sel?.mode === 'view' ? sel.id : null;
  const openEventQuery = useQuery({
    queryKey: ['events', openEventId],
    queryFn: () => apiFetch<{ event: EventRow }>(`/api/events/${openEventId}`).then((r) => r.event),
    enabled: !!openEventId,
  });

  // Local working copy, so mutations update optimistically; seeded from the query
  // and reconciled whenever the server data changes (incl. a mutation's invalidate).
  // With the tree it holds just the open event.
  const [events, setEvents] = useState<EventRow[]>([]);
  useEffect(() => {
    if (showTree) setEvents(openEventQuery.data ? [openEventQuery.data] : []);
    else setEvents(listQuery.data?.events ?? []);
  }, [showTree, openEventQuery.data, listQuery.data]);

  const [searchInput, setSearchInput] = useState(query);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    // The tree opens nothing by itself: an event opens when you pick it.
    if (showTree || sel !== null) return;
    // ONCE THE LIST LOADS, and not a frame before — the same trap /tasks had.
    // `events` is a local copy seeded by the effect above, so on a cold load
    // there are two commits where it is still empty while rows are on their
    // way: the pending one, and the one where the query first resolves (this
    // effect sees the previous render's `events`). Defaulting in either lands on
    // the create form and STAYS there, because a non-null `sel` is never
    // revisited — every fresh load of /events opened a composer.
    if (!listQuery.isSuccess) return;
    if (events.length === 0 && (listQuery.data?.events.length ?? 0) > 0) return;
    setSel(events[0] ? { mode: 'view', id: events[0].id } : { mode: 'create' });
  }, [events, sel, showTree, listQuery.isSuccess, listQuery.data]);

  // Debounced search → URL (?q=); resets to page 1.
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() !== query) go({ q: searchInput.trim() || null, page: null });
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Live db-watch: Saskia adds an event / a reminder edit / another tab → refetch.
  useRealtime(['event'], () => {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  });

  const all = events;
  const selected = sel?.mode === 'view' ? (all.find((e) => e.id === sel.id) ?? null) : null;

  // Pin the open event. Same shape as the /events/[id] deep link, which pins
  // the same ref — whichever route you arrived by, "this event" is the same
  // thing, and only one of the two is ever mounted.
  useSurfaceAssist({
    node: selected
      ? { id: selected.id, kind: 'event', label: selected.title || 'Untitled event' }
      : null,
  });

  // Group by day once mounted; before that, a flat upcoming→past list (SSR-safe).
  const groups = useMemo(() => {
    if (!now) return null;
    const buckets: Record<DayGroup, EventRow[]> = {
      today: [],
      tomorrow: [],
      this_week: [],
      later: [],
      past: [],
    };
    for (const e of all) buckets[dayGroup(e.startsAt, now, tz)].push(e);
    for (const k of GROUP_ORDER) buckets[k].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    buckets.past.reverse(); // most-recent first
    return buckets;
  }, [now, all, tz]);

  const createEvent = async (payload: EventPayload) => {
    const fileIn = sel?.mode === 'create' ? sel.in : undefined;
    let event: EventRow;
    try {
      ({ event } = await apiSend<{ event: EventRow }>('/api/events', 'POST', payload));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
      toast.error(e instanceof Error ? e.message : 'Could not save event');
      return;
    }
    setEvents((p) => [event, ...p]);
    // Seed the by-id fetch so the tree's detail opens without a round trip.
    queryClient.setQueryData(['events', event.id], event);
    view(event.id);
    if (fileIn) void fileNew(event.id, fileIn);
    toast.success(`Saved “${event.title}”`);
    startTransition(async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    });
    void queryClient.invalidateQueries({ queryKey: treeKey('events') });
  };

  const onUpdated = (e: EventRow) => {
    setEvents((p) => p.map((x) => (x.id === e.id ? e : x)));
    startTransition(async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    });
    void queryClient.invalidateQueries({ queryKey: treeKey('events') });
  };

  const onDeleted = (id: string) => {
    const next = all.filter((e) => e.id !== id);
    setEvents((p) => p.filter((e) => e.id !== id));
    if (address.id === id) address.close();
    if (showTree) setSel(null);
    else setSel(next[0] ? { mode: 'view', id: next[0].id } : { mode: 'create' });
    startTransition(async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
    });
    void queryClient.invalidateQueries({ queryKey: treeKey('events') });
  };

  const renderCard = (e: EventRow) => {
    const isSel = sel?.mode === 'view' && sel.id === e.id;
    const state = now ? eventState(e.startsAt, e.endsAt, now) : 'upcoming';
    const live = state === 'in_progress';
    const isPast = state === 'past';
    return (
      <ListCard
        key={e.id}
        onClick={() => view(e.id)}
        data-mark-id={e.id}
        data-mark-kind="event"
        data-mark-label={e.title}
        selected={isSel}
        dimmed={isPast && !isSel}
        className={cn(live && !isSel && 'border-primary')}
      >
        <div className="flex items-center gap-2">
          <ListCardTitle>{e.title}</ListCardTitle>
          <span
            className={cn(
              'ml-auto shrink-0 text-xs tabular-nums',
              live ? 'font-medium text-primary-ink' : 'text-muted-foreground',
            )}
          >
            {now ? (live ? 'now' : formatRelativeShort(e.startsAt, now)) : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {e.recur !== 'none' && (
            <Repeat className="size-3 shrink-0" aria-label={`repeats ${e.recur}`} />
          )}
          <span className="truncate">{fmt(e.startsAt)}</span>
        </div>
        {(e.location || e.tags.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {e.location && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="size-3" /> {e.location}
              </span>
            )}
            {e.tags.map((t) => (
              <TagPill key={t} tag={t} />
            ))}
          </div>
        )}
      </ListCard>
    );
  };

  if (!showTree && listQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!showTree && listQuery.isError && !listQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load events.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  // ONE detail pane for all three states, exactly as /tasks does it, so the
  // create form and the read view sit on the same surface at the same width.
  const detailPane =
    sel?.mode === 'create' ? (
      <div className="p-6">
        {/* §6c: boxed, left-aligned card. It used to be `mx-auto max-w-2xl`,
            which centred a form in a pane that is now draggable — the composer
            drifted away from the list it belongs to as the pane grew. */}
        <FormShell>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary-ink" aria-hidden />
            <h2 className="text-lg font-semibold">
              {sel.in ? `New event in “${sel.in.name}”` : 'New event'}
            </h2>
          </div>
          <EventForm
            initial={emptyEventForm()}
            submitLabel="Save event"
            submitting={pending}
            onSubmit={createEvent}
            onCancel={() => {
              const first = all[0];
              if (showTree) setSel(null);
              else setSel(first ? { mode: 'view', id: first.id } : { mode: 'create' });
            }}
          />
        </FormShell>
      </div>
    ) : selected ? (
      <EventDetail
        key={selected.id}
        event={selected}
        onUpdated={onUpdated}
        onDeleted={() => onDeleted(selected.id)}
        editing={address.id === selected.id && address.editing}
        onEditingChange={(on) => address.open(selected.id, on)}
      />
    ) : openEventId && openEventQuery.isPending ? (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ) : (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        Select an event, or add a new one.
      </div>
    );

  return (
    <MasterDetail
      id="events"
      listCollapsed={zen}
      list={
        showTree ? (
          <aside className="flex h-full flex-col bg-muted/20">
            {fileConfirm}
            <ItemTree
              kind="events"
              adapter={eventsAdapter}
              selectedItemId={sel?.mode === 'view' ? sel.id : null}
              query={treeQuery}
              onQueryChange={setTreeQuery}
              searchPlaceholder="Search events and folders…"
              newItemInFolder={{
                label: 'event',
                onCreate: (f) => setSel({ mode: 'create', in: f }),
              }}
              actions={
                <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
                  <Plus /> New
                </Button>
              }
              onOpenItem={(item) => view(item.id)}
              onUnsupported={() => setTreeGone(true)}
            />
          </aside>
        ) : (
          <>
            {/* ── Left: event list ─────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Events
              </h2>
              <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
                <Plus /> New
              </Button>
            </div>
            <div className="space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search events…"
                  className="h-9 pl-8"
                />
              </div>
              {/* Was a raw `<select>` — no focus ring, native chevron, and a font
              that ignored the theme. §6d: the kit's Select or nothing. */}
              <Select
                value={window}
                onValueChange={(v) => go({ window: v === 'upcoming' ? null : v, page: null })}
              >
                <SelectTrigger size="sm" aria-label="Filter events">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="past">Past</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {all.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  {query || window !== 'upcoming' ? (
                    'No events match your search or filter.'
                  ) : (
                    <>
                      No upcoming events. Click <strong>New</strong>, or ask Saskia (“remind me of
                      my meeting at 10am”).
                    </>
                  )}
                </p>
              ) : groups ? (
                GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
                  <section key={g} className="space-y-2">
                    <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {GROUP_LABEL[g]}
                    </h3>
                    <div className="space-y-2">{groups[g].map(renderCard)}</div>
                  </section>
                ))
              ) : (
                // Pre-mount fallback: flat list (matches SSR order).
                <div className="space-y-2">{all.map(renderCard)}</div>
              )}
            </div>
            <ListPager
              page={page}
              total={total}
              pageSize={pageSize}
              pending={navPending}
              onGo={(p) => go({ page: p > 1 ? p : null })}
            />
          </>
        )
      }
      detail={detailPane}
    />
  );
}
