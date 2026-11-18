'use client';

import { useCallback, useRef, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
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
import { createTreeFolder, treeKey, type TreeSource } from './tree-api';
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
  const qc = useQueryClient();
  // "New folder": a name typed in place, made in the chosen folder (or the
  // root), then chosen. null = not asked.
  const [newName, setNewName] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

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
    if (!o) {
      setChosen(undefined);
      setNewName(null);
      setNewError(null);
    }
    onOpenChange(o);
  };

  const parent = chosen ?? null;
  const parentName = parent ? parent.name : rootLabel;
  const makeFolder = async () => {
    const name = newName?.trim();
    if (!name || making) return;
    setMaking(true);
    setNewError(null);
    try {
      const made = await createTreeFolder(kind, parent?.id ?? null, name, source);
      await qc.invalidateQueries({ queryKey: treeKey(kind, source) });
      if (parent) setOpen(parent.id, true);
      setChosen(made);
      setNewName(null);
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : 'Could not create the folder');
    } finally {
      setMaking(false);
    }
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
        {newName !== null ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void makeFolder();
            }}
          >
            <label htmlFor="picker-new-folder" className="text-xs text-muted-foreground">
              New folder in <span className="font-medium text-foreground">{parentName}</span>
            </label>
            <div className="flex gap-2">
              <Input
                id="picker-new-folder"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  // Escape drops the name, not the whole dialog.
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setNewName(null);
                    setNewError(null);
                  }
                }}
                placeholder="Folder name"
                aria-invalid={newError ? true : undefined}
                className="h-8"
                disabled={making}
              />
              <Button type="submit" size="sm" disabled={!newName.trim() || making}>
                Create
              </Button>
            </div>
            {newError && <p className="text-xs text-destructive-ink">{newError}</p>}
          </form>
        ) : null}
        <div className="flex justify-end gap-2">
          {newName === null && (
            <Button variant="ghost" className="mr-auto" onClick={() => setNewName('')}>
              <FolderPlus /> New folder
            </Button>
          )}
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
