'use client';

import { useZenMode } from '@/components/layout/zen-mode';
import { ItemHeader } from '@/components/layout/item-header';
import { AccessSlot } from '@/components/share/access-slot';
import { itemAccess } from '@/lib/item-access';
import { guardedNavigate } from '@/lib/nav-guard';
import { grantsKey, grantsUrl, uploadLine, uploadVisibleTo, type GrantsView } from '@/lib/grants';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  ArrowDown,
  Folder,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Columns2,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { FileEditor } from './file-editor';
import { oneOf, usePersistedState } from '@/lib/use-persisted-state';
import { useFileSearch } from './use-file-search';
import { useWorkspaceJump, WorkspaceHitTag } from '@/components/workspaces/workspace-hit-tag';
import { cn } from '@mantle/web-ui/lib/utils';
import { CreateFileDialog, CreateFolderDialog, RenameDialog } from './files-dialogs';
import {
  droppedTree,
  folderUploadNotice,
  pickedTreeFiles,
  planFolderUpload,
} from './folder-upload';
import type { FolderUploadPlan, TreeFile } from './folder-upload';
import { ChildFolders, DualPane } from './files-panes';
import { FolderTreeRail } from './folder-tree-rail';
import { ItemTree } from '@/components/item-tree/item-tree';
import { filesAdapter } from '@/components/item-tree/kinds/files';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import {
  FILES_ROOT,
  cascadeOutcome,
  describeDerivedCounts,
  effectiveFolderIndexing,
  fmtRelative,
  fmtSize,
  sumDerivedCounts,
  dismissDialog,
  fileFolderHref,
  refusalMessages,
  folderIndexingDoneText,
  folderIndexingErrorText,
} from './files-shared';
import type {
  BulkDeleteCascadeResponse,
  BulkDeleteResponse,
  FileRow,
  FolderRow,
  FilesDialog,
  FilesDialogKind,
} from './files-shared';
import { useRealtime } from '@/components/realtime/use-realtime';
import { useUploads } from '@/components/uploads/upload-provider';
import { SetPageTitle } from '@/components/layout/page-title';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
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

/** The three shapes the file list can take; anything else in storage is stale. */
const VIEW_CHOICES = oneOf('list', 'grid', 'dual');

