'use client';

import { WorkspaceChips } from '@/components/share/workspace-chips';
import { hasShareMarks, marksHaveLook } from '@/lib/grants';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import { useWorkspaceJump, WorkspaceHitTag } from '@/components/workspaces/workspace-hit-tag';
import { elsewhereText, hitLabel } from '@/lib/workspace-hits';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { DropdownMenu, DropdownMenuTrigger } from '@mantle/web-ui/ui/dropdown-menu';
import {
  TREE_KIND_SPECS,
  type TreeCrumb,
  type TreeFolder,
  type TreeFolderPage,
  type TreeItem,
  type TreeKind,
  type TreeSort,
} from '@mantle/web-ui/types/tree';
import { AppTile } from '@/components/app-nav/app-tile';
import { TREE_INDENT, TREE_ROW_PAD, TreeGuides } from '@/components/app-nav/tree-guides';
import { fetchFolderPage, folderKey, treeScope, type TreeSource } from './tree-api';
import {
  crumbLine,
  flattenTree,
  mergeFolderPages,
  type FolderLoad,
  type TreeRow,
} from './tree-model';
import { rowTabIndex, useTreeCtx, type DragData } from './tree-context';
import { itemAccess } from '@/lib/item-access';

/**
 * The rows of the item tree. Every row is one line, 32px high: an optional
 * drag grip (manage mode, on hover), the dotted guides, a lead, the title and
 * its share marks (TreeName), a small status slot, and the "…" menu (on hover
 * and right-click). A folder row has a chevron, its tile, its name and its
 * count. With the shares shown (the header's toggle) a row that has any
 * grows a second line: its share pills under the name.
 *
 * The tree is flattened (tree-model's `flattenTree`) and drawn through one
 * virtual list, so only the rows near the viewport exist, however many
 * folders are open. The root and each open folder keep their own pages
 * (`useInfiniteQuery` per folder, 50 items a page) through an invisible
 * loader; the last row of a folder with more to come asks for the next page
 * as it comes into view.
 */

const ROW_BUTTON =
  'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-8 text-left text-sm focus-visible:z-10';

/** One slot of the list: a 32px row and the 1px gap below it. */
const ROW_SIZE = 33;
/** A row with its share pills under its name: two lines, and the gap. */
const TALL_ROW_SIZE = 47;
const SIZE: Record<TreeRow['type'], number> = {
  folder: ROW_SIZE,
  item: ROW_SIZE,
  hit: ROW_SIZE,
  root: ROW_SIZE,
  status: ROW_SIZE,
  elsewhere: ROW_SIZE,
  more: ROW_SIZE,
  note: 33,
  divider: 9,
};

// ── Loading folders ─────────────────────────────────────────────────────

/** What a folder's loader lends the rows: the next page, and a retry. */
type FolderHandle = { fetchMore: () => void; retry: () => void };

function readFolderLoad(
  state: ReturnType<ReturnType<typeof useQueryClient>['getQueryState']>,
): FolderLoad {
  const data = state?.data as InfiniteData<TreeFolderPage> | undefined;
  if (!data) {
    if (state?.status !== 'error') return { status: 'pending' };
    return { status: 'error', gone: state.error instanceof ApiError && state.error.status === 404 };
  }
  const fetchMore = (state?.fetchMeta as { fetchMore?: { direction?: string } } | null)?.fetchMore;
  return {
    status: 'ok',
    children: mergeFolderPages(data.pages),
    loadingMore: state?.fetchStatus === 'fetching' && fetchMore?.direction === 'forward',
  };
}

