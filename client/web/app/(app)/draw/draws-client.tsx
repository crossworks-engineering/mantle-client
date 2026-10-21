'use client';

import { itemHref, useItemAddress } from '@/components/layout/use-item-address';
import { DrawDetailClient } from './[id]/draw-detail-client';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PenTool, Plus, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { TagPill } from '@mantle/web-ui/tag-pill';
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
import { useExportTool } from '@/components/export/export-menu';
import { useListNav } from '@/lib/use-list-nav';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { drawSnapshotClass } from '@/components/draw/snapshot-theme';
import { HeaderPill, ItemHeader, type HeaderTool } from '@/components/layout/item-header';
import { shareMarksOf } from '@/components/share/access-stack';
import { AccessSlot } from '@/components/share/access-slot';
import { DrawViewer } from '@/components/draw/draw-viewer';
import { Move } from 'lucide-react';
import { useZenMode } from '@/components/layout/zen-mode';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { ItemCard, ItemIcon } from '@/components/item-list/item-card';
import { ItemListHeader, ItemListScroll, NewButton } from '@/components/item-list/item-list-header';
import { ClearFilter, SortMenu, TagFilter } from '@/components/item-list/item-filters';
import { useCardDetails } from '@/components/item-list/use-card-details';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { DropdownMenuItem } from '@mantle/web-ui/ui/dropdown-menu';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { drawAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';

type DrawRow = {
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  description: string | null;
  summary: string | null;
  visibility: 'private' | 'public';
  hasSvg: boolean;
  hasDraft: boolean;
  createdAt: string;
  updatedAt: string;
  // No audience, inherited or embedded since W5b2 (contract 34): the list's
  // workspace chips and hasLink say who reads it.
};

type ListResponse = {
  draws: DrawRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: { tag: string; count: number }[];
};

type DrawSort = 'edited' | 'newest' | 'oldest' | 'title';
const SORT_LABELS: Record<DrawSort, string> = {
  edited: 'Last edited',
  newest: 'Newest',
  oldest: 'Oldest',
  title: 'Title A–Z',
};
const isSort = (v: string | null): v is DrawSort => !!v && v in SORT_LABELS;

export function DrawsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { pending, go } = useListNav();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  // New asks for a title; Enter in the title creates it.
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // "New drawing inside" a tree folder: where it goes.
  const [createIn, setCreateIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('draw', 'drawing');
  const openCreate = (folder: TreeFolder | null = null) => {
    setNewTitle('');
    setCreateIn(folder);
    setCreateOpen(true);
  };

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const tag = searchParams.get('tag')?.trim() ?? '';
  // The drawing in the address (`/draw/<id>`, `?edit=1` to edit); an old
  // `?id=` link moves there.
  const address = useItemAddress('draw', 'id');
  const urlId = address.id;
  const sortParam = searchParams.get('sort');
  const sort: DrawSort = isSort(sortParam) ? sortParam : 'edited';
  const [details, changeDetails] = useCardDetails('mantle_draws_card_details_v1');

  // The item tree when this brain serves it for drawings (docs/folder-tree.md);
  // the paged card list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('draw');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  // Selection lives in client state; `select` mirrors it to the URL with
  // replaceState (no navigation) — the param is an entry point, not truth.
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  // The tree row a drawing was opened from: its share marks, for Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);
  useEffect(() => {
    if (urlId) setSelectedId(urlId);
  }, [urlId]);

  const [deleteTarget, setDeleteTarget] = useState<Pick<DrawRow, 'id' | 'title'> | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Focus mode drops the list column so a drawing can be LOOKED AT full-width,
  // not only drawn that way. The toggle lives in the preview header below.
  const { zen } = useZenMode();

  async function deleteActive() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiSend(`/api/draws/${deleteTarget.id}`, 'DELETE');
      toast.success('Drawing deleted');
      setSelectedId(null);
      if (address.id === deleteTarget.id) address.close();
      await queryClient.invalidateQueries({ queryKey: ['draws'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('draw') });
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the drawing');
    } finally {
      setDeleting(false);
    }
  }

  const [searchInput, setSearchInput] = useState(query);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setSearchInput(query);
  }, [query]);
  useEffect(() => {
    if (searchInput === query) return;
    const t = setTimeout(() => go({ q: searchInput || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [searchInput, query, go]);

  const listQuery = useQuery({
    queryKey: ['draws', { q: query, tag, page, sort }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (tag) qs.set('tag', tag);
      if (page > 1) qs.set('page', String(page));
      if (sort !== 'edited') qs.set('sort', sort);
      return apiFetch<ListResponse>(`/api/draws?${qs.toString()}`);
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  const draws = useMemo(
    () => (showTree ? [] : (listQuery.data?.draws ?? [])),
    [showTree, listQuery.data],
  );
  // A drawing that is not among the list rows (opened from the tree, or a deep
  // link off this page of the list) loads by id. The detail route answers the
  // row's fields plus the scene.
  const selectedDrawQuery = useQuery({
    queryKey: ['draws', selectedId],
    queryFn: () => apiFetch<{ draw: DrawRow }>(`/api/draws/${selectedId}`).then((r) => r.draw),
    enabled: !!selectedId && !draws.some((d) => d.id === selectedId),
  });
  // The first card when nothing is picked (auto-select).
  const activeId = selectedId ?? draws[0]?.id ?? null;
  const active =
    draws.find((d) => d.id === activeId) ??
    (activeId && selectedDrawQuery.data?.id === activeId ? selectedDrawQuery.data : null);
  // Draw opens on this drawing next time (lib/last-opened.ts): one the user
  // picked and that loaded, not the first card shown by default.
  useRememberLastOpened('draw', selectedId && active?.id === selectedId ? selectedId : null);

  function select(id: string) {
    setSelectedId(id);
    if (id !== address.id || address.editing) address.open(id);
  }

  async function createDraw() {
    if (creating) return;
    setCreating(true);
    const title = newTitle.trim() || 'Untitled drawing';
    try {
      const { draw } = await apiSend<{ draw: { id: string } }>('/api/draws', 'POST', {
        title,
      });
      if (createIn) {
        setCreateOpen(false);
        await fileNew(draw.id, createIn);
      }
      await queryClient.invalidateQueries({ queryKey: ['draws'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('draw') });
      router.push(itemHref('draw', draw.id, true));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the drawing');
      setCreating(false);
    }
  }

  if (!showTree && listQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!showTree && listQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Could not load drawings.</p>
        <Button variant="outline" onClick={() => void listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <MasterDetail
        id="draw"
        // The fixed 360px column this screen has always had — draggable now.
        defaultListSize="360px"
        // The detail is a DRAWING: an SVG snapshot, or a pan-and-zoom canvas.
        // The 672px default measure exists to protect a line of text, and
        // capping a diagram at it would shrink the thing the screen is for.
        detailFills
        // Focus mode. The list COLLAPSES rather than unmounting, so the search
        // box, scroll position and page survive the round trip — see the prop's
        // note in master-detail.tsx.
        listCollapsed={zen}
        list={
          showTree ? (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="draw"
                adapter={drawAdapter}
                selectedItemId={activeId}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search drawings and folders…"
                newItemInFolder={{ label: 'drawing', onCreate: (f) => openCreate(f) }}
                actions={<NewButton onClick={() => openCreate()} busy={creating} />}
                onOpenItem={(item) => {
                  setOpenedRow(item);
                  select(item.id);
                }}
                itemActions={(item) =>
                  itemAccess(item).manage ? (
                    <DropdownMenuItem
                      className="text-destructive-ink focus:text-destructive-ink"
                      onSelect={() => setDeleteTarget({ id: item.id, title: item.title })}
                    >
                      <Trash2 />
                      Delete…
                    </DropdownMenuItem>
                  ) : null
                }
                // A share or a move changes the level the open item is read
                // at: its header badge and client thread follow.
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['draws'] })}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <>
              <ItemListHeader
                search={searchInput}
                onSearch={setSearchInput}
                placeholder="Search drawings…"
                actions={<NewButton onClick={() => openCreate()} busy={creating} />}
              >
                <SortMenu
                  value={sort}
                  labels={SORT_LABELS}
                  onChange={(v) => go({ sort: v === 'edited' ? null : v, page: null })}
                />
                <TagFilter
                  tags={listQuery.data?.tags ?? []}
                  activeTag={tag || null}
                  onSelect={(t) => go({ tag: t, page: null })}
                  details={details}
                  onDetailsChange={changeDetails}
                  allLabel="All drawings"
                />
                {tag ? (
                  <ClearFilter
                    onClear={() => go({ tag: null, page: null })}
                    title="Clear tag filter"
                  />
                ) : null}
              </ItemListHeader>

              <ItemListScroll pending={pending}>
                {draws.length === 0 && (query || tag) ? (
                  <div className="space-y-3 px-1 py-8 text-center">
                    <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => go({ q: null, tag: null, page: null })}
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : draws.length === 0 ? (
                  <div className="space-y-3 px-1 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No drawings yet. Sketch an idea, an architecture, a plan. Commits land in the
                      brain like every other content type.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openCreate()}
                      disabled={creating}
                    >
                      {creating ? <Spinner /> : <Plus />}
                      New drawing
                    </Button>
                  </div>
                ) : (
                  draws.map((d) => (
                    <ItemCard
                      key={d.id}
                      id={d.id}
                      kind="draw"
                      title={d.title}
                      icon={<ItemIcon emoji={d.icon} fallback={<PenTool />} />}
                      badge={
                        <>
                          {/* A dot, not a word: the row is a scan target and the
                                preview pane carries the full explanation. */}
                          {d.hasDraft && (
                            <span
                              className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                              title="Uncommitted edits"
                              aria-label="Uncommitted edits"
                            />
                          )}
                          <WorkspaceChips item={d} className="mt-0.5" />
                        </>
                      }
                      selected={activeId === d.id}
                      onSelect={() => select(d.id)}
                      updatedAt={d.updatedAt}
                    >
                      {details && d.summary ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{d.summary}</p>
                      ) : null}
                      {details && d.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {d.tags.map((t) => (
                            <TagPill key={t} tag={t} />
                          ))}
                        </div>
                      ) : null}
                    </ItemCard>
                  ))
                )}
              </ItemListScroll>

              <ListPager
                page={page}
                total={listQuery.data?.total ?? 0}
                pageSize={listQuery.data?.pageSize ?? 50}
                pending={pending}
                onGo={(p) => go({ page: p > 1 ? p : null })}
                noun={{ one: 'drawing', many: 'drawings' }}
              />
            </>
          )
        }
        // No wrapper: the preview is a plain document with no pinned header of
        // its own, so `MasterDetail`'s pane is the only scroller.
        detail={
          address.editing && address.id ? (
            // The editor, beside the folders; it owns its header.
            <div className="h-full min-h-0">
              <DrawDetailClient key={address.id} drawId={address.id} />
            </div>
          ) : active ? (
            <DrawPreview
              key={active.id}
              draw={active}
              shares={shareMarksOf(active, openedRow)}
              onOpen={() => router.push(itemHref('draw', active.id, true))}
              onDelete={() => setDeleteTarget(active)}
            />
          ) : activeId && selectedDrawQuery.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a drawing.</p>
            </div>
          )
        }
      />

      {fileConfirm}
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createIn ? `New drawing in “${createIn.name}”` : 'New drawing'}
            </DialogTitle>
            <DialogDescription>Give it a name, or leave it Untitled.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createDraw();
            }}
          >
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Untitled drawing"
              aria-label="Drawing title"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Spinner /> : <Plus />}
                Create drawing
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this drawing?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title ?? ''}” and its brain index will be removed. Images embedded
              from the files area are kept there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void deleteActive()}
            >
              {deleting ? 'Deleting…' : 'Delete drawing'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Read-only preview: the committed SVG snapshot plus metadata and the Open
 * button. No canvas is mounted here, so browsing the list never pays the
 * editor chunk.
 *
 * The snapshot renders as an IMAGE, not as injected markup. This screen is the
 * owner's authenticated session, which makes it the worst place to inline
 * third-party-shaped SVG: referenced as an image, the browser treats the file
 * as a separate, script-disabled document, so nothing inside it can touch this
 * page. The bytes still arrive over an authenticated fetch (an image element's
 * src can't carry a bearer in the detached deployment), then become a blob URL.
 */
function DrawPreview({
  draw,
  shares,
  onOpen,
  onDelete,
}: {
  draw: DrawRow;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  onOpen: () => void;
  onDelete: () => void;
}) {
  // The JSON snapshot route and Export are for an Admin user only (W6b).
  // Any other login reads the snapshot as raw bytes in an image: the shell
  // maps that path onto the route their login may read.
  const isAdminUser = useIsAdminUser();
  const toAsset = useAssetUrl();
  // The login's caps on the drawing (W6b fix round): no Edit without
  // mayEdit (never on a snapshot copy), no Grant Access or Delete without
  // mayManage.
  const access = itemAccess(draw);
  const note = readOnlyNote(access);
  const svgQuery = useQuery({
    queryKey: ['draws', draw.id, 'svg'],
    queryFn: () => apiFetch<{ svg: string | null }>(`/api/draws/${draw.id}/svg`).then((r) => r.svg),
    enabled: isAdminUser,
    // Deliberately NOT gated on draw.hasSvg. A drawing with no snapshot is
    // exactly the case the render fallback exists for (an agent authored it,
    // or a client-side export failed), and gating the fetch on "a snapshot
    // already exists" meant that case could never heal from this screen. The
    // route answers an empty scene straight from SQL, so a drawing with
    // nothing on it still costs no browser session.
  });

  const svg = svgQuery.data;
  // The interactive view-mode canvas, off by default. Resets per drawing (the
  // pane is keyed on the id), so selecting another row starts from the cheap
  // snapshot again rather than mounting a canvas you didn't ask for.
  const [interactive, setInteractive] = useState(false);
  const { zen } = useZenMode();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [svg]);

  const download = useExportTool(draw.id, 'draw');
  // The snapshot can't be panned or zoomed, so a diagram bigger than the pane
  // was unreadable without opening it for EDITING. This mounts the real
  // canvas in upstream's view mode instead: pan and zoom, no editing. Off by
  // default so browsing the list keeps costing one image rather than the
  // editor bundle.
  const panZoom: HeaderTool = {
    key: 'pan-zoom',
    label: interactive ? 'Back to the snapshot' : 'Pan and zoom (read-only)',
    icon: <Move />,
    pressed: interactive,
    onSelect: () => setInteractive((v) => !v),
  };
  const description = draw.description ?? draw.summary;

  return (
    <div className="w-full">
      {/* The item header (contract 2026-10-21): one row; the description,
          tags and the read-only note behind Info. Share without opening the
          canvas: no `beforeEnable` here, unlike the editor's, because
          committing means capturing the snapshot in the editor, so the link
          serves the last COMMITTED scene. The "uncommitted" pill says when
          that is behind. */}
      <ItemHeader
        sticky
        section="Drawings"
        visual={<span aria-hidden>{draw.icon ?? '✏️'}</span>}
        title={draw.title}
        badges={
          draw.hasDraft ? (
            <HeaderPill title="Showing the last commit: your newer edits are saved in the drawing">
              uncommitted
            </HeaderPill>
          ) : null
        }
        access={<AccessSlot type="draw" nodeId={draw.id} canShare={access.share} shares={shares} />}
        tools={isAdminUser ? [panZoom, download] : [panZoom]}
        onDelete={access.manage ? onDelete : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete drawing"
        move={access.move ? { kind: 'draw', item: { id: draw.id, title: draw.title } } : null}
        edit={
          access.edit
            ? { href: itemHref('draw', draw.id, true), label: 'Edit drawing' }
            : { disabled: true }
        }
        info={{
          description: description ?? undefined,
          tags: draw.tags,
          rows: [
            ...(note ? [{ label: 'Access', value: note }] : []),
            ...(draw.hasDraft
              ? [
                  {
                    label: 'Shown',
                    value: 'The last commit. Newer edits are saved in the drawing.',
                  },
                ]
              : []),
          ],
        }}
        infoLabel="About this drawing"
      />

      <div className="space-y-4 p-6">
        {/* The viewer reads the SCENE, not the snapshot, so it is offered ahead
          of the snapshot checks below — a drawing whose render failed (or that
          an agent authored) can still be looked at properly. */}
        {interactive ? (
          // Given real height, because a canvas has no intrinsic one — and more
          // of it in focus mode, where the shell's chrome is gone.
          <div
            className={cn(
              'w-full overflow-hidden rounded-lg border border-border',
              zen ? 'h-[calc(100vh-13rem)]' : 'h-[70vh]',
            )}
          >
            {/* Same reasoning as the detail screen: a scene this viewer cannot
              read is one row of a list, not the list. */}
            <SurfaceErrorBoundary label="this drawing" resetKeys={[draw.id]}>
              <DrawViewer drawId={draw.id} />
            </SurfaceErrorBoundary>
          </div>
        ) : !isAdminUser && draw.hasSvg ? (
          // eslint-disable-next-line @next/next/no-img-element -- the raw SVG bytes of a committed snapshot; next/image can't take a signed asset path
          <img
            src={toAsset(`/api/draws/${draw.id}/svg?raw=1`)}
            alt={draw.title}
            className="h-auto w-full"
          />
        ) : isAdminUser && svgQuery.isPending ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : src ? (
          <>
            {/* The snapshot fills its pane plainly — no border, mat or box; the
              SVG carries its own background. Still an IMAGE, never inline
              markup (see the loader note above). Under the dark theme it takes
              the canvas's own inversion so the preview matches the editor the
              drawing was made in — view-time only, nothing stored changes. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL of an owner-generated SVG; next/image can't take it */}
            <img
              src={src}
              alt={draw.title}
              className={cn('h-auto w-full', drawSnapshotClass(svg))}
            />
          </>
        ) : (
          <PreviewEmpty
            label={
              draw.hasDraft
                ? 'Your uncommitted edits are saved — open the drawing to carry on. The preview appears once you commit.'
                : 'Nothing to preview yet. Open the drawing and commit to create one.'
            }
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}

function PreviewEmpty({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <RowButton
      onClick={onOpen}
      className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-muted/40"
    >
      <PenTool className="size-6" />
      {label}
    </RowButton>
  );
}
