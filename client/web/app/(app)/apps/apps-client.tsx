'use client';

import { itemHref, useItemAddress } from '@/components/layout/use-item-address';
import { useShellRole } from '@/components/layout/shell-role';
import { AppDetailClient } from './[id]/app-detail-client';
import { HeaderPill } from '@/components/layout/item-header';
import { shareMarksOf } from '@/components/share/access-stack';
import { AccessSlot } from '@/components/share/access-slot';
import { itemAccess } from '@/lib/item-access';
import { noteListAnswer } from '@/lib/workspace-filter';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Plus, Trash2, Pencil } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { useListNav } from '@/lib/use-list-nav';
import { syncSelectionParam } from '@/lib/url-sync';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { AppSandbox } from '@mantle/share-ui/app-sandbox';
import { ownerAppSandboxProps } from '@/lib/owner-app-sandbox';
import { useAppToolConfirm } from '@/components/app-nav/use-app-tool-confirm';
import { AppLoader } from '@/components/app-nav/app-loader';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useZenMode } from '@/components/layout/zen-mode';
import type { AppDetail, AppRow } from '@mantle/client-types';
import { RecentlyDeletedApps } from '@/components/app-nav/recently-deleted-apps';
import { APP_NAV_KEY, useAppNav } from '@/components/app-nav/use-app-nav';
import { AppTile } from '@/components/app-nav/app-tile';
import { AppTreePills } from '@/components/app-nav/app-tree-pills';
import { DropdownMenuItem } from '@mantle/web-ui/ui/dropdown-menu';
import { ItemCard } from '@/components/item-list/item-card';
import { ItemListHeader, ItemListScroll, NewButton } from '@/components/item-list/item-list-header';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { appsAdapter } from '@/components/item-tree/kinds/apps';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { DELETED_APPS_KEY } from '@/lib/space-apps';
import {
  APP_SHARE_HINT,
  APP_WAS_IN_TRASH,
  appDeleteCopy,
  appDetailQuery,
  appsLegacyHref,
  appsUrlId,
  wasInTrash,
} from '@/lib/apps-screen';
import { useIsAdminUser, useIsBrainOwner } from '@/components/workspaces/use-shell-workspaces';
import { AppItemHeader } from '@/components/app-nav/app-item-header';
import { play } from '@/lib/sounds/play';

type AppsPage = { apps: AppRow[]; total: number; page: number; pageSize: number };

/** What the delete dialog needs, from the tree or the list. */
type DeleteTarget = { id: string; title: string };

/**
 * /apps for an admin: the folder view every workspace has (Pages, Notes,
 * Tables, Draw, Files). The item tree in the list column, with its folder
 * menus, "New app inside" and the search in `?q=`; the picked app in `?id=`
 * and in the detail pane, running, under the item header (its tile, title,
 * level and pills, then Level, Focus, Open and Delete). Everything that
 * changes an app (Builder, Code, History, Activity, the switches) is its own
 * screen, /apps/<id>, as an editor is for a page or a drawing.
 *
 * The trash sits at the foot of the list. A brain that does not serve Apps as a
 * tree kind keeps the paged list (GET /api/apps), as Draw does.
 */