/** Keeps one folder's pages loaded and fresh; draws nothing. */
function FolderLoader({
  kind,
  source,
  sort,
  folderId,
  handles,
  onUnsupported,
}: {
  kind: TreeKind;
  source: TreeSource;
  sort: TreeSort;
  folderId: string | null;
  handles: Map<string, FolderHandle>;
  onUnsupported?: () => void;
}) {
  const qc = useQueryClient();
  const ws = useListWorkspace();
  const q = useInfiniteQuery({
    queryKey: folderKey(kind, folderId, sort, source, ws),
    queryFn: ({ pageParam }) => fetchFolderPage(kind, folderId, sort, pageParam, source, ws),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // A 404 is a brain without the tree (the root) or a folder deleted
    // elsewhere: neither gets better by asking again.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    // A reader's tree hears of no change (the realtime stream is the
    // owner's): coming back to the window is when it asks again.
    refetchOnWindowFocus: source !== 'owner',
  });
  const { fetchNextPage, refetch } = q;
  const busy = useRef(false);
  const id = folderId ?? 'root';
  useEffect(() => {
    handles.set(id, {
      fetchMore: () => {
        // Marked busy at once: two asks before the next render (a row
        // mounting twice in dev, two sentinels) must make one request.
        if (busy.current) return;
        busy.current = true;
        void fetchNextPage().finally(() => {
          busy.current = false;
        });
      },
      retry: () => void refetch(),
    });
    return () => void handles.delete(id);
  }, [handles, id, fetchNextPage, refetch]);
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const unsupported = folderId === null && notFound;
  useEffect(() => {
    if (unsupported) onUnsupported?.();
  }, [unsupported, onUnsupported]);
  // A folder that answers 404 left the tree (deleted, or no longer shared
  // with a reader): the folders above it are stale, so they ask again (not
  // this one, which would only answer 404 again). Once per time it fails.
  const goneAt = folderId !== null && notFound ? q.errorUpdatedAt : 0;
  useEffect(() => {
    if (!goneAt) return;
    const scope = treeScope(kind, source);
    void qc.invalidateQueries(
      {
        // Not other folders that are gone too: they would answer 404 again,
        // with a new errorUpdatedAt, and ask this one again, in a loop.
        predicate: (query) => {
          const key = query.queryKey;
          if (key[0] !== 'tree' || key[1] !== scope || key[2] !== 'folder') return false;
          if (key[3] === folderId) return false;
          const err = query.state.error;
          return !(err instanceof ApiError && err.status === 404);
        },
      },
      // Never cancel a refetch already under way (the parent's is what
      // removes this row).
      { cancelRefetch: false },
    );
  }, [goneAt, qc, kind, source, folderId]);
  return null;
}

/** Re-renders when any of this kind's folder pages change in the cache. */
function useFolderCacheVersion(kind: TreeKind, source: TreeSource): number {
  const qc = useQueryClient();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) =>
      qc.getQueryCache().subscribe((e) => {
        const key = e.query.queryKey;
        if (key[0] !== 'tree' || key[1] !== treeScope(kind, source) || key[2] !== 'folder') {
          return;
        }
        if (e.type !== 'updated' && e.type !== 'removed') return;
        version.current += 1;
        // Deferred: a loader's query can report while another component
        // renders, and a re-render must not be asked for from inside one.
        queueMicrotask(onChange);
      }),
    [qc, kind, source],
  );
  return useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
}

/**
 * The tree's rows below the root, from what the cache holds, plus the
 * loaders that keep every folder on screen fetching. Render `loaders`
 * anywhere; hand `handles` to the rows.
 */
export function useFolderRows({
  kind,
  source = 'owner',
  sort,
  isOpen,
  foldersOnly = false,
  emptyText,
  goneText,
  onUnsupported,
}: {
  kind: TreeKind;
  /** Who the tree is read as (tree-api's TreeSource). */
  source?: TreeSource;
  sort: TreeSort;
  isOpen: (folderId: string) => boolean;
  foldersOnly?: boolean;
  emptyText: string;
  /** What a folder the brain no longer shows says (flattenTree's). */
  goneText?: string;
  onUnsupported?: () => void;
}): { rows: TreeRow[]; loaders: ReactNode; handles: Map<string, FolderHandle> } {
  const qc = useQueryClient();
  const ws = useListWorkspace();
  useFolderCacheVersion(kind, source);
  const handles = useRef(new Map<string, FolderHandle>()).current;
  const { rows, needed } = flattenTree(
    (folderId) => readFolderLoad(qc.getQueryState(folderKey(kind, folderId, sort, source, ws))),
    isOpen,
    { foldersOnly, emptyText, goneText },
  );
  const loaders = needed.map((folderId) => (
    <FolderLoader
      key={folderId ?? 'root'}
      kind={kind}
      source={source}
      sort={sort}
      folderId={folderId}
      handles={handles}
      onUnsupported={folderId === null ? onUnsupported : undefined}
    />
  ));
  return { rows, loaders, handles };
}

// ── The list ────────────────────────────────────────────────────────────

