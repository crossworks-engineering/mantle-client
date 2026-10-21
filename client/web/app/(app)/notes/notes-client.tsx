'use client';

import { useItemAddress } from '@/components/layout/use-item-address';
import { noteListAnswer } from '@/lib/workspace-filter';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
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
import { shareMarksOf } from '@/components/share/access-stack';
import { AccessSlot } from '@/components/share/access-slot';
import { useExportTool } from '@/components/export/export-menu';
import { ItemHeader } from '@/components/layout/item-header';
import { useZenMode } from '@/components/layout/zen-mode';
import { useToast } from '@mantle/web-ui/ui/toast';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { ItemCard, ItemIcon } from '@/components/item-list/item-card';
import {
  ItemListEmpty,
  ItemListHeader,
  ItemListScroll,
  NewButton,
} from '@/components/item-list/item-list-header';
import { ClearFilter, TagFilter } from '@/components/item-list/item-filters';
import { useCardDetails } from '@/components/item-list/use-card-details';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { DropdownMenuItem } from '@mantle/web-ui/ui/dropdown-menu';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { notesAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { NoteMarkdown } from '@/components/note-markdown';
import { ownerNoteAssetPath } from '@/lib/note-media';
import { NoteEditor, type NoteRow } from './note-editor';

type TagCount = { tag: string; count: number };

type NotesListResponse = {
  notes: NoteRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: TagCount[];
};

/** Mirror of @mantle/content's isDigestTag — local copy because that module
 *  pulls in the server-only db client and can't enter the client bundle. */
const isDigestTag = (t: string) =>
  t === 'conversation-digest' || t.startsWith('agent:') || t.startsWith('topic:');

export function NotesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [navPending, startNav] = useTransition();

  // URL is the source of truth (matches the old SSR page); the list query keys
  // off these so a `go()` navigation re-fetches automatically.
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const activeTag = searchParams.get('tag')?.trim() || null;
  const showDigests =
    searchParams.get('digests') === '1' || (!!activeTag && isDigestTag(activeTag));

  // The item tree when this brain serves it for notes (docs/folder-tree.md);
  // the paged card list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('notes');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  // The switcher's workspace (W5b): the list shows its items only.
  const ws = useListWorkspace();
  const listQuery = useQuery({
    queryKey: ['notes', { q: query, tag: activeTag, digests: showDigests, page, ws }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (activeTag) qs.set('tag', activeTag);
      if (showDigests) qs.set('digests', '1');
      if (page > 1) qs.set('page', String(page));
      if (ws) qs.set('ws', ws);
      return apiFetch<NotesListResponse>(`/api/notes?${qs.toString()}`).then((r) =>
        noteListAnswer(r, ws),
      );
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  const notes = useMemo(
    () => (showTree ? [] : (listQuery.data?.notes ?? [])),
    [showTree, listQuery.data?.notes],
  );
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 50;
  const tags = useMemo(() => listQuery.data?.tags ?? [], [listQuery.data?.tags]);

  // The note in the address: `/notes/<id>` reads it, `/notes/<id>?edit=1`
  // edits it, beside the folders (item header contract, phase 5). An old
  // `?selected=` link moves there. A NEW note has no address until it saves.
  const address = useItemAddress('notes', 'selected');
  const [selectedId, setSelectedId] = useState<string | null>(address.id);
  useEffect(() => {
    if (address.id) setSelectedId(address.id);
  }, [address.id]);

  // A deep-linked note may sit outside the current list slice — fetch it so the
  // right pane can open it even when it's not in `notes`.
  const selectedNoteQuery = useQuery({
    queryKey: ['notes', selectedId],
    queryFn: () => apiFetch<{ note: NoteRow }>(`/api/notes/${selectedId}`).then((r) => r.note),
    enabled: !!selectedId && !notes.some((n) => n.id === selectedId),
  });
  const [creating, setCreating] = useState(false);
  // Editing: a new note, or the open one at its edit address.
  const editing = creating || address.editing;
  // "New note inside" a tree folder: where the note goes once it is saved.
  const [createIn, setCreateIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('notes', 'note');
  // Maximise from the item header (the shell's focus mode) collapses the
  // folders, in the read view and the editor alike.
  const { zen } = useZenMode();
  // The tree row a note was opened from: its share marks, for Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pick<NoteRow, 'id' | 'title'> | null>(null);
  /** Pending action held back by the unsaved-changes guard. */
  const [discard, setDiscard] = useState<{ run: () => void } | null>(null);

  const [searchInput, setSearchInput] = useState(query);

  // Card density (summaries and tags), as on every list screen.
  const [details, changeDetails] = useCardDetails('mantle_notes_card_details_v1');

  // ── Selection / edit state machine ──────────────────────────────────
  // The first card, when nothing is picked (auto-select).
  const selected = useMemo<NoteRow | null>(() => {
    if (selectedId) {
      return (
        notes.find((n) => n.id === selectedId) ??
        (selectedNoteQuery.data?.id === selectedId ? selectedNoteQuery.data : null)
      );
    }
    return notes[0] ?? null;
  }, [selectedId, notes, selectedNoteQuery.data]);
  // Notes opens on this note next time (lib/last-opened.ts): one the user
  // picked and that loaded, not the first card shown by default.
  useRememberLastOpened('notes', selectedId && selected?.id === selectedId ? selectedId : null);

  // Pin whatever the right pane is showing. That includes the `notes[0]`
  // fallback above: nothing was clicked, but the note is on screen and read,
  // so "summarise this" should mean it. The chip is removable when it isn't
  // what the user meant.
  useSurfaceAssist({
    node: selected
      ? { id: selected.id, kind: 'note', label: selected.title || 'Untitled note' }
      : null,
  });

  /** Run an action, but if the editor has unsaved changes, confirm first. */
  const guard = useCallback(
    (run: () => void) => {
      if (editing && dirty) setDiscard({ run });
      else run();
    },
    [editing, dirty],
  );

  const exitEdit = useCallback(() => {
    setCreating(false);
    setDirty(false);
    if (address.id && address.editing) address.open(address.id);
  }, [address]);

  const selectNote = (id: string) =>
    guard(() => {
      setSelectedId(id);
      setCreating(false);
      setDirty(false);
      if (id !== address.id || address.editing) address.open(id);
    });

  const startCreate = (folder: TreeFolder | null = null) =>
    guard(() => {
      setCreateIn(folder);
      setCreating(true);
    });

  const startEdit = () => {
    setCreating(false);
    if (selected) address.open(selected.id, true);
  };

  const onSaved = (saved: NoteRow) => {
    const fileIn = creating ? createIn : null;
    setCreateIn(null);
    setCreating(false);
    setDirty(false);
    setSelectedId(saved.id);
    address.open(saved.id);
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: treeKey('notes') });
    if (fileIn) void fileNew(saved.id, fileIn);
  };

  const buildHref = (over: {
    page?: number;
    tag?: string | null;
    q?: string | null;
    digests?: boolean;
  }) => {
    const nextTag = over.tag !== undefined ? over.tag : activeTag;
    const nextQ = over.q !== undefined ? over.q : query || null;
    const nextPage = over.page !== undefined ? over.page : page;
    const nextDigests = over.digests !== undefined ? over.digests : showDigests;
    const params = new URLSearchParams();
    if (nextTag) params.set('tag', nextTag);
    if (nextQ) params.set('q', nextQ);
    if (nextDigests) params.set('digests', '1');
    if (nextPage && nextPage > 1) params.set('page', String(nextPage));
    const s = params.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const go = (over: Parameters<typeof buildHref>[0]) =>
    startNav(() => router.push(buildHref(over)));

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() === query) return;
      go({ q: searchInput.trim() || null, page: 1 });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiSend(`/api/notes/${deleteTarget.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
      toast.error(e instanceof Error ? e.message : 'Could not delete note');
      return;
    }
    toast.success('Note deleted');
    if (selected?.id === deleteTarget.id) exitEdit();
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
      if (address.id === deleteTarget.id) address.close();
    }
    setDeleteTarget(null);
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: treeKey('notes') });
  };

  if (!showTree && listQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!showTree && listQuery.isError && !listQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load notes.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <MasterDetail
        id="notes"
        // The screen's old clamps, so the column lands and stops where it did.
        defaultListSize="380px"
        minListSize="300px"
        maxListSize="760px"
        // A note is PROSE, so it takes the three-panel default: a bounded card
        // with a real grab handle and the spacer holding the slack, the way
        // Formulas and Contacts read. It opens at 900px — the measure /pages
        // chose — and `maxDetailSize="100%"` leaves its own handle no ceiling,
        // so a member who wants the whole window can still drag for it.
        //
        // ⚠ This was `detailFills`, and both halves of the comment defending it
        // were wrong. A markdown editor is text the writer READS while writing;
        // style guide §8 puts prose under the default and says so twice,
        // naming `/pages` shipping `detailFills` as the mistake. And the mode
        // below is not "literally called full width" — focus-toggle.tsx labels
        // it "Focus mode". For prose the guide is explicit that focus should
        // remove the CHROME, not re-flow the paragraph the writer is in the
        // middle of, which is exactly what the spacer absorbing the freed width
        // does. So this screen keeps its spacer.
        defaultDetailSize="900px"
        // 480, like /pages: this pane holds the editor AND the preview beside
        // it, and two columns inside the 420px default is not two columns.
        minDetailSize="480px"
        maxDetailSize="100%"
        // Focus mode. The list COLLAPSES rather than unmounting, so the search
        // box, scroll position and page survive the round trip — see the prop's
        // note in master-detail.tsx.
        listCollapsed={zen}
        list={
          showTree ? (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="notes"
                adapter={notesAdapter}
                selectedItemId={creating ? null : (selected?.id ?? null)}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search notes and folders…"
                newItemInFolder={{ label: 'note', onCreate: (f) => startCreate(f) }}
                actions={<NewButton onClick={() => startCreate()} />}
                onOpenItem={(item) => {
                  setOpenedRow(item);
                  selectNote(item.id);
                }}
                itemActions={(item) =>
                  itemAccess(item).manage ? (
                    <DropdownMenuItem
                      className="text-destructive-ink focus:text-destructive-ink"
                      onSelect={() => setDeleteTarget({ id: item.id, title: item.title })}
                    >
                      <Trash2 />
                      Delete…
                    </DropdownMenuItem>
                  ) : null
                }
                // A share or a move changes the level the open item is read
                // at: its header badge and client thread follow.
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['notes'] })}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <>
              <ItemListHeader
                search={searchInput}
                onSearch={setSearchInput}
                placeholder="Search notes…"
                actions={<NewButton onClick={() => startCreate()} />}
              >
                <TagFilter
                  tags={tags}
                  activeTag={activeTag}
                  onSelect={(t) => go({ tag: t, page: 1 })}
                  details={details}
                  onDetailsChange={changeDetails}
                  allLabel="All notes"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-7 gap-1 px-2',
                    showDigests ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  aria-pressed={showDigests}
                  onClick={() =>
                    go({
                      digests: !showDigests,
                      page: 1,
                      // Hiding digests while filtered on a digest tag would show an
                      // empty list — drop the tag along with them.
                      ...(showDigests && activeTag && isDigestTag(activeTag) ? { tag: null } : {}),
                    })
                  }
                  title={
                    showDigests
                      ? 'Hide agent conversation digests'
                      : 'Show agent conversation digests'
                  }
                >
                  <Sparkles className="size-3.5" /> Digests
                </Button>
                {activeTag && (
                  <ClearFilter
                    onClear={() => go({ tag: null, page: 1 })}
                    title="Clear tag filter"
                  />
                )}
              </ItemListHeader>

              <ItemListScroll pending={navPending}>
                {notes.length === 0 ? (
                  <ItemListEmpty>
                    {query || activeTag
                      ? 'No notes match your search or filter.'
                      : 'No notes yet. Click “New” or ask your assistant to add one.'}
                  </ItemListEmpty>
                ) : (
                  notes.map((n) => (
                    <ItemCard
                      key={n.id}
                      id={n.id}
                      kind="note"
                      title={n.title}
                      icon={<ItemIcon fallback={<FileText />} />}
                      badge={<WorkspaceChips item={n} className="mt-0.5" />}
                      selected={selected?.id === n.id && !creating}
                      onSelect={() => selectNote(n.id)}
                      updatedAt={n.updatedAt}
                    >
                      {details && (n.summary || n.content) && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {n.summary ?? n.content.slice(0, 200)}
                        </p>
                      )}
                      {details && n.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {n.tags.map((t) => (
                            <TagPill key={t} tag={t} />
                          ))}
                        </div>
                      )}
                    </ItemCard>
                  ))
                )}
              </ItemListScroll>

              <ListPager
                page={page}
                total={total}
                pageSize={pageSize}
                pending={navPending}
                onGo={(p) => go({ page: p })}
                noun={{ one: 'note', many: 'notes' }}
              />
            </>
          )
        }
        // Both the editor and the preview open with their own sticky header
        // above a scrolling body, so each keeps its own scroller.
        // `h-full overflow-hidden` means the pane's scroller can never
        // overflow, so only one bar is ever painted.
        detail={
          <div className="md:h-full md:overflow-hidden">
            {/* No editor without mayEdit, never on a snapshot copy (W6b fix
                round): the read view instead. */}
            {editing && (creating || itemAccess(selected).edit) ? (
              <NoteEditor
                note={creating ? null : selected}
                shares={selected ? shareMarksOf(selected, openedRow) : undefined}
                onDelete={
                  !creating && selected && itemAccess(selected).manage
                    ? () => setDeleteTarget(selected)
                    : undefined
                }
                onSaved={onSaved}
                onCancel={() => guard(exitEdit)}
                onDirtyChange={setDirty}
              />
            ) : selected ? (
              <NotePreview
                note={selected}
                shares={shareMarksOf(selected, openedRow)}
                onEdit={startEdit}
                onDelete={() => setDeleteTarget(selected)}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
                Select a note, or click{' '}
                <span className="mx-1 font-medium text-foreground">New</span> to start one.
              </div>
            )}
          </div>
        }
      />

      {fileConfirm}
      {/* Discard-unsaved-changes guard */}
      <AlertDialog open={discard !== null} onOpenChange={(o) => !o && setDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This note has edits that haven’t been saved. Leaving now will lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const run = discard?.run;
                setDirty(false);
                setDiscard(null);
                run?.();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Right-pane read view — de-boxed: full-width prose, sticky header, own scroll. */
function NotePreview({
  note,
  shares,
  onEdit,
  onDelete,
}: {
  note: NoteRow;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Export is a route only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();
  // The login's caps on the note (W6b fix round): no Edit without mayEdit
  // (never on a snapshot copy), no Grant Access or Delete without mayManage.
  const access = itemAccess(note);
  const readNote = readOnlyNote(access);
  const download = useExportTool(note.id);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The item header (contract 2026-10-21): one row; tags, dates and the
          read-only note behind Info. */}
      <ItemHeader
        section="Notes"
        visual={<FileText className="size-4" aria-hidden />}
        title={note.title || 'Untitled note'}
        access={<AccessSlot type="note" nodeId={note.id} canShare={access.share} shares={shares} />}
        tools={isAdminUser ? [download] : []}
        onDelete={access.manage ? onDelete : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete note"
        move={access.move ? { kind: 'notes', item: { id: note.id, title: note.title } } : null}
        edit={access.edit ? { onSelect: onEdit, label: 'Edit note' } : { disabled: true }}
        info={{
          tags: note.tags,
          rows: [
            ...(readNote ? [{ label: 'Access', value: readNote }] : []),
            { label: 'Updated', value: formatDateTime(note.updatedAt) },
            { label: 'Created', value: formatDateTime(note.createdAt) },
          ],
        }}
        infoLabel="About this note"
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto scrollbar-thin px-6 py-5">
        <article className="prose prose-sm dark:prose-invert max-w-none prose-accent prose-document">
          {note.content ? (
            <NoteMarkdown content={note.content} assetPath={ownerNoteAssetPath} />
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No content yet.
              {access.edit ? (
                <>
                  {' '}
                  Click the <span className="font-medium not-italic text-foreground">
                    pencil
                  </span>{' '}
                  to add some.
                </>
              ) : null}
            </p>
          )}
        </article>

        {/* Digest notes store the same text as content and summary (the note IS
            a summary) — skip the box rather than render the body twice. */}
        {note.summary && note.summary.trim() !== note.content.trim() && (
          <aside className="rounded-md border border-border bg-muted/40 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden /> Indexed summary
            </div>
            <p className="text-sm text-muted-foreground">{note.summary}</p>
          </aside>
        )}
      </div>
    </div>
  );
}
