'use client';

import { itemHref } from '@/components/layout/use-item-address';
import { HeaderPill } from '@/components/layout/item-header';
import { AccessSlot } from '@/components/share/access-slot';
import { AppSettingsDialog, useAppSettingsShown } from '@/components/app-nav/app-settings-button';
import { PanelsTopLeft, Settings2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, GitCommitHorizontal, Undo2, Save, WandSparkles } from 'lucide-react';
import { apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Tabs, TabsContent } from '@mantle/web-ui/ui/tabs';
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
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { useToast } from '@mantle/web-ui/ui/toast';
import { SetPageTitle } from '@/components/layout/page-title';
import { BackLink } from '@mantle/web-ui/layout/back-link';
import { AppLookPicker } from '@/components/app-nav/app-look-picker';
import { AppTile } from '@/components/app-nav/app-tile';
import { AppItemHeader } from '@/components/app-nav/app-item-header';
import { AppTreePills } from '@/components/app-nav/app-tree-pills';
import { useAppNav } from '@/components/app-nav/use-app-nav';
import { AppSandbox } from '@mantle/share-ui/app-sandbox';
import { ownerAppSandboxProps } from '@/lib/owner-app-sandbox';
import { useAppToolConfirm } from '@/components/app-nav/use-app-tool-confirm';
import { AppHistory } from '@/components/app-nav/app-history';
import { AppLoader } from '@/components/app-nav/app-loader';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { AppAccessLog } from '@mantle/web-ui/app-sandbox/access-log';
import { CodeEditor } from '@mantle/web-ui/app-sandbox/code-editor';
import { FileTree } from '@mantle/web-ui/app-sandbox/file-tree';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import type { AppDetail } from '@mantle/client-types';
import {
  APP_SHARE_HINT,
  appCodeErrorText,
  appCodeWhy,
  appDetailQuery,
  canChangeAppCode,
} from '@/lib/apps-screen';
import { itemAccess } from '@/lib/item-access';
import { play } from '@/lib/sounds/play';

type BuildMsg = { text: string; location: { file: string; line: number; column: number } | null };

// Extensions the /format (Prettier) route handles — mirror its PARSER map so the
// button only enables for files the server can actually format.
const FORMATTABLE = new Set([
  'tsx',
  'ts',
  'jsx',
  'js',
  'mjs',
  'cjs',
  'css',
  'scss',
  'less',
  'json',
  'html',
  'htm',
  'md',
  'markdown',
]);
const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

/** Every app query: this app's AND the list's. A commit, discard or save
 *  changes the list's draft and build badges too (apps audit U7); inactive
 *  list pages are only marked stale, not refetched. */
const APPS_KEY = ['apps'] as const;

/** The four views of an app, picked from the header's View menu. */
const VIEWS = [
  { value: 'builder', label: 'Builder' },
  { value: 'code', label: 'Code' },
  { value: 'history', label: 'History' },
  { value: 'activity', label: 'Activity' },
] as const;
type View = (typeof VIEWS)[number]['value'];
const viewLabel = (v: string) => VIEWS.find((x) => x.value === v)?.label ?? VIEWS[0].label;

/**
 * One view's panel. Radix Tabs still holds the switching (and Builder's
 * forceMount), but there is no tab list: the views are picked from a menu.
 * So a panel is a labelled region, not a tabpanel naming a trigger that
 * isn't there, and not a tab stop of its own.
 */
function ViewPanel({ value, ...props }: ComponentProps<typeof TabsContent> & { value: View }) {
  return (
    <TabsContent
      value={value}
      role="region"
      aria-label={viewLabel(value)}
      aria-labelledby={undefined}
      tabIndex={undefined}
      {...props}
    />
  );
}

/** Outer query-gate so the page stays data-free. */
export function AppDetailClient({ id }: { id: string }) {
  // One shape for this cache entry on every screen (lib/apps-screen.ts).
  const appQuery = useQuery(appDetailQuery(id));

  if (appQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (appQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Couldn&apos;t load this app.</p>
        <BackLink href="/apps">Back to apps</BackLink>
      </div>
    );
  }
  return <AppDetailView app={appQuery.data.app} />;
}

/** A control that is off for a reason: the reason as the tooltip of a
 *  wrapper (a disabled button takes no pointer, so its own title never
 *  shows). No wrapper when it is on. */
function Why({ why, children }: { why: string | null; children: ReactNode }) {
  if (!why) return <>{children}</>;
  return (
    <span className="inline-flex" title={why}>
      {children}
    </span>
  );
}