/**
 * Draws `rows` through a virtual list inside `scrollRoot` (which scrolls and
 * carries no vertical padding: the list pads itself). When `activeKey` names
 * a row, the list scrolls to it once it exists, and again whenever the key
 * changes. `keepKey` names a row that is always drawn, near the viewport or
 * not: the keyboard's tab stop, so Tab always has a row to land on.
 * `scrollTo` receives the list's own scroll, for the keyboard's moves.
 */
export function VirtualRows({
  rows,
  scrollRoot,
  activeKey = null,
  keepKey = null,
  scrollTo,
  render,
  showShares,
}: {
  rows: readonly TreeRow[];
  scrollRoot: RefObject<HTMLElement | null>;
  activeKey?: string | null;
  keepKey?: string | null;
  scrollTo?: RefObject<((key: string) => void) | null>;
  render: (row: TreeRow) => ReactNode;
  /** The tree's share pills choice: rows with pills are first taken to be
   *  two lines, so a big tree does not jump as they are measured. */
  showShares?: boolean;
}) {
  // The scroll element is the parent's, and a parent's ref attaches after its
  // children's layout effects: the virtualizer's first look finds nothing.
  // One render after mount lets it find the element even when nothing else
  // changes (the picker over a cached tree).
  const [, remeasure] = useReducer((n: number) => n + 1, 0);
  useEffect(() => remeasure(), []);
  const keepIndex = keepKey ? rows.findIndex((r) => r.key === keepKey) : -1;
  const rangeExtractor = useCallback(
    (range: Range) => {
      const out = defaultRangeExtractor(range);
      if (keepIndex < 0 || out.includes(keepIndex)) return out;
      return [...out, keepIndex].sort((a, b) => a - b);
    },
    [keepIndex],
  );
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRoot.current,
    estimateSize: (i) => rowEstimate(rows[i]!, showShares),
    getItemKey: (i) => rows[i]!.key,
    overscan: 12,
    paddingStart: 8,
    paddingEnd: 8,
    rangeExtractor,
  });
  useEffect(() => {
    if (!scrollTo) return;
    scrollTo.current = (key) => {
      const i = rows.findIndex((r) => r.key === key);
      if (i >= 0) v.scrollToIndex(i, { align: 'auto' });
    };
  });
  const activeIndex = activeKey ? rows.findIndex((r) => r.key === activeKey) : -1;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeKey) {
      scrolledFor.current = null;
      return;
    }
    if (activeIndex < 0 || scrolledFor.current === activeKey) return;
    scrolledFor.current = activeKey;
    v.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeKey, activeIndex, v]);
  return (
    <div className="relative w-full" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((vi) => (
        // `top`, not a transform: a transform would make each slot its own
        // stacking context and the dragged row could not rise above the rest.
        <div
          key={vi.key}
          data-index={vi.index}
          ref={v.measureElement}
          className="absolute inset-x-0 pb-px"
          style={{ top: vi.start }}
        >
          {render(rows[vi.index]!)}
        </div>
      ))}
    </div>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────

/** The shell every row shares: guides, the drag and drop wiring, the drop
 *  indicator, and the menu. The body is the row's own. */
