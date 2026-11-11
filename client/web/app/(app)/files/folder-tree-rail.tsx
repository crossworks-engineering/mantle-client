'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Clock,
  Database,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Palette,
  Pencil,
} from 'lucide-react';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { isAppTint } from '@mantle/client-types/app-nav';
import { AppTile } from '@/components/app-nav/app-tile';
import { AppLookPicker, type AppLook } from '@/components/app-nav/app-look-picker';
import { TREE_INDENT, TREE_ROW_PAD, TreeGuides } from '@/components/app-nav/tree-guides';
import { FILES_ROOT } from './files-shared';
import type { FolderRow } from './files-shared';
import { ancestorPaths, flattenFolderTree } from './folder-tree';

/**
 * The Files list column, drawn like the /apps tree: tinted folder tiles,
 * dotted guides from each child back to its parent, and folders that fold.
 *
 * A row click opens the folder; its chevron folds it. Which folders are open
 * is this BROWSER's (localStorage), as on /apps. A folder's icon and colour
 * are the BRAIN's (stored on the folder node), so they follow it to every
 * device. Opening a folder unfolds the path to it, so where you are is always
 * visible in the tree.
 */

const OPEN_KEY = 'mantle_files_tree_open_v1';

function readOpen(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The open-folder set, merged rather than replaced so the stored set (read
 *  after hydration) and the path to the current folder can arrive in either
 *  order without one wiping the other. */
function useOpenFolders() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const stored = readOpen();
    if (stored.length) setOpen((prev) => new Set([...prev, ...stored]));
  }, []);
  const update = useCallback((fn: (next: Set<string>) => void) => {
    setOpen((prev) => {
      const next = new Set(prev);
      fn(next);
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: it just won't persist */
      }
      return next;
    });
  }, []);
  return [open, update] as const;
}

