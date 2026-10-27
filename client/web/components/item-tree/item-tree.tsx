'use client';

import { onTreeMoveRequest } from './tree-move-request';
import { GrantAccessDialog } from '@/components/share/grant-access';
import {
  MoveGrantsDialog,
  fetchMovePreview,
  type MoveTarget as GrantMoveTarget,
} from '@/components/share/grant-dialogs';
import { grantErrorText, isNoGrants, moveChangesAccess, type MovePreview } from '@/lib/grants';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import { useWorkspaceJump } from '@/components/workspaces/workspace-hit-tag';
import { guardedNavigate } from '@/lib/nav-guard';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import {
  FolderInput,
  FolderPlus,
  Layers,
  ListFilter,
  Pin,
  PinOff,
  Search,
  Share2,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import {
  TREE_KIND_SPECS,
  TREE_MAX_DEPTH,
  type TreeCrumb,
  type TreeFilter,
  type TreeFolder,
  type TreeFolderPage,
  type TreeItem,
  type TreeKind,
  type TreeSort,
} from '@mantle/web-ui/types/tree';
import { AppLookPicker } from '@/components/app-nav/app-look-picker';
import { DeleteFolderDialog, FolderNameDialog } from '@/components/app-nav/folder-dialogs';
import { useRealtime } from '@/components/realtime/use-realtime';
import { parseFlag, serialiseFlag, usePersistedState } from '@/lib/use-persisted-state';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import type { TreeKindAdapter } from './kinds/types';
import { newInsideEntry, type NewItemInFolder } from './new-inside';
import { nodeTypeIcon } from '@/components/search/node-type-icons';
import {
  createTreeFolder,
  deleteTreeFolder,
  fetchMarks,
  fetchSearch,
  fetchTags,
  marksKey,
  moveTreeItems,
  patchTreeFolder,
  placeTreeItem,
  recordTreeItemOpened,
  searchKey,
  setTreeItemPinned,
  tagsKey,
  treeKey,
  treeScope,
  type TreeFolderPatch,
  type TreeSource,
} from './tree-api';
import {
  TreeContext,
  type DragData,
  type DropHint,
  type ItemOrder,
  type ItemWhere,
  type TreeCtx,
} from './tree-context';
import {
  afterFor,
  afterForStep,
  canNestFolder,
  dropPosition,
  isAtOrBelow,
  isOnTheWayTo,
  folderManaged,
  itemMovable,
  itemPlaceAt,
  pickedAfterMove,
  placeSiblings,
  rangeOfItems,
  refreshFor,
  type TreeRow,
} from './tree-model';
import { useTreeCustomOrder } from './use-tree-kinds';
import {
  FolderHitRow,
  FolderTile,
  FolderTreeRow,
  Sentinel,
  TreeRowShell,
  useFolderRows,
  VirtualRows,
} from './tree-rows';
import { FolderPickerDialog } from './folder-picker';
import { canGrantFolder, seenOf, visibilityRefusal } from './sharing';
import { itemAccess } from '@/lib/item-access';
import { VisibilityConfirmDialog, type PendingConfirm } from './visibility-confirm';

/**
 * The item tree: one navigation for every kind (the brain's
 * docs/folder-tree.md). Folders (tile, name, count) nest three deep; items
 * show a title and a small status slot. Grown from the /apps tree, whose
 * guides, tiles, look picker and folder dialogs it reuses.
 *
 * What syncs and what doesn't:
 *  - folders, their names, looks and order, and where items sit are the
 *    BRAIN's (every admin, every device);
 *  - pins, Recent and Most used are this LOGIN's (item marks);
 *  - which folders are open and the sort are this BROWSER's (localStorage,
 *    a convenience only);
 *  - the chosen view is this VISIT's: every tree opens on Folders, and
 *    Recent, Most used and A to Z hold only while the screen stays up.
 *
 * The search box searches the brain (folders first, then items, each with
 * where it lives). The chips list items flat: Recent, Most used, A to Z.
 */

type View = 'tree' | 'recent' | 'used' | 'az';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'tree', label: 'Folders' },
  { id: 'recent', label: 'Recent' },
  { id: 'used', label: 'Most used' },
  { id: 'az', label: 'A to Z' },
];
const SORT_LABEL: Record<TreeSort, string> = {
  custom: 'Custom order',
  name: 'Name',
  updated: 'Last changed',
  start: 'Start',
  due: 'Due',
};

/** Where the share pills choice is kept: one key per login (the shell names
 *  it by email). null until the shell has answered: nothing is read or
 *  written under a key two logins would share. */
export function sharesPrefKey(login: string | null | undefined): string | null {
  const who = login?.trim().toLowerCase();
  return who ? `mantle_tree_shares_v1:${who}` : null;
}

/** The open-folder set for a kind, merged rather than replaced so the stored
 *  set (read after hydration) and a reveal can arrive in either order. */
function useOpenFolders(scope: string) {
  const key = `mantle_tree_open_v1:${scope}`;
  const [open, setOpenSet] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
      const stored = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      if (stored.length) setOpenSet((prev) => new Set([...prev, ...stored]));
    } catch {
      /* no storage: everything starts folded */
    }
  }, [key]);
  const setOpen = useCallback(
    (id: string, o: boolean) => {
      setOpenSet((prev) => {
        if (prev.has(id) === o) return prev;
        const next = new Set(prev);
        if (o) next.add(id);
        else next.delete(id);
        try {
          window.localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          /* private mode: it just won't persist */
        }
        return next;
      });
    },
    [key],
  );
  return [open, setOpen] as const;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type MoveTarget =
  | { type: 'items'; items: TreeItem[]; from: string | null | undefined }
  | { type: 'folder'; folder: TreeFolder };

const movable = itemMovable;

/** Where a move lands, inside a sentence. */
const into = (dest: string | null | undefined) => (dest ? `into “${dest}”` : 'to the top level');

