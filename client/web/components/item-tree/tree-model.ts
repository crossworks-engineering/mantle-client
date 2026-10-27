/**
 * The item tree's pure half: how loaded folder pages become rows, where a
 * drag would land, and what a reorder sends. No React, so the rules are
 * pinned by tests.
 */
import type {
  TreeCrumb,
  TreeFolder,
  TreeFolderPage,
  TreeItem,
  TreeSort,
} from '@mantle/web-ui/types/tree';
import { TREE_MAX_DEPTH } from '@mantle/web-ui/types/tree';
import { itemAccess } from '@/lib/item-access';
import { ELSEWHERE_MAX } from '@/lib/workspace-hits';
import type { ElsewhereCount } from '@mantle/client-types';

/** What moves (drag, the Move menu) and is picked: never an owner's private
 *  item (no folder yet), a snapshot copy, or an item the login does not
 *  manage (its caps, W6b fix round: lib/item-access.ts). */
export function itemMovable(item: TreeItem): boolean {
  return item.state !== 'private' && itemAccess(item).move;
}

/** A folder the login may move, order or delete: its caps, and never a
 *  system folder. */
export function folderManaged(folder: TreeFolder): boolean {
  return !folder.system && itemAccess(folder).manage;
}

/** The item orders this client asks a folder for: the contract's sorts and
 *  `custom`, the folder's own order (brain docs/folder-tree.md, "Custom
 *  order"), from a brain whose shell says `features.treeCustomOrder`. The
 *  contract package names `custom` from its next release; until then it is
 *  added here, and the two agree. */
export type TreeOrder = TreeSort | 'custom';

/** A folder page's order fields (brain contract, "Custom order"): absent from
 *  a brain before it. */
type PageOrder = { ordered?: boolean; mayOrder?: boolean };

/** One folder's children as loaded so far: its subfolders (they all come
 *  with the first page) and every item page fetched, in order. */
export type FolderChildren = {
  folders: TreeFolder[];
  items: TreeItem[];
  /** More items wait behind the next cursor. */
  hasMore: boolean;
  /** The login may set this folder's order (its items and subfolders): Write
   *  on the folder, or Admin at the top level. Absent from a brain before it. */
  mayOrder?: boolean;
  /** Asked with the switcher's workspace and none of its items here: the
   *  login's other workspaces that read items in this folder (brain task
   *  f26a516e). Absent otherwise, and from a brain before it. */
  elsewhere?: ElsewhereCount[];
};

