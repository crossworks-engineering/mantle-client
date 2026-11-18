'use client';

/**
 * The Files list's and thumbnails' pick controls: the bar over a pick, and
 * a file's own menu (its button, and a right-click on the row). A menu on a
 * picked file acts on the whole pick; on any other file, on that file.
 * The pick rule itself (cmd/ctrl, shift) is lib/pick-range.ts.
 */
import { Fragment, useRef } from 'react';
import {
  FolderInput,
  History,
  Info,
  type LucideIcon,
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

/** One entry of a file's menu; `danger` sets it apart, last. */
type MenuEntry = { icon: LucideIcon; label: string; run: () => void; danger?: boolean };

/**
 * A file's menu. `targets` is what it acts on: the pick when this file is
 * in it, else this file alone. Controlled, so a right-click on the row can
 * open it (`open` / `onOpenChange`), as the tree's rows do. Only the open
 * row mounts the menu; every other row draws a plain button, so a list of
 * thousands of files holds one menu root, not one per row. A new entry is
 * one line in `entries`.
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
  onDetails,
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
  /** The file's Details sheet (what the brain did with it). */
  onDetails: () => void;
  /** The file's History (file history); none from a brain before it. */
  onHistory?: () => void;
  className?: string;
}) {
  // The open row draws a new button inside the menu, and the closed row a
  // plain one again, so Radix's own return of focus finds a button that is
  // gone. One ref names whichever is drawn; a close puts focus back on it,
  // unless the entry chosen moved focus on (a dialog, an editor).
  const button = useRef<HTMLButtonElement>(null);
  const trigger = (
    <Button
      ref={button}
      variant="ghost"
      size="icon-2xs"
      aria-label={`More actions for ${file.filename}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={open ? undefined : () => onOpenChange(true)}
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
        open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      <MoreHorizontal />
    </Button>
  );
  if (!open) return trigger;

  const many = targets.length > 1;
  const may = pickRights(targets, treeMove);
  const entries: Array<MenuEntry | false> = [
    !many && { icon: SquareArrowOutUpRight, label: 'Open', run: onOpen },
    !many && { icon: Info, label: 'Details', run: onDetails },
    !many && onHistory !== undefined && { icon: History, label: 'History', run: onHistory },
    !many && itemAccess(file).edit && { icon: Pencil, label: 'Rename…', run: onRename },
    may.move && {
      icon: FolderInput,
      label: many ? `Move ${files(targets.length)} to…` : 'Move to…',
      run: onMove,
    },
    may.remove && {
      icon: Trash2,
      label: many ? `Delete ${files(targets.length)}…` : 'Delete…',
      run: onDelete,
      danger: true,
    },
  ];
  const shown = entries.filter((e): e is MenuEntry => e !== false);
  return (
    <DropdownMenu open onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (!document.activeElement || document.activeElement === document.body) {
            button.current?.focus();
          }
        }}
      >
        {shown.map(({ icon: Icon, label, run, danger }, i) => (
          <Fragment key={label}>
            {danger && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={run}
              className={danger ? 'text-destructive-ink focus:text-destructive-ink' : undefined}
            >
              <Icon /> {label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