function AppDetailView({ app }: { app: AppDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  // Icon and colour edits go through the app-nav hook: optimistic in the
  // sidebar and here, one PATCH, every other client notified. It deliberately
  // does NOT invalidate this app's query: reloading it re-syncs the source
  // tree and would drop unsaved editor changes for a cosmetic write.
  const { data: nav, setAppLook } = useAppNav();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsShown = useAppSettingsShown(app);
  const face = nav?.apps.find((a) => a.id === app.id);
  const icon = face ? face.icon : app.icon;
  const color = face ? face.color : app.color;

  // Saving the draft, Discard, Preview and Commit need the app's manage
  // right (brain F4): off for a login that only edits it, with why. A
  // read-only snapshot copy says it is a copy: nobody changes one.
  const codeAccess = canChangeAppCode(app);
  const codeWhy = appCodeWhy(app);
  const isCopy = itemAccess(app).copy;
  const source = app.draft ?? app.source;
  const toolSlugs = app.manifest?.toolSlugs ?? [];
  // Editable working copy of the source tree. Re-synced from the server on every
  // reload (build / publish / discard / assist), which also drops local edits.
  const [files, setFiles] = useState<Record<string, string>>(source.files);
  const [dirty, setDirty] = useState(false);
  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const [activePath, setActivePath] = useState(source.entry);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<null | 'preview' | 'commit' | 'discard' | 'save' | 'format'>(
    null,
  );
  const [buildErrors, setBuildErrors] = useState<BuildMsg[]>([]);
  // Discard throws away the whole draft, the assistant's work included, and
  // cannot be undone: it asks first (apps audit U2).
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Unsaved Code edits: leaving the screen (Back, a link, closing the tab)
  // asks first instead of dropping them (apps audit U3).
  const [heldLeave, setHeldLeave] = useState<(() => void) | null>(null);
  const holdLeave = useCallback(
    (go: () => void) => {
      if (dirty) setHeldLeave(() => go);
      else go();
    },
    [dirty],
  );
  useLeaveGuard(dirty, holdLeave);
  // A running app's call to a tool that needs confirmation (apps audit S1).
  const toolConfirm = useAppToolConfirm();
  // The draft stamp of the files this editor holds (apps audit U1). A save
  // sends it back; the brain refuses (409) when the draft changed since, so
  // a save cannot drop work the assistant or another window did meanwhile.
  // It moves only when the editor takes the server's files, never when a
  // refetch merely reports a newer draft. Undefined from an older brain:
  // then a save sends no stamp and goes through, as before.
  const baseRef = useRef(app.draftUpdatedAt);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState('builder');
  // The next reload only restarts the running app (a data restore): the
  // draft did not change, so the re-sync says nothing about it.
  const quietResyncRef = useRef(false);

  const activeContent = files[activePath] ?? files[source.entry] ?? '';
  const canFormat = FORMATTABLE.has(extOf(activePath));

  // Re-sync the editable copy whenever the server source changes (a build,
  // publish, discard, or an Appsmith edit). With unsaved edits in the editor
  // it keeps them instead (apps audit U1): the next save meets the newer
  // draft and asks what to do, rather than either side's work vanishing.
  useEffect(() => {
    const quiet = quietResyncRef.current;
    quietResyncRef.current = false;
    if (dirtyRef.current) {
      if (!quiet) {
        toast.info('The draft changed. Your unsaved edits are kept; saving will ask what to do.');
      }
      return;
    }
    setFiles(source.files);
    baseRef.current = app.draftUpdatedAt;
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  /** Compile the draft and refresh the preview. Does NOT go live. */
  async function preview() {
    // Unsaved editor changes must reach the draft before we compile it.
    if (dirty && !(await saveDraft())) return;
    setBusy('preview');
    setBuildErrors([]);
    try {
      const data = await apiSend<{ errors?: BuildMsg[]; buildOk?: boolean }>(
        `/api/apps/${app.id}/build`,
        'POST',
      );
      setBuildErrors(data.errors ?? []);
      if (data.buildOk) {
        toast.success('Preview updated.');
        await queryClient.invalidateQueries({ queryKey: APPS_KEY });
        setReloadKey((k) => k + 1);
      } else {
        toast.error(`${data.errors?.length ?? 0} error(s). The preview was not updated.`);
      }
    } catch (err) {
      toast.error(appCodeErrorText(err, 'Could not build the preview.', { copy: isCopy }));
    } finally {
      setBusy(null);
    }
  }

  /** Go live: the route compiles the draft itself and promotes it only on a
   *  clean build, so the live source and the live bundle always agree. */
  async function commit() {
    if (dirty && !(await saveDraft())) return;
    setBusy('commit');
    setBuildErrors([]);
    try {
      await apiSend(`/api/apps/${app.id}/publish`, 'POST');
      play('commit');
      toast.success('Committed. The live app is updated.');
      await queryClient.invalidateQueries({ queryKey: APPS_KEY });
      setReloadKey((k) => k + 1);
    } catch (err) {
      // 422 = the commit's own build failed; surface the errors in the panel
      // rather than a bare toast, exactly as a Preview failure would.
      if (err instanceof ApiError && err.status === 422) {
        const errors = (err.body?.errors as BuildMsg[] | undefined) ?? [];
        setBuildErrors(errors);
        play('danger');
        toast.error(`${errors.length} error(s). Nothing was committed.`);
      } else {
        play('danger');
        toast.error(appCodeErrorText(err, 'Commit failed.', { copy: isCopy }));
      }
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy('discard');
    try {
      await apiSend(`/api/apps/${app.id}/draft`, 'DELETE');
      toast.success('Draft discarded.');
      // The unsaved edits go with the draft (the owner said so): the re-sync
      // takes the server's files and stamp. Kept, they met the new draft on
      // the next save as a false conflict (apps audit 2026-10-02, low).
      setDirty(false);
      dirtyRef.current = false;
      await queryClient.invalidateQueries({ queryKey: APPS_KEY });
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(appCodeErrorText(err, 'Could not discard the draft.', { copy: isCopy }));
    } finally {
      setBusy(null);
    }
  }

  // Wire the global assistant overlay to this app: arm the Appsmith specialist,
  // pin this app as context, and rebuild the preview when Appsmith edits the
  // draft. Replaces the old in-builder Appsmith panel; the draft/Commit flow is
  // unchanged.
  const onAppEdited = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: APPS_KEY });
    setReloadKey((k) => k + 1);
  }, [queryClient]);
  useSurfaceAssist({
    node: { id: app.id, kind: 'app', label: app.title },
    onEdited: onAppEdited,
  });

  // Persist the edited file tree to the draft. Returns true on success so
  // Preview and Commit can save-then-compile when there are unsaved edits.
  // `overwrite` (the conflict dialog's choice) sends no stamp, so it goes
  // through over a draft that changed meanwhile.
  async function saveDraft(overwrite = false): Promise<boolean> {
    setBusy('save');
    try {
      const base = baseRef.current;
      const res = await apiSend<{ draftUpdatedAt?: string }>(`/api/apps/${app.id}/draft`, 'PUT', {
        entry: source.entry,
        files,
        ...(base !== undefined && !overwrite ? { baseDraftUpdatedAt: base } : {}),
      });
      if (res?.draftUpdatedAt) baseRef.current = res.draftUpdatedAt;
      setDirty(false);
      play('commit');
      toast.success('Saved to draft.');
      await queryClient.invalidateQueries({ queryKey: APPS_KEY });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
        return false;
      }
      play('danger');
      toast.error(appCodeErrorText(err, 'Could not save.', { copy: isCopy }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Drop the unsaved edits and take the draft as the brain has it now. */
  async function reloadLatest() {
    setDirty(false);
    dirtyRef.current = false;
    await queryClient.invalidateQueries({ queryKey: APPS_KEY });
    setReloadKey((k) => k + 1);
  }

  async function formatActive() {
    setBusy('format');
    try {
      const data = await apiSend<{ formatted: string }>(`/api/apps/${app.id}/format`, 'POST', {
        path: activePath,
        content: activeContent,
      });
      if (data.formatted !== activeContent) {
        setFiles((f) => ({ ...f, [activePath]: data.formatted }));
        setDirty(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not format.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SetPageTitle title={app.title} />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        {/* The item header (contract 2026-10-21): the same one row as the Apps
            pane, in edit mode. Commit is the one word button; Preview,
            Discard, the view switch and App settings are the app's tools
            (they fold into More); the description and its state behind Info;
            the pressed pencil leaves editing (back to the app in Apps). */}
        <AppItemHeader
          section="Apps"
          icon={icon}
          color={color}
          tile={
            <AppLookPicker
              icon={icon}
              color={color}
              label={app.title}
              onChange={(l) => void setAppLook(app.id, l)}
              align="start"
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Change icon and colour"
                  title="Change icon and colour"
                >
                  <AppTile icon={icon} color={color} size="md" />
                </Button>
              }
            />
          }
          title={app.title}
          badges={app.hasDraft ? <HeaderPill>unpublished draft</HeaderPill> : null}
          textActions={
            // Commit compiles the draft itself, so it gates on there being
            // something staged, not on a build having been run by hand.
            <Why why={codeWhy}>
              <Button
                size="sm"
                onClick={commit}
                disabled={busy !== null || !codeAccess || (!app.hasDraft && !dirty)}
                title={codeWhy ? undefined : 'Compile the draft and make it live'}
              >
                <GitCommitHorizontal />
                Commit
              </Button>
            </Why>
          }
          access={
            <AccessSlot
              type="app"
              nodeId={app.id}
              canShare={!!app.publishedBuild?.ok}
              shares={app}
              hint={APP_SHARE_HINT}
            />
          }
          tools={[
            {
              key: 'preview',
              label: codeWhy ?? 'Preview: compile the draft and refresh it (does not go live)',
              icon: <Eye />,
              disabled: busy !== null || !codeAccess,
              onSelect: preview,
            },
            {
              key: 'view',
              label: `View: ${viewLabel(tab)}`,
              icon: <PanelsTopLeft />,
              choices: VIEWS.map((v) => ({
                key: v.value,
                label: v.value === tab ? `${v.label} ✓` : v.label,
                onSelect: () => setTab(v.value),
              })),
            },
            ...(app.hasDraft
              ? [
                  {
                    key: 'discard',
                    label: codeWhy ?? (busy === 'discard' ? 'Discarding…' : 'Discard the draft'),
                    icon: <Undo2 />,
                    disabled: busy !== null || !codeAccess,
                    onSelect: () => setConfirmDiscard(true),
                  },
                ]
              : []),
            ...(settingsShown
              ? [
                  {
                    key: 'settings',
                    label: 'App settings: its data and tools',
                    icon: <Settings2 />,
                    onSelect: () => setSettingsOpen(true),
                  },
                ]
              : []),
          ]}
          edit={{
            href: itemHref('apps', app.id),
            pressed: true,
            label: 'Done editing: back to the app',
          }}
          info={{
            description: app.description ?? app.summary ?? undefined,
            rows: [
              {
                label: 'State',
                value: app.hasDraft
                  ? 'It has an unpublished draft: Commit makes it live.'
                  : app.publishedBuild?.ok
                    ? 'The live app is the last commit.'
                    : 'It has no published build yet: Commit builds and publishes it.',
              },
              {
                label: 'Tools',
                value: toolSlugs.length ? toolSlugs.join(', ') : 'It declares no tools.',
              },
              { label: 'Data', value: <AppTreePills id={app.id} /> },
            ],
          }}
          infoLabel="About this app"
        />
        <AppSettingsDialog app={app} open={settingsOpen} onOpenChange={setSettingsOpen} />

        {/* Builder — the live preview. Ask Appsmith to edit the app via the
            global assistant (⌘I), auto-armed for this app. */}
        {/* forceMount: the running app stays mounted while another view is
            open (apps audit P8). Unmounting it on every switch minted a new
            frame ticket, reloaded the app and lost its state. */}
        <ViewPanel
          value="builder"
          forceMount
          className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          {/* The preview is a real viewport (frame="viewport"): the sandbox
              fills the pane and the app handles its own scrolling, exactly as
              it will on the shared /s/ surface. */}
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <div className="min-h-0 flex-1">
              {/* `onError` above is the app's own build failing, which the
                  sandbox reports and handles. This is the other kind: the
                  sandbox host itself throwing, which took the build errors
                  pane down with it. */}
              <SurfaceErrorBoundary label="this app" resetKeys={[app.id, reloadKey]}>
                <AppSandbox
                  appId={app.id}
                  {...ownerAppSandboxProps(app.id)}
                  confirmTool={toolConfirm.confirmTool}
                  loader={<AppLoader title={app.title} icon={icon} color={color} />}
                  frame="viewport"
                  reloadKey={reloadKey}
                  onError={(m) => toast.error(m)}
                />
              </SurfaceErrorBoundary>
            </div>
            {buildErrors.length > 0 && (
              // shrink-0 + its own scroll so the flex-1 sandbox above can't
              // squeeze the errors to zero height in the non-scrolling column.
              <div className="mt-3 max-h-48 shrink-0 overflow-y-auto scrollbar-thin rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-ink">
                <p className="mb-1 font-medium">Compile errors</p>
                <ul className="flex flex-col gap-1">
                  {buildErrors.map((e, i) => (
                    <li key={i}>
                      {e.location ? `${e.location.file}:${e.location.line}: ` : ''}
                      {e.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ViewPanel>

        {/* Code — file-tree sidebar + an editable, syntax-highlighted editor. */}
        <ViewPanel value="code" className="mt-0 flex min-h-0 flex-1 flex-col">
          <MasterDetail
            id="app-code"
            // The view is the whole of this pane, so the scaffold takes all of
            // it — the page header sits above.
            className="min-h-0 flex-1"
            // The 200px column the grid always had. It is a file TREE, not a
            // list of cards, so it opens narrower than the 340px default and
            // its floor comes down with it: a 260px minimum would be wider
            // than the width it starts at, and the divider could only ever
            // move right.
            defaultListSize="200px"
            minListSize="160px"
            maxListSize="420px"
            // The old `minmax(0,1fr)`. A code editor is not a measure of
            // reading prose — capping it at 672px would hand the slack to an
            // empty spacer and wrap the lines the tab exists to show.
            detailFills
            list={
              <FileTree
                paths={paths}
                entry={source.entry}
                activePath={activePath}
                onSelect={setActivePath}
                // `flex-1` for the height the grid cell used to give it; the
                // divider is the border it used to draw itself.
                className="flex-1"
              />
            }
            detail={
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {activePath}
                    {dirty && <span className="ml-1.5 text-foreground">●</span>}
                  </span>
                  <Why why={codeWhy}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={formatActive}
                      disabled={busy !== null || !canFormat || !codeAccess}
                      title={
                        codeWhy
                          ? undefined
                          : canFormat
                            ? 'Format with Prettier'
                            : 'No formatter for this file type'
                      }
                    >
                      <WandSparkles />
                      {busy === 'format' ? 'Formatting…' : 'Format'}
                    </Button>
                  </Why>
                  <Why why={codeWhy}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveDraft()}
                      disabled={busy !== null || !dirty || !codeAccess}
                    >
                      <Save />
                      {busy === 'save' ? 'Saving…' : 'Save'}
                    </Button>
                  </Why>
                </div>
                {codeWhy ? (
                  // The read-only reason in words, not only a tooltip: a
                  // keyboard or screen-reader user reads it too (F4 audit L2).
                  <p
                    className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
                    data-testid="app-code-read-only"
                  >
                    {codeWhy}
                  </p>
                ) : null}
                <CodeEditor
                  path={activePath}
                  readOnly={!codeAccess}
                  value={activeContent}
                  onChange={(next) => {
                    setFiles((f) => ({ ...f, [activePath]: next }));
                    setDirty(true);
                  }}
                  className="min-h-0 flex-1"
                />
              </div>
            }
          />
        </ViewPanel>

        {/* History — versions (each commit) and snapshots (code + data);
            restore any of them. */}
        <ViewPanel value="history" className="mt-0 min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <AppHistory
            appId={app.id}
            appTitle={app.title}
            hasDraft={app.hasDraft}
            dirty={dirty}
            codeWhy={codeWhy}
            copy={isCopy}
            onRestored={(res) => {
              // Code came back (the draft or live): take the server's files.
              // A data-only restore leaves the code alone, unsaved edits
              // included (mantle apps audit 2026-10-02, item 6): only the
              // running app reloads.
              if (res.code !== null) {
                setDirty(false);
                dirtyRef.current = false;
              } else {
                quietResyncRef.current = true;
              }
              setReloadKey((k) => k + 1);
              setTab('builder');
            }}
          />
        </ViewPanel>

        {/* Activity — the external access log (who opened/used the shared app). */}
        <ViewPanel value="activity" className="mt-0 min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <AppAccessLog appId={app.id} />
        </ViewPanel>
      </Tabs>

      {toolConfirm.dialog}

      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>The draft changed</AlertDialogTitle>
            <AlertDialogDescription>
              The assistant or another window changed this app&apos;s draft after you opened it.
              Saving now would replace that work with yours. Your edits are still here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setConflict(false);
                void reloadLatest();
              }}
            >
              Load the latest (drop mine)
            </Button>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void saveDraft(true)}
            >
              Save mine over it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Every change since the last commit goes, the assistant&apos;s included. The live app
              stays as it is. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the draft</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void discard()}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={heldLeave !== null}
        onOpenChange={(o) => {
          if (!o) setHeldLeave(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              The code has edits that are not saved to the draft. Leaving throws them away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const go = heldLeave;
                setHeldLeave(null);
                setDirty(false);
                go?.();
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