export function FilesClient() {
  const searchParams = useSearchParams();
  const requestedPath = searchParams.get('path') || FILES_ROOT;

  const treeQuery = useQuery({
    queryKey: ['files', 'tree'],
    queryFn: () => apiFetch<{ folders: FolderRow[] }>('/api/files/folders?tree=true'),
  });

  const tree = treeQuery.data?.folders ?? [];
  // Validate the requested path exists; fall back to root (mirrors the old SSR).
  const currentPath = tree.some((f) => f.path === requestedPath) ? requestedPath : FILES_ROOT;
  const currentFolder = tree.find((f) => f.path === currentPath) ?? null;

  const filesQuery = useQuery({
    queryKey: ['files', 'list', currentPath],
    queryFn: () =>
      apiFetch<{ files: FileRow[] }>(`/api/files/files?parent=${encodeURIComponent(currentPath)}`),
    enabled: treeQuery.isSuccess,
    placeholderData: (prev) => prev,
  });

  const files = filesQuery.data?.files ?? EMPTY_ROWS;

  if (treeQuery.isPending || (filesQuery.isPending && !filesQuery.data)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (treeQuery.isError && !treeQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Couldn&apos;t load your files.</p>
        <Button variant="outline" size="sm" onClick={() => treeQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <FilesView tree={tree} currentPath={currentPath} currentFolder={currentFolder} files={files} />
  );
}

const EMPTY_ROWS: FileRow[] = [];

function FilesView({
  tree,
  currentPath,
  currentFolder,
  files: initialFiles,
}: {
  tree: FolderRow[];
  currentPath: string;
  currentFolder: FolderRow | null;
  files: FileRow[];
}) {
  const toAsset = useAssetUrl();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  // Effective brain-indexing mode for the folder being viewed — what the
  // header toggle displays and what un-flagged file rows badge under.
  const foldersByPath = useMemo(() => new Map(tree.map((f) => [f.path, f])), [tree]);
  const foldersById = useMemo(() => new Map(tree.map((f) => [f.id, f])), [tree]);

  // The left pane is the item tree when this brain serves it (its shell names
  // `files` in `treeKinds`); an older brain, or a tree call that 404s, keeps
  // the folder rail below.
  const treeServes = useTreeServes('files');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const folderIndexing = effectiveFolderIndexing(currentPath, foldersByPath);

  // ── View + sort ────────────────────────────────────────────────
  // 'list' is the details table; 'grid' is thumbnail tiles. The choice is a
  // lasting preference, not per-folder state, so it lives in localStorage.
  // Read AFTER hydration, not during it: the lazy `localStorage` initialiser
  // this replaces rendered 'list' on the server and the stored value on the
  // client, which is a hydration mismatch, and its unguarded storage access
  // throws outright in a browser set to block site data.
  const [view, switchView] = usePersistedState('files:view', 'list' as const, VIEW_CHOICES);
  type SortKey = 'name' | 'type' | 'size' | 'modified';
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : // Size and recency are usually asked as "biggest / newest first".
          { key, dir: key === 'size' || key === 'modified' ? 'desc' : 'asc' },
    );
  // The left pane's search — see use-file-search.ts for the two behaviours
  // one input drives, and for the stale-response guard.
  // The open folder below the top level: what Access, rename and delete act on.
  const folder = currentFolder && currentFolder.path !== FILES_ROOT ? currentFolder : null;
  // Maximise from the item header collapses the folders.
  const { zen } = useZenMode();
  const { query, setQuery, hits, searching, active: searchActive } = useFileSearch();
  const jump = useWorkspaceJump();

  // ── Path jump — type/paste a path, Enter navigates ──────────
  const [pathJump, setPathJump] = useState<string | null>(null);
  const submitPathJump = () => {
    if (pathJump === null) return;
    // Accept 'files.work.x', 'files/work/x', or '/files/work/x'.
    const normalized = pathJump.trim().replace(/^\/+/, '').replace(/\//g, '.').replace(/\.+$/, '');
    if (!normalized) return setPathJump(null);
    if (!foldersByPath.has(normalized)) {
      toast.error(`No folder at '${normalized}' — check the path in the tree`);
      return;
    }
    setPathJump(null);
    navigateFolder(normalized);
  };

  // ── Recent — the cross-tree "where did that upload land" view ──
  const [recentView, setRecentView] = useState(false);
  const recentQuery = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () =>
      apiFetch<{ files: FileRow[] }>('/api/files/files?recent=1&limit=100').then((r) => r.files),
    enabled: recentView,
  });

  const sortedFiles = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const label = (f: FileRow) => describeFile(f.mimeType, f.filename).label;
    return [...files].sort((a, b) => {
      switch (sort.key) {
        case 'size':
          return (a.sizeBytes - b.sizeBytes) * dir;
        case 'modified':
          return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir;
        case 'type': {
          const c = label(a).localeCompare(label(b));
          // Same type sorts by name so the order is stable and scannable.
          return (c !== 0 ? c : a.filename.localeCompare(b.filename)) * dir;
        }
        default:
          return a.filename.localeCompare(b.filename, undefined, { numeric: true }) * dir;
      }
    });
  }, [files, sort]);

  // Which dialog is open — one value, because only one ever is. The six flags
  // this replaces could spell thirty-one states that must never happen, and
  // only care kept them apart. `cascade` is the second-step confirm for files
  // that ingest derived nodes (extracted images, imported tables, pages,
  // notes): the server refuses a plain delete and reports the counts, which
  // ride along with the kind that needs them.
  const [dialog, setDialog] = useState<FilesDialog>(null);
  const closeDialog = (kind: FilesDialogKind) => setDialog((d) => dismissDialog(d, kind));
  // Narrowed once here rather than at each of its six reads below.
  const cascade = dialog?.kind === 'cascade' ? dialog : null;

  // Sync local file state when server re-fetches.
  useEffect(() => {
    setFiles(initialFiles);
    setSelectedFileIds(new Set());
  }, [initialFiles]);

  const openFileId = searchParams.get('file');

  // Pin the open file when the preview is up, else the folder being browsed —
  // in both cases the thing the screen is actually about.
  //
  // The folder path rides as meta because a filename alone is ambiguous: two
  // `report.pdf`s in different folders produce identical chips and identical
  // preamble lines, and the agent has no way to tell which one is meant. The
  // path is a handful of bytes and settles it. Content deliberately stays out —
  // once the ref resolves, the node tools can read the body.
  const openFileRow = openFileId ? (files.find((f) => f.id === openFileId) ?? null) : null;
  useSurfaceAssist({
    node: openFileRow
      ? {
          id: openFileRow.id,
          kind: 'file',
          label: openFileRow.filename,
          meta: { folder: openFileRow.parentPath },
        }
      : currentFolder
        ? {
            id: currentFolder.id,
            kind: 'folder',
            label: currentFolder.title || currentFolder.path,
            meta: { path: currentFolder.path },
          }
        : null,
  });

  const refresh = useCallback(() => {
    startTransition(() => {
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      // The tree shows the same folders and files.
      void queryClient.invalidateQueries({ queryKey: ['tree', 'files'] });
    });
  }, [queryClient]);

  // Live updates: a new file/folder (node_ingested) or a finished extraction
  // (node_indexed) for this owner repaints the list — the summary appears the
  // moment the extractor writes it, with no manual refresh.
  useRealtime(['file', 'branch'], refresh);

  const navigateFolder = (path: string) => {
    const sp = new URLSearchParams();
    sp.set('path', path);
    router.push(`/files?${sp.toString()}`);
  };

  const openFile = (fileId: string | null) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (fileId) sp.set('file', fileId);
    else sp.delete('file');
    router.push(`/files?${sp.toString()}`);
  };

  // ─── Upload ──────────────────────────────────────────────────────
  // Hands files to the app-wide background uploader (UploadProvider) so they
  // keep uploading after you navigate away; the realtime layer refreshes this
  // list as each file lands.
  const { enqueue } = useUploads();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const triggerUpload = () => fileInputRef.current?.click();
  // Into a folder shared beyond its home, what lands is read there at once
  // (S6): asked once per upload, then sent with `confirm` (the brain refuses
  // it without, 409). Who reads it comes from the folder's grants (W8: no
  // level, so no other source).
  const folderGrants = useQuery({
    queryKey: grantsKey(currentFolder?.id ?? 'none'),
    queryFn: () => apiFetch<GrantsView>(grantsUrl(currentFolder!.id)),
    enabled: !!currentFolder,
    retry: false,
  });
  const visibleTo = currentFolder ? uploadVisibleTo(folderGrants.data) : null;
  const asksOnUpload = visibleTo !== null;
  // `tree`: a folder upload, whose files land in the folders it makes.
  const [sharedUpload, setSharedUpload] = useState<{
    files: File[];
    path: string;
    tree?: FolderUploadPlan;
  } | null>(null);
  const upload = (list: FileList | File[]) => {
    const picked = Array.from(list);
    if (!picked.length) return;
    if (asksOnUpload) setSharedUpload({ files: picked, path: currentPath });
    else enqueue(picked, currentPath);
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    upload(e.target.files);
    e.target.value = '';
  };

  // ─── Folder upload ───────────────────────────────────────────────
  // A folder with its sub-folders: the brain takes one file into one
  // existing folder, so each missing folder is made first, parents before
  // children, then each folder's files go to the upload dock.
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const sendTree = async (plan: FolderUploadPlan, confirm: boolean) => {
    for (const step of plan.folders) {
      if (foldersByPath.has(step.path)) continue;
      try {
        await apiSend('/api/files/folders', 'POST', {
          parentPath: step.parentPath,
          slug: step.slug,
        });
      } catch (err) {
        // 409: it is there already (made since the tree last loaded).
        if (err instanceof ApiError && err.status === 409) continue;
        toast.error(
          `Could not create folder ${step.path}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
        return;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['files', 'tree'] });
    for (const b of plan.batches) enqueue(b.files, b.parentPath, confirm ? { confirm: true } : {});
    const notice = folderUploadNotice(plan);
    if (notice) toast.info(notice);
  };
  const uploadTree = (items: TreeFile[]) => {
    const plan = planFolderUpload(items, currentPath);
    if (plan.fileCount === 0) {
      toast.info(folderUploadNotice(plan) ?? 'That folder has no files to upload.');
      return;
    }
    const files = plan.batches.flatMap((b) => b.files);
    if (asksOnUpload) setSharedUpload({ files, path: currentPath, tree: plan });
    else void sendTree(plan, false);
  };
  const onFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    uploadTree(pickedTreeFiles(e.target.files));
    e.target.value = '';
  };

  // ─── Drag-drop ───────────────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    // A drop with a folder in it keeps its tree; read while the event runs.
    const tree = droppedTree(e.dataTransfer.items);
    if (tree) {
      tree.then(uploadTree, () => toast.error('Could not read the dropped folder.'));
      return;
    }
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
  };

  // ─── Delete folder ───────────────────────────────────────────────
  const confirmDeleteFolder = async () => {
    if (!currentFolder || currentFolder.path === FILES_ROOT) return;
    try {
      await apiSend(`/api/files/folders/${currentFolder.id}`, 'DELETE');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
      return;
    }
    toast.success(`Deleted "${currentFolder.slug}"`);
    const parent =
      currentFolder.path.lastIndexOf('.') > 0
        ? currentFolder.path.slice(0, currentFolder.path.lastIndexOf('.'))
        : FILES_ROOT;
    navigateFolder(parent);
  };

  // ─── Bulk delete files ───────────────────────────────────────────
  const deleteIds =
    dialog?.kind === 'bulkDelete' && dialog.ids ? dialog.ids : Array.from(selectedFileIds);
  // A refused file's name, when this folder lists it (never an id).
  const fileNameOf = (id: string) => files.find((f) => f.id === id)?.filename;
  const confirmBulkDelete = async () => {
    const ids = deleteIds;
    if (ids.length === 0) return;
    let res: BulkDeleteResponse;
    try {
      res = await apiSend<BulkDeleteResponse>('/api/files/files', 'DELETE', { ids });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
      return;
    }
    const needsCascade = res.hasDerived ?? [];
    if (needsCascade.length > 0) {
      // Some files produced derived nodes; nothing of theirs was deleted.
      // Ask before cascading.
      setDialog({
        kind: 'cascade',
        ids: needsCascade.map((r) => r.fileId),
        counts: sumDerivedCounts(needsCascade.map((r) => r.derived)),
      });
    }
    // Say why a file survived, per reason (brain F4). Without this a guarded
    // file just silently stayed put; a mixed selection reported only the
    // successes.
    for (const line of refusalMessages(res.refused ?? [], fileNameOf)) toast.error(line);
    if (res.deleted > 0) {
      toast.success(`Deleted ${res.deleted} file${res.deleted === 1 ? '' : 's'}`);
    }
    setSelectedFileIds(new Set());
    refresh();
  };

  const confirmCascadeDelete = async () => {
    if (dialog?.kind !== 'cascade') return;
    const { ids } = dialog;
    let res: BulkDeleteCascadeResponse;
    try {
      res = await apiSend<BulkDeleteCascadeResponse>('/api/files/files', 'DELETE', {
        ids,
        cascade: true,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
      return;
    }
    // Never "everything" when the brain kept derived items the login may
    // not delete, or refused a file (brain F4: keptTotal, refused).
    const { success, kept } = cascadeOutcome(res, ids.length);
    if (success) toast.success(success);
    if (kept) toast.info(kept);
    for (const line of refusalMessages(res.refused ?? [], fileNameOf)) toast.error(line);
    closeDialog('cascade');
    refresh();
  };

  // ─── Folder description inline edit ──────────────────────────────
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftDesc, setDraftDesc] = useState(currentFolder?.description ?? '');
  const saveDescription = async () => {
    if (!currentFolder) return;
    try {
      await apiSend(`/api/files/folders/${currentFolder.id}`, 'PATCH', { description: draftDesc });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save description');
      return;
    }
    setEditingDesc(false);
    refresh();
  };

  /** Flip the current folder's indexing flag. The server sweeps descendants
   *  and reports how many files it re-queued — surface that, because the
   *  effect is otherwise invisible until the extractor gets there. */
  const setFolderIndexing = async (mode: 'full' | 'metadata' | 'inherit') => {
    if (!currentFolder) return;
    try {
      const res = await apiSend<{ requeued?: number }>(
        `/api/files/folders/${currentFolder.id}`,
        'PATCH',
        { indexing: mode },
      );
      toast.success(folderIndexingDoneText(mode, res.requeued ?? 0));
      refresh();
    } catch (err) {
      toast.error(folderIndexingErrorText(err));
    }
  };

  // ─── Breadcrumbs ─────────────────────────────────────────────────
  const breadcrumbs = useMemo(() => {
    const segments = currentPath.split('.');
    const crumbs: { label: string; path: string }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join('.');
      const label = i === 0 ? 'Files' : segments[i]!.replace(/_/g, '-');
      crumbs.push({ label, path });
    }
    return crumbs;
  }, [currentPath]);

  const allSelected = files.length > 0 && selectedFileIds.size === files.length;
  const someSelected = selectedFileIds.size > 0 && !allSelected;

  return (
    <>
      <MasterDetail
        id="files"
        listCollapsed={zen}
        // 260px, the width this screen has always had — a starting point now
        // rather than a decree.
        defaultListSize="260px"
        // The literal translation of the old `grid-cols-[260px_1fr]`: the tree
        // keeps its draggable width and the right pane takes everything else.
        // It is a six-column file table and, when a file is open, an editor with
        // a side-by-side preview — not a measure of reading text, so the
        // three-panel default's 672px cap would be actively wrong here.
        detailFills
        list={
          /* ── Tree rail ─────────────────────────────────────────
             No `border-r`: `MasterDetail`'s handle IS a 1px `bg-border` rule in
             exactly that place, so keeping the border would draw it twice.
             `h-full` because a grid item stretched to the row and a flex item
             does not — without it the tinted background stops wherever the
             tree happens to end. */
          showTree ? (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="files"
                adapter={filesAdapter}
                rootLabel="All files"
                selectedItemId={openFileId}
                selectedFolderPath={openFileId || searchActive ? null : currentPath}
                revealPath={currentPath}
                query={query}
                onQueryChange={setQuery}
                searchPlaceholder="Search files and folders…"
                // Like New with that folder open: the dialog picks the type,
                // and the file is made in the folder and opens there.
                newItemInFolder={{
                  label: 'file',
                  icon: FileText,
                  onCreate: (f) => {
                    setRecentView(false);
                    navigateFolder(f.path);
                    setDialog({ kind: 'createFile', ext: 'md', parentPath: f.path });
                  },
                }}
                onOpenFolder={(f) => {
                  setRecentView(false);
                  navigateFolder(f?.path ?? FILES_ROOT);
                }}
                onOpenItem={(item, where) => {
                  const sp = new URLSearchParams();
                  sp.set(
                    'path',
                    where.folderPath ??
                      (where.folderId ? foldersById.get(where.folderId)?.path : null) ??
                      FILES_ROOT,
                  );
                  sp.set('file', item.id);
                  router.push(`/files?${sp.toString()}`);
                }}
                itemActions={(item) => (
                  <>
                    {itemAccess(item).edit ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          setDialog({
                            kind: 'rename',
                            target: {
                              kind: 'file',
                              id: item.id,
                              filename: item.title,
                              extension: item.subtype ?? '',
                            },
                          })
                        }
                      >
                        <Pencil />
                        Rename…
                      </DropdownMenuItem>
                    ) : null}
                    {itemAccess(item).manage ? (
                      <DropdownMenuItem
                        className="text-destructive-ink focus:text-destructive-ink"
                        onSelect={() => setDialog({ kind: 'bulkDelete', ids: [item.id] })}
                      >
                        <Trash2 />
                        Delete…
                      </DropdownMenuItem>
                    ) : null}
                  </>
                )}
                onChanged={refresh}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <aside className="flex h-full flex-col bg-muted/20">
              <div className="space-y-2 border-b border-border p-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                    placeholder="Filter folders, search files…"
                    aria-label="Filter folders and search files"
                    className="h-9 pl-8 pr-8"
                  />
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon-2xs"
                      aria-label="Clear search"
                      onClick={() => setQuery('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2">
                <FolderTreeRail
                  tree={tree}
                  currentPath={recentView ? '' : currentPath}
                  onNavigate={(p) => {
                    setRecentView(false);
                    setQuery('');
                    navigateFolder(p);
                  }}
                  filter={query.trim()}
                  recentActive={recentView}
                  onRecent={() => setRecentView(true)}
                  onNewFolder={(parentPath) => setDialog({ kind: 'createFolder', parentPath })}
                  onNewFile={(parentPath) => {
                    setRecentView(false);
                    navigateFolder(parentPath);
                    setDialog({ kind: 'createFile', ext: 'md', parentPath });
                  }}
                  onRename={(f) =>
                    setDialog({
                      kind: 'rename',
                      target: { kind: 'folder', id: f.id, slug: f.slug },
                    })
                  }
                />
              </div>
            </aside>
          )
        }
        detail={
          /* ── Main pane ─────────────────────────────────────────
             KEEPS its own `flex h-full flex-col overflow-hidden` and the
             `flex-1 overflow-y-auto` grid inside it, rather than handing the
             scroll to `MasterDetail`'s pane (landmine 9). The breadcrumb header
             and the toolbar are pinned by that structure; letting the outer
             pane scroll would scroll them away. Only ONE scrollbar is ever
             painted — `h-full` + `overflow-hidden` means the outer pane's
             content can never exceed it, so it has nothing to scroll.

             The drag-to-upload handlers stay on this element, so the drop zone
             is still the whole right pane. */
          <div
            className="flex h-full flex-col overflow-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {openFileId ? (
              <FileEditor
                key={openFileId}
                fileId={openFileId}
                onClose={() => openFile(null)}
                onSaved={refresh}
                onLoaded={(file) => {
                  // A /n link names only the file: open its folder too.
                  const href = fileFolderHref(searchParams, file.parentPath);
                  if (href) router.replace(href);
                }}
              />
            ) : searchActive ? (
              /* ── Search results ────────────────────────────────── */
              <div className="flex h-full flex-col overflow-hidden">
                <SetPageTitle title="Search files" />
                <header className="border-b border-border px-6 py-3">
                  <h2 className="text-sm font-medium">
                    {searching
                      ? 'Searching…'
                      : `${(hits ?? []).length} result${(hits ?? []).length === 1 ? '' : 's'} for “${query.trim()}”`}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ranked by meaning across file names, summaries and content. Name-only files
                    match on name, type and tags.
                  </p>
                </header>
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {(hits ?? []).length === 0 && !searching ? (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      Nothing matched. Content search needs indexed files — name-only files match by
                      filename and tags alone.
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {(hits ?? []).map((h) => {
                        const d = describeFile(null, h.title);
                        const HitIcon = d.icon;
                        // A hit from another workspace (task f26a516e): its
                        // tag, and opening it switches there first.
                        const to = jump.target(h);
                        return (
                          <li key={h.id}>
                            <RowButton
                              onClick={() =>
                                // The switch runs inside the guarded open (as
                                // the search palette does): kept off it, the
                                // workspace stays too.
                                guardedNavigate(() => {
                                  if (to) jump.switchTo(to.id);
                                  setQuery('');
                                  const sp = new URLSearchParams();
                                  sp.set('path', h.path);
                                  sp.set('file', h.id);
                                  router.push(`/files?${sp.toString()}`);
                                })
                              }
                              className="flex w-full items-start gap-3 px-6 py-2.5 text-left hover:bg-muted/30"
                            >
                              <HitIcon
                                aria-hidden
                                className={`mt-0.5 size-4 shrink-0 ${KIND_TINT[d.kind]}`}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  {h.title}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {h.path}
                                  {h.summary ? ` — ${h.summary}` : ''}
                                </span>
                              </span>
                              {to && <WorkspaceHitTag workspace={to} className="ml-auto" />}
                              <span
                                className={cn(
                                  'shrink-0 text-xs text-muted-foreground',
                                  !to && 'ml-auto',
                                )}
                              >
                                {fmtRelative(h.updatedAt)}
                              </span>
                            </RowButton>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : recentView ? (
              /* ── Recent files, whole tree ──────────────────────── */
              <div className="flex h-full flex-col overflow-hidden">
                <SetPageTitle title="Recent files" />
                <header className="border-b border-border px-6 py-3">
                  <h2 className="text-sm font-medium">Recent files</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Newest changes across every folder — an upload or edit puts a file back on top.
                  </p>
                </header>
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  <ul className="divide-y divide-border">
                    {(recentQuery.data ?? []).map((f) => {
                      const d = describeFile(f.mimeType, f.filename);
                      const RecentIcon = d.icon;
                      return (
                        <li key={f.id}>
                          <RowButton
                            onClick={() => {
                              setRecentView(false);
                              const sp = new URLSearchParams();
                              sp.set('path', f.parentPath);
                              sp.set('file', f.id);
                              router.push(`/files?${sp.toString()}`);
                            }}
                            className="flex w-full items-center gap-3 px-6 py-2 text-left hover:bg-muted/30"
                          >
                            <RecentIcon
                              aria-hidden
                              className={`size-4 shrink-0 ${KIND_TINT[d.kind]}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {f.filename}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {f.parentPath}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {fmtSize(f.sizeBytes)}
                            </span>
                            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                              {fmtRelative(f.updatedAt)}
                            </span>
                          </RowButton>
                        </li>
                      );
                    })}
                  </ul>
                  {recentQuery.data && recentQuery.data.length === 0 && (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No files yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <SetPageTitle title={currentFolder?.slug ?? 'files'} />
                {/* The item header (contract 2026-10-21): one row for the open
                    folder. New and Upload are the word buttons; Upload folder,
                    the view and the indexing switch are its tools; the pencil
                    renames it; the path, the description and Go to path sit
                    behind Info and More. The top level has no Access, rename or
                    delete. */}
                <ItemHeader
                  sticky
                  section="Files"
                  visual={<Folder className="size-4" aria-hidden />}
                  title={
                    pathJump !== null ? (
                      // Click-to-type path entry: the file-manager address bar,
                      // for pasting a path from chat or a doc.
                      <Input
                        autoFocus
                        value={pathJump}
                        onChange={(e) => setPathJump(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitPathJump();
                          if (e.key === 'Escape') setPathJump(null);
                        }}
                        onBlur={() => setPathJump(null)}
                        placeholder="files.work.reports — Enter to jump"
                        aria-label="Go to path"
                        className="h-7 w-80 max-w-full font-mono text-xs"
                      />
                    ) : (
                      (breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Files')
                    )
                  }
                  textActions={
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm">
                            <Plus /> New <ChevronDown className="opacity-70" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'createFolder' })}>
                            <FolderPlus /> Folder
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'createFile', ext: 'md' })}
                          >
                            <FileText /> Markdown file
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'createFile', ext: 'txt' })}
                          >
                            <FileText /> Text file
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'createFile', ext: 'json' })}
                          >
                            <FileJson /> JSON file
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" variant="outline" onClick={triggerUpload}>
                        <Upload /> Upload
                      </Button>
                    </>
                  }
                  access={
                    folder ? (
                      <AccessSlot type="branch" nodeId={folder.id} canShare shares={folder} />
                    ) : undefined
                  }
                  tools={[
                    {
                      key: 'upload-folder',
                      label: 'Upload a folder with its sub-folders',
                      icon: <FolderUp />,
                      onSelect: () => folderInputRef.current?.click(),
                    },
                    {
                      key: 'view',
                      label: `View: ${view === 'grid' ? 'Thumbnails' : view === 'dual' ? 'Two panes' : 'Details'}`,
                      icon:
                        view === 'grid' ? (
                          <LayoutGrid />
                        ) : view === 'dual' ? (
                          <Columns2 />
                        ) : (
                          <List />
                        ),
                      choices: [
                        {
                          key: 'list',
                          label: view === 'list' ? 'Details ✓' : 'Details',
                          icon: <List />,
                          onSelect: () => switchView('list'),
                        },
                        {
                          key: 'grid',
                          label: view === 'grid' ? 'Thumbnails ✓' : 'Thumbnails',
                          icon: <LayoutGrid />,
                          onSelect: () => switchView('grid'),
                        },
                        {
                          key: 'dual',
                          label:
                            view === 'dual'
                              ? 'Two panes ✓ (F5 copy, F6 move, Tab switches)'
                              : 'Two panes (F5 copy, F6 move, Tab switches)',
                          icon: <Columns2 />,
                          onSelect: () => switchView('dual'),
                        },
                      ],
                    },
                    ...(folder
                      ? [
                          {
                            // The trigger names the EFFECTIVE mode (own flag
                            // or inherited); the choices edit the OWN flag.
                            key: 'indexing',
                            label:
                              folderIndexing.mode === 'metadata'
                                ? `Name only: content here is not indexed${folderIndexing.from ? ` (inherited from ${folderIndexing.from})` : ''}`
                                : 'Indexed: search can read inside files here',
                            icon: folderIndexing.mode === 'metadata' ? <EyeOff /> : <Eye />,
                            choices: [
                              {
                                key: 'full',
                                label: 'Index content (search can read inside files)',
                                icon: <Eye />,
                                onSelect: () => setFolderIndexing('full'),
                              },
                              {
                                key: 'metadata',
                                label: "Name only (store and share, don't index content)",
                                icon: <EyeOff />,
                                onSelect: () => setFolderIndexing('metadata'),
                              },
                              ...(folder.indexing
                                ? [
                                    {
                                      key: 'inherit',
                                      label: 'Inherit from parent',
                                      onSelect: () => setFolderIndexing('inherit'),
                                    },
                                  ]
                                : []),
                            ],
                          },
                        ]
                      : []),
                  ]}
                  onDelete={folder ? () => setDialog({ kind: 'deleteFolder' }) : undefined}
                  deleteDisabled={busy && !!folder}
                  deleteLabel="Delete folder"
                  edit={
                    folder
                      ? {
                          label: 'Rename folder',
                          onSelect: () =>
                            setDialog({
                              kind: 'rename',
                              target: {
                                kind: 'folder',
                                id: folder.id,
                                slug: folder.slug,
                              },
                            }),
                        }
                      : undefined
                  }
                  more={[
                    {
                      key: 'path',
                      label: 'Go to path…',
                      icon: <Pencil />,
                      onSelect: () => setTimeout(() => setPathJump(currentPath), 50),
                    },
                  ]}
                  info={{
                    description: editingDesc ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={draftDesc}
                          onChange={(e) => setDraftDesc(e.target.value)}
                          rows={3}
                          placeholder="Describe what lives in this folder…"
                          aria-label="Folder description"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="xs" onClick={saveDescription}>
                            Save
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              setEditingDesc(false);
                              setDraftDesc(currentFolder?.description ?? '');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <RowButton
                        onClick={() => {
                          setDraftDesc(currentFolder?.description ?? '');
                          setEditingDesc(true);
                        }}
                        className="group flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground"
                      >
                        <span>
                          {currentFolder?.description ? (
                            currentFolder.description
                          ) : (
                            <span className="italic">No description: click to add</span>
                          )}
                        </span>
                        <Pencil className="size-3 opacity-0 group-hover:opacity-100" aria-hidden />
                      </RowButton>
                    ),
                    rows: [
                      {
                        label: 'Location',
                        value: (
                          <span className="flex flex-wrap items-center gap-1">
                            {breadcrumbs.map((c, i) => (
                              <span key={c.path} className="flex items-center gap-1">
                                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                                <RowButton
                                  onClick={() => navigateFolder(c.path)}
                                  className="hover:text-primary-ink"
                                >
                                  {c.label}
                                </RowButton>
                              </span>
                            ))}
                          </span>
                        ),
                      },
                    ],
                  }}
                  infoLabel="About this folder"
                />
                <input ref={fileInputRef} type="file" multiple hidden onChange={onFileInput} />
                <input
                  ref={(el) => {
                    // Not a React prop: the folder picker is a DOM attribute.
                    el?.setAttribute('webkitdirectory', '');
                    folderInputRef.current = el;
                  }}
                  type="file"
                  multiple
                  hidden
                  onChange={onFolderInput}
                />

                {/* A pick of files has its own bar, in the content. */}
                <div
                  className={cn(
                    'flex items-center gap-2 border-b border-border px-6 py-2',
                    selectedFileIds.size === 0 && 'hidden',
                  )}
                >
                  {selectedFileIds.size > 0 &&
                    // Delete is a Moderator's of each file's home (its caps).
                    files.every((f) => !selectedFileIds.has(f.id) || itemAccess(f).manage) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-muted-foreground hover:text-destructive-ink"
                        onClick={() => setDialog({ kind: 'bulkDelete' })}
                      >
                        <Trash2 /> Delete {selectedFileIds.size}
                      </Button>
                    )}
                </div>

                {/* Grid */}
                {/* The pane's ONE scrollbar. `scrollbar-thin` per §8 — there is
                    no global default, so an element that scrolls without it
                    gets a fat bar and nothing warns you. */}
                <div className="relative flex-1 overflow-y-auto scrollbar-thin">
                  {dragOver && (
                    <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/50 bg-primary/5 text-sm font-medium text-primary-ink">
                      <span>
                        Drop to upload to <code className="ml-1 font-mono">{currentPath}</code>
                      </span>
                      {visibleTo ? (
                        <span className="text-xs font-normal">
                          Also visible to: {visibleTo.join(', ')}
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* Child folders */}
                  <ChildFolders tree={tree} currentPath={currentPath} onNavigate={navigateFolder} />

                  {/* Files */}
                  {/* Dual pane FIRST: an empty current folder is exactly where
                      a two-pane view earns its keep (you're moving things INTO
                      it), so the empty state must not shadow it (audit A3). */}
                  {view === 'dual' ? (
                    <DualPane
                      tree={tree}
                      leftStart={currentPath}
                      onOpenFile={(id, path) => {
                        const sp = new URLSearchParams();
                        sp.set('path', path);
                        sp.set('file', id);
                        router.push(`/files?${sp.toString()}`);
                      }}
                      onChanged={() => {
                        refresh();
                        queryClient.invalidateQueries({ queryKey: ['files'] });
                      }}
                    />
                  ) : files.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No files in this folder. Drop a file anywhere here, or use{' '}
                      <span className="font-medium text-foreground">New</span> to create one.
                    </div>
                  ) : view === 'grid' ? (
                    /* Thumbnail tiles. Images load ?thumb=1 (cached 512px JPEG
                       server-side); a 404 — not an image, render failed —
                       flips the tile to the type icon via onError. Selection
                       stays a list-view feature; a tile click opens. */
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-4">
                      {sortedFiles.map((f) => {
                        const described = describeFile(f.mimeType, f.filename);
                        const TypeIcon = described.icon;
                        const isImage = f.mimeType.startsWith('image/');
                        return (
                          <RowButton
                            key={f.id}
                            onClick={() => openFile(f.id)}
                            data-mark-id={f.id}
                            data-mark-kind="file"
                            data-mark-label={f.filename}
                            title={`${f.filename} — ${described.label}, ${fmtSize(f.sizeBytes)}`}
                            className="group flex flex-col overflow-hidden rounded-md border border-border bg-card text-left hover:border-primary/40 hover:shadow-sm"
                          >
                            <span className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/40">
                              {isImage ? (
                                // eslint-disable-next-line @next/next/no-img-element -- authed same-origin thumbnail; next/image can't carry the asset token
                                <img
                                  src={toAsset(`/api/files/files/${f.id}?thumb=1`)}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                  onError={(e) => {
                                    // Swap to the icon fallback: hide the img,
                                    // reveal the sibling icon span.
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <span
                                className={
                                  isImage
                                    ? 'hidden items-center justify-center'
                                    : 'flex items-center justify-center'
                                }
                              >
                                <TypeIcon
                                  aria-hidden
                                  className={`size-10 ${KIND_TINT[described.kind]}`}
                                />
                              </span>
                            </span>
                            <span className="flex flex-col gap-0.5 px-2 py-1.5">
                              <span className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate text-xs font-medium">
                                  {f.filename}
                                </span>
                                <WorkspaceChips item={f} />
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                {fmtSize(f.sizeBytes)}
                                {(f.indexing === 'metadata' ||
                                  f.indexingApplied === 'metadata' ||
                                  (!f.indexing && folderIndexing.mode === 'metadata')) && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <EyeOff className="size-2.5" /> name only
                                  </span>
                                )}
                              </span>
                            </span>
                          </RowButton>
                        );
                      })}
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="w-8 px-3 py-2">
                            <Checkbox
                              aria-label="Select all files"
                              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                              onCheckedChange={(v) =>
                                setSelectedFileIds(v ? new Set(files.map((f) => f.id)) : new Set())
                              }
                            />
                          </th>
                          {(
                            [
                              ['name', 'Name', 'text-left'],
                              ['type', 'Type', 'text-left'],
                              ['size', 'Size', 'text-right'],
                            ] as const
                          ).map(([key, label, align]) => (
                            <th key={key} className={`px-3 py-2 ${align}`}>
                              <RowButton
                                onClick={() => toggleSort(key)}
                                className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${align === 'text-right' ? 'flex-row-reverse' : ''}`}
                              >
                                {label}
                                {sort.key === key &&
                                  (sort.dir === 'asc' ? (
                                    <ArrowUp className="size-3" />
                                  ) : (
                                    <ArrowDown className="size-3" />
                                  ))}
                              </RowButton>
                            </th>
                          ))}
                          <th className="px-3 py-2 text-left">Summary</th>
                          <th className="px-3 py-2 text-left">
                            <RowButton
                              onClick={() => toggleSort('modified')}
                              className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
                            >
                              Modified
                              {sort.key === 'modified' &&
                                (sort.dir === 'asc' ? (
                                  <ArrowUp className="size-3" />
                                ) : (
                                  <ArrowDown className="size-3" />
                                ))}
                            </RowButton>
                          </th>
                          <th className="w-10 px-3 py-2" aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {sortedFiles.map((f) => {
                          // MIME first, filename as tie-breaker — files uploaded
                          // before the server's mime map learned audio/video/
                          // archives are stored as octet-stream, and the
                          // extension still names them correctly.
                          const described = describeFile(f.mimeType, f.filename);
                          const TypeIcon = described.icon;
                          return (
                            <tr key={f.id} className="hover:bg-muted/30">
                              <td className="px-3 py-2">
                                <Checkbox
                                  aria-label={`Select ${f.filename}`}
                                  checked={selectedFileIds.has(f.id)}
                                  onCheckedChange={(v) =>
                                    setSelectedFileIds((prev) => {
                                      const next = new Set(prev);
                                      if (v) next.add(f.id);
                                      else next.delete(f.id);
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td className="px-3 py-2">
                                <RowButton
                                  onClick={() => openFile(f.id)}
                                  data-mark-id={f.id}
                                  data-mark-kind="file"
                                  data-mark-label={f.filename}
                                  className="flex items-center gap-2 text-left hover:underline"
                                >
                                  <TypeIcon
                                    aria-hidden
                                    className={`size-4 shrink-0 ${KIND_TINT[described.kind]}`}
                                  />
                                  <span className="font-medium">{f.filename}</span>
                                  <span
                                    title={described.label}
                                    className="text-[10px] uppercase tracking-wider text-muted-foreground"
                                  >
                                    {f.extension}
                                  </span>
                                  {(f.indexing === 'metadata' ||
                                    f.indexingApplied === 'metadata' ||
                                    (!f.indexing && folderIndexing.mode === 'metadata')) && (
                                    <span
                                      title={
                                        f.indexing === 'metadata'
                                          ? 'Name-only: content not indexed (set on this file)'
                                          : 'Name-only: content not indexed (inherited from the folder)'
                                      }
                                      className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground"
                                    >
                                      <EyeOff className="size-3 shrink-0" /> name only
                                    </span>
                                  )}
                                  {f.summary && f.indexingApplied !== 'metadata' && (
                                    <span
                                      title="Indexed — summary ready"
                                      className="inline-flex items-center text-primary-ink"
                                    >
                                      <ChevronsRight className="size-3.5 shrink-0" />
                                    </span>
                                  )}
                                </RowButton>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                {described.label}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {fmtSize(f.sizeBytes)}
                              </td>
                              <td className="max-w-[40ch] truncate px-3 py-2 text-xs text-muted-foreground">
                                {f.summary ?? <span className="italic">—</span>}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {fmtRelative(f.updatedAt)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {itemAccess(f).edit ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    aria-label={`Rename ${f.filename}`}
                                    onClick={() =>
                                      setDialog({
                                        kind: 'rename',
                                        target: {
                                          kind: 'file',
                                          id: f.id,
                                          filename: f.filename,
                                          extension: f.extension,
                                        },
                                      })
                                    }
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        }
      />

      {/* ── Create folder dialog ──────────────────────────────────── */}
      <CreateFolderDialog
        open={dialog?.kind === 'createFolder'}
        onOpenChange={(open) => !open && closeDialog('createFolder')}
        parentPath={(dialog?.kind === 'createFolder' && dialog.parentPath) || currentPath}
        onCreated={refresh}
      />

      {/* ── Upload into a shared folder ───────────────────────────── */}
      <AlertDialog
        open={sharedUpload !== null}
        onOpenChange={(open) => !open && setSharedUpload(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Upload{' '}
              {sharedUpload?.files.length === 1
                ? 'a file'
                : `${sharedUpload?.files.length ?? 0} files`}{' '}
              to a shared folder?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sharedUpload && visibleTo ? uploadLine(visibleTo, sharedUpload.files.length) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (sharedUpload?.tree) void sendTree(sharedUpload.tree, true);
                else if (sharedUpload)
                  enqueue(sharedUpload.files, sharedUpload.path, { confirm: true });
                setSharedUpload(null);
              }}
            >
              Upload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Create file dialog ────────────────────────────────────── */}
      <CreateFileDialog
        ext={dialog?.kind === 'createFile' ? dialog.ext : null}
        onOpenChange={(open) => !open && closeDialog('createFile')}
        parentPath={(dialog?.kind === 'createFile' && dialog.parentPath) || currentPath}
        onCreated={(id) => {
          refresh();
          openFile(id);
        }}
      />

      {/* ── Rename file / folder dialog ───────────────────────────── */}
      <RenameDialog
        target={dialog?.kind === 'rename' ? dialog.target : null}
        onOpenChange={(open) => !open && closeDialog('rename')}
        onRenamed={refresh}
      />

      {/* ── Delete folder confirm ─────────────────────────────────── */}
      <AlertDialog
        open={dialog?.kind === 'deleteFolder'}
        onOpenChange={(open) => !open && closeDialog('deleteFolder')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder “{currentFolder?.slug}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The folder must be empty — move or delete its files first. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteFolder}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk delete confirm ───────────────────────────────────── */}
      <AlertDialog
        open={dialog?.kind === 'bulkDelete'}
        onOpenChange={(open) => !open && closeDialog('bulkDelete')}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteIds.length} file{deleteIds.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cascade confirm: files with derived nodes ─────────────── */}
      <AlertDialog open={cascade !== null} onOpenChange={(open) => !open && closeDialog('cascade')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Also delete everything derived from{' '}
              {cascade && cascade.ids.length === 1
                ? 'this file'
                : `these ${cascade?.ids.length ?? 0} files`}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cascade
                ? `Ingest produced ${describeDerivedCounts(cascade.counts)} from ${
                    cascade.ids.length === 1 ? 'this file' : 'these files'
                  }. Nothing has been deleted yet. Confirming removes the file${
                    cascade.ids.length === 1 ? '' : 's'
                  } and what was derived from ${
                    cascade.ids.length === 1 ? 'it' : 'them'
                  }. A derived item you cannot manage, if there is one, is kept. This can’t be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep everything</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmCascadeDelete}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
