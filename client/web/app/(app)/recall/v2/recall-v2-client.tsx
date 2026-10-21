'use client';

import { itemHref } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Map as MapIcon, Plus, Search } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { StatePill } from '@/components/item-list/state-pill';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { recallAdapter } from '@/components/item-tree/kinds/simple';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { useListNav } from '@/lib/use-list-nav';
import {
  fetchAllMaps,
  isNativeMap,
  mapToPin,
  recallKeys,
  type RecallMapsPage,
} from '@/lib/recall-v2';
import { CreateMapDialog } from './map-dialogs';
import { MapWorkbench, type EditGuard } from './map-workbench';
import { useLeaveGuard } from '@/lib/use-leave-guard';

export type RecallV2View = 'cards' | 'graph' | 'revisions';

/**
 * Recall v2: the native map editor. A map is one `recall` item and its cards
 * are rows the brain checks as they are written, so there is no compile step
 * and nothing here ever shows a stale map.
 *
 * URL state: `selected` (map id), `view` (cards, graph, revisions), `card`
 * (the open card's slug), `q` and `page`.
 */
export function RecallV2Client({
  selected,
  view,
  card,
  q,
  page,
}: {
  selected: string | null;
  view: RecallV2View;
  card: string | null;
  q: string;
  page: number;
}) {
  const mapsQuery = useQuery({
    queryKey: ['recall', 'maps', { q, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (page > 1) params.set('page', String(page));
      const qs = params.toString();
      return apiFetch<RecallMapsPage>(`/api/recall/maps${qs ? `?${qs}` : ''}`);
    },
    placeholderData: (prev) => prev,
  });

  if (mapsQuery.isPending && !mapsQuery.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (mapsQuery.isError && !mapsQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Could not load the Recall maps.</p>
        <Button variant="outline" size="sm" onClick={() => mapsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <RecallV2View
      data={mapsQuery.data}
      selected={selected}
      view={view}
      card={card}
      q={q}
      page={page}
    />
  );
}

function RecallV2View({
  data,
  selected,
  view,
  card,
  q,
  page,
}: {
  data: RecallMapsPage;
  selected: string | null;
  view: RecallV2View;
  card: string | null;
  q: string;
  page: number;
}) {
  // Maximise from the item header collapses the list.
  const { zen } = useZenMode();
  const { pending: navPending, go: goList } = useListNav();
  // The open map is the address (`/recall/<id>`, item header contract phase
  // 5): a change of `selected` moves the path; every other param stays a
  // query param.
  const go = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      if (!('selected' in patch)) return goList(patch);
      const { selected: to, ...rest } = patch;
      goList(rest, to ? itemHref('recall', String(to)) : '/recall');
    },
    [goList],
  );
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  // "New map inside" a tree folder: where the new map goes.
  const [createIn, setCreateIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('recall', 'map');
  const startCreate = (folder: TreeFolder | null = null) => {
    setCreateIn(folder);
    setCreating(true);
  };
  // `isNativeMap` drops a page-built row a brain from before mantle R5 could
  // still list (see lib/recall-v2).
  const maps = useMemo(() => data.maps.filter(isNativeMap), [data.maps]);

  // Every map, not just this page of the catalog: option targets can lead to
  // any published map, and the tree opens the first of all of them. The page
  // itself still drives the list mode's cards and pager.
  const allQuery = useQuery({
    queryKey: recallKeys.allMaps,
    queryFn: () =>
      fetchAllMaps((p) => apiFetch<RecallMapsPage>(`/api/recall/maps${p > 1 ? `?page=${p}` : ''}`)),
  });
  const allMaps = useMemo(
    () => (allQuery.data ? allQuery.data.filter(isNativeMap) : maps),
    [allQuery.data, maps],
  );

  // The unsaved-edit guard. The card editor reports whether it holds unsaved
  // edits; anything here that would unmount it (another map, a new map, a
  // link off the screen, closing the tab) asks first.
  const [dirty, setDirty] = useState(false);
  const [held, setHeld] = useState<(() => void) | null>(null);
  // Read through a ref, so a navigation the reader let go (Discard) that
  // asks again on its way (the tree's open after a workspace switch, run
  // through guardedNavigate) is not asked twice.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const guarded = useCallback((nav: () => void) => {
    if (dirtyRef.current) setHeld(() => nav);
    else nav();
  }, []);
  useLeaveGuard(dirty, guarded);
  const guard: EditGuard = useMemo(
    () => ({ dirty, onDirtyChange: setDirty, guarded }),
    [dirty, guarded],
  );
  const total = data.total ?? maps.length;
  const pageSize = data.pageSize ?? Math.max(1, maps.length);

  // The item tree when this brain serves it for Recall (folders, then maps);
  // the paged catalog for a brain before it, or if a tree call 404s. In the
  // tree, a selected map need not be on the catalog page, so the id alone
  // opens it.
  const treeServes = useTreeServes('recall');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  // The URL's map when it names one, even off this page of the catalog (the
  // workbench loads it by id); else the first map shown.
  const selectedId = useMemo(() => {
    if (selected) return selected;
    if (showTree) return allMaps[0]?.id ?? null;
    return maps[0]?.id ?? null;
  }, [maps, allMaps, selected, showTree]);

  // Pin the map opened by default into the URL (replace, not push), so a
  // catalog refetch that lists another map first cannot swap the workbench,
  // and an unsaved card with it. In the tree it waits for every map, since
  // it picks the first native one of all of them.
  const router = useRouter();
  const searchParams = useSearchParams();
  const pin = mapToPin(
    selected,
    selectedId,
    treeServes !== undefined && (!showTree || !allQuery.isPending),
  );
  useEffect(() => {
    if (!pin) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('selected');
    const rest = params.toString();
    router.replace(`${itemHref('recall', pin)}${rest ? `?${rest}` : ''}`, { scroll: false });
  }, [pin, router, searchParams]);

  /** Open another map, asking first when the open card has unsaved edits. */
  const openMap = (id: string) => {
    if (id === selectedId) return;
    guarded(() => go({ selected: id, card: null }));
  };

  const [searchInput, setSearchInput] = useState(q);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setSearchInput(q);
  }, [q]);
  useEffect(() => {
    const h = setTimeout(() => {
      // Pin the open map, so a search that no longer lists it does not
      // swap it out (and throw away an edit in progress).
      if (searchInput.trim() !== q) {
        go({ q: searchInput.trim() || null, page: null, selected: selected ?? selectedId });
      }
    }, 350);
    return () => clearTimeout(h);
  }, [searchInput, q, go, selected, selectedId]);

  const createDialog = creating && (
    <CreateMapDialog
      open
      onOpenChange={setCreating}
      folderName={createIn?.name ?? null}
      onCreated={async (mapId) => {
        if (createIn) await fileNew(mapId, createIn);
        guarded(() => go({ selected: mapId, view: null, card: null, q: null, page: null }));
      }}
    />
  );

  if (total === 0 && !q) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <MapIcon className="size-8 opacity-50" aria-hidden />
          <p className="font-medium text-foreground">No Recall maps yet</p>
          <p className="max-w-md">
            A map is a set of cards agents walk one at a time. Each card says when to open it and
            where to go next. Start one here; its entry card is written for you.
          </p>
          <div className="mt-2">
            <Button size="sm" onClick={() => startCreate()}>
              <Plus /> New map
            </Button>
          </div>
        </div>
        {createDialog}
      </>
    );
  }

  const list = (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Maps
          </h2>
          <Button size="sm" onClick={() => startCreate()}>
            <Plus /> New map
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search maps…"
            className="h-9 pl-8"
          />
        </div>
      </div>
      <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
        {maps.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            No maps match.
          </p>
        ) : (
          maps.map((m) => (
            <ListCard key={m.id} selected={m.id === selectedId} onClick={() => openMap(m.id)}>
              <ListCardTitle className="flex items-center gap-2">
                <span className="min-w-0 truncate">{m.title}</span>
                {!m.published && <StatePill state="draft" />}
              </ListCardTitle>
              <ListCardMeta className="flex min-w-0 items-center gap-1.5">
                {[
                  m.folder && (
                    <span key="folder" className="truncate">
                      {m.folder}
                    </span>
                  ),
                  <span key="slug" className="truncate font-mono">
                    {m.slug}
                  </span>,
                  <span key="count" className="tabular-nums">
                    {m.nodeCount} {m.nodeCount === 1 ? 'card' : 'cards'}
                  </span>,
                ]
                  .filter(Boolean)
                  .flatMap((part, i) =>
                    i === 0 ? [part] : [<span key={`sep-${i}`}>·</span>, part],
                  )}
              </ListCardMeta>
            </ListCard>
          ))
        )}
      </div>
      <ListPager
        page={page}
        total={total}
        pageSize={pageSize}
        pending={navPending}
        onGo={(p) => go({ page: p > 1 ? p : null, selected: selected ?? selectedId })}
      />
    </div>
  );

  // The workbench loads the map by id, so one opened from the URL or the
  // tree need not be on this page of the catalog.
  const detail = selectedId ? (
    <MapWorkbench
      key={selectedId}
      mapId={selectedId}
      catalog={allMaps}
      view={view}
      cardSlug={card}
      guard={guard}
    />
  ) : null;

  const newMapButton = (
    <Button size="sm" onClick={() => startCreate()}>
      <Plus /> New map
    </Button>
  );
  const tree = (
    <aside className="flex h-full flex-col bg-muted/20">
      <div className="min-h-40 flex-1">
        {fileConfirm}
        <ItemTree
          kind="recall"
          adapter={recallAdapter}
          selectedItemId={selectedId}
          query={treeQuery}
          onQueryChange={setTreeQuery}
          searchPlaceholder="Search maps and folders…"
          actions={newMapButton}
          newItemInFolder={{ label: 'map', icon: MapIcon, onCreate: (f) => startCreate(f) }}
          onOpenItem={(item) => openMap(item.id)}
          onUnsupported={() => setTreeGone(true)}
          // A move changes a map's folder, which the catalog and the map's
          // header show; the tree refreshes itself.
          onChanged={() => void qc.invalidateQueries({ queryKey: recallKeys.maps })}
        />
      </div>
    </aside>
  );

  return (
    <>
      <div className="relative h-full min-h-0">
        <MasterDetail
          id="recall-v2"
          listCollapsed={zen}
          list={showTree ? tree : list}
          detail={detail}
          detailFills
        />
      </div>
      {createDialog}
      <AlertDialog
        open={held !== null}
        onOpenChange={(o) => {
          if (!o) setHeld(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The open card has edits that are not saved. Leaving it throws them away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const nav = held;
                setHeld(null);
                setDirty(false);
                dirtyRef.current = false;
                nav?.();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