export function AppsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { pending, go } = useListNav();
  const { zen } = useZenMode();
  // The tree row an app was opened from: its share marks, for Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);
  const toolConfirm = useAppToolConfirm();
  // Every login has this screen (W6b). The app editor, the app nav, the
  // trash list and the owner runner are an Admin user's; anyone else runs
  // an app on the member routes and changes it over its own MCP connection.
  const admin = useIsAdminUser();
  // The 30-day trash text is the brain owner's only (GET /api/shell isOwner).
  const deleteCopy = appDeleteCopy(useIsBrainOwner());

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  // The owner's screen gives the open app its own address (`/apps/<id>`,
  // `?edit=1` to edit); a member's keeps `?id=` beside the tree, as
  // `/apps/<id>` is a member's runner.
  const member = useShellRole() === 'member';
  const address = useItemAddress('apps', member ? undefined : 'id');
  const urlId = member ? appsUrlId(searchParams) : (address.id ?? appsUrlId(searchParams));

  // The item tree when this brain serves it for apps (docs/folder-tree.md);
  // the paged list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('apps');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  // An old link (the paged list's `sort` and `page`, a `?selected=`) is
  // rewritten in place, so the address bar says what the screen shows.
  useEffect(() => {
    if (treeServes === undefined) return;
    const to = appsLegacyHref(searchParams, showTree);
    if (to) router.replace(to, { scroll: false });
  }, [searchParams, showTree, treeServes, router]);

  // The picked app (`?id=`), shown in the pane beside the tree. It lives in
  // client state; `select` mirrors it to the URL with replaceState (no
  // navigation): the param is an entry point, not truth.
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  useEffect(() => {
    if (urlId) setSelectedId(urlId);
  }, [urlId]);
  // Duplicate (the More menu): the brain copies the app with its code,
  // builds and data; the copy opens beside the folders.
  async function duplicate(id: string) {
    try {
      const { app: copy } = await apiSend<{ app: { id: string } }>(
        `/api/apps/${id}/duplicate`,
        'POST',
        {},
      );
      toast.success('App duplicated');
      void queryClient.invalidateQueries({ queryKey: ['apps'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('apps') });
      select(copy.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not duplicate the app');
    }
  }

  function select(id: string | null) {
    setSelectedId(id);
    if (member) syncSelectionParam('id', id);
    else if (!id) address.close();
    else if (id !== address.id || address.editing) address.open(id);
  }

  // The paged list's search box; the tree's lives in the tree.
  const [searchInput, setSearchInput] = useState(query);
  useEffect(() => setSearchInput(query), [query]);
  useEffect(() => {
    if (showTree || searchInput === query) return;
    const t = setTimeout(() => go({ q: searchInput || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [showTree, searchInput, query, go]);

  // The switcher's workspace (W5b): the list shows its items only.
  const ws = useListWorkspace();
  const listQuery = useQuery({
    queryKey: ['apps', { query, page, ws }],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) });
      if (query) qs.set('q', query);
      if (ws) qs.set('ws', ws);
      return apiFetch<AppsPage>(`/api/apps?${qs.toString()}`).then((r) => noteListAnswer(r, ws));
    },
    placeholderData: (prev) => prev,
    enabled: treeServes !== undefined && !showTree,
  });
  const rows = useMemo(
    () => (showTree ? [] : (listQuery.data?.apps ?? [])),
    [showTree, listQuery.data],
  );

  // The first card when nothing is picked (the paged list only, as on the
  // other screens: the tree opens on its folders with nothing picked).
  const activeId = selectedId ?? rows[0]?.id ?? null;
  // The picked app as its own screen reads it: the same query and the same
  // cached shape (appDetailQuery), so opening it from here is instant.
  const activeQuery = useQuery({ ...appDetailQuery(activeId ?? ''), enabled: !!activeId });
  const active = activeQuery.data?.app.id === activeId ? activeQuery.data.app : null;

  // New, and "New app inside" a tree folder (where the new app goes).
  const [createOpen, setCreateOpen] = useState(false);
  const [createIn, setCreateIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('apps', 'app');
  const openCreate = (folder: TreeFolder | null = null) => {
    setCreateIn(folder);
    setCreateOpen(true);
  };

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function deleteApp() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiSend(`/api/apps/${deleteTarget.id}`, 'DELETE');
      toast.success(deleteCopy.toast);
      if (deleteTarget.id === activeId) select(null);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['apps'] });
      void queryClient.invalidateQueries({ queryKey: APP_NAV_KEY });
      void queryClient.invalidateQueries({ queryKey: treeKey('apps') });
      void queryClient.invalidateQueries({ queryKey: DELETED_APPS_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the app.');
    } finally {
      setDeleting(false);
    }
  }

  const newButton = <NewButton onClick={() => openCreate()} title="New app" />;
  const listLoading = treeServes === undefined || (!showTree && listQuery.isPending);

  return (
    <>
      <MasterDetail
        id="apps"
        defaultListSize="340px"
        // The detail is an app viewport, not a measure of reading text, so it
        // takes the slack. Capping it at the 672px default would shrink the
        // only thing the pane is for.
        detailFills
        // Focus mode. The list COLLAPSES rather than unmounting, so the search
        // box, scroll position and page survive the round trip (see the prop's
        // note in master-detail.tsx).
        listCollapsed={zen}
        list={
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              {listLoading ? (
                <div className="flex h-full items-center justify-center p-6">
                  <Spinner />
                </div>
              ) : showTree ? (
                <aside className="flex h-full min-h-0 flex-col bg-muted/20">
                  <ItemTree
                    kind="apps"
                    adapter={appsAdapter}
                    selectedItemId={activeId}
                    query={treeQuery}
                    onQueryChange={setTreeQuery}
                    searchPlaceholder="Search apps and folders…"
                    actions={newButton}
                    newItemInFolder={{ label: 'app', icon: AppWindow, onCreate: openCreate }}
                    onOpenItem={(item) => {
                      setOpenedRow(item);
                      select(item.id);
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
                    // A share or a move changes the level the open app is read
                    // at: its header badge follows.
                    onChanged={() => void queryClient.invalidateQueries({ queryKey: ['apps'] })}
                    onUnsupported={() => setTreeGone(true)}
                  />
                </aside>
              ) : listQuery.isError && !listQuery.data ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
                  <p>Could not load apps.</p>
                  <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <ItemListHeader
                    search={searchInput}
                    onSearch={setSearchInput}
                    placeholder="Search apps…"
                    actions={newButton}
                  />
                  <ItemListScroll pending={pending}>
                    {rows.length === 0 ? (
                      <div className="space-y-3 px-1 py-8 text-center">
                        <p className="text-sm text-muted-foreground">
                          {query
                            ? 'No app matches this search.'
                            : 'No apps yet. Create one, or ask the assistant to build one.'}
                        </p>
                        {query ? (
                          <Button variant="outline" size="sm" onClick={() => go({ q: null })}>
                            Clear search
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => openCreate()}>
                            <Plus />
                            New app
                          </Button>
                        )}
                      </div>
                    ) : (
                      rows.map((app) => (
                        <ItemCard
                          key={app.id}
                          id={app.id}
                          kind="app"
                          title={app.title}
                          icon={<AppTile icon={app.icon} color={app.color} size="sm" />}
                          badge={
                            <span className="flex shrink-0 items-center gap-1">
                              {wasInTrash(app) ? (
                                <Badge variant="outline" className="shrink-0">
                                  was in your trash
                                </Badge>
                              ) : null}
                              {app.hasDraft && (
                                <span
                                  className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                                  title="Unpublished draft"
                                  aria-label="Unpublished draft"
                                />
                              )}
                              <AppTreePills id={app.id} />
                              <WorkspaceChips item={app} hub={app.isHub} className="mt-0.5" />
                            </span>
                          }
                          selected={activeId === app.id}
                          onSelect={() => select(app.id)}
                          updatedAt={app.updatedAt}
                        >
                          {app.description ? (
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {app.description}
                            </p>
                          ) : null}
                        </ItemCard>
                      ))
                    )}
                  </ItemListScroll>
                  <ListPager
                    page={page}
                    total={listQuery.data?.total ?? 0}
                    pageSize={listQuery.data?.pageSize ?? 50}
                    pending={pending}
                    onGo={(p) => go({ page: p > 1 ? p : null })}
                    noun={{ one: 'app', many: 'apps' }}
                  />
                </>
              )}
            </div>
            {admin ? <RecentlyDeletedApps /> : null}
          </div>
        }
        detail={
          !member && address.editing && address.id ? (
            // The editor, beside the folders; it owns its header.
            <div className="h-full min-h-0">
              <AppDetailClient key={address.id} id={address.id} />
            </div>
          ) : active ? (
            <AppPreview
              key={active.id}
              app={active}
              shares={shareMarksOf(active, openedRow)}
              admin={admin}
              confirmTool={toolConfirm.confirmTool}
              onDelete={() => setDeleteTarget({ id: active.id, title: active.title })}
              onDuplicate={() => void duplicate(active.id)}
            />
          ) : activeId && activeQuery.isPending ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <AppWindow className="size-8 opacity-50" aria-hidden />
                {activeId ? 'This app could not be loaded.' : 'Select an app.'}
              </div>
            </div>
          )
        }
      />

      {fileConfirm}
      {toolConfirm.dialog}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen && (
          <CreateAppDialog
            folderName={createIn?.name ?? null}
            onCreated={async (id) => {
              setCreateOpen(false);
              if (createIn) await fileNew(id, createIn);
              void queryClient.invalidateQueries({ queryKey: ['apps'] });
              void queryClient.invalidateQueries({ queryKey: treeKey('apps') });
              // The editor is an Admin user's; anyone else sees it here.
              if (admin) router.push(itemHref('apps', id, true));
              else select(id);
            }}
          />
        )}
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>{deleteCopy.confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void deleteApp()}
            >
              {deleting ? 'Deleting…' : 'Delete app'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The picked app in the detail pane: the item header every workspace has
 * (the app's tile, title, draft and level, then its actions), and below it
 * the app itself, running, the way it runs when shared. Changing the app is
 * its own screen (Open).
 */
function AppPreview({
  app,
  shares,
  admin,
  confirmTool,
  onDelete,
  onDuplicate,
}: {
  app: AppDetail;
  /** The share marks for Access (`shareMarksOf`). */
  shares: unknown;
  /** An Admin user: the owner runner, the app nav and the editor link. */
  admin: boolean;
  confirmTool: ReturnType<typeof useAppToolConfirm>['confirmTool'];
  onDelete: () => void;
  /** Copy the app (its code, builds and data) and open the copy. */
  onDuplicate: () => void;
}) {
  // The face the app-nav read holds: a look changed in the editor shows here
  // before this app's own query is read again.
  const { data: nav } = useAppNav({ enabled: admin });
  const face = nav?.apps.find((a) => a.id === app.id);
  const icon = face ? face.icon : app.icon;
  const color = face ? face.color : app.color;
  const hasBuild = app.hasBuild;
  // The login's caps on the app (W6b fix round): no Grant Access or Delete
  // without mayManage, no Open (the editor) without mayEdit.
  const access = itemAccess(app);

  return (
    // `h-full`, not `flex-1`: MasterDetail's detail wrapper is a block, so a
    // flex-1 here sizes to its content and the sandbox's `h-full` collapses to
    // the iframe's intrinsic 150px.
    <div className="flex h-full min-h-0 flex-col">
      {/* The item header (contract 2026-10-21): one row; the description,
          the data pills, the home-app tag and a trash note behind Info. Access
          is the level control once there is a published build to share; the
          pencil opens the app (build, code, history). */}
      <AppItemHeader
        section="Apps"
        icon={icon}
        color={color}
        title={app.title}
        badges={app.hasDraft ? <HeaderPill>unpublished draft</HeaderPill> : null}
        access={
          <AccessSlot
            type="app"
            nodeId={app.id}
            canShare={hasBuild && access.share}
            shares={shares}
            hint={APP_SHARE_HINT}
          />
        }
        onDelete={access.manage ? onDelete : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete app"
        move={access.move ? { kind: 'apps', item: { id: app.id, title: app.title } } : null}
        onDuplicate={admin ? onDuplicate : undefined}
        edit={
          admin && access.edit
            ? { href: itemHref('apps', app.id, true), label: 'Open app' }
            : { disabled: true, label: 'Open app' }
        }
        info={{
          description: app.description ?? app.summary ?? undefined,
          rows: [
            ...(admin ? [{ label: 'Data', value: <AppTreePills id={app.id} /> }] : []),
            ...(app.isHub ? [{ label: 'Home app', value: 'Members see it as their home.' }] : []),
            ...(wasInTrash(app) ? [{ label: 'Note', value: APP_WAS_IN_TRASH }] : []),
          ],
        }}
        infoLabel="About this app"
      />
      {/* Below `md` the panes stack and the detail has no height of its own,
          so the app is given most of the screen there. */}
      <div data-testid="app-preview-run" className="h-[75dvh] min-h-0 md:h-auto md:flex-1">
        {hasBuild ? (
          // The sandbox host runs the broker, the file tree and the access log
          // beside the iframe; a throw in any of them must not take the list.
          <SurfaceErrorBoundary label="this app" resetKeys={[app.id]}>
            <AppSandbox
              appId={app.id}
              {...ownerAppSandboxProps(app.id)}
              confirmTool={admin ? confirmTool : undefined}
              loader={<AppLoader title={app.title} icon={icon} color={color} />}
              frame="viewport"
            />
          </SurfaceErrorBoundary>
        ) : (
          // The sandbox's own "isn't available" line is worded for share
          // visitors; the owner gets the way to fix it.
          <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center text-sm text-muted-foreground">
            <AppWindow className="size-8 opacity-50" aria-hidden />
            {admin ? (
              <>
                This app has no published build yet. Open it to build and commit it, or ask the
                assistant to build it.
                <Button asChild size="sm" variant="outline">
                  <Link href={itemHref('apps', app.id, true)}>
                    <Pencil />
                    Open
                  </Link>
                </Button>
              </>
            ) : (
              'This app has no published build yet. Build it over your MCP connection.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateAppDialog({
  folderName,
  onCreated,
}: {
  /** "New app inside" a folder: its name, for the title. */
  folderName: string | null;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // An empty name says so on the field, rather than leaving the button
    // looking broken.
    if (!name.trim()) {
      setError('A name is required');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { app } = await apiSend<{ app: { id: string } }>('/api/apps', 'POST', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      play('success');
      await onCreated(app.id);
    } catch {
      play('danger');
      toast.error('Could not create the app.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{folderName ? `New app in “${folderName}”` : 'New app'}</DialogTitle>
        <DialogDescription>Give it a name. Its own screen opens next.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor="app-name">Name</FieldLabel>
            <Input
              id="app-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error && e.target.value.trim()) setError(null);
              }}
              placeholder="Weather"
              autoFocus
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'app-name-error' : undefined}
            />
            <FieldError id="app-name-error">{error}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="app-desc">Description</FieldLabel>
            <Input
              id="app-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Today’s weather for a city"
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={saving}>Create app</SubmitButton>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  );
}