export function TreeRowShell({
  rowKey,
  depth,
  isLast,
  guides,
  drag,
  drop,
  menu,
  label,
  badge,
  children,
}: {
  rowKey: string;
  depth: number;
  isLast: boolean;
  guides: readonly boolean[];
  /** Draggable, carrying this. */
  drag?: DragData;
  /** A drop target, carrying this. */
  drop?: DragData;
  menu?: ReactNode;
  /** What the row is, for its menu button's name ("More actions for Plan"). */
  label?: string;
  /** Shown on the row while it is dragged (how many go with it). */
  badge?: ReactNode;
  children: (style: CSSProperties) => ReactNode;
}) {
  const ctx = useTreeCtx();
  const manage = ctx.mode === 'manage';
  const draggable = useDraggable({ id: rowKey, data: drag, disabled: !manage || !drag });
  const droppable = useDroppable({ id: rowKey, data: drop, disabled: !manage || !drop });
  const pos = ctx.hint?.over === rowKey ? ctx.hint.pos : null;
  const isDragging = ctx.dragging === rowKey;
  // Listeners only, not dnd-kit's `attributes`: those make the row a
  // role="button" wrapping a button. The row menu's "Move to" is the keyboard
  // path.
  const listeners = manage && drag ? draggable.listeners : undefined;
  const menuOpen = ctx.menuFor === rowKey;
  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
        ctx.registerRow(rowKey, node);
      }}
      className={cn(
        'group/tree-row relative flex items-center rounded-md',
        isDragging && 'z-20 bg-sidebar shadow-sm ring-1 ring-border',
        pos === 'inside' && 'ring-2 ring-ring/60',
      )}
      style={
        isDragging && draggable.transform
          ? { transform: `translate3d(0, ${draggable.transform.y}px, 0)` }
          : undefined
      }
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              ctx.setMenuFor(rowKey);
            }
          : undefined
      }
      {...listeners}
    >
      {pos === 'before' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded bg-ring"
        />
      )}
      {pos === 'after' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded bg-ring"
        />
      )}
      {manage && drag && (
        <GripVertical
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/tree-row:opacity-60"
        />
      )}
      <TreeGuides depth={depth} isLast={isLast} guides={guides} />
      {children({ paddingLeft: TREE_ROW_PAD + depth * TREE_INDENT })}
      {isDragging && badge}
      {menu && (
        <DropdownMenu open={menuOpen} onOpenChange={(o) => ctx.setMenuFor(o ? rowKey : null)}>
          <DropdownMenuTrigger asChild>
            {/* 24px to look at, 32px to hit (the ::after). Shown on hover, on
                a row that holds focus, and always where nothing hovers (a
                touch screen). Only the tab stop's is reached by Tab. */}
            <Button
              variant="ghost"
              size="icon-2xs"
              aria-label={label ? `More actions for ${label}` : 'More actions'}
              tabIndex={rowTabIndex(ctx, rowKey)}
              className={cn(
                'absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 after:absolute after:-inset-1 hover:text-foreground focus-visible:opacity-100 group-focus-within/tree-row:opacity-100 group-hover/tree-row:opacity-100 [@media(hover:none)]:opacity-100',
                menuOpen && 'opacity-100',
              )}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * A row's name and its share marks (task ca907a89): the ONE place a tree
 * row draws the workspaces of an item or a folder, for every kind. Shares
 * hidden: each workspace's icon in its colour beside the name, which keeps
 * the name its width. Shown: the workspaces as small pills in their colours
 * under the name. The status slot and a folder's count stay the row's own.
 * From an older brain (chips with no look) the pills show either way: icons
 * alone would be the same grey tile for every workspace.
 */
export function TreeName({ name, marks }: { name: string; marks: unknown }) {
  const { showShares } = useTreeCtx();
  if (pillsUnderName(showShares, marks)) {
    return (
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-1">
        <span className="max-w-full truncate">{name}</span>
        {/* Wrapped, never cut: a narrow tree gives a pill a line of its own. */}
        <WorkspaceChips item={marks} compact className="max-w-full flex-wrap" />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="min-w-0 truncate">{name}</span>
      <WorkspaceChips item={marks} variant="icons" />
    </span>
  );
}

/** Whether a row draws its share pills under its name (TreeName's rule). */
export function pillsUnderName(showShares: boolean | undefined, marks: unknown): boolean {
  return hasShareMarks(marks) && (!!showShares || !marksHaveLook(marks));
}

/** A row two lines high when its share pills show under the name. */
function useRowHeight(marks: unknown): string | false {
  const { showShares } = useTreeCtx();
  return pillsUnderName(showShares, marks) && 'h-auto min-h-8';
}

/** What a row of the list is first taken to be, before it is measured: a
 *  row with its pills under its name is two lines (TALL_ROW_SIZE). */
export function rowEstimate(row: TreeRow, showShares: boolean | undefined): number {
  const marks =
    row.type === 'folder' || row.type === 'hit'
      ? row.folder
      : row.type === 'item'
        ? row.item
        : null;
  return marks && pillsUnderName(showShares, marks) ? TALL_ROW_SIZE : SIZE[row.type];
}

/** A folder's face: its tile, or the neutral folder glyph. */
export function FolderTile({ folder }: { folder: Pick<TreeFolder, 'icon' | 'color'> | null }) {
  return <AppTile icon={folder?.icon} color={folder?.color} kind="folder" size="sm" />;
}

/** Any row of a folder tree (not the flat lists' own rows, not the root
 *  row: their owner draws those). */
export function FolderTreeRow({
  row,
  handles,
}: {
  row: TreeRow;
  handles: Map<string, FolderHandle>;
}) {
  switch (row.type) {
    case 'folder':
      return <FolderRow row={row} />;
    case 'item':
      return (
        <ItemRow
          rowKey={row.key}
          item={row.item}
          parent={row.parent}
          folderPath={row.folderPath}
          siblings={row.siblings}
          mayOrder={row.mayOrder}
          depth={row.depth}
          isLast={row.isLast}
          guides={row.guides}
          crumbs={row.crumbs}
        />
      );
    case 'status': {
      const retry = row.retry;
      return (
        <StatusRow
          depth={row.depth}
          guides={row.guides}
          label={row.label}
          busy={row.busy}
          action={
            retry !== undefined
              ? { label: 'Retry', onClick: () => handles.get(retry ?? 'root')?.retry() }
              : undefined
          }
        />
      );
    }
    case 'elsewhere':
      return <ElsewhereRow row={row} />;
    case 'more':
      return (
        <Sentinel
          depth={row.depth}
          guides={row.guides}
          loading={row.loading}
          onVisible={() => handles.get(row.source ?? 'root')?.fetchMore()}
        />
      );
    case 'note':
      return (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          {row.text}
          {row.retry && (
            <Button variant="link" size="2xs" className="h-auto p-0" onClick={row.retry}>
              Retry
            </Button>
          )}
        </p>
      );
    case 'divider':
      return <div className="mx-3 my-1 border-t border-border/60" />;
    default:
      return null;
  }
}

function FolderRow({ row }: { row: Extract<TreeRow, { type: 'folder' }> }) {
  const ctx = useTreeCtx();
  const { folder, parent, siblings, mayOrder, depth, isLast, guides, open, hasChildren } = row;
  const picker = ctx.mode === 'picker';
  const selected = ctx.selectedFolderPath === folder.path;
  const disabled = ctx.folderDisabled?.(folder) ?? false;
  const drag: DragData = { type: 'folder', folder, parent, siblings, mayOrder };
  // A folder moves by its own caps; one the login may only order (Write on
  // its parent) drags to its place among its siblings.
  const draggable =
    !folder.system &&
    (ctx.canMoveFolder?.(folder) !== false || (ctx.mode === 'manage' && mayOrder));
  const tall = useRowHeight(folder);
  return (
    <TreeRowShell
      rowKey={row.key}
      depth={depth}
      isLast={isLast}
      guides={guides}
      drag={draggable ? drag : undefined}
      drop={drag}
      menu={ctx.folderMenu?.(folder, parent, siblings, mayOrder)}
      label={folder.name}
    >
      {(style) => (
        <>
          <RowButton
            onClick={() => ctx.onFolderClick(folder)}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={selected}
            aria-current={selected ? 'true' : undefined}
            data-row-key={row.key}
            tabIndex={rowTabIndex(ctx, row.key)}
            onFocus={() => ctx.onRowFocus?.(row.key)}
            disabled={disabled}
            title={folder.name}
            style={style}
            className={cn(
              ROW_BUTTON,
              tall,
              'pr-14',
              selected
                ? 'bg-accent font-medium text-accent-foreground'
                : 'font-medium text-foreground/85 hover:bg-foreground/[0.06]',
            )}
          >
            <FolderTile folder={folder} />
            <TreeName name={folder.name} marks={folder} />
            {!picker && folder.itemCount > 0 && (
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  selected ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
                title={`${folder.itemCount} ${folder.itemCount === 1 ? ctx.adapter.noun.one : ctx.adapter.noun.many}`}
              >
                {folder.itemCount}
              </span>
            )}
          </RowButton>
          {hasChildren && (
            <Button
              variant="ghost"
              size="icon-2xs"
              aria-label={open ? `Fold ${folder.name}` : `Unfold ${folder.name}`}
              aria-expanded={open}
              // The arrow keys fold and unfold the row itself; the chevron
              // is for the pointer.
              tabIndex={ctx.tabStop === undefined ? undefined : -1}
              onClick={() => ctx.setOpen(folder.id, !open)}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 hover:text-foreground',
                picker ? 'right-1' : 'right-7',
                selected ? 'text-accent-foreground/70' : 'text-muted-foreground',
              )}
            >
              <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
            </Button>
          )}
        </>
      )}
    </TreeRowShell>
  );
}

/** One item: its lead, its title, and the status slot (or, in a flat list,
 *  the folder it lives in). */
export function ItemRow({
  rowKey,
  item,
  parent = null,
  folderPath = null,
  siblings,
  mayOrder = false,
  depth,
  isLast,
  guides,
  crumbs,
}: {
  rowKey: string;
  item: TreeItem;
  parent?: TreeFolder | null;
  folderPath?: string | null;
  /** Its folder's items in order, and whether the login may order them. */
  siblings?: TreeItem[];
  mayOrder?: boolean;
  depth: number;
  isLast: boolean;
  guides: readonly boolean[];
  /** A flat list's row: where the item lives, in the status slot's place. */
  crumbs?: readonly TreeCrumb[];
}) {
  const ctx = useTreeCtx();
  const selected = ctx.selectedItemId === item.id;
  const picked = ctx.picked.has(item.id);
  const place = crumbs ? crumbLine(crumbs) : null;
  const where = crumbs
    ? { folderId: crumbs.at(-1)?.id ?? null, folderPath: null }
    : { folderId: parent?.id ?? null, folderPath };
  // Only a tree that manages drags (never a client's). An owner's private
  // items have no folder yet: they cannot be dragged anywhere. A member's
  // tree says which of its rows move.
  // In a custom order a folder the login may order drags its items to
  // place them, and each row takes a drop beside it. A read-only snapshot
  // copy keeps its place: it is neither placed nor a place to drop beside
  // (the brain leaves copies out of a place's neighbours).
  const placeable =
    ctx.mode === 'manage' &&
    crumbs === undefined &&
    ctx.ordering === true &&
    mayOrder &&
    !itemAccess(item).copy;
  const data: DragData = {
    type: 'item',
    item,
    parent: parent ?? null,
    siblings,
    mayOrder: placeable,
  };
  const drag: DragData | undefined =
    ctx.mode === 'manage' &&
    crumbs === undefined &&
    ((ctx.canMoveItem?.(item) ?? item.state !== 'private') || placeable)
      ? data
      : undefined;
  const carried = picked ? ctx.picked.size : 1;
  const tall = useRowHeight(item);
  // A search hit from another workspace (brain task f26a516e): its tag.
  // Opening it switches there (the tree's click does).
  const elsewhere = useWorkspaceJump().target(crumbs ? item : null);
  return (
    <TreeRowShell
      rowKey={rowKey}
      depth={depth}
      isLast={isLast}
      guides={guides}
      drag={drag}
      drop={placeable ? data : undefined}
      menu={ctx.itemMenu?.(
        item,
        where,
        crumbs === undefined && siblings ? { siblings, mayOrder: placeable } : undefined,
      )}
      label={item.title || 'Untitled'}
      badge={
        carried > 1 ? (
          <span className="absolute -right-1 -top-1.5 rounded-full bg-primary px-1.5 text-[10px] font-medium tabular-nums text-primary-foreground">
            {carried}
          </span>
        ) : null
      }
    >
      {(style) => (
        <RowButton
          onClick={(e: MouseEvent) => ctx.onItemClick(item, where, e)}
          role="treeitem"
          aria-level={depth + 1}
          // Selected: the item open beside the tree, or one picked for a move.
          aria-selected={selected || picked}
          aria-current={selected ? 'true' : undefined}
          data-row-key={rowKey}
          tabIndex={rowTabIndex(ctx, rowKey)}
          onFocus={() => ctx.onRowFocus?.(rowKey)}
          title={place ? `${place} / ${item.title}` : item.title}
          style={style}
          data-mark-id={item.id}
          data-mark-kind={TREE_KIND_SPECS[ctx.kind].nodeType}
          data-mark-label={item.title}
          className={cn(
            ROW_BUTTON,
            tall,
            selected
              ? 'bg-accent text-accent-foreground'
              : picked
                ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30 hover:bg-primary/15'
                : 'text-foreground/90 hover:bg-foreground/[0.06]',
            selected && picked && 'ring-1 ring-inset ring-primary/40',
          )}
        >
          {ctx.adapter.lead(item)}
          <TreeName name={item.title} marks={item} />
          {elsewhere && <WorkspaceHitTag workspace={elsewhere} />}
          {place !== null ? (
            place && (
              <span className="max-w-[45%] shrink truncate text-[11px] text-muted-foreground">
                {place}
              </span>
            )
          ) : (
            <span className="flex shrink-0 items-center gap-1">{ctx.adapter.status(item)}</span>
          )}
        </RowButton>
      )}
    </TreeRowShell>
  );
}

/** A search hit that is a folder: its tile, name and where it lives. */
export function FolderHitRow({
  rowKey,
  folder,
  crumbs,
  onClick,
}: {
  rowKey: string;
  folder: TreeFolder;
  crumbs: readonly TreeCrumb[];
  onClick: () => void;
}) {
  const ctx = useTreeCtx();
  const place = crumbLine(crumbs);
  const tall = useRowHeight(folder);
  return (
    <RowButton
      onClick={onClick}
      role="treeitem"
      aria-level={1}
      aria-selected={false}
      data-row-key={rowKey}
      tabIndex={rowTabIndex(ctx, rowKey)}
      onFocus={() => ctx.onRowFocus?.(rowKey)}
      title={place ? `${place} / ${folder.name}` : folder.name}
      style={{ paddingLeft: TREE_ROW_PAD }}
      className={cn(
        ROW_BUTTON,
        tall,
        'pr-2 font-medium text-foreground/85 hover:bg-foreground/[0.06]',
      )}
    >
      <FolderTile folder={folder} />
      <TreeName name={folder.name} marks={folder} />
      {place && (
        <span className="max-w-[45%] shrink truncate text-[11px] font-normal text-muted-foreground">
          {place}
        </span>
      )}
    </RowButton>
  );
}

/**
 * A folder with nothing in the switcher's workspace whose items another of
 * the login's workspaces reads (brain task f26a516e): "2 pages in Admin",
 * and Switch, which picks that workspace in the switcher so the list shows
 * them. Quiet, like the Empty it replaces.
 */
function ElsewhereRow({ row }: { row: Extract<TreeRow, { type: 'elsewhere' }> }) {
  const ctx = useTreeCtx();
  const { workspaces, switchTo } = useWorkspaceJump();
  const held = workspaces.find((w) => w.id === row.workspace.id);
  const text = elsewhereText(row.count, ctx.adapter.noun, held ?? row.workspace);
  return (
    <StatusRow
      depth={row.depth}
      guides={row.guides}
      label={text}
      action={
        held
          ? {
              label: 'Switch',
              title: `Switch to ${hitLabel(held)}`,
              // "Switch" alone does not say where to a screen reader.
              ariaLabel: `Switch to ${hitLabel(held)}`,
              onClick: () => switchTo(held.id),
            }
          : undefined
      }
    />
  );
}

/** A quiet one-line row inside the tree: loading, empty, or an error. */
function StatusRow({
  depth,
  guides,
  label,
  busy,
  action,
}: {
  depth: number;
  guides: readonly boolean[];
  label: string;
  busy?: boolean;
  action?: { label: string; title?: string; ariaLabel?: string; onClick: () => void };
}) {
  return (
    <div className="relative flex h-8 items-center">
      <TreeGuides depth={depth} isLast guides={guides} />
      <span
        className="flex items-center gap-2 text-xs text-muted-foreground"
        style={{ paddingLeft: TREE_ROW_PAD + depth * TREE_INDENT + 4 }}
      >
        {busy && <Spinner className="size-3" />}
        {label}
        {action && (
          <Button
            variant="link"
            size="2xs"
            className="h-auto p-0"
            title={action.title}
            aria-label={action.ariaLabel}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * The last row of a list with more to load. The list only draws rows near
 * the viewport, so being drawn is being nearly in view: it asks for the next
 * page when it appears, and again when a page lands while it is still drawn
 * (its key carries the count, so a new page makes it a new row).
 */
export function Sentinel({
  depth,
  guides,
  loading,
  onVisible,
}: {
  depth: number;
  guides: readonly boolean[];
  loading: boolean;
  onVisible: () => void;
}) {
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    if (!loading) cb.current();
    // Only on appearing: a failed page must not be asked for in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <StatusRow
      depth={depth}
      guides={guides}
      busy={loading}
      label={loading ? 'Loading more…' : ''}
      action={loading ? undefined : { label: 'Load more', onClick: () => cb.current() }}
    />
  );
}
