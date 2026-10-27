'use client';

import { useCallback, useRef, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import type { TreeFolder, TreeKind, TreeSort } from '@mantle/web-ui/types/tree';
import { TREE_ROW_PAD } from '@/components/app-nav/tree-guides';
import type { TreeKindAdapter } from './kinds/types';
import type { TreeSource } from './tree-api';
import type { TreeRow } from './tree-model';
import { TreeContext, type TreeCtx } from './tree-context';
import { FolderTile, FolderTreeRow, useFolderRows, VirtualRows } from './tree-rows';

const NO_PICKS: ReadonlySet<string> = new Set();

/**
 * "Move to…": the same tree in picker mode, folders only. A click chooses a
 * destination (the top row is the kind's root); the chevrons unfold. The
 * keyboard path for every move a drag can make.
 */
export function FolderPickerDialog({
  kind,
  source = 'owner',
  adapter,
  sort,
  title,
  description,
  open,
  onOpenChange,
  rootLabel,
  currentFolderId,
  disabled,
  onPick,
}: {
  kind: TreeKind;
  /** Whose tree it browses (a member picks among the folders it sees). */
  source?: TreeSource;
  adapter: TreeKindAdapter;
  sort: TreeSort;
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootLabel: string;
  /** Where the thing sits now (null = the root): not offered again.
   *  Undefined when that is several places (a picked set). */
  currentFolderId?: string | null;
  /** Folders it cannot go into (itself, its own subfolders, too deep). */
  disabled?: (folder: TreeFolder) => boolean;
  onPick: (folder: TreeFolder | null) => void;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  // undefined = nothing chosen yet; null = the root.
  const [chosen, setChosen] = useState<TreeFolder | null | undefined>(undefined);
  const scrollRoot = useRef<HTMLDivElement>(null);

  const setOpen = useCallback((id: string, o: boolean) => {
    setOpenIds((prev) => {
      if (prev.has(id) === o) return prev;
      const next = new Set(prev);
      if (o) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const ctx: TreeCtx = {
    kind,
    adapter,
    sort,
    mode: 'picker',
    isOpen: (id) => openIds.has(id),
    setOpen,
    reveal: null,
    selectedItemId: null,
    selectedFolderPath: chosen ? chosen.path : null,
    folderDisabled: (f) => f.id === currentFolderId || (disabled?.(f) ?? false),
    onFolderClick: (f) => setChosen(f),
    onItemClick: () => undefined,
    picked: NO_PICKS,
    menuFor: null,
    setMenuFor: () => undefined,
    registerRow: () => undefined,
    hint: null,
    dragging: null,
  };

  const { rows, loaders, handles } = useFolderRows({
    kind,
    source,
    sort,
    isOpen: ctx.isOpen,
    foldersOnly: true,
    emptyText: '',
  });
  const all: TreeRow[] = [{ type: 'root', key: 'root' }, ...rows];

  const close = (o: boolean) => {
    if (!o) setChosen(undefined);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div
          ref={scrollRoot}
          role="tree"
          aria-label="Folders"
          className="max-h-80 min-h-40 overflow-y-auto scrollbar-thin rounded-md border border-border px-1"
        >
          <TreeContext.Provider value={ctx}>
            <DndContext>
              {open && loaders}
              <VirtualRows
                rows={all}
                scrollRoot={scrollRoot}
                render={(row) =>
                  row.type === 'root' ? (
                    <RowButton
                      onClick={() => setChosen(null)}
                      role="treeitem"
                      aria-level={1}
                      aria-selected={chosen === null}
                      disabled={currentFolderId === null}
                      aria-current={chosen === null ? 'true' : undefined}
                      style={{ paddingLeft: TREE_ROW_PAD }}
                      className={cn(
                        'flex h-8 w-full items-center gap-2 rounded-md pr-2 text-sm font-medium',
                        chosen === null
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground/85 hover:bg-foreground/[0.06]',
                      )}
                    >
                      <FolderTile folder={null} />
                      {rootLabel}
                    </RowButton>
                  ) : (
                    <FolderTreeRow row={row} handles={handles} />
                  )
                }
              />
            </DndContext>
          </TreeContext.Provider>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={chosen === undefined}
            onClick={() => {
              if (chosen === undefined) return;
              onPick(chosen);
              close(false);
            }}
          >
            Move here
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