export function mergeFolderPages(pages: readonly TreeFolderPage[] | undefined): FolderChildren {
  if (!pages?.length) return { folders: [], items: [], hasMore: false };
  const seen = new Set<string>();
  const items: TreeItem[] = [];
  // A page refetched while another is added can repeat an item at the seam;
  // show it once.
  for (const p of pages) {
    for (const it of p.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
  }
  const elsewhere = pages[0]!.elsewhere;
  return {
    folders: pages[0]!.folders,
    items,
    hasMore: pages.at(-1)!.nextCursor !== null,
    ...((pages[0] as TreeFolderPage & PageOrder).mayOrder ? { mayOrder: true } : {}),
    ...(elsewhere?.length && !items.length ? { elsewhere } : {}),
  };
}

/** Whether a folder row unfolds: what it holds that the login reads here,
 *  and (brain task f26a516e) items only its other workspaces read, so the
 *  folder opens to say where they are. The picker lists folders only. */
export function folderHasChildren(f: TreeFolder, foldersOnly = false): boolean {
  return foldersOnly
    ? f.folderCount > 0
    : f.folderCount + f.itemCount + (f.itemsElsewhere ?? 0) > 0;
}

export type ChildEntry =
  | { type: 'folder'; folder: TreeFolder; isLast: boolean }
  | { type: 'item'; item: TreeItem; isLast: boolean };

/** The rows under a folder, folders first. The last row draws the closing
 *  elbow only when nothing more is still to load below it. `foldersOnly` is
 *  the picker, which lists where things can go. */
export function childEntries(children: FolderChildren, foldersOnly = false): ChildEntry[] {
  const rows: ChildEntry[] = [
    ...children.folders.map((folder) => ({ type: 'folder' as const, folder, isLast: false })),
    ...(foldersOnly
      ? []
      : children.items.map((item) => ({ type: 'item' as const, item, isLast: false }))),
  ];
  const more = !foldersOnly && children.hasMore;
  if (rows.length && !more) rows[rows.length - 1]!.isLast = true;
  return rows;
}

/** The guide flags for a folder's children: its own, plus whether it was the
 *  last child of its parent (TreeGuides). */
export function childGuides(guides: readonly boolean[], isLast: boolean): boolean[] {
  return [...guides, isLast];
}

/** What the cache holds for one folder's pages. */
export type FolderLoad =
  | { status: 'pending' }
  /** `gone`: the brain answered 404 (deleted elsewhere, or, for a reader,
   *  no longer shared with it): asking again cannot help. */
  | { status: 'error'; gone?: boolean }
  | { status: 'ok'; children: FolderChildren; loadingMore: boolean };

/**
 * One line of the tree as the list renders it. The tree is flattened, open
 * folders' children inline below their row, so a single virtual list draws
 * whatever is on screen however deep and long the folders get.
 */
export type TreeRow =
  | {
      type: 'folder';
      key: string;
      folder: TreeFolder;
      parent: TreeFolder | null;
      siblings: TreeFolder[];
      /** The login may order the parent's contents (FolderChildren). */
      mayOrder: boolean;
      depth: number;
      isLast: boolean;
      guides: readonly boolean[];
      open: boolean;
      hasChildren: boolean;
    }
  | {
      type: 'item';
      key: string;
      item: TreeItem;
      /** The folder it sits in, when the row is inside the tree. */
      parent: TreeFolder | null;
      folderPath: string | null;
      /** The items of its folder loaded so far, in order (a place's `after`).
       *  Absent on a flat list's row. */
      siblings?: TreeItem[];
      /** The login may order its folder's items (FolderChildren). */
      mayOrder?: boolean;
      depth: number;
      isLast: boolean;
      guides: readonly boolean[];
      /** A flat list's row (pins, Recent, search): where the item lives. */
      crumbs?: readonly TreeCrumb[];
    }
  | { type: 'hit'; key: string; folder: TreeFolder; crumbs: readonly TreeCrumb[] }
  | { type: 'root'; key: string }
  | { type: 'divider'; key: string }
  | {
      /** A folder with no item in the switcher's workspace whose items
       *  another of the login's workspaces reads: "2 pages in Admin", and
       *  a switch (brain task f26a516e). One row per workspace. */
      type: 'elsewhere';
      key: string;
      depth: number;
      guides: readonly boolean[];
      workspace: { id: string; name: string };
      count: number;
    }
  | {
      type: 'note';
      key: string;
      text: string;
      /** A failed list: a Retry beside the words. */
      retry?: () => void;
    }
  | {
      type: 'status';
      key: string;
      depth: number;
      guides: readonly boolean[];
      label: string;
      busy?: boolean;
      /** The folder to ask again (a failed load); undefined = no retry. */
      retry?: string | null;
    }
  | {
      type: 'more';
      /** Carries the count loaded so far, so the row is new after each page
       *  and asks again if it is still in view. */
      key: string;
      /** The folder whose next page it loads; 'flat' = the flat list's. */
      source: string | null;
      depth: number;
      guides: readonly boolean[];
      loading: boolean;
    };

/**
 * The rows of a folder tree: the root's children, and below every open
 * folder its own, depth first. `load` reads what the cache holds for a folder
 * (null = the root). Also returns every folder whose pages the rows need (the
 * root and each open folder on screen), so the caller keeps those loading.
 * `foldersOnly` is the picker.
 */
export function flattenTree(
  load: (folderId: string | null) => FolderLoad,
  isOpen: (folderId: string) => boolean,
  opts: {
    foldersOnly?: boolean;
    emptyText: string;
    /** The words for a folder the brain no longer shows (a 404). */
    goneText?: string;
  },
): { rows: TreeRow[]; needed: Array<string | null> } {
  const rows: TreeRow[] = [];
  const needed: Array<string | null> = [];
  const foldersOnly = opts.foldersOnly ?? false;
  // Just after a move, the page it left and the page it joined refetch on
  // their own, so for a moment both may hold it. It is drawn once, where it
  // is met first.
  const seen = new Set<string>();

  const walk = (folder: TreeFolder | null, depth: number, guides: readonly boolean[]) => {
    const folderId = folder?.id ?? null;
    const base = folderId ?? 'root';
    needed.push(folderId);
    const st = load(folderId);
    if (st.status === 'pending') {
      rows.push({ type: 'status', key: `s:${base}`, depth, guides, label: 'Loading…', busy: true });
      return;
    }
    if (st.status === 'error') {
      rows.push(
        st.gone
          ? {
              type: 'status',
              key: `s:${base}`,
              depth,
              guides,
              label: opts.goneText ?? 'No longer here.',
            }
          : {
              type: 'status',
              key: `s:${base}`,
              depth,
              guides,
              label: 'Couldn’t load this folder.',
              retry: folderId,
            },
      );
      return;
    }
    const { children } = st;
    const entries = childEntries(children, foldersOnly);
    // Items only the login's other workspaces read: said after the folders,
    // in place of "Empty".
    const elsewhere: TreeRow[] = foldersOnly
      ? []
      : (children.elsewhere ?? []).slice(0, ELSEWHERE_MAX).map((e) => ({
          type: 'elsewhere',
          key: `e:${base}:${e.id}`,
          depth,
          guides,
          workspace: { id: e.id, name: e.name },
          count: e.count,
        }));
    if (!entries.length) {
      if (foldersOnly) return;
      if (elsewhere.length) {
        rows.push(...elsewhere);
        return;
      }
      rows.push(
        depth === 0
          ? { type: 'note', key: `s:${base}`, text: opts.emptyText }
          : { type: 'status', key: `s:${base}`, depth, guides, label: 'Empty' },
      );
      return;
    }
    for (const e of entries) {
      const id = e.type === 'item' ? e.item.id : e.folder.id;
      if (seen.has(id)) continue;
      seen.add(id);
      if (e.type === 'item') {
        rows.push({
          type: 'item',
          key: `i:${e.item.id}`,
          item: e.item,
          parent: folder,
          folderPath: folder?.path ?? null,
          siblings: children.items,
          mayOrder: children.mayOrder === true,
          depth,
          isLast: e.isLast,
          guides,
        });
        continue;
      }
      const f = e.folder;
      const hasChildren = folderHasChildren(f, foldersOnly);
      const open = hasChildren && isOpen(f.id);
      rows.push({
        type: 'folder',
        key: `f:${f.id}`,
        folder: f,
        parent: folder,
        siblings: children.folders,
        mayOrder: children.mayOrder === true,
        depth,
        isLast: e.isLast,
        guides,
        open,
        hasChildren,
      });
      if (open) walk(f, depth + 1, childGuides(guides, e.isLast));
    }
    rows.push(...elsewhere);
    if (!foldersOnly && children.hasMore) {
      rows.push({
        type: 'more',
        key: `m:${base}:${children.items.length}`,
        source: folderId,
        depth,
        guides,
        loading: st.loadingMore,
      });
    }
  };

  walk(null, 0, []);
  return { rows, needed };
}

/** The items a shift-click selects: every movable item row from the anchor
 *  to the clicked one, in the order on screen, once each. */
export function rangeOfItems(
  rows: readonly TreeRow[],
  anchorId: string,
  toId: string,
  movable: (item: TreeItem) => boolean,
): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    if (r.type === 'item' && movable(r.item) && !ids.includes(r.item.id)) ids.push(r.item.id);
  }
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return b < 0 ? [] : [toId];
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** What stays picked after a move of `items` that partly failed: the ones
 *  that did not move, in pick order, so they can be tried again. */
