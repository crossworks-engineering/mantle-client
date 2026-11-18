'use client';

/**
 * The Files list's and thumbnails' pick controls: the bar over a pick, and
 * a file's own menu (its button, and a right-click on the row). A menu on a
 * picked file acts on the whole pick; on any other file, on that file.
 * The pick rule itself (cmd/ctrl, shift) is lib/pick-range.ts.
 */
import {
  FolderInput,
  MoreHorizontal,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { itemAccess } from '@/lib/item-access';
import { HistoryMenuItem } from '@/components/file-history/file-history-sheet';
import type { FileRow } from './files-shared';

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/** What a pick of files may do: every one of them must allow it. `move`
 *  also needs the tree, whose Move dialog the move goes through. */
export function pickRights(rows: readonly FileRow[], treeMove: boolean) {
  return {
    move: treeMove && rows.length > 0 && rows.every((f) => itemAccess(f).move),
    remove: rows.length > 0 && rows.every((f) => itemAccess(f).manage),
  };
}

/** The bar over a pick: how many, Move to…, Delete, and clear (Esc). */
export function SelectionBar({
  rows,
  treeMove,
  onMove,
  onDelete,
  onClear,
}: {
  rows: readonly FileRow[];
  treeMove: boolean;
  onMove: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (rows.length === 0) return null;
  const may = pickRights(rows, treeMove);
  return (
    <div
      role="toolbar"
      aria-label="Picked files"
      className="flex items-center gap-2 border-b border-border bg-primary/5 px-6 py-2"
    >
      <span className="text-sm font-medium tabular-nums">{files(rows.length)} selected</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        Shift-click picks a range, Cmd or Ctrl-click one more
      </span>
      <div className="ml-auto flex items-center gap-2">
        {may.move && (
          <Button size="sm" variant="outline" onClick={onMove}>
            <FolderInput /> Move to…
          </Button>
        )}
        {may.remove && (
          <Button
            size="sm"
            variant="outline"
            className="text-muted-foreground hover:text-destructive-ink"
            onClick={onDelete}
          >
            <Trash2 /> Delete
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Clear the selection"
          title="Clear the selection (Esc)"
          onClick={onClear}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

/**
 * A file's menu. `targets` is what it acts on: the pick when this file is
 * in it, else this file alone. Controlled, so a right-click on the row can
 * open it (`open` / `onOpenChange`), as the tree's rows do.
 */
export function FileRowMenu({
  file,
  targets,
  treeMove,
  open,
  onOpenChange,
  onOpen,
  onRename,
  onMove,
  onDelete,
  onHistory,
  className,
}: {
  file: FileRow;
  targets: readonly FileRow[];
  treeMove: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  /** The file's History (file history); none from a brain before it. */
  onHistory?: () => void;
  className?: string;
}) {
  const many = targets.length > 1;
  const may = pickRights(targets, treeMove);
  const rename = !many && itemAccess(file).edit;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-2xs"
          aria-label={`More actions for ${file.filename}`}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
            open
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            className,
          )}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {!many && (
          <DropdownMenuItem onSelect={onOpen}>
            <SquareArrowOutUpRight /> Open
          </DropdownMenuItem>
        )}
        {rename && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil /> Rename…
          </DropdownMenuItem>
        )}
        {may.move && (
          <DropdownMenuItem onSelect={onMove}>
            <FolderInput /> {many ? `Move ${files(targets.length)} to…` : 'Move to…'}
          </DropdownMenuItem>
        )}
        {!many && onHistory && <HistoryMenuItem onSelect={onHistory} />}
        {may.remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive-ink focus:text-destructive-ink"
              onSelect={onDelete}
            >
              <Trash2 /> {many ? `Delete ${files(targets.length)}…` : 'Delete…'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
