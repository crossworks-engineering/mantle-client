'use client';

import { useItemAddress } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { itemAccess } from '@/lib/item-access';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useCallback, useEffect, useState } from 'react';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Table2,
  Trash2,
} from 'lucide-react';
import { useListNav } from '@/lib/use-list-nav';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useRealtime } from '@/components/realtime/use-realtime';
import { SetPageTitle } from '@/components/layout/page-title';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { parseFlag, serialiseFlag, usePersistedState } from '@/lib/use-persisted-state';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
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
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Badge } from '@mantle/web-ui/ui/badge';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { ItemCard, ItemCardAction, ItemIcon, UpdatedStamp } from '@/components/item-list/item-card';
import {
  ItemListEmpty,
  ItemListHeader,
  ItemListScroll,
  NewButton,
} from '@/components/item-list/item-list-header';
import { ClearFilter, SortMenu, TagFilter } from '@/components/item-list/item-filters';
import { useCardDetails } from '@/components/item-list/use-card-details';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { DropdownMenuItem } from '@mantle/web-ui/ui/dropdown-menu';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { tablesAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { TableDetailClient } from './[id]/table-detail-client';
import type { TableDetail, TableRow, TableSort } from '@mantle/content-core/table-model';

const SORTS: TableSort[] = ['edited', 'newest', 'oldest', 'title'];

const SORT_LABELS: Record<TableSort, string> = {
  edited: 'Last edited',
  newest: 'Newest',
  oldest: 'Oldest',
  title: 'Title A–Z',
};

type TablesListResponse = {
  tables: TableRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: { tag: string; count: number }[];
};

export function TablesShell() {
  // Maximise from the item header collapses the list too.
  const { zen } = useZenMode();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { pending: navPending, go } = useListNav();

  // URL is the source of truth (matches the old SSR page).
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const activeTag = searchParams.get('tag')?.trim() || null;
  const sortParam = searchParams.get('sort');
  const sort: TableSort = SORTS.includes(sortParam as TableSort)
    ? (sortParam as TableSort)
    : 'edited';
  // Spreadsheet import is a route only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();
  const [details, changeDetails] = useCardDetails('mantle_tables_card_details_v1');

  // The item tree when this brain serves it for tables (docs/folder-tree.md);
  // the paged card list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('tables');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  const listQuery = useQuery({
    queryKey: ['tables', { q: query, tag: activeTag, sort, page }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (activeTag) qs.set('tag', activeTag);
      if (sort !== 'edited') qs.set('sort', sort);
      if (page > 1) qs.set('page', String(page));
      return apiFetch<TablesListResponse>(`/api/tables?${qs.toString()}`);
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  const rows = showTree ? [] : (listQuery.data?.tables ?? []);
  const total = listQuery.data?.total ?? 0;
  const pageSize = listQuery.data?.pageSize ?? 50;
  const tags = listQuery.data?.tags ?? [];

  // The full selected table (grid + draft) — a separate fetch since list rows
  // are summaries. Defaults to the first row (master-detail convention).
  // The table in the address (`/tables/<id>`); an old `?selected=` link
  // moves there.
  const address = useItemAddress('tables', 'selected');
  const urlSelected = address.id;
  const selectedId = urlSelected ?? rows[0]?.id ?? null;
  const selectedTableQuery = useQuery({
    queryKey: ['tables', selectedId],
    queryFn: () =>
      apiFetch<{ table: TableDetail }>(`/api/tables/${selectedId}`).then((r) => r.table),
    enabled: !!selectedId,
    placeholderData: (prev) => prev,
    // The editor seeds its draft etag (draftRev) from this data once, but
    // autosaves advance the server rev without touching this cache entry — a
    // cached table is stale the moment it has been edited. With the global
    // 30s staleTime, reselecting a just-edited table would seed the stale rev
    // with NO refetch and the first autosave would 409 ("changed elsewhere")
    // + reload the draft over live edits. Always revalidate, and gate the
    // editor mount on the fresh response (isFetchedAfterMount) below.
    //
    // refetchOnMount:'always' only covers observer SUBSCRIBE; switching
    // selectedId is a key change on a mounted observer, where TanStack fetches
    // only if stale (shouldFetchOptionally) — with the global 30s staleTime a
    // re-selected table issued NO fetch and isFetchedAfterMount never flipped,
    // wedging the spinner forever. staleTime:0 makes every selection revalidate.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const selectedTable: TableDetail | null =
    selectedTableQuery.data?.id === selectedId ? selectedTableQuery.data : null;
  // Tables opens on this table next time (lib/last-opened.ts): one the user
  // picked and that loaded, not the first row shown by default.
  useRememberLastOpened('tables', urlSelected && selectedTable ? selectedTable.id : null);

  const [searchInput, setSearchInput] = useState(query);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  // "New table inside" a tree folder: where it goes.
  const [createIn, setCreateIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('tables', 'table');
  const [deleteTarget, setDeleteTarget] = useState<Pick<TableRow, 'id' | 'title'> | null>(null);

  // The list's collapse, restored after hydration. The effect below already
  // kept this out of the first render; what it did NOT do is guard the access —
  // reading or writing localStorage THROWS in a browser set to block site data,
  // and neither call site was in a try. Same hook as every other persisted
  // preference now, which owns both halves.
  const [collapsed, setCollapse] = usePersistedState(
    'tables.listCollapsed',
    false,
    parseFlag,
    serialiseFlag,
  );

  // Which table is mid-open. Selecting is a server round-trip (the full grid is
  // loaded SSR), so without a cue the click feels dead for a beat. Set on click,
  // cleared once the new selection lands.
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    setPendingId(null);
  }, [selectedId]);
  const selectTable = (id: string) => {
    if (id === selectedId) return;
    setPendingId(id);
    address.open(id);
  };

  // The WIDTH is `MasterDetail`'s now, under `master-detail:tables`.

  useRealtime(['table'], () => {
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
  });

  // Debounced search → URL.
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() === query) return;
      go({ q: searchInput.trim() || null, page: 1 });
    }, 350);
    return () => clearTimeout(h);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = (folder: TreeFolder | null = null) => {
    setNewTitle('');
    setCreateIn(folder);
    setCreateOpen(true);
  };

  async function createTable() {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const { table } = await apiSend<{ table: TableDetail }>('/api/tables', 'POST', { title });
      setCreateOpen(false);
      if (createIn) await fileNew(table.id, createIn);
      await queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('tables') });
      address.open(table.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error('Could not create table');
      return;
    } finally {
      setCreating(false);
    }
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await apiSend(`/api/tables/${deleteTarget.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error('Could not delete table');
      return;
    }
    toast.success('Table deleted');
    const wasSelected = deleteTarget.id === selectedId;
    setDeleteTarget(null);
    void queryClient.invalidateQueries({ queryKey: treeKey('tables') });
    await queryClient.invalidateQueries({ queryKey: ['tables'] });
    if (wasSelected) address.close();
  }, [deleteTarget, selectedId, address, queryClient, toast]);

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
          {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load tables.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  // New, and the collapse toggle (the rail brings the list back): the same
  // pair above the tree and above the older list.
  const listActions = (
    <>
      <NewButton onClick={() => openCreate()} />
      <Button
        size="icon"
        variant="ghost"
        className="size-9 shrink-0 text-muted-foreground"
        onClick={() => setCollapse(true)}
        aria-label="Collapse list"
        title="Collapse"
      >
        <PanelLeftClose />
      </Button>
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* The collapsed rail sits OUTSIDE the panel group. It is the only way
          back from a collapsed list, and a control rendered inside a zero-width
          panel cannot be clicked. */}
      {collapsed && (
        <div className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => setCollapse(false)}
            aria-label="Show table list"
            title="Show tables"
          >
            <PanelLeftOpen />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => openCreate()}
            aria-label="New table"
            title="New table"
          >
            <Plus />
          </Button>
        </div>
      )}

      <MasterDetail
        id="tables"
        className="min-w-0 flex-1"
        // The screen's old hand-rolled clamps, kept so the column lands and
        // stops where it always did.
        defaultListSize="320px"
        minListSize="220px"
        maxListSize="520px"
        // The detail is a DATA GRID, not a measure of reading text: the 672px
        // default would cap a spreadsheet and park an empty spacer beside it.
        detailFills
        // The existing collapse toggle. The list COLLAPSES rather than
        // unmounting, so the search box, scroll position and page survive the
        // round trip — see the prop's note in master-detail.tsx.
        listCollapsed={collapsed || zen}
        list={
          showTree ? (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="tables"
                adapter={tablesAdapter}
                selectedItemId={pendingId ?? selectedId}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search tables and folders…"
                newItemInFolder={{
                  label: 'table',
                  icon: Table2,
                  onCreate: (f) => openCreate(f),
                }}
                actions={listActions}
                onOpenItem={(item) => selectTable(item.id)}
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
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['tables'] })}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <>
              <ItemListHeader
                search={searchInput}
                onSearch={setSearchInput}
                placeholder="Search tables…"
                actions={listActions}
              >
                <SortMenu
                  value={sort}
                  labels={SORT_LABELS}
                  onChange={(v) => go({ sort: v === 'edited' ? null : v, page: null })}
                />
                <TagFilter
                  tags={tags}
                  activeTag={activeTag}
                  onSelect={(t) => go({ tag: t, page: null })}
                  details={details}
                  onDetailsChange={changeDetails}
                  allLabel="All tables"
                />
                {activeTag && (
                  <ClearFilter
                    onClear={() => go({ tag: null, page: null })}
                    title="Clear tag filter"
                  />
                )}
              </ItemListHeader>

              <ItemListScroll pending={navPending}>
                {rows.length === 0 ? (
                  <ItemListEmpty>
                    {query || activeTag
                      ? 'No tables match your search or filter.'
                      : 'No tables yet.'}
                  </ItemListEmpty>
                ) : (
                  rows.map((t) => (
                    <ItemCard
                      key={t.id}
                      id={t.id}
                      kind="table"
                      title={t.title}
                      icon={
                        pendingId === t.id ? (
                          <ItemIcon
                            fallback={
                              <Loader2 className="animate-spin text-muted-foreground" aria-hidden />
                            }
                          />
                        ) : (
                          <ItemIcon emoji={t.icon || '📊'} fallback={null} />
                        )
                      }
                      badge={<WorkspaceChips item={t} className="mt-0.5" />}
                      selected={selectedId === t.id || pendingId === t.id}
                      onSelect={() => selectTable(t.id)}
                      footerStart={
                        <>
                          <UpdatedStamp at={t.updatedAt} />
                          <span className="truncate text-xs text-muted-foreground tabular-nums">
                            · {t.columnCount} cols · {t.rowCount} rows
                          </span>
                        </>
                      }
                      actions={
                        itemAccess(t).manage ? (
                          <ItemCardAction
                            label={`Delete ${t.title}`}
                            title="Delete table"
                            destructive
                            onClick={() => setDeleteTarget(t)}
                          >
                            <Trash2 />
                          </ItemCardAction>
                        ) : null
                      }
                    >
                      {/* App-bound export: read-only here, edited in the app.
                            The card is one big click target, so the chip is a
                            plain badge; the DETAIL's badge is the link. */}
                      {t.appLink && (
                        <Badge variant="secondary" className="gap-1 font-normal">
                          <AppWindow className="size-3" aria-hidden />
                          App table{t.appLink.appName ? ` · ${t.appLink.appName}` : ''}
                        </Badge>
                      )}
                      {details && t.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.tags.map((tag) => (
                            <TagPill key={tag} tag={tag} />
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
                onGo={(p) => go({ page: p > 1 ? p : null })}
                noun={{ one: 'table', many: 'tables' }}
              />
            </>
          )
        }
        // The editor brings its own sticky toolbar above a scrolling grid, so
        // it keeps its own scroller. `h-full overflow-hidden` means the pane's
        // scroller can never overflow, so only one bar is ever painted.
        detail={
          <div className="relative h-full overflow-hidden">
            {selectedTable && selectedTableQuery.isFetchedAfterMount ? (
              <TableDetailClient key={selectedTable.id} initial={selectedTable} />
            ) : selectedId && selectedTableQuery.isError ? (
              <>
                <SetPageTitle title="Tables" />
                <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-sm">
                  <p className="text-muted-foreground">
                    {selectedTableQuery.error instanceof Error
                      ? selectedTableQuery.error.message
                      : 'Failed to load table.'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => selectedTableQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              </>
            ) : selectedId ? (
              <>
                <SetPageTitle title="Tables" />
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              </>
            ) : (
              <>
                <SetPageTitle title="Tables" />
                <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
                  {!showTree && rows.length === 0
                    ? 'Create a table to get started.'
                    : 'Select a table.'}
                </div>
              </>
            )}
            {pendingId && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading table…
                </span>
              </div>
            )}
          </div>
        }
      />

      {/* Create dialog */}
      {fileConfirm}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createIn ? `New table in “${createIn.name}”` : 'New table'}</DialogTitle>
            <DialogDescription>
              {isAdminUser
                ? 'Give it a name. You can add columns and import a spreadsheet in the editor.'
                : 'Give it a name. You can add columns in the editor.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Stock list"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTable();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void createTable()}
              pending={creating}
              disabled={!newTitle.trim()}
            >
              Create table
            </SubmitButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the table and its index entries. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