export function pickedAfterMove(
  items: readonly TreeItem[],
  failed: readonly { id: string }[],
): Map<string, TreeItem> {
  const left = new Set(failed.map((f) => f.id));
  return new Map(items.filter((i) => left.has(i.id)).map((i) => [i.id, i]));
}

/** Where a folder, item or search hit lives, as one line. */
export function crumbLine(crumbs: readonly TreeCrumb[]): string {
  return crumbs.map((c) => c.name).join(' / ');
}

/** Whether `path` is `folder` itself or sits somewhere below it. */
export function isAtOrBelow(path: string, folderPath: string): boolean {
  return path === folderPath || path.startsWith(`${folderPath}.`);
}

/** Whether a folder at `path` must be open to show `target` (it is one of
 *  the folders on the way down to it, or the folder itself). */
export function isOnTheWayTo(target: string | null | undefined, path: string): boolean {
  return !!target && isAtOrBelow(target, path);
}

export type DropPos = 'before' | 'after' | 'inside';

/** What a pointer over a row means. Over a folder: the top and bottom thirds
 *  place a dragged folder beside it, the middle drops into it; an item
 *  dropped on a folder goes into it. Over an item (a custom order, its own
 *  folder's): the top half places the dragged item before it, the bottom
 *  half after. */
export function dropPosition(
  rel: number,
  dragging: 'folder' | 'item',
  over: 'folder' | 'item' = 'folder',
): DropPos {
  if (over === 'item') return rel < 0.5 ? 'before' : 'after';
  if (dragging === 'item') return 'inside';
  return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'inside';
}

/**
 * Where a dragged item lands on another item row, in a custom order: before
 * or after it, when both sit in the same folder and the login may order it.
 * Null when it cannot (another folder: drop it on the folder to move it; a
 * pick of several moves, never orders).
 */
