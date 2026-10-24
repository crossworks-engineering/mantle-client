'use client';

import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { PageDetailClient } from './[id]/page-detail-client';
import { noteListAnswer } from '@/lib/workspace-filter';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { revealInFolds } from '@mantle/share-ui/heading-fold-dom';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/react';
import {
  ChevronLeft,
  ChevronRight,
  CornerLeftUp,
  FolderInput,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import type { PageSort } from '@mantle/client-types';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
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
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { Skeleton } from '@mantle/web-ui/ui/skeleton';
import { useToast } from '@mantle/web-ui/ui/toast';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { ItemCard, ItemCardAction, ItemIcon, UpdatedStamp } from '@/components/item-list/item-card';
import {
  ItemListEmpty,
  ItemListHeader,
  ItemListScroll,
  NewButton,
} from '@/components/item-list/item-list-header';
import {
  ClearFilter,
  SortMenu,
  TagFilter,
  type TagCount,
} from '@/components/item-list/item-filters';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { useCardDetails } from '@/components/item-list/use-card-details';
import { TagInput } from '@/components/tag-input';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { pagesAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useLiveTreeFolder } from '@/components/item-tree/use-tree-cache';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import { visibilityRefusal } from '@/components/item-tree/sharing';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { PageView } from '@/components/page-editor/page-view';
import { CanvasEmbedHost } from '@/components/page-editor/canvas-embed';
import { shareMarksOf } from '@/components/share/access-stack';
import { AccessSlot } from '@/components/share/access-slot';
import { PageOutline } from '@mantle/web-ui/page-outline';
import { buildPageToc } from '@mantle/content-core/page-toc';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { useZenMode } from '@/components/layout/zen-mode';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { MeasurePane } from '@mantle/web-ui/ui/measure-pane';
import { useExportTool } from '@/components/export/export-menu';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime, updatedAgo } from '@mantle/web-ui/lib/format-datetime';
import {
  buildChildrenIndex,
  pagePath,
  sortBySubtreeEdit,
  subtreeEditedAt,
} from '@mantle/web-ui/page-tree';
import { scrollBehavior } from '@mantle/web-ui/lib/motion';
import type { PageListRow as ContractPageListRow, PageRow } from '@mantle/client-types';

// Wire shape is the GET /api/pages mapper's output — single source of truth
// (the canonical row also carries `width`, unused by this list view). Drift
// between the mapper and what this screen renders is now a compile error.

/**
 * A list row as the server sends it: the page plus its place in the hierarchy
 * (the contract's `PageListRow`). Both placement fields are read as OPTIONAL
 * here although the contract makes them required, because a brain older than
 * mantle v0.232.206 leaves them out, and this screen then behaves as it did
 * before (a search hit has no way into its sub-pages) rather than breaking.
 */
type PageListRow = PageRow & Partial<Pick<ContractPageListRow, 'childCount' | 'parentTitle'>>;

/** Droppable id for the "move to the top level" zone shown while dragging a
 *  nested page. A literal sentinel — page ids are uuids, so it never collides. */
const TOP_LEVEL_DROP_ID = '__pages_root__';

/** Droppable id for the breadcrumb, which un-nests a page by one level while
 *  drilled in (§5.3 of the handover). Same sentinel rule as above. */
const UP_LEVEL_DROP_ID = '__pages_up__';

/** Cards are ~4x the height of the old tree rows, so a level pages at 25 where
 *  the server's flat search list pages at 50. Client-side for now: tree mode
 *  ships the whole corpus (see the handover §3b) — when mantle grows
 *  `?parent=` + `childCount`, this becomes the server's `pageSize`. */
const LEVEL_PAGE_SIZE = 25;

/** Card density, remembered per browser. A display preference, not part of the
 *  query — putting it in the URL would paste it into every link someone
 *  shares, and it says nothing about WHICH pages you are looking at. */
const DETAILS_KEY = 'mantle_pages_card_details_v1';

const SORT_LABELS: Record<PageSort, string> = {
  edited: 'Last edited',
  newest: 'Newest',
  oldest: 'Oldest',
  title: 'Title A–Z',
};

const SORTS: PageSort[] = ['edited', 'newest', 'oldest', 'title'];

type PagesListResponse = {
  mode: 'tree' | 'list';
  pages: PageListRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: TagCount[];
};