export function FolderTreeRail({
  tree,
  currentPath,
  onNavigate,
  filter,
  recentActive,
  onRecent,
  dataActive = false,
  onData,
  onNewFolder,
  onNewFile,
  onRename,
}: {
  tree: FolderRow[];
  /** '' when no folder is on screen (Recent). */
  currentPath: string;
  onNavigate: (path: string) => void;
  /** Substring filter over slug/path; matches keep their ancestors. */
  filter?: string;
  recentActive: boolean;
  onRecent: () => void;
  /** Data files: every file with a database, in every folder. */
  dataActive?: boolean;
  onData?: () => void;
  onNewFolder: (parentPath: string) => void;
  /** "New file inside": the screen's own create, in that folder. */
  onNewFile?: (parentPath: string) => void;
  onRename: (folder: FolderRow) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, updateOpen] = useOpenFolders();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // ONE look picker for the tree, anchored to the row it was opened from (the
  // /apps tree's pattern: wrapping the row in a popover on demand remounted it
  // and the closing menu's focus return closed the new popover).
  const [lookFor, setLookFor] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());

  const byPath = useMemo(() => new Map(tree.map((f) => [f.path, f])), [tree]);
  const root = byPath.get(FILES_ROOT) ?? null;

  // Unfold the way to the folder on screen, and the folder itself.
  useEffect(() => {
    if (!currentPath) return;
    const ids = [...ancestorPaths(currentPath), currentPath]
      .map((p) => byPath.get(p)?.id)
      .filter((id): id is string => !!id);
    if (ids.some((id) => !open.has(id))) updateOpen((s) => ids.forEach((id) => s.add(id)));
    // Only when the destination changes: re-running on `open` would re-open a
    // folder the user has just folded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, byPath]);

  const q = (filter ?? '').trim();
  const rows = useMemo(() => flattenFolderTree(tree, (f) => open.has(f.id), q), [tree, open, q]);

  const setLook = async (folder: FolderRow, look: AppLook) => {
    const patch: { icon?: string | null; color?: string | null } = {};
    if (look.icon !== undefined) patch.icon = look.icon || null;
    if (look.color !== undefined) patch.color = look.color;
    // Optimistic: the picker stays open and previews each pick on the row.
    qc.setQueryData<{ folders: FolderRow[] }>(['files', 'tree'], (d) =>
      d ? { folders: d.folders.map((f) => (f.id === folder.id ? { ...f, ...patch } : f)) } : d,
    );
    try {
      await apiSend(`/api/files/folders/${folder.id}`, 'PATCH', { look: patch });
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 400
          ? 'This brain can’t store folder looks yet. Update it, then try again.'
          : err instanceof ApiError
            ? err.message
            : 'Could not change the folder’s look',
      );
      void qc.invalidateQueries({ queryKey: ['files', 'tree'] });
    }
  };

  const lookFolder = lookFor ? (tree.find((f) => f.id === lookFor) ?? null) : null;

  const menu = (f: FolderRow) => (
    <DropdownMenuContent
      align="start"
      side="right"
      className="w-52"
      // Focus must not return to the "…" trigger: when the menu opens the
      // picker, that focus lands outside the picker and closes it.
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <DropdownMenuItem onSelect={() => window.setTimeout(() => setLookFor(f.id), 0)}>
        <Palette />
        Icon and colour…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onNewFolder(f.path)}>
        <FolderPlus />
        New folder inside…
      </DropdownMenuItem>
      {onNewFile && (
        <DropdownMenuItem onSelect={() => onNewFile(f.path)}>
          <FileText />
          New file inside
        </DropdownMenuItem>
      )}
      {f.path !== FILES_ROOT && (
        <DropdownMenuItem onSelect={() => onRename(f)}>
          <Pencil />
          Rename…
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );

  /** One row: guides, the clickable body, an optional fold chevron, and the
   *  hover "…" menu (also on right-click). */
  const row = (opts: {
    folder: FolderRow | null;
    key: string;
    depth: number;
    isLast: boolean;
    guides: boolean[];
    selected: boolean;
    label: string;
    tile: ReactNode;
    count?: number;
    onClick: () => void;
    fold?: { open: boolean; toggle: () => void };
  }) => {
    const f = opts.folder;
    return (
      <div
        key={opts.key}
        ref={(el) => {
          if (!f) return;
          if (el) rowEls.current.set(f.id, el);
          else rowEls.current.delete(f.id);
        }}
        className="group/file-row relative flex items-center"
        onContextMenu={
          f
            ? (e) => {
                e.preventDefault();
                setMenuFor(f.id);
              }
            : undefined
        }
      >
        <TreeGuides depth={opts.depth} isLast={opts.isLast} guides={opts.guides} />
        <RowButton
          onClick={opts.onClick}
          aria-current={opts.selected ? 'true' : undefined}
          title={f?.description || undefined}
          style={{ paddingLeft: TREE_ROW_PAD + opts.depth * TREE_INDENT }}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-sm',
            f ? 'pr-14' : 'pr-2',
            opts.selected
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-foreground/90 hover:bg-foreground/[0.06]',
          )}
        >
          {opts.tile}
          <span className="min-w-0 flex-1 truncate text-left">{opts.label}</span>
          {opts.count !== undefined && opts.count > 0 && (
            <span
              className={cn(
                'text-[11px] tabular-nums',
                opts.selected ? 'text-accent-foreground/70' : 'text-muted-foreground',
              )}
              title={`${opts.count} file${opts.count === 1 ? '' : 's'}`}
            >
              {opts.count}
            </span>
          )}
        </RowButton>
        {opts.fold && (
          <Button
            variant="ghost"
            size="icon-2xs"
            aria-label={opts.fold.open ? `Fold ${opts.label}` : `Unfold ${opts.label}`}
            aria-expanded={opts.fold.open}
            onClick={opts.fold.toggle}
            className={cn(
              'absolute right-7 top-1/2 -translate-y-1/2 hover:text-foreground',
              opts.selected ? 'text-accent-foreground/70' : 'text-muted-foreground',
            )}
          >
            <ChevronRight className={cn('transition-transform', opts.fold.open && 'rotate-90')} />
          </Button>
        )}
        {f && (
          <DropdownMenu open={menuFor === f.id} onOpenChange={(o) => setMenuFor(o ? f.id : null)}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-2xs"
                aria-label={`More actions for ${opts.label}`}
                className={cn(
                  'absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/file-row:opacity-100',
                  menuFor === f.id && 'opacity-100',
                )}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            {menu(f)}
          </DropdownMenu>
        )}
      </div>
    );
  };

  const folderTile = (f: FolderRow | null) => {
    const color = f?.color;
    return (
      <AppTile icon={f?.icon} color={isAppTint(color) ? color : null} kind="folder" size="sm" />
    );
  };

  return (
    <div className="flex flex-col gap-px">
      {!q && (
        <>
          {row({
            folder: null,
            key: 'recent',
            depth: 0,
            isLast: false,
            guides: [],
            selected: recentActive,
            label: 'Recent',
            tile: (
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground">
                <Clock className="size-3" aria-hidden />
              </span>
            ),
            onClick: onRecent,
          })}
          {onData &&
            row({
              folder: null,
              key: 'data',
              depth: 0,
              isLast: false,
              guides: [],
              selected: dataActive,
              label: 'Data files',
              tile: (
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-muted text-muted-foreground">
                  <Database className="size-3" aria-hidden />
                </span>
              ),
              onClick: onData,
            })}
          {row({
            folder: root,
            key: 'root',
            depth: 0,
            isLast: false,
            guides: [],
            selected: currentPath === FILES_ROOT,
            label: 'All files',
            tile: folderTile(root),
            count: root?.fileCount,
            onClick: () => onNavigate(FILES_ROOT),
          })}
          <div className="mx-3 my-1 border-t border-border/60" />
        </>
      )}
      {rows.map((r) => {
        const f = r.folder;
        const isOpen = q.length > 0 || open.has(f.id);
        return row({
          folder: f,
          key: f.id,
          depth: r.depth,
          isLast: r.isLast,
          guides: r.guides,
          selected: f.path === currentPath,
          label: f.slug,
          tile: folderTile(f),
          count: f.fileCount,
          onClick: () => onNavigate(f.path),
          fold:
            r.hasChildren && !q
              ? {
                  open: isOpen,
                  toggle: () =>
                    updateOpen((s) => {
                      if (s.has(f.id)) s.delete(f.id);
                      else s.add(f.id);
                    }),
                }
              : undefined,
        });
      })}
      {q && rows.length === 0 && (
        <p className="px-3 py-1 text-xs text-muted-foreground">No folder names match.</p>
      )}

      {lookFolder && (
        <AppLookPicker
          open
          onOpenChange={(o) => !o && setLookFor(null)}
          virtualAnchor={rowEls.current.get(lookFolder.id) ?? null}
          side="right"
          align="start"
          icon={lookFolder.icon}
          color={isAppTint(lookFolder.color) ? lookFolder.color : null}
          kind="folder"
          label={lookFolder.path === FILES_ROOT ? 'All files' : lookFolder.slug}
          onChange={(l) => void setLook(lookFolder, l)}
        />
      )}
    </div>
  );
}