export function itemPlaceAt(
  moving: { item: TreeItem; parent: TreeFolder | null; mayOrder?: boolean },
  target: { item: TreeItem; parent: TreeFolder | null },
  rel: number,
  carrying: number,
): 'before' | 'after' | null {
  if (!moving.mayOrder || carrying > 1) return null;
  // A read-only snapshot copy keeps its place and is no place to land.
  if (itemAccess(moving.item).copy || itemAccess(target.item).copy) return null;
  if (moving.item.id === target.item.id) return null;
  if ((moving.parent?.id ?? null) !== (target.parent?.id ?? null)) return null;
  return dropPosition(rel, 'item', 'item') as 'before' | 'after';
}

/** The items a place steps over and lands beside: its folder's items in
 *  order, without the read-only snapshot copies. A copy keeps its place,
 *  and the brain leaves copies out of a place's neighbours, so Move up,
 *  Move down and a drop count only the rest. */
export function placeSiblings<T extends object>(siblings: readonly T[]): T[] {
  return siblings.filter((s) => !itemAccess(s).copy);
}

/** A dragged folder may land in `target` when that is not itself, not one of
 *  its own subfolders, and not already at the deepest level. The brain still
 *  checks the moved subtree's full depth. */
export function canNestFolder(moving: TreeFolder, target: TreeFolder | null): boolean {
  if (!target) return true;
  if (isAtOrBelow(target.path, moving.path)) return false;
  return target.depth < TREE_MAX_DEPTH;
}

/**
 * The `after` a reorder sends to put `movingId` beside `targetId` among
 * `siblings` (the target's siblings, in order): after the target, or after
 * whatever precedes it (null = first).
 */
export function afterFor(
  siblings: readonly { id: string }[],
  movingId: string,
  targetId: string,
  pos: 'before' | 'after',
): string | null {
  const rest = siblings.filter((s) => s.id !== movingId);
  if (pos === 'after') return targetId;
  const at = rest.findIndex((s) => s.id === targetId);
  return at > 0 ? rest[at - 1]!.id : null;
}

/** The `after` for Move up / Move down, or undefined when it cannot move
 *  that way. */
export function afterForStep(
  siblings: readonly { id: string }[],
  id: string,
  dir: -1 | 1,
): string | null | undefined {
  const at = siblings.findIndex((s) => s.id === id);
  if (at < 0) return undefined;
  const to = at + dir;
  if (to < 0 || to >= siblings.length) return undefined;
  const rest = siblings.filter((s) => s.id !== id);
  return to === 0 ? null : rest[to - 1]!.id;
}

// ── Reading the cached pages (the member's tree) ───────────────────────────

/** One folder's cached pages as a hook reads them from the query cache. */
export type CachedFolderPages = {
  /** The folder the pages are of; null = the kind's root. */
  folderId: string | null;
  /** Loaded without error (the pages are what the brain says now). */
  ok: boolean;
  /** The brain answered 404: the folder is gone, or no longer shown. */
  notFound: boolean;
  pages: readonly TreeFolderPage[] | undefined;
};

/**
 * The folder as the cache holds it now (renamed, moved, restyled), or null
 * when it has left the tree: its own pages answer 404, or its parent's pages
 * load without it. Unknown (nothing cached says either way): as it was.
 */
export function liveFolder(
  cache: readonly CachedFolderPages[],
  folder: TreeFolder,
): TreeFolder | null {
  for (const c of cache) {
    for (const p of c.pages ?? []) {
      const hit = p.folders.find((f) => f.id === folder.id);
      if (hit) return hit;
      if (p.folder?.id === folder.id) return p.folder;
    }
  }
  if (cache.some((c) => c.folderId === folder.id && c.notFound)) return null;
  const parent = cache.find((c) => c.folderId === folder.parentId);
  if (parent?.ok && parent.pages?.length) return null;
  return folder;
}

/**
 * What a realtime ping about one item refreshes. The owner's stream says only
 * "an item of this type changed" (an insert, or the extractor finishing with
 * it), with its id. An item the loaded folders already hold was re-indexed or
 * edited: only the folders holding it ask again. One they do not hold is new,
 * somewhere: every loaded folder asks again. `folders` is each loaded
 * folder's query key and pages.
 */
export function refreshFor<K>(
  folders: ReadonlyArray<{ key: K; pages: readonly TreeFolderPage[] | undefined }>,
  itemId: string,
): { all: true } | { all: false; keys: K[] } {
  const keys = folders
    .filter((f) => f.pages?.some((p) => p.items.some((it) => it.id === itemId)))
    .map((f) => f.key);
  return keys.length ? { all: false, keys } : { all: true };
}