export function PagesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Every open page has its own address, read or edited, so it can be copied
  // and shared as it is: `/pages/<id>` reads the page, `/pages/<id>?edit=1`
  // edits it, both in the detail pane with the tree still beside them
  // (phase 5). `/pages` alone opens on the first page.
  const routeParam = useParams<{ id?: string }>().id;
  const routeId = typeof routeParam === 'string' ? routeParam : null;
  const editId = routeId && searchParams.get('edit') === '1' ? routeId : null;
  // Pages opens on the page read last (lib/last-opened.ts); the editor
  // remembers the one edited.
  useRememberLastOpened('pages', routeId && !editId ? routeId : null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [navPending, startNav] = useTransition();

  // URL is the source of truth (matches the old SSR page); the data query keys
  // off these so a `go()` navigation re-fetches automatically.
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const activeTag = searchParams.get('tag')?.trim() || null;
  const sortParam = searchParams.get('sort');
  const sort: PageSort = SORTS.includes(sortParam as PageSort) ? (sortParam as PageSort) : 'edited';
  // Drill-down: which level the list column is showing. null = top level.
  // Only meaningful in tree mode — a search spans levels, so it has no parent.
  const parentParam = searchParams.get('parent')?.trim() || null;

  // The item tree when this brain serves it for pages (folder phase 7,
  // docs/folder-tree.md: pages live in folders and never nest); the card
  // list below, with its drill-down, for a brain before it, or if a tree
  // call 404s.
  const treeServes = useTreeServes('pages');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();
  // The folder open in the tree: where New files the page (null = the top
  // level, the tree's root row). Followed through the tree's cache: renamed
  // or moved, it is the folder as it is now; deleted (here or in another
  // tab), New goes back to the top level.
  const [pickedFolder, setTreeFolder] = useState<TreeFolder | null>(null);
  const treeFolder = useLiveTreeFolder('pages', 'owner', pickedFolder);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('pages', 'page');
  // New came from a folder's "New page inside": the page goes there, so the
  // dialog names it.
  const [inside, setInside] = useState(false);
  useEffect(() => {
    if (pickedFolder && !treeFolder) setTreeFolder(null);
  }, [pickedFolder, treeFolder]);

  // The switcher's workspace (W5b): the list shows its items only.
  const ws = useListWorkspace();
  const listQuery = useQuery({
    queryKey: ['pages', { q: query, tag: activeTag, sort, page, ws }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (activeTag) qs.set('tag', activeTag);
      if (sort !== 'edited') qs.set('sort', sort);
      if (page > 1) qs.set('page', String(page));
      if (ws) qs.set('ws', ws);
      return apiFetch<PagesListResponse>(`/api/pages?${qs.toString()}`).then((r) =>
        noteListAnswer(r, ws),
      );
    },
    placeholderData: (prev) => prev, // keep the list visible while paging/filtering
    enabled: !showTree,
  });

  const mode = listQuery.data?.mode ?? (query || activeTag ? 'list' : 'tree');
  const pages = useMemo(
    () => (showTree ? [] : (listQuery.data?.pages ?? [])),
    [showTree, listQuery.data?.pages],
  );
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 50;
  const tags = listQuery.data?.tags ?? [];

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ title: string; tags: string[] }>({ title: '', tags: [] });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pick<PageRow, 'id' | 'title'> | null>(null);
  // Authoritative descendant count for the delete warning — fetched on open so
  // it's accurate even in filtered/paginated 'list' mode (where the client
  // doesn't hold the whole tree). null = not yet loaded.
  const [deleteDescendants, setDeleteDescendants] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The page in the address is the selected one, read or edited.
  useEffect(() => {
    if (routeId) setSelectedId(routeId);
  }, [routeId]);
  // The tree row a page was opened from: its share marks (workspaces, open
  // link), which the detail route does not answer, for the header's Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);

  const [searchInput, setSearchInput] = useState(query);
  // The `q` a navigation already in flight is heading for. Leaving a search by
  // drilling into a hit clears the box AND the URL together; without this the
  // debounced sync below could fire before the URL catches up, read the empty
  // box as a new search, and navigate to the top level over the drill.
  const pendingQuery = useRef<string | null>(null);

  // Card density. Defaults to OFF: the column is for FINDING a page, and a
  // title plus its sub-page count is what you scan (useCardDetails).
  const [details, changeDetails] = useCardDetails(DETAILS_KEY);

  // Focus mode drops the list column so a page can be READ full-width, not
  // only written that way. The toggle lives in the preview header below.
  const { zen } = useZenMode();

  // Tree index: parent id → sorted children (null key = top-level). See
  // buildChildrenIndex for the orphan-as-root + cycle-safety rules.
  const childrenByParent = useMemo(() => buildChildrenIndex(pages), [pages]);

  const childCountOf = (id: string) => childrenByParent.get(id)?.length ?? 0;
  const hasChildren = (id: string) => childCountOf(id) > 0;

  // ── The level on screen ──────────────────────────────────────────────────
  // Drill-down turns the hierarchy into ONE FLAT LIST at a time, which is what
  // makes paging it meaningful — page 2 of a tree would cut a branch in half.
  // A `parent` that isn't loaded falls back to the top level rather than
  // showing an empty column.
  const drillParent =
    mode === 'tree' && parentParam ? (pages.find((p) => p.id === parentParam) ?? null) : null;
  const drillId = drillParent?.id ?? null;
  /** The level the breadcrumb returns to — the drilled page's own parent. */
  const backParent = drillParent?.parentId
    ? (pages.find((p) => p.id === drillParent.parentId) ?? null)
    : null;

  // "Last edited" orders each level by the newest edit anywhere in a page's
  // SUBTREE, so editing a sub-page lifts its ancestors within their own levels
  // (see subtreeEditedAt for why this is not a server-side timestamp bump).
  // Tree mode only: a search hit is an individual page, and a parent that
  // merely contains an edited child is not a hit. The roll-up covers what the
  // client holds, which is the whole hierarchy up to the server's TREE_LIMIT.
  const subtreeEdits = useMemo(
    () => (mode === 'tree' ? subtreeEditedAt(pages, childrenByParent) : null),
    [mode, pages, childrenByParent],
  );
  const levelPages = useMemo((): PageListRow[] => {
    if (mode !== 'tree') return pages;
    const level = childrenByParent.get(drillId) ?? [];
    return sort === 'edited' && subtreeEdits ? sortBySubtreeEdit(level, subtreeEdits) : level;
  }, [mode, pages, childrenByParent, drillId, sort, subtreeEdits]);
  const levelTotal = mode === 'tree' ? levelPages.length : total;
  const levelPageSize = mode === 'tree' ? LEVEL_PAGE_SIZE : pageSize;
  const visiblePages =
    mode === 'tree'
      ? levelPages.slice((page - 1) * LEVEL_PAGE_SIZE, page * LEVEL_PAGE_SIZE)
      : pages;

  // What the detail shows: the page picked, else the first card of the list
  // (auto-select).
  // A page opened from the tree is not among the list rows: its row loads
  // by id (the detail route answers the row's fields plus the document;
  // the same cache entry the editor reads).
  const selectedPageQuery = useQuery({
    queryKey: ['pages', selectedId],
    queryFn: () => apiFetch<{ page: PageRow }>(`/api/pages/${selectedId}`).then((r) => r.page),
    enabled: showTree && !!selectedId,
  });
  const brainPicked =
    pages.find((p) => p.id === selectedId) ??
    (showTree && selectedId && selectedPageQuery.data?.id === selectedId
      ? selectedPageQuery.data
      : null);
  const selected: PageListRow | null = brainPicked ?? visiblePages[0] ?? null;
  const deleteHasChildren = deleteTarget ? hasChildren(deleteTarget.id) : false;
  useEffect(() => {
    // Pages do not nest on a brain with the tree: nothing to count.
    if (!deleteTarget || showTree) {
      setDeleteDescendants(null);
      return;
    }
    let cancelled = false;
    setDeleteDescendants(null);
    apiFetch<{ count?: number }>(`/api/pages/${deleteTarget.id}/descendant-count`)
      .then((d) => {
        if (!cancelled && d) setDeleteDescendants(typeof d.count === 'number' ? d.count : 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deleteTarget, showTree]);

  // ── Drag-to-reparent (level mode) ────────────────────────────────────────
  // The whole hierarchy is client-side here, so re-parenting is a drag of one
  // card onto another (→ nest under it), onto the top-level zone (→ un-nest),
  // or onto the breadcrumb (→ up one level). There's no manual sibling
  // ordering (children sort by title), so a drop is purely "set parent". A 6px
  // activation distance keeps plain clicks selecting.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRow = activeId ? (pages.find((p) => p.id === activeId) ?? null) : null;

  /** All pages beneath `id` in the tree (excludes `id` itself). Cycle-safe. */
  const descendantIdsOf = useMemo(() => {
    return (id: string): Set<string> => {
      const out = new Set<string>();
      const stack = [...(childrenByParent.get(id) ?? [])];
      while (stack.length) {
        const n = stack.pop()!;
        if (out.has(n.id)) continue;
        out.add(n.id);
        const kids = childrenByParent.get(n.id);
        if (kids) stack.push(...kids);
      }
      return out;
    };
  }, [childrenByParent]);

  // Targets you can't drop onto: the dragged page itself + its descendants
  // (would create a cycle). Recomputed when a drag starts.
  const invalidDropIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    const s = descendantIdsOf(activeId);
    s.add(activeId);
    return s;
  }, [activeId, descendantIdsOf]);

  const move = async (id: string, parentId: string | null) => {
    // Surface the result immediately, then re-pull the SSR tree (the same
    // refresh pattern create/delete use). The moved page lands in its new
    // parent's level; the breadcrumb is how you follow it there.
    try {
      await apiSend(`/api/pages/${id}/move`, 'POST', { parentId });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not move page');
      return;
    }
    toast.success(parentId ? 'Page moved' : 'Moved to top level');
    void queryClient.invalidateQueries({ queryKey: ['pages'] });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const sourceId = String(active.id);
    const src = pages.find((p) => p.id === sourceId);
    if (!src) return;
    const targetParent =
      over.id === TOP_LEVEL_DROP_ID
        ? null
        : over.id === UP_LEVEL_DROP_ID
          ? (drillParent?.parentId ?? null) // breadcrumb = up one level
          : String(over.id);
    if (targetParent === (src.parentId ?? null)) return; // already there — no-op
    // Belt-and-braces with the disabled drop targets + the server cycle guard.
    if (
      targetParent &&
      (targetParent === sourceId || descendantIdsOf(sourceId).has(targetParent))
    ) {
      toast.error("Can't move a page into one of its own sub-pages");
      return;
    }
    void move(sourceId, targetParent);
  };

  const buildHref = (over: {
    page?: number;
    tag?: string | null;
    q?: string | null;
    sort?: PageSort;
    parent?: string | null;
  }) => {
    const nextTag = over.tag !== undefined ? over.tag : activeTag;
    const nextQ = over.q !== undefined ? over.q : query || null;
    const nextPage = over.page !== undefined ? over.page : page;
    const nextSort = over.sort !== undefined ? over.sort : sort;
    const nextParent = over.parent !== undefined ? over.parent : drillId;
    const params = new URLSearchParams();
    if (nextTag) params.set('tag', nextTag);
    if (nextQ) params.set('q', nextQ);
    if (nextPage && nextPage > 1) params.set('page', String(nextPage));
    if (nextSort && nextSort !== 'edited') params.set('sort', nextSort); // 'edited' is default
    // A search spans levels, so it has no parent to sit under — callers that
    // set `q`/`tag` pass `parent: null` and this drops the param.
    if (nextParent) params.set('parent', nextParent);
    const s = params.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const go = (over: Parameters<typeof buildHref>[0]) =>
    startNav(() => router.push(buildHref(over)));

  useEffect(() => {
    const handle = setTimeout(() => {
      const heading = pendingQuery.current ?? query;
      pendingQuery.current = null;
      if (searchInput.trim() === heading) return;
      go({ q: searchInput.trim() || null, page: 1, parent: null });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      let created: PageRow;
      const create = (folderId?: string | null) =>
        apiSend<{ page: PageRow }>('/api/pages', 'POST', {
          title: form.title.trim(),
          tags: form.tags,
          ...(folderId !== undefined ? { folderId } : {}),
        });
      // In the tree, a new page lands in the folder that is open.
      const folder = showTree ? treeFolder : null;
      try {
        ({ page: created } = await create(showTree ? (folder?.id ?? null) : undefined));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        if (!folder || !visibilityRefusal(e)) {
          toast.error(e instanceof Error ? e.message : 'request failed');
          return;
        }
        // A shared folder: the page would be read at its share at once, so
        // the brain asks first. Made at the top level, then filed with the
        // tree's move, which shows that question.
        try {
          ({ page: created } = await create(null));
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 401) return;
          toast.error(e2 instanceof Error ? e2.message : 'request failed');
          return;
        }
        setOpen(false);
        await fileNew(created.id, folder);
      }
      setForm({ title: '', tags: [] });
      setOpen(false);
      toast.success('Page created');
      // Refresh the list cache so the new page is present on navigate-back.
      void queryClient.invalidateQueries({ queryKey: ['pages'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('pages') });
      // New pages open straight into the editor.
      router.push(`/pages/${created.id}?edit=1`);
    } finally {
      setSaving(false);
    }
  };

  // Create a sub-page under `parentId` and open it (create & edit, like New).
  const createChild = async (parentId: string) => {
    let created: PageRow;
    try {
      ({ page: created } = await apiSend<{ page: PageRow }>('/api/pages', 'POST', {
        title: 'Untitled page',
        parentId,
      }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not create sub-page');
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['pages'] }); // keep the list fresh
    router.push(`/pages/${created.id}?edit=1`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiSend(`/api/pages/${deleteTarget.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not delete page');
      return;
    }
    toast.success(
      deleteDescendants && deleteDescendants > 0
        ? `Page and ${deleteDescendants} sub-page${deleteDescendants === 1 ? '' : 's'} deleted`
        : deleteHasChildren
          ? 'Page and sub-pages deleted'
          : 'Page deleted',
    );
    if (selectedId === deleteTarget.id) setSelectedId(null);
    if (routeId === deleteTarget.id) router.push('/pages');
    void queryClient.invalidateQueries({ queryKey: ['pages'] });
    void queryClient.invalidateQueries({ queryKey: treeKey('pages') });
  };

  // Drilling out of a search or tag filter has to LEAVE it. `buildHref` keeps
  // the current `q`/`tag` unless told otherwise, and the screen reads either as
  // "list mode, no parent", so a drill that kept them would be a no-op.
  const leaveSearchFor = (parent: string | null, select: string) => {
    setSelectedId(select);
    pendingQuery.current = '';
    setSearchInput('');
    go({ parent, q: null, tag: null, page: 1 });
  };

  // One card per page in the CURRENT LEVEL (or per search hit). Clicking a
  // card always previews it; a card with children also drills the column into
  // them, which is what Jason described and what makes the pager meaningful.
  const renderCards = (): ReactNode[] =>
    visiblePages.map((p) => {
      // Tree mode counts from the index it holds. A search or tag filter holds
      // only the HITS, so there the count is the server's; null when the brain
      // predates it, which hides the drill link as before.
      const kids = mode === 'tree' ? childCountOf(p.id) : (p.childCount ?? null);
      // Why this card sits where it does under "Last edited": a sub-page was
      // edited more recently than the page itself.
      const sub = sort === 'edited' ? subtreeEdits?.get(p.id) : undefined;
      const subEdit =
        sub && sub.page.id !== p.id
          ? { at: sub.at, path: pagePath(pages, sub.page.id).slice(pagePath(pages, p.id).length) }
          : null;
      return (
        <PageCard
          key={p.id}
          row={p}
          childCount={kids}
          location={mode === 'list' ? (p.parentTitle ?? null) : null}
          onOpenParent={
            mode === 'list' && p.parentId ? () => leaveSearchFor(p.parentId, p.id) : undefined
          }
          subEdit={subEdit}
          details={details}
          selected={selected?.id === p.id}
          allPages={pages}
          descendantIdsOf={descendantIdsOf}
          draggable={mode === 'tree'}
          disabledDrop={invalidDropIds.has(p.id)}
          dragging={activeId === p.id}
          onSelect={() => {
            setSelectedId(p.id);
            if (!kids || kids <= 0) return;
            if (mode === 'list') leaveSearchFor(p.id, p.id);
            else go({ parent: p.id, page: 1 });
          }}
          onAddChild={() => void createChild(p.id)}
          onDelete={() => setDeleteTarget(p)}
          onMove={(parentId) => void move(p.id, parentId)}
        />
      );
    });

  const emptyState = (
    <ItemListEmpty>
      {mode === 'list'
        ? 'No pages match your search or filter.'
        : drillParent
          ? 'This page has no sub-pages.'
          : 'No pages yet. Click “New” to start writing.'}
    </ItemListEmpty>
  );

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
          {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load pages.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <MasterDetail
        // `-reader`, not the old `pages`: the panel set changed under this key
        // ([LIST, DETAIL, SPACER] → [LIST, DETAIL]) when the spacer treatment
        // gave way to the centered measure, and a saved three-panel layout
        // must not be replayed onto two panels.
        id="pages-reader"
        // The screen's old clamps, so the column lands and stops where it did.
        defaultListSize="300px"
        minListSize="220px"
        maxListSize="560px"
        // `detailFills`, WITH a `MeasurePane` inside the detail. The pane takes
        // every spare pixel; the page centers within it at a width the reader
        // drags, margins splitting the slack equally. The earlier spacer
        // treatment solved only the width — the page always tucked left
        // against the divider, and in focus mode against the screen edge.
        detailFills
        // Focus mode. The list COLLAPSES rather than unmounting, so the search
        // box, scroll position and page survive the round trip — see the prop's
        // note in master-detail.tsx.
        listCollapsed={zen}
        list={
          showTree ? (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="pages"
                adapter={pagesAdapter}
                selectedItemId={selected?.id ?? null}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search pages and folders…"
                // The root row: New back at the top level.
                rootLabel="All pages"
                actions={
                  <NewButton
                    onClick={() => {
                      setInside(false);
                      setOpen(true);
                    }}
                    title={
                      treeFolder ? `New page in ${treeFolder.name}` : 'New page at the top level'
                    }
                  />
                }
                onOpenFolder={(f) => setTreeFolder(f)}
                // New, with that folder open: the page lands in it.
                newItemInFolder={{
                  label: 'page',
                  onCreate: (f) => {
                    setTreeFolder(f);
                    setInside(true);
                    setOpen(true);
                  },
                }}
                onOpenItem={(item) => {
                  setOpenedRow(item);
                  setSelectedId(item.id);
                  // The page's own address (copy it to share it). A page
                  // picked while editing leaves the editor, which saves its
                  // draft on the way out.
                  if (item.id !== routeId || editId) router.push(`/pages/${item.id}`);
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
                // A share or a move changes the level the open page is read
                // at: its header badge, client thread and folder follow.
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['pages'] })}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <>
              <ItemListHeader
                search={searchInput}
                onSearch={setSearchInput}
                placeholder="Search pages…"
                actions={
                  <NewButton
                    onClick={() => {
                      setInside(false);
                      setOpen(true);
                    }}
                  />
                }
              >
                <SortMenu
                  value={sort}
                  labels={SORT_LABELS}
                  onChange={(v) => go({ sort: v, page: 1 })}
                />
                {/* Rendered even with no tags: it also holds the density
                  switch, which is not about tags and must stay reachable on
                  a brain that has never used one. */}
                <TagFilter
                  tags={tags}
                  activeTag={activeTag}
                  onSelect={(t) => go({ tag: t, page: 1, parent: null })}
                  details={details}
                  onDetailsChange={changeDetails}
                  allLabel="All pages"
                />
                {activeTag && (
                  <ClearFilter
                    onClear={() => go({ tag: null, page: 1 })}
                    title="Clear tag filter"
                  />
                )}
              </ItemListHeader>

              {/* One DndContext for BOTH modes so `PageCard` can call the dnd
                hooks unconditionally; drag itself is off in search mode, where
                a cross-level hit list has no level to re-parent within. Keyed
                on the level so `placeholderData` can't leave the previous
                level's cards on screen mid-navigation. */}
              <ItemListScroll key={drillId ?? 'root'} pending={navPending}>
                {/* The breadcrumb is itself a drop target, so it has to sit
                  INSIDE the context — a `useDroppable` rendered outside one
                  registers with nothing and silently never fires. */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={pointerWithin}
                  onDragStart={(e) => setActiveId(String(e.active.id))}
                  onDragEnd={onDragEnd}
                  onDragCancel={() => setActiveId(null)}
                >
                  {drillParent && (
                    <Breadcrumb
                      parent={drillParent}
                      backLabel={backParent ? backParent.title : 'all pages'}
                      // The breadcrumb doubles as the un-nest target while
                      // dragging — in a drilled level it is the "move up" gesture.
                      dropActive={activeRow !== null && activeRow.parentId === drillParent.id}
                      onBack={() => go({ parent: backParent?.id ?? null, page: 1 })}
                    />
                  )}
                  {visiblePages.length === 0 ? (
                    emptyState
                  ) : (
                    <>
                      {/* Un-nest-to-root target — only at the top level, and only
                        while dragging a page that actually has a parent. Deeper
                        levels use the breadcrumb instead. */}
                      {drillId === null && activeRow && activeRow.parentId !== null && (
                        <TopLevelDropZone />
                      )}
                      {renderCards()}
                    </>
                  )}
                  <DragOverlay dropAnimation={null}>
                    {activeRow ? <DragGhost row={activeRow} /> : null}
                  </DragOverlay>
                </DndContext>
              </ItemListScroll>

              <ListPager
                page={page}
                total={levelTotal}
                pageSize={levelPageSize}
                pending={navPending}
                onGo={(p) => go({ page: p })}
                noun={{ one: 'page', many: 'pages' }}
              />
            </>
          )
        }
        // The measure owns the scroller: it has to sit INSIDE the centered
        // column, or the handle (pinned to the column's viewport height)
        // would scroll away with the page. 900px, not the 672px default: the
        // preview also holds the `xl:` outline rail (a 224px aside).
        detail={
          editId ? (
            // The editor owns its header and its own measure.
            <div className="h-full min-h-0">
              <PageDetailClient key={editId} pageId={editId} />
            </div>
          ) : selected ? (
            <MeasurePane id="pages-preview" defaultSize="900px" minSize="480px">
              {/* A canvas the page embeds opens live over this pane. */}
              <CanvasEmbedHost key={selected.id} className="h-full min-h-0">
                <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
                  <PagePreview
                    key={selected.id}
                    row={selected}
                    shares={shareMarksOf(selected, openedRow)}
                    onDelete={() => setDeleteTarget(selected)}
                  />
                </div>
              </CanvasEmbedHost>
            </MeasurePane>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a page to preview.
            </div>
          )
        }
      />

      {fileConfirm}
      {/* New page dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {inside && treeFolder ? `New page in “${treeFolder.name}”` : 'New page'}
            </DialogTitle>
            <DialogDescription>
              Give it a title — you’ll write the body in the editor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tags">Tags</Label>
              <TagInput
                id="tags"
                value={form.tags}
                onChange={(t) => setForm({ ...form, tags: t })}
                placeholder="Type and press comma or Enter…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pending={saving}>Create page</SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDescendants && deleteDescendants > 0
                ? `This also permanently deletes ${deleteDescendants} nested page${deleteDescendants === 1 ? '' : 's'}. This can’t be undone.`
                : deleteHasChildren
                  ? 'This page and all of its sub-pages will be deleted. This can’t be undone.'
                  : 'This can’t be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One page in the list column — the card treatment the rest of the system
 *  uses (style guide §8), replacing the old one-line tree row.
 *
 *  Anatomy, per Jason's ask: the TITLE gets the full width and wraps instead
 *  of truncating, and every control moved to a footer row inside the card so
 *  nothing crowds it. The footer carries the drag handle, the sub-page count
 *  (which also signals "clicking me drills in") and move / add / delete.
 *
 *  The whole card is a drop target — dropping another page onto it nests that
 *  page underneath, and a card is a far bigger target than the 28px row was.
 *  There is no indentation: drill-down shows ONE LEVEL at a time, so depth is
 *  carried by the breadcrumb rather than by padding. */
function PageCard({
  row,
  childCount,
  location,
  onOpenParent,
  subEdit,
  details,
  selected,
  allPages,
  descendantIdsOf,
  draggable,
  disabledDrop,
  dragging,
  onSelect,
  onAddChild,
  onDelete,
  onMove,
}: {
  row: PageRow;
  /** Children in this level's index, or null in search mode where the client
   *  holds only the hits and so cannot derive it (handover §3d). */
  childCount: number | null;
  /** The parent page's title, shown on a search hit so it says where it lives.
   *  Null in the tree (the breadcrumb already says) and for a top-level hit. */
  location: string | null;
  /** Leave the search for the parent's level, with this page selected in it. */
  onOpenParent?: () => void;
  /** Set when a sub-page was edited more recently than the page itself, which
   *  is why "Last edited" ranks the card here. `path` runs from the first
   *  sub-page down to the edited one. */
  subEdit: { at: string; path: string[] } | null;
  /** Card density. Off strips the summary and the tags, leaving the title and
   *  the footer controls — the compact column the cards replaced, but still a
   *  card. */
  details: boolean;
  selected: boolean;
  allPages: PageRow[];
  descendantIdsOf: (id: string) => Set<string>;
  draggable: boolean;
  disabledDrop: boolean;
  dragging: boolean;
  onSelect: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onMove: (parentId: string | null) => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: row.id,
    disabled: disabledDrop || !draggable,
  });
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
  } = useDraggable({ id: row.id, disabled: !draggable });

  // Valid "Move to…" parents: every other page except this one and its own
  // descendants (those would cycle). Built lazily — the menu mounts on open.
  const moveTargets = useMemo(() => {
    const bad = descendantIdsOf(row.id);
    return allPages
      .filter((p) => p.id !== row.id && !bad.has(p.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allPages, descendantIdsOf, row.id]);

  // Moves only for a login that manages the page, never a snapshot copy
  // (its caps, W6b fix round).
  const access = itemAccess(row);
  const nesting = isOver && !disabledDrop && draggable;
  const drills = childCount !== null && childCount > 0;

  return (
    <ItemCard
      id={row.id}
      kind="page"
      title={row.title}
      icon={<ItemIcon emoji={row.icon ?? '📄'} fallback={null} />}
      badge={<WorkspaceChips item={row} className="mt-0.5" />}
      selected={selected}
      dimmed={dragging}
      highlight={nesting}
      onSelect={onSelect}
      dropRef={setDropRef}
      footerStart={
        <>
          {draggable && access.move && (
            <Button
              type="button"
              variant="ghost"
              size="icon-2xs"
              ref={setDragRef}
              {...listeners}
              {...attributes}
              aria-label={`Drag to move “${row.title}”`}
              title="Drag onto another page to nest it there"
              className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" />
            </Button>
          )}
          {drills ? (
            <RowButton
              onClick={onSelect}
              className="flex min-w-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={`Open the ${childCount} sub-page${childCount === 1 ? '' : 's'}`}
            >
              <span className="truncate tabular-nums">
                {childCount} sub-page{childCount === 1 ? '' : 's'}
              </span>
              <ChevronRight className="size-3.5 shrink-0 opacity-70" />
            </RowButton>
          ) : (
            /* A leaf page leaves this slot empty, so it carries the updated
               stamp instead. */
            <UpdatedStamp at={row.updatedAt} />
          )}
        </>
      }
      actions={
        <>
          {/* Kept even though the card is a big drop target: once a level
              pages, the page you want to drop onto may be on page 2, and this
              is the only way to reach it. */}
          {access.move ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ItemCardAction label="Move page" title="Move to…">
                  <FolderInput />
                </ItemCardAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 w-56 overflow-y-auto scrollbar-thin"
              >
                <DropdownMenuItem disabled={row.parentId === null} onClick={() => onMove(null)}>
                  <CornerLeftUp />
                  Top level
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {moveTargets.length === 0 ? (
                  <DropdownMenuItem disabled>No other pages</DropdownMenuItem>
                ) : (
                  moveTargets.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      disabled={t.id === row.parentId}
                      onClick={() => onMove(t.id)}
                    >
                      <span className="size-4 shrink-0 text-center text-sm leading-4" aria-hidden>
                        {t.icon ?? '📄'}
                      </span>
                      <span className="min-w-0 truncate">{t.title}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <ItemCardAction label="Add sub-page" onClick={onAddChild}>
            <Plus />
          </ItemCardAction>
          {access.manage ? (
            <ItemCardAction label="Delete page" destructive onClick={onDelete}>
              <Trash2 />
            </ItemCardAction>
          ) : null}
        </>
      }
    >
      {location &&
        (onOpenParent ? (
          <RowButton
            onClick={onOpenParent}
            className="flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={`Leave the search and open “${location}”`}
          >
            <CornerLeftUp className="size-3 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">in {location}</span>
          </RowButton>
        ) : (
          <p className="truncate px-1 text-xs text-muted-foreground">in {location}</p>
        ))}

      {subEdit && (
        <p
          className="truncate px-1 text-xs text-muted-foreground"
          title={`${subEdit.path.join(' › ')}, edited ${formatDateTime(subEdit.at)}`}
        >
          Sub-page edited {updatedAgo(subEdit.at)}
        </p>
      )}

      {details && row.summary && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{row.summary}</p>
      )}
      {details && row.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.tags.map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      )}
    </ItemCard>
  );
}

/** Header of a drilled-in level: which page you are inside, and the way back
 *  out. While dragging one of this level's own pages it is ALSO the un-nest
 *  target — dropping there moves that page up beside its current parent. */
function Breadcrumb({
  parent,
  backLabel,
  dropActive,
  onBack,
}: {
  parent: PageRow;
  backLabel: string;
  dropActive: boolean;
  onBack: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UP_LEVEL_DROP_ID, disabled: !dropActive });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md border px-2 py-1.5 transition-colors',
        dropActive ? 'border-dashed' : 'border-transparent',
        isOver && dropActive && 'border-primary bg-primary/10',
      )}
    >
      <RowButton
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        <span className="truncate">Back to {backLabel}</span>
      </RowButton>
      <div className="mt-0.5 flex items-center gap-1.5 pl-0.5">
        <span className="size-4 shrink-0 text-center text-sm leading-4" aria-hidden>
          {parent.icon ?? '📄'}
        </span>
        <span className="min-w-0 break-words text-sm font-semibold">{parent.title}</span>
      </div>
      {dropActive && (
        <p className="mt-1 pl-0.5 text-[11px] text-muted-foreground">
          Drop here to move it out of “{parent.title}”
        </p>
      )}
    </div>
  );
}

/** The floating preview that follows the cursor while dragging a tree row. */
function DragGhost({ row }: { row: PageRow }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm font-medium shadow-lg">
      <GripVertical className="size-3.5 text-muted-foreground" />
      <span aria-hidden>{row.icon ?? '📄'}</span>
      <span className="max-w-48 truncate">{row.title}</span>
    </div>
  );
}

/** Drop band at the top of the tree (shown only while dragging a nested page)
 *  that re-parents the dragged page to the top level. */
function TopLevelDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: TOP_LEVEL_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mb-1 rounded-md border border-dashed px-3 py-2 text-center text-xs transition-colors',
        isOver
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground',
      )}
    >
      Drop here to move to the top level
    </div>
  );
}

/** Right-pane read-only preview. Fetches the full document for the selected
 *  page (the list omits the body to stay lean) and renders it read-only.
 *  Prefers the uncommitted DRAFT over the published doc so a page you've edited
 *  but not committed — especially a brand-new page whose published doc is still
 *  empty — shows its content here instead of looking blank. This is render-only
 *  (no indexing); the committed doc stays the canonical version everywhere else
 *  (public share, MCP). A badge flags that the preview is showing a draft. */
function PagePreview({
  row,
  shares,
  onDelete,
}: {
  row: PageRow;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  onDelete: () => void;
}) {
  const [doc, setDoc] = useState<JSONContent | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  // The folder the page sits in (folder phase 7): what a Folder index block
  // set to `here` lists. Undefined until loaded, or on a brain before it.
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Export is a route only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();
  // The login's caps on the page (W6b fix round): no Edit without
  // mayEdit (never on a snapshot copy), no Grant Access or Delete without
  // mayManage.
  const access = itemAccess(row);
  const note = readOnlyNote(access);
  const download = useExportTool(row.id);
  const exportTool = isAdminUser ? download : null;

  // The outline reads the SAME doc the preview renders — the draft when there
  // is one, so the headings match what is on screen rather than what was last
  // committed.
  const toc = useMemo(() => (doc ? buildPageToc(doc) : []), [doc]);

  // PageView renders through TipTap, which writes block ids as `data-block-id`
  // (block-id.ts avoids the native `id` on purpose). PageOutline's default jump
  // uses getElementById, which only works on the server-rendered share/print
  // surface — so this surface supplies its own.
  const jumpToBlock = useCallback((id: string) => {
    const el = bodyRef.current?.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
    revealInFolds(el); // a heading in a folded section opens first
    el?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{
      page: { doc: JSONContent; draft: JSONContent | null; folderId?: string | null };
    }>(`/api/pages/${row.id}`)
      .then(({ page }) => {
        if (!cancelled) {
          setDoc(page.draft ?? page.doc);
          setIsDraft(!!page.draft);
          setFolderId(page.folderId);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <div>
      {/* The item header (contract 2026-10-21): one row; tags, dates and the
          read-only note behind Info. */}
      <ItemHeader
        sticky
        section="Pages"
        visual={<span aria-hidden>{row.icon ?? '📄'}</span>}
        title={row.title}
        badges={
          isDraft ? (
            <HeaderPill title="Showing the draft: edits not committed yet">uncommitted</HeaderPill>
          ) : null
        }
        edit={
          access.edit ? { href: `/pages/${row.id}?edit=1`, label: 'Edit page' } : { disabled: true }
        }
        // Share without opening the editor. No `beforeEnable` here, unlike
        // the editor's: a list screen holds no draft to commit, so the link
        // serves the last COMMITTED page, which is what /s renders in any
        // case. The "uncommitted" pill beside the title is what says so.
        access={<AccessSlot type="page" nodeId={row.id} canShare={access.share} shares={shares} />}
        tools={exportTool ? [exportTool] : []}
        onDelete={access.manage ? onDelete : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete page"
        move={access.move ? { kind: 'pages', item: { id: row.id, title: row.title } } : null}
        info={{
          tags: row.tags,
          rows: [
            ...(note ? [{ label: 'Access', value: note }] : []),
            { label: 'Updated', value: formatDateTime(row.updatedAt) },
            { label: 'Created', value: formatDateTime(row.createdAt) },
          ],
        }}
        infoLabel="About this page"
      />

      <div className="space-y-4 p-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : doc ? (
          // Outline rail (left, wide screens) + content that fills the rest.
          // The measure is the divider, so nothing is centred and nothing is
          // capped — drag the column and the prose follows.
          <div className="flex w-full gap-6" ref={bodyRef}>
            {toc.length > 0 && (
              <aside className="hidden w-56 shrink-0 xl:block">
                <div className="sticky top-6 max-h-[calc(100vh-9rem)] overflow-y-auto scrollbar-thin">
                  <PageOutline entries={toc} onJump={jumpToBlock} />
                </div>
              </aside>
            )}
            <div className="min-w-0 flex-1">
              <PageView content={doc} folderId={folderId} />
            </div>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">Couldn’t load this page.</p>
        )}
      </div>
    </div>
  );
}