export function ItemTree({
  kind,
  source = 'owner',
  adapter,
  mode = 'manage',
  rootLabel,
  selectedItemId = null,
  selectedFolderPath = null,
  revealPath,
  query,
  onQueryChange,
  searchPlaceholder,
  actions,
  onOpenItem,
  onOpenFolder,
  itemActions,
  onChanged,
  onUnsupported,
  newItemInFolder,
  capOnNarrow = true,
}: {
  kind: TreeKind;
  /** Who it is read as: the owner (default), a member (manage mode covers
   *  only its own folders and drafts, folder plan phase 5), or a client
   *  (always read mode). Readers get no marks, filters or live updates. */
  source?: TreeSource;
  adapter: TreeKindAdapter;
  mode?: 'manage' | 'read';
  /** A row for the kind's root above the folders ("All files"). */
  rootLabel?: string;
  selectedItemId?: string | null;
  /** The folder the page shows: highlighted, and unfolded to. */
  selectedFolderPath?: string | null;
  /** Unfold to this path instead (a folder whose item is open). Defaults to
   *  the selected folder. */
  revealPath?: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  searchPlaceholder?: string;
  /** Extra toolbar controls (a New button). */
  actions?: ReactNode;
  onOpenItem: (item: TreeItem, where: ItemWhere) => void;
  /** A folder click (null = the root row). Absent: a click folds. */
  onOpenFolder?: (folder: TreeFolder | null) => void;
  /** Extra entries at the foot of an item's menu (Rename, Delete). */
  itemActions?: (item: TreeItem, where: ItemWhere) => ReactNode;
  /** After any write the tree made. */
  onChanged?: () => void;
  /** A tree call answered 404: the brain does not serve this kind. */
  onUnsupported?: () => void;
  /** "New <label> inside" in a folder's menu: the section's own create flow,
   *  for an item in that folder. The tree unfolds the folder, so the new
   *  item shows in it. `icon` defaults to the kind's node type icon. */
  newItemInFolder?: NewItemInFolder & { icon?: LucideIcon };
  /**
   * Below `md` a master-detail screen stacks its panes and gives the list no
   * height of its own, so the list would grow to every row: the virtual list
   * would draw them all and each folder's "load more" row would fetch the
   * next page at once, page after page. Capped, the list scrolls in its own
   * box there. Off for a screen that shows the tree alone at full height
   * below `md` (the member's and client's screens: list OR detail).
   */
  capOnNarrow?: boolean;
}) {
  const spec = TREE_KIND_SPECS[kind];
  const qc = useQueryClient();
  const ws = useListWorkspace();
  const toast = useToast();
  // One tree for every login since W6b: the brain answers in the login's
  // scope and refuses (403, in its own words) what the login may not change.
  const owner = source === 'owner';
  const manage = mode === 'manage';
  const writer = 'owner';
  const canMove = movable;
  const scope = treeScope(kind, source);
  const views = VIEWS;

  // Plain state, never stored: a tree opens on Folders every time its
  // screen is opened (Jason, 2026-10-01). The other views are one click away
  // and hold for the visit: a selection, a refetch and a cleared search keep
  // the tree mounted, so they keep the view.
  const [chosenView, setView] = useState<View>('tree');
  const view: View = views.some((v) => v.id === chosenView) ? chosenView : 'tree';
  // The custom order first, from a brain that serves it (one order for
  // everyone, set by dragging; an unordered folder lists as before). The
  // choice is this browser's; v2 of the key so every tree opens on the
  // custom order once.
  const customOrder = useTreeCustomOrder();
  const sorts: readonly TreeSort[] = customOrder
    ? spec.sorts
    : spec.sorts.filter((s) => s !== 'custom');
  const [chosenSort, setSort] = usePersistedState<TreeSort>(
    `mantle_tree_sort_v2:${scope}`,
    'custom',
    (s) => (spec.sorts.includes(s as never) ? (s as TreeSort) : null),
  );
  const sort: TreeSort = sorts.includes(chosenSort) ? chosenSort : sorts[0]!;
  const [open, setOpen] = useOpenFolders(scope);
  // Show or hide the share pills (task ca907a89): one choice for every tree,
  // per login, kept in this browser. Hidden by default: each workspace's icon
  // beside the name, so names keep their width.
  const login = useShellWorkspaces()?.login;
  const [showShares, setShowShares] = usePersistedState<boolean>(
    sharesPrefKey(login),
    false,
    parseFlag,
    serialiseFlag,
  );
  // Where to unfold to: the page's latest destination, or a folder search
  // hit chosen since. The latest of the two wins.
  const hostReveal = revealPath === undefined ? selectedFolderPath : revealPath;
  const [reveal, setReveal] = useState<string | null>(hostReveal);
  useEffect(() => {
    if (hostReveal) setReveal(hostReveal);
  }, [hostReveal]);

  const term = useDebounced(query.trim(), 250);
  const searching = query.trim().length > 0;

  // The filter menu (State, Tag): a question about items, so it lists them
  // flat by name, like A to Z. Not remembered: a filter left on from last
  // time would quietly hide things.
  const [filter, setFilter] = useState<TreeFilter>({});
  const filtering = filter.tag !== undefined;
  // The tree lists items in their folder's custom order: their rows place.
  const ordering = sort === 'custom' && view === 'tree' && !searching && !filtering;
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const tagsQ = useQuery({
    queryKey: tagsKey(kind, ws),
    queryFn: () => fetchTags(kind, ws),
    enabled: filterMenuOpen && owner,
    staleTime: 60_000,
  });

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const scrollRoot = useRef<HTMLDivElement>(null);
  // The keyboard's place in the rows (the roving tab stop), and the list's
  // own scroll, to bring a row the arrows move to into view.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const scrollTo = useRef<((key: string) => void) | null>(null);

  const [folderDialog, setFolderDialog] = useState<
    { mode: 'new'; parent: TreeFolder | null } | { mode: 'rename'; folder: TreeFolder } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeFolder | null>(null);
  const [lookFor, setLookFor] = useState<{ key: string; folder: TreeFolder } | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  // "Move to folder…" asked from the item header's More menu.
  useEffect(
    () =>
      onTreeMoveRequest(kind, (item) =>
        setMoveTarget({ type: 'items', items: [item], from: undefined }),
      ),
    [kind],
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  // W5b: a folder's Access panel, and a move that changes who sees items.
  const [accessFolder, setAccessFolder] = useState<TreeFolder | null>(null);
  const [grantMove, setGrantMove] = useState<{
    target: GrantMoveTarget;
    preview: MovePreview;
  } | null>(null);
  const closeGrantMove = useCallback(() => setGrantMove(null), []);

  // Items picked for a move (cmd/ctrl or shift click), in pick order, and
  // the anchor a shift-click ranges from. Kept by id, so the pick survives
  // a refetch and a switch of view.
  const [picked, setPicked] = useState<ReadonlyMap<string, TreeItem>>(() => new Map());
  const anchor = useRef<string | null>(null);
  const clearPicked = useCallback(() => {
    setPicked((prev) => (prev.size ? new Map() : prev));
    anchor.current = null;
  }, []);
  const pickedIds = useMemo(() => new Set(picked.keys()), [picked]);
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: treeKey(kind, source) });
  }, [qc, kind, source]);

  // Another device, an agent or an upload changed the tree. A `tree` event
  // (a folder or a filing changed) refreshes the kind's tree; an item event
  // (an insert, or the extractor finishing with one) refreshes only the
  // folders holding it when they are loaded (a re-index or an edit), else
  // every open folder (it is new, somewhere). Bursts (a folder of uploads)
  // coalesce into one refetch of what is on screen.
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKeys = useRef<'all' | Map<string, readonly unknown[]>>(new Map());
  const flushRefresh = useCallback(() => {
    const keys = pendingKeys.current;
    pendingKeys.current = new Map();
    if (keys === 'all') {
      refresh();
      return;
    }
    for (const queryKey of keys.values()) void qc.invalidateQueries({ queryKey, exact: true });
  }, [qc, refresh]);
  useRealtime(
    ['tree', spec.nodeType],
    (c) => {
      if (c.type === 'tree') {
        if (c.id !== kind) return;
        pendingKeys.current = 'all';
      } else if (pendingKeys.current !== 'all') {
        const loaded = qc
          .getQueryCache()
          .findAll({ queryKey: [...treeKey(kind, source), 'folder'] })
          .map((q) => ({
            key: q,
            pages: (q.state.data as InfiniteData<TreeFolderPage> | undefined)?.pages,
          }));
        const hit = refreshFor(loaded, c.id);
        if (hit.all) pendingKeys.current = 'all';
        else for (const q of hit.keys) pendingKeys.current.set(q.queryHash, q.queryKey);
      }
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      pendingRefresh.current = setTimeout(flushRefresh, 300);
    },
    // The stream is the owner's; a reader's tree refreshes as it is opened.
    { enabled: owner },
  );
  useEffect(
    () => () => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
    },
    [],
  );

  /** Run a write, then refresh the tree; a refusal is a toast. */
  const write = async <T,>(fn: () => Promise<T>, failure: string): Promise<T | undefined> => {
    try {
      const out = await fn();
      refresh();
      onChanged?.();
      return out;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : failure);
      return undefined;
    }
  };

  /**
   * A write that can change who sees items (a share, a move, a delete that
   * lifts): tried as it is, and when the brain refuses it for that, the
   * changes are shown and it is repeated with `confirm` and `seen` (the total
   * the dialog showed). Nothing is written until then. When what it changes
   * differs by then, the brain refuses again with the new list, which is
   * shown again. Any other refusal is a toast.
   */
  const guarded = <T,>(
    run: (confirm: boolean, seen?: number) => Promise<T>,
    failure: string,
    ask: { action: string; verb: string },
    onDone?: (out: T) => void,
  ): Promise<void> => {
    const attempt = async (confirm: boolean, seen?: number) => {
      try {
        const out = await run(confirm, seen);
        refresh();
        onChanged?.();
        onDone?.(out);
      } catch (err) {
        const refusal = visibilityRefusal(err);
        if (refusal) {
          setPendingConfirm({ refusal, ...ask, run: () => void attempt(true, seenOf(refusal)) });
        } else {
          toast.error(err instanceof ApiError ? err.message : failure);
        }
      }
    };
    return attempt(false);
  };

  /** Any folder change. A rename or a new look never asks; a move may
   *  (`dest` names where a move lands, for the question). */
  const patchFolder = (
    folder: TreeFolder,
    patch: TreeFolderPatch,
    opts: { dest?: string | null; onDone?: () => void } = {},
  ) =>
    guarded(
      (confirm, seen) =>
        patchTreeFolder(
          kind,
          folder.id,
          confirm ? { ...patch, confirm: true, ...(seen !== undefined ? { seen } : {}) } : patch,
          writer,
        ),
      'Could not change the folder',
      // A folder is shared in its Access panel (grants), never by a level:
      // the only folder change that may ask is a move.
      { action: `Move “${folder.name}” ${into(opts.dest)}.`, verb: 'Move' },
      opts.onDone,
    );

  // ── Queries beside the tree ───────────────────────────────────────────
  const pinsQ = useQuery({
    queryKey: marksKey(kind, 'pinned'),
    queryFn: () => fetchMarks(kind, 'pinned'),
    enabled: manage && owner,
  });
  const pinned = useMemo(() => new Set(pinsQ.data?.items.map((i) => i.id)), [pinsQ.data]);

  const listView = view === 'recent' || view === 'used' ? view : null;
  const marksQ = useQuery({
    queryKey: marksKey(kind, listView ?? 'recent'),
    queryFn: () => fetchMarks(kind, listView ?? 'recent'),
    enabled: owner && !searching && listView !== null,
  });

  // A to Z is the empty search; a search is the same query with a term; a
  // filter narrows either.
  const flatTerm = searching ? term : '';
  const flatQ = useInfiniteQuery({
    queryKey: searchKey(kind, flatTerm, filter, source, ws),
    queryFn: ({ pageParam }) => fetchSearch(kind, flatTerm, pageParam, filter, source, ws),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: searching ? term.length > 0 : view === 'az' || filtering,
    // A reader hears of no change: back at the window, it asks again.
    refetchOnWindowFocus: !owner,
  });

  // ── Opening ───────────────────────────────────────────────────────────
  // A search hit from another workspace (brain task f26a516e) switches
  // there first, the switcher's own pick, so the lists follow it; then it
  // opens as any item does. The switch and the open run as one guarded
  // navigation (as the search palette does): a screen holding unsaved edits
  // that keeps the reader there keeps the workspace too.
  const jump = useWorkspaceJump();
  const openItem = (item: TreeItem, where: ItemWhere) => {
    clearPicked();
    const to = jump.target(item);
    if (to) {
      guardedNavigate(() => {
        jump.switchTo(to.id);
        onOpenItem(item, where);
      });
    } else {
      onOpenItem(item, where);
    }
    // Recent and Most used count the owner's opens only.
    if (owner && item.state !== 'private') {
      void recordTreeItemOpened(item.id).then(() =>
        qc.invalidateQueries({ queryKey: ['tree', kind, 'marks'] }),
      );
    }
  };

  const openFolder = (folder: TreeFolder) => {
    if (onOpenFolder) {
      onOpenFolder(folder);
      setOpen(folder.id, true);
    } else {
      setOpen(folder.id, !open.has(folder.id));
    }
  };

  /** A plain click opens; cmd/ctrl adds or drops the item from the pick;
   *  shift picks every movable item from the last one picked to this. */
  const clickItem = (item: TreeItem, where: ItemWhere, e?: MouseEvent) => {
    const toggle = e && (e.metaKey || e.ctrlKey);
    const range = e?.shiftKey && anchor.current !== null;
    if (!manage || !canMove(item) || (!toggle && !e?.shiftKey)) {
      openItem(item, where);
      return;
    }
    e.preventDefault();
    if (range) {
      const ids = rangeOfItems(allRows, anchor.current!, item.id, canMove);
      const byId = new Map<string, TreeItem>();
      for (const r of allRows) if (r.type === 'item') byId.set(r.item.id, r.item);
      setPicked((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          const it = byId.get(id);
          if (it) next.set(id, it);
        }
        return next;
      });
      return;
    }
    anchor.current = item.id;
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  };

  /** Move items (one, or the pick) into a folder; null = the top level. A
   *  move that partly failed still shows what did move, and keeps the ones
   *  that did not picked, to try again. */
  const moveItems = async (
    items: readonly TreeItem[],
    dest: Pick<TreeFolder, 'id' | 'name'> | null,
  ) => {
    const action =
      items.length === 1
        ? `Move “${items[0]!.title}” ${into(dest?.name)}.`
        : `Move ${items.length} ${adapter.noun.many} ${into(dest?.name)}.`;
    const after = () => {
      refresh();
      onChanged?.();
      if (items.length > 1) clearPicked();
      if (dest) setOpen(dest.id, true);
    };
    // W5b: a move that changes who sees the items says so first ("This will
    // also be visible to: ...", 21.8 row 1) and goes through /api/grants.
    // A move that changes nothing, or a brain before W5b, moves as before.
    if (writer === 'owner') {
      const ids = items.map((i) => i.id);
      const to = { toFolderId: dest?.id ?? null };
      try {
        const preview = await fetchMovePreview(ids, to);
        if (moveChangesAccess(preview)) {
          setGrantMove({
            target: {
              nodeIds: ids,
              action,
              to,
              onMoved: after,
              ...(kind === 'apps' ? { app: {} } : {}),
            },
            preview,
          });
          return;
        }
      } catch (err) {
        if (!isNoGrants(err)) {
          toast.error(grantErrorText(err, 'Could not check who would see it'));
          return;
        }
      }
    }
    return moveItemsByTree(items, dest, action);
  };

  const moveItemsByTree = (
    items: readonly TreeItem[],
    dest: Pick<TreeFolder, 'id' | 'name'> | null,
    action: string,
  ) =>
    guarded(
      async (confirm, seen) => {
        const res = await moveTreeItems(
          kind,
          items.map((i) => i.id),
          dest?.id ?? null,
          confirm,
          writer,
          seen,
        );
        if (res.failed.length) {
          refresh();
          onChanged?.();
          if (items.length > 1) setPicked(pickedAfterMove(items, res.failed));
          const what =
            items.length === 1
              ? `the ${adapter.noun.one}`
              : `${res.failed.length} of ${items.length} ${adapter.noun.many}`;
          throw new ApiError(`Could not move ${what}: ${res.failed[0]!.error}`, 409);
        }
        if (items.length > 1) clearPicked();
        if (dest) setOpen(dest.id, true);
      },
      `Could not move the ${items.length === 1 ? adapter.noun.one : adapter.noun.many}`,
      { action, verb: 'Move' },
    );

  /** Put an item right after `after` in its folder's custom order (null =
   *  first). The brain refuses (403, in its words) a login that may not
   *  order the folder; the tree refetches on its `tree` event either way. */
  const placeItem = async (item: TreeItem, after: string | null) => {
    try {
      await placeTreeItem(kind, item.id, after);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not move the ${adapter.noun.one}`);
    }
  };

  /** What a move of `item` carries: the whole pick when it is part of it. */
  const carried = (item: TreeItem): TreeItem[] =>
    picked.has(item.id) && picked.size > 1 ? [...picked.values()] : [item];

  /** A folder search hit: back to the tree, unfolded to it. */
  const openFolderHit = (folder: TreeFolder) => {
    onQueryChange('');
    setView('tree');
    setReveal(folder.path);
    openFolder(folder);
  };

  const togglePin = (item: TreeItem) =>
    void write(() => setTreeItemPinned(item.id, !pinned.has(item.id)), 'Could not change the pin');

  // ── Menus ─────────────────────────────────────────────────────────────
  // After the menu's own close, as for the look picker below.
  const openAccess = (folder: TreeFolder) => window.setTimeout(() => setAccessFolder(folder), 0);

  const openLook = (key: string, folder: TreeFolder) =>
    // After the menu's own close has run, so the picker isn't born into it.
    window.setTimeout(() => setLookFor({ key, folder }), 0);

  const NewItemIcon =
    newItemInFolder?.icon ?? (spec.nodeType === 'table' ? Table2 : nodeTypeIcon(spec.nodeType));
  const folderMenu = manage
    ? (
        folder: TreeFolder,
        _parent: TreeFolder | null,
        siblings: TreeFolder[],
        mayOrder?: boolean,
      ) => {
        const up = afterForStep(siblings, folder.id, -1);
        const down = afterForStep(siblings, folder.id, 1);
        // A folder's place among its siblings, one order for everyone: Write
        // on the folder that holds it (an Admin at the top level), as the
        // brain asks of a patch of `after` alone. A brain before the custom
        // order: the owner, on a folder it manages.
        const orderable =
          !folder.system && (customOrder ? mayOrder === true : owner && itemAccess(folder).manage);
        const newInside = newInsideEntry(folder, { manage, newItemInFolder });
        return (
          <DropdownMenuContent
            align="start"
            side="right"
            className="w-52"
            // Focus must not return to the "…" trigger: when the menu opens
            // the picker, that focus lands outside the picker and closes it.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {onOpenFolder && (
              <DropdownMenuItem onSelect={() => openFolder(folder)}>Open</DropdownMenuItem>
            )}
            {folder.depth < TREE_MAX_DEPTH && (
              <DropdownMenuItem onSelect={() => setFolderDialog({ mode: 'new', parent: folder })}>
                <FolderPlus />
                New folder inside…
              </DropdownMenuItem>
            )}
            {newInside && (
              <DropdownMenuItem
                onSelect={() => {
                  setOpen(folder.id, true);
                  setReveal(folder.path);
                  newInside.run();
                }}
              >
                <NewItemIcon />
                {newInside.label}
              </DropdownMenuItem>
            )}
            {!folder.system && itemAccess(folder).edit && (
              <DropdownMenuItem onSelect={() => setFolderDialog({ mode: 'rename', folder })}>
                Rename…
              </DropdownMenuItem>
            )}
            {itemAccess(folder).edit && (
              <DropdownMenuItem onSelect={() => openLook(`f:${folder.id}`, folder)}>
                Icon and colour…
              </DropdownMenuItem>
            )}
            {owner && canGrantFolder(kind, folder) && itemAccess(folder).share && (
              <DropdownMenuItem onSelect={() => openAccess(folder)}>
                <Share2 />
                Access…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {folderManaged(folder) && (
              <DropdownMenuItem onSelect={() => setMoveTarget({ type: 'folder', folder })}>
                Move to…
              </DropdownMenuItem>
            )}
            {orderable && (
              <>
                <DropdownMenuItem
                  disabled={up === undefined}
                  onSelect={() => up !== undefined && void patchFolder(folder, { after: up })}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={down === undefined}
                  onSelect={() => down !== undefined && void patchFolder(folder, { after: down })}
                >
                  Move down
                </DropdownMenuItem>
              </>
            )}
            {folderManaged(folder) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive-ink focus:text-destructive-ink"
                  onSelect={() => setDeleteTarget(folder)}
                >
                  Delete folder…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        );
      }
    : undefined;

  const itemMenu = manage
    ? (item: TreeItem, where: ItemWhere, order?: ItemOrder) => {
        const extra = itemActions?.(item, where);
        // Its place in the folder's custom order, by the keyboard too. Never
        // a read-only copy's, and a copy is no step: the brain leaves copies
        // out of a place's neighbours.
        const placing = ordering && order?.mayOrder === true && !itemAccess(item).copy;
        const steps = placing ? placeSiblings(order!.siblings) : [];
        const up = placing ? afterForStep(steps, item.id, -1) : undefined;
        const down = placing ? afterForStep(steps, item.id, 1) : undefined;
        return (
          <DropdownMenuContent align="start" side="right" className="w-52">
            <DropdownMenuItem onSelect={() => openItem(item, where)}>Open</DropdownMenuItem>
            {/* A pin is the login's own mark, not a change to the item: it
                shows on every item that has a folder, a read-only one too. */}
            {owner && item.state !== 'private' && (
              <DropdownMenuItem onSelect={() => togglePin(item)}>
                {pinned.has(item.id) ? <PinOff /> : <Pin />}
                {pinned.has(item.id) ? 'Unpin' : 'Pin to top'}
              </DropdownMenuItem>
            )}
            {canMove(item) && (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    const items = carried(item);
                    setMoveTarget({
                      type: 'items',
                      items,
                      from: items.length > 1 ? undefined : where.folderId,
                    });
                  }}
                >
                  <FolderInput />
                  {picked.has(item.id) && picked.size > 1
                    ? `Move ${picked.size} ${adapter.noun.many} to…`
                    : 'Move to…'}
                </DropdownMenuItem>
              </>
            )}
            {placing && (
              <>
                <DropdownMenuItem
                  disabled={up === undefined}
                  onSelect={() => up !== undefined && void placeItem(item, up)}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={down === undefined}
                  onSelect={() => down !== undefined && void placeItem(item, down)}
                >
                  Move down
                </DropdownMenuItem>
              </>
            )}
            {extra && (
              <>
                <DropdownMenuSeparator />
                {extra}
              </>
            )}
          </DropdownMenuContent>
        );
      }
    : undefined;

  // ── Drag and drop ─────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /** Where a drop would land, or null when it can't. Used for the live
   *  indicator AND at release: a quick drag can end without a move event. */
  const dropAt = (e: DragMoveEvent | DragEndEvent): DropHint => {
    const { active, over } = e;
    const rect = active.rect.current.translated;
    const a = active.data.current as DragData | undefined;
    const o = over?.data.current as DragData | undefined;
    if (!over || !rect || !a || !o || a.type === 'root') return null;
    const overId = String(over.id);
    const rel = (rect.top + rect.height / 2 - over.rect.top) / over.rect.height;
    // A dragged item may only be placed (no move), a folder only ordered
    // among its siblings (no move), when the login's caps allow no more.
    const movesItem = a.type === 'item' && canMove(a.item);
    const movesFolder = a.type === 'folder' && folderManaged(a.folder);
    if (o.type === 'root') {
      return a.parent === null || !(movesItem || movesFolder)
        ? null
        : { over: overId, pos: 'inside' };
    }
    if (o.type === 'item') {
      if (a.type !== 'item' || !ordering) return null;
      const pos = itemPlaceAt(a, o, rel, carried(a.item).length);
      return pos ? { over: overId, pos } : null;
    }
    if (o.type !== 'folder') return null;
    const pos = dropPosition(rel, a.type);
    if (a.type === 'item') {
      return a.parent?.id === o.folder.id || !movesItem ? null : { over: overId, pos };
    }
    if (a.folder.id === o.folder.id || isAtOrBelow(o.folder.path, a.folder.path)) return null;
    if (!movesFolder && (pos === 'inside' || o.parent?.id !== a.parent?.id)) return null;
    // A place beside a sibling needs the order right of the folder it lands
    // in (the brain asks it before any move).
    if (pos !== 'inside' && customOrder && !o.mayOrder) return null;
    if (pos === 'inside') return canNestFolder(a.folder, o.folder) ? { over: overId, pos } : null;
    return canNestFolder(a.folder, o.parent) ? { over: overId, pos } : null;
  };

  const onDragEnd = (e: DragEndEvent) => {
    const h = dropAt(e);
    setHint(null);
    setDragging(null);
    if (!h) return;
    const a = e.active.data.current as DragData;
    const o = e.over!.data.current as DragData;
    if (a.type === 'item' && o.type === 'item') {
      void placeItem(
        a.item,
        afterFor(
          placeSiblings(o.siblings ?? []),
          a.item.id,
          o.item.id,
          h.pos as 'before' | 'after',
        ),
      );
      return;
    }
    if (a.type === 'item') {
      void moveItems(carried(a.item), o.type === 'folder' ? o.folder : null);
      return;
    }
    if (a.type !== 'folder') return;
    if (o.type === 'root') {
      void patchFolder(a.folder, { parentId: null }, { dest: null });
    } else if (o.type === 'folder' && h.pos === 'inside') {
      const dest = o.folder;
      void patchFolder(
        a.folder,
        { parentId: dest.id },
        { dest: dest.name, onDone: () => setOpen(dest.id, true) },
      );
    } else if (o.type === 'folder') {
      const parentId = o.parent?.id ?? null;
      void patchFolder(
        a.folder,
        {
          ...(parentId !== (a.parent?.id ?? null) ? { parentId } : {}),
          after: afterFor(o.siblings, a.folder.id, o.folder.id, h.pos as 'before' | 'after'),
        },
        { dest: o.parent?.name ?? null },
      );
    }
  };

  // ── The context every row reads ───────────────────────────────────────
  const ctx: TreeCtx = {
    kind,
    adapter,
    sort,
    // A client's tree never manages, whatever the page asked for.
    mode: manage ? 'manage' : 'read',
    isOpen: (id) => open.has(id),
    setOpen,
    reveal,
    selectedItemId,
    selectedFolderPath,
    onFolderClick: openFolder,
    onItemClick: clickItem,
    picked: pickedIds,
    // Drag follows the same rule as the Move menu: the item's caps.
    canMoveItem: canMove,
    canMoveFolder: folderManaged,
    ordering,
    folderMenu,
    itemMenu,
    menuFor,
    setMenuFor,
    registerRow: (key, el) => {
      if (el) rowEls.current.set(key, el);
      else rowEls.current.delete(key);
    },
    hint,
    dragging,
    showShares,
  };

  // ── Rows by view ──────────────────────────────────────────────────────
  // Every view is one flat list of rows drawn through the virtual list: the
  // tree (pins, the root row, then the folders as far as they are open),
  // Recent and Most used, and search or A to Z.
  const flatView = searching || filtering || view === 'az';
  const folderRows = useFolderRows({
    kind,
    source,
    sort,
    isOpen: (id) => open.has(id),
    emptyText: `No ${adapter.noun.many} or folders yet.`,
    goneText: owner ? 'This folder is gone.' : 'No longer shared.',
    onUnsupported,
  });

  const flatRow = (it: TreeItem & { crumbs: TreeCrumb[] }, prefix: string): TreeRow => ({
    type: 'item',
    key: `${prefix}:${it.id}`,
    item: it,
    parent: null,
    folderPath: null,
    depth: 0,
    isLast: false,
    guides: [],
    crumbs: it.crumbs,
  });

  let allRows: TreeRow[];
  if (flatView) {
    const pages = flatQ.data?.pages ?? [];
    const folders = pages[0]?.folders ?? [];
    const items = pages.flatMap((p) => p.items);
    const pendingSearch = searching && (term !== query.trim() || flatQ.isPending);
    const flatMore = flatQ.hasNextPage;
    allRows =
      pendingSearch && !items.length && !folders.length
        ? [{ type: 'note', key: 'note', text: 'Searching…' }]
        : flatQ.isError && !items.length && !folders.length
          ? [
              {
                type: 'note',
                key: 'note',
                text: searching ? 'The search failed.' : `Couldn’t load the ${adapter.noun.many}.`,
                retry: () => void flatQ.refetch(),
              },
            ]
          : !folders.length && !items.length
            ? [
                {
                  type: 'note',
                  key: 'note',
                  text: searching
                    ? `Nothing matches “${query.trim()}”${filtering ? ' with this filter' : ''}.`
                    : filtering
                      ? `No ${adapter.noun.many} match this filter.`
                      : `No ${adapter.noun.many} yet.`,
                },
              ]
            : [
                ...folders.map((f): TreeRow => ({
                  type: 'hit',
                  key: `sf:${f.id}`,
                  folder: f,
                  crumbs: f.crumbs,
                })),
                ...items.map((it) => flatRow(it, 's')),
                ...(flatMore
                  ? [
                      {
                        type: 'more' as const,
                        key: `m:flat:${items.length}`,
                        source: 'flat',
                        depth: 0,
                        guides: [],
                        loading: flatQ.isFetchingNextPage,
                      },
                    ]
                  : []),
              ];
  } else if (listView) {
    const items = marksQ.data?.items ?? [];
    allRows = marksQ.isPending
      ? [{ type: 'note', key: 'note', text: 'Loading…' }]
      : marksQ.isError && !items.length
        ? [
            {
              type: 'note',
              key: 'note',
              text: `Couldn’t load the ${adapter.noun.many}.`,
              retry: () => void marksQ.refetch(),
            },
          ]
        : items.length === 0
          ? [
              {
                type: 'note',
                key: 'note',
                text: `${adapter.noun.many.charAt(0).toUpperCase()}${adapter.noun.many.slice(1)} you open show up here.`,
              },
            ]
          : items.map((it) => flatRow(it, 'l'));
  } else {
    const pins = pinsQ.data?.items ?? [];
    allRows = [
      ...pins.map((it) => flatRow(it, 'p')),
      ...(pins.length ? [{ type: 'divider' as const, key: 'pins-end' }] : []),
      ...(rootLabel ? [{ type: 'root' as const, key: 'root' }] : []),
      ...folderRows.rows,
    ];
  }

  // Unfold the way to what is on screen: the folders above the folder the
  // page shows (or a folder search hit), and when an item is open the
  // folder holding it as well, so the item's row is there to see. Each folder
  // opens once per destination, so one folded by hand afterwards stays shut.
  const revealKey = reveal ? `${reveal}|${selectedItemId ?? ''}` : null;
  const revealed = useRef<{ to: string | null; done: Set<string> }>({ to: null, done: new Set() });
  useEffect(() => {
    if (revealed.current.to !== revealKey) revealed.current = { to: revealKey, done: new Set() };
    if (!reveal) return;
    for (const r of folderRows.rows) {
      if (r.type !== 'folder' || !isOnTheWayTo(reveal, r.folder.path)) continue;
      if (r.folder.path === reveal && !selectedItemId) continue;
      if (revealed.current.done.has(r.folder.id)) continue;
      revealed.current.done.add(r.folder.id);
      setOpen(r.folder.id, true);
    }
  });

  // The row the page is about, scrolled to when it changes: the open item
  // in its folder, else the folder the page shows.
  const activeKey =
    view === 'tree' && !flatView
      ? selectedItemId && allRows.some((r) => r.key === `i:${selectedItemId}`)
        ? `i:${selectedItemId}`
        : selectedFolderPath
          ? (allRows.find((r) => r.type === 'folder' && r.folder.path === selectedFolderPath)
              ?.key ?? null)
          : null
      : null;

  // ── The keyboard (a tree: roving tab stop, arrow keys) ───────────────
  // Tab reaches one row, the tab stop: the last row focused while it is still
  // listed, else the row the page is about, else the first. The arrows move
  // it (Up, Down, Home, End), Right unfolds a folder or steps into it, Left
  // folds it or steps out to the folder above; Enter opens, as a click does;
  // Shift+F10 or the menu key opens the row's menu.
  const navRows = allRows.filter(
    (r) => r.type === 'folder' || r.type === 'item' || r.type === 'root' || r.type === 'hit',
  );
  const listed = (key: string | null) => !!key && navRows.some((r) => r.key === key);
  const tabStop = listed(focusKey)
    ? focusKey
    : listed(activeKey)
      ? activeKey
      : (navRows[0]?.key ?? null);
  ctx.tabStop = tabStop;
  ctx.onRowFocus = (key) => setFocusKey((cur) => (cur === key ? cur : key));

  const focusRow = (key: string) => {
    setFocusKey(key);
    scrollTo.current?.(key);
    // The row may only be drawn once the list has scrolled to it.
    let tries = 0;
    const attempt = () => {
      const el = scrollRoot.current?.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(key)}"]`,
      );
      if (el) el.focus();
      else if (tries++ < 6) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };

  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && picked.size) {
      e.stopPropagation();
      clearPicked();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.getAttribute('role') !== 'treeitem') return;
    const key = target.dataset.rowKey;
    const at = key ? navRows.findIndex((r) => r.key === key) : -1;
    if (!key || at < 0) return;
    const row = navRows[at]!;
    const go = (to: TreeRow | undefined) => {
      e.preventDefault();
      if (to) focusRow(to.key);
    };
    if (e.key === 'ArrowDown') go(navRows[at + 1]);
    else if (e.key === 'ArrowUp') go(navRows[at - 1]);
    else if (e.key === 'Home') go(navRows[0]);
    else if (e.key === 'End') go(navRows.at(-1));
    else if (e.key === 'ArrowRight') {
      if (row.type !== 'folder' || !row.hasChildren) return;
      if (row.open) go(navRows[at + 1]);
      else {
        e.preventDefault();
        setOpen(row.folder.id, true);
      }
    } else if (e.key === 'ArrowLeft') {
      if (row.type === 'folder' && row.open) {
        e.preventDefault();
        setOpen(row.folder.id, false);
        return;
      }
      const parent = row.type === 'folder' || row.type === 'item' ? row.parent : null;
      if (parent) go(navRows.find((r) => r.key === `f:${parent.id}`));
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (row.type !== 'folder' && row.type !== 'item') return;
      e.preventDefault();
      setMenuFor(key);
    }
  };

  const rootSelected = selectedFolderPath === spec.root;
  const renderRow = (row: TreeRow): ReactNode => {
    switch (row.type) {
      case 'hit':
        return (
          <FolderHitRow
            rowKey={row.key}
            folder={row.folder}
            crumbs={row.crumbs}
            onClick={() => openFolderHit(row.folder)}
          />
        );
      case 'root':
        return (
          <TreeRowShell rowKey="root" depth={0} isLast={false} guides={[]} drop={{ type: 'root' }}>
            {(style) => (
              <RowButton
                onClick={() => onOpenFolder?.(null)}
                role="treeitem"
                aria-level={1}
                aria-selected={rootSelected}
                aria-current={rootSelected ? 'true' : undefined}
                data-row-key="root"
                tabIndex={tabStop === 'root' ? 0 : -1}
                onFocus={() => ctx.onRowFocus?.('root')}
                style={style}
                className={cn(
                  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left text-sm',
                  rootSelected
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground/90 hover:bg-foreground/[0.06]',
                )}
              >
                <FolderTile folder={null} />
                <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
              </RowButton>
            )}
          </TreeRowShell>
        );
      case 'more':
        if (row.source === 'flat') {
          return (
            <Sentinel
              depth={0}
              guides={[]}
              loading={row.loading}
              onVisible={() => {
                if (!flatQ.isFetchingNextPage) void flatQ.fetchNextPage();
              }}
            />
          );
        }
        return <FolderTreeRow row={row} handles={folderRows.handles} />;
      default:
        return <FolderTreeRow row={row} handles={folderRows.handles} />;
    }
  };

  const lookFolder = lookFor?.folder ?? null;

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && onQueryChange('')}
                placeholder={searchPlaceholder ?? `Search ${adapter.noun.many} and folders`}
                aria-label={`Search ${adapter.noun.many}`}
                className="h-9 pl-8 pr-8"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  aria-label="Clear search"
                  onClick={() => onQueryChange('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
            {manage && (
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="New folder"
                title="New folder"
                onClick={() => setFolderDialog({ mode: 'new', parent: null })}
              >
                <FolderPlus />
              </Button>
            )}
            {actions}
          </div>
          {!searching && (
            <div className="flex items-center gap-1.5">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={filtering ? '' : view}
                onValueChange={(v) => {
                  if (!v) return;
                  setView(v as View);
                  setFilter({});
                }}
                aria-label={`How to list ${adapter.noun.many}`}
                className="flex min-w-0 flex-1"
              >
                {views.map((v) => (
                  <ToggleGroupItem key={v.id} value={v.id} className="h-8 flex-auto px-1.5 text-xs">
                    {v.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                variant={showShares ? 'secondary' : 'outline'}
                size="icon-xs"
                // A toggle: the name stays, aria-pressed says whether it is on.
                aria-pressed={showShares}
                aria-label="Show shares"
                title="Show shares: the workspaces under each name"
                onClick={() => setShowShares(!showShares)}
              >
                <Layers />
              </Button>
              {(owner || (view === 'tree' && spec.sorts.length > 1)) && (
                <DropdownMenu open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={filtering ? 'secondary' : 'outline'}
                      size="icon-xs"
                      aria-label={
                        !owner
                          ? 'Sort'
                          : filtering
                            ? 'Sort and filter (filter on)'
                            : 'Sort and filter'
                      }
                      title={
                        owner
                          ? `Sort: ${SORT_LABEL[sort]}. Filter by state or tag`
                          : `Sort: ${SORT_LABEL[sort]}`
                      }
                    >
                      <ListFilter />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-96 w-52 overflow-y-auto scrollbar-thin"
                  >
                    {view === 'tree' && !filtering && sorts.length > 1 && (
                      <>
                        <DropdownMenuLabel>Sort {adapter.noun.many}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={sort}
                          onValueChange={(v) => setSort(v as TreeSort)}
                        >
                          {sorts.map((s) => (
                            <DropdownMenuRadioItem key={s} value={s}>
                              {SORT_LABEL[s]}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {owner && <DropdownMenuSeparator />}
                      </>
                    )}
                    {/* Tags are the owner's to filter by. Levels are gone (W5b):
                        the workspace switcher narrows the lists instead. */}
                    {owner && (
                      <>
                        <DropdownMenuLabel>Tag</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={filter.tag ?? ''}
                          onValueChange={(v) =>
                            setFilter((f) => ({ ...f, tag: v === '' ? undefined : v }))
                          }
                        >
                          <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
                          {filter.tag && !tagsQ.data?.tags.some((t) => t.tag === filter.tag) && (
                            <DropdownMenuRadioItem value={filter.tag}>
                              {filter.tag}
                            </DropdownMenuRadioItem>
                          )}
                          {tagsQ.data?.tags.map((t) => (
                            <DropdownMenuRadioItem key={t.tag} value={t.tag}>
                              <span className="min-w-0 flex-1 truncate">{t.tag}</span>
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {t.count}
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {tagsQ.isPending && (
                          <DropdownMenuItem disabled>Loading tags…</DropdownMenuItem>
                        )}
                        {tagsQ.isError && (
                          <DropdownMenuItem disabled>Couldn’t load the tags.</DropdownMenuItem>
                        )}
                        {tagsQ.data && tagsQ.data.tags.length === 0 && (
                          <DropdownMenuItem disabled>No tags yet.</DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
          {filtering && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListFilter className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {filter.tag && `tagged “${filter.tag}”`}
              </span>
              <Button
                variant="link"
                size="2xs"
                className="h-auto p-0"
                onClick={() => setFilter({})}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        <div
          ref={scrollRoot}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2',
            capOnNarrow && 'max-md:max-h-[70dvh]',
          )}
          role="tree"
          aria-label={
            flatView
              ? `${adapter.noun.many.charAt(0).toUpperCase()}${adapter.noun.many.slice(1)} found`
              : `${adapter.noun.many.charAt(0).toUpperCase()}${adapter.noun.many.slice(1)} and folders`
          }
          aria-multiselectable={manage || undefined}
          onKeyDown={onTreeKey}
        >
          {view === 'tree' && !flatView && folderRows.loaders}
          <DndContext
            sensors={sensors}
            onDragStart={(e) => setDragging(String(e.active.id))}
            onDragMove={(e) => setHint(dropAt(e))}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setHint(null);
              setDragging(null);
            }}
          >
            <VirtualRows
              rows={allRows}
              scrollRoot={scrollRoot}
              activeKey={activeKey}
              keepKey={tabStop}
              scrollTo={scrollTo}
              render={renderRow}
              showShares={showShares}
            />
          </DndContext>
        </div>

        {/* At the foot, so picking never moves the rows under the pointer. */}
        {picked.size > 0 && (
          <div
            role="status"
            className="flex items-center gap-1.5 border-t border-border bg-primary/5 px-3 py-1.5 text-xs"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {picked.size} {picked.size === 1 ? adapter.noun.one : adapter.noun.many} picked
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                setMoveTarget({ type: 'items', items: [...picked.values()], from: undefined })
              }
            >
              <FolderInput />
              Move to…
            </Button>
            <Button
              variant="ghost"
              size="icon-2xs"
              aria-label="Clear the pick"
              title="Clear the pick (Esc)"
              onClick={clearPicked}
            >
              <X />
            </Button>
          </div>
        )}
      </div>

      {lookFor && lookFolder && (
        <AppLookPicker
          open
          onOpenChange={(o) => !o && setLookFor(null)}
          virtualAnchor={rowEls.current.get(lookFor.key) ?? null}
          side="right"
          align="start"
          icon={lookFolder.icon}
          color={lookFolder.color}
          kind="folder"
          label={lookFolder.name}
          onChange={(l) => {
            const patch: TreeFolderPatch = {};
            if (l.icon !== undefined) patch.icon = l.icon || null;
            if (l.color !== undefined) patch.color = l.color;
            // The picker previews the choice at once; the row follows the save.
            setLookFor((cur) =>
              cur
                ? {
                    ...cur,
                    folder: {
                      ...cur.folder,
                      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
                      ...(l.color !== undefined ? { color: l.color } : {}),
                    },
                  }
                : cur,
            );
            void patchFolder(lookFolder, patch);
          }}
        />
      )}

      <FolderNameDialog
        open={folderDialog !== null}
        onOpenChange={(o) => !o && setFolderDialog(null)}
        initial={folderDialog?.mode === 'rename' ? folderDialog.folder.name : undefined}
        parentName={folderDialog?.mode === 'new' ? (folderDialog.parent?.name ?? null) : null}
        onSubmit={(name, look) => {
          if (!folderDialog) return;
          if (folderDialog.mode === 'rename') {
            void patchFolder(folderDialog.folder, { name });
            return;
          }
          const parent = folderDialog.parent;
          void write(
            () => createTreeFolder(kind, parent?.id ?? null, name, writer, look),
            'Could not create the folder',
          ).then((made) => {
            if (made && parent) setOpen(parent.id, true);
          });
        }}
      />
      <DeleteFolderDialog
        folderName={deleteTarget?.name ?? null}
        contents={adapter.noun.many}
        merges
        renamesFiles={kind === 'files'}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void guarded(
            (confirm, seen) => deleteTreeFolder(kind, target.id, confirm, writer, seen),
            'Could not delete',
            {
              action: `Delete “${target.name}”: what it holds moves up one step and takes the workspaces of where it lands.`,
              verb: 'Delete folder',
            },
          );
        }}
      />
      <VisibilityConfirmDialog
        pending={pendingConfirm}
        onOpenChange={(o) => !o && setPendingConfirm(null)}
      />
      <GrantAccessDialog
        nodeId={accessFolder?.id ?? null}
        title={accessFolder?.name ?? ''}
        onOpenChange={(o) => !o && setAccessFolder(null)}
      />
      <MoveGrantsDialog
        target={grantMove?.target ?? null}
        preview={grantMove?.preview ?? null}
        onClose={closeGrantMove}
      />
      <FolderPickerDialog
        kind={kind}
        source={source}
        adapter={adapter}
        sort={sort}
        open={moveTarget !== null}
        onOpenChange={(o) => !o && setMoveTarget(null)}
        title={
          !moveTarget
            ? ''
            : moveTarget.type === 'folder'
              ? `Move “${moveTarget.folder.name}” to…`
              : moveTarget.items.length === 1
                ? `Move “${moveTarget.items[0]!.title}” to…`
                : `Move ${moveTarget.items.length} ${adapter.noun.many} to…`
        }
        rootLabel={rootLabel ?? 'Top level'}
        currentFolderId={
          moveTarget?.type === 'items'
            ? moveTarget.from
            : moveTarget?.type === 'folder'
              ? moveTarget.folder.parentId
              : null
        }
        disabled={
          moveTarget?.type === 'folder' ? (f) => !canNestFolder(moveTarget.folder, f) : undefined
        }
        onPick={(dest) => {
          const target = moveTarget;
          if (!target) return;
          if (target.type === 'items') {
            void moveItems(target.items, dest);
          } else {
            void patchFolder(
              target.folder,
              { parentId: dest?.id ?? null },
              { dest: dest?.name ?? null, onDone: () => dest && setOpen(dest.id, true) },
            );
          }
        }}
      />
    </TreeContext.Provider>
  );
}
