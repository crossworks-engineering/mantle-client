'use client';

import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import type { TreeFolder, TreeItem, TreeKind } from '@mantle/web-ui/types/tree';
import type { TreeKindAdapter } from './kinds/types';
import type { DropPos, TreeOrder } from './tree-model';

/** Where an item was opened from: the folder it sits in when the tree knows
 *  it (a folder row's child), else the last crumb's id (a flat list). Null
 *  folder = the kind's root. */
export type ItemWhere = { folderId: string | null; folderPath: string | null };

/** What a drag carries: the dragged row, and for a drop target what a drop
 *  beside it needs (its parent and its siblings, for the reorder). */
export type DragData =
  | {
      type: 'folder';
      folder: TreeFolder;
      parent: TreeFolder | null;
      siblings: TreeFolder[];
      /** The login may order the parent's contents (FolderChildren). */
      mayOrder?: boolean;
    }
  | {
      type: 'item';
      item: TreeItem;
      parent: TreeFolder | null;
      /** Its folder's items, in order, and whether the login may order
       *  them: a drop on one of them places it (the custom order). */
      siblings?: TreeItem[];
      mayOrder?: boolean;
    }
  | { type: 'root' };

export type DropHint = { over: string; pos: DropPos } | null;

/** An item row's place in its folder's custom order, for Move up and down. */
export type ItemOrder = { siblings: readonly TreeItem[]; mayOrder: boolean };

/**
 * Everything a row needs from the tree it sits in. One tree renders its rows
 * recursively (each open folder asks for its own pages), so this rides in
 * context rather than through every level. The picker is the same rows with
 * its own value: folders only, a click chooses.
 */
export type TreeCtx = {
  kind: TreeKind;
  adapter: TreeKindAdapter;
  sort: TreeOrder;
  /** `manage`: menus and drag; `read`: rows only; `picker`: folders only, a
   *  click chooses a destination. */
  mode: 'manage' | 'read' | 'picker';
  isOpen: (folderId: string) => boolean;
  setOpen: (folderId: string, open: boolean) => void;
  /** Unfold the folders on the way down to this path. */
  reveal: string | null;
  selectedItemId: string | null;
  selectedFolderPath: string | null;
  folderDisabled?: (folder: TreeFolder) => boolean;
  onFolderClick: (folder: TreeFolder) => void;
  /** A click on an item row; cmd, ctrl and shift pick items for a move. */
  onItemClick: (item: TreeItem, where: ItemWhere, e?: MouseEvent) => void;
  /** Items picked for a move (cmd/ctrl or shift click). */
  picked: ReadonlySet<string>;
  folderMenu?: (
    folder: TreeFolder,
    parent: TreeFolder | null,
    siblings: TreeFolder[],
    mayOrder?: boolean,
  ) => ReactNode;
  itemMenu?: (item: TreeItem, where: ItemWhere, order?: ItemOrder) => ReactNode;
  menuFor: string | null;
  setMenuFor: (key: string | null) => void;
  registerRow: (key: string, el: HTMLElement | null) => void;
  hint: DropHint;
  dragging: string | null;
  /** Which rows may be dragged in manage mode (a member moves only its own
   *  folders and drafts, folder plan phase 5). Absent: the owner's rules. */
  canMoveFolder?: (folder: TreeFolder) => boolean;
  canMoveItem?: (item: TreeItem) => boolean;
  /** The tree lists items in their custom order (the `custom` sort, from a
   *  brain that has it): a folder the login may order drags its items to
   *  place them, and its rows take a drop beside them. */
  ordering?: boolean;
  /**
   * The roving tab stop (the item tree's keyboard model): the one row Tab
   * reaches; the arrow keys move it. Absent (the picker): every row is a tab
   * stop of its own, as buttons are.
   */
  tabStop?: string | null;
  /** A row took focus (by the keyboard or a click): it is the tab stop now. */
  onRowFocus?: (key: string) => void;
  /** The share marks as pills under each name (the header's toggle, task
   *  ca907a89). Off or absent (the picker): each workspace's icon beside
   *  the name. */
  showShares?: boolean;
};

/** A row's `tabIndex` under the roving tab stop, when the tree has one. */
export function rowTabIndex(ctx: Pick<TreeCtx, 'tabStop'>, key: string): number | undefined {
  if (ctx.tabStop === undefined) return undefined;
  return ctx.tabStop === key ? 0 : -1;
}

export const TreeContext = createContext<TreeCtx | null>(null);

export function useTreeCtx(): TreeCtx {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('item-tree rows render inside an ItemTree');
  return ctx;
}
