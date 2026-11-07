'use client';

import { itemHref } from '@/components/layout/use-item-address';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCommitHorizontal, Undo2 } from 'lucide-react';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { TagInput } from '@/components/tag-input';
import { ItemHeader } from '@/components/layout/item-header';
import { DraftPill, HeaderIconPicker, HeaderTitleField } from '@/components/layout/header-fields';
import { AccessSlot } from '@/components/share/access-slot';
import { useExportTool } from '@/components/export/export-menu';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { DrawViewer } from '@/components/draw/draw-viewer';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { BackLink } from '@mantle/web-ui/layout/back-link';
import { SetPageTitle } from '@/components/layout/page-title';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { ExcalidrawCanvas, type SceneChange } from '@/components/draw/excalidraw-canvas';
import { loadSceneFiles, uploadNewSceneFiles } from '@/components/draw/scene-files';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
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
import { useFlushOnLeave } from '@mantle/web-ui/use-flush-on-leave';
import { commitFailedSound } from '@/lib/sounds/events';
import { play } from '@/lib/sounds/play';

type DrawDetail = {
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  description: string | null;
  summary: string | null;
  visibility: 'private' | 'public';
  createdAt: string;
  updatedAt: string;
  scene: Record<string, unknown>;
  draft: Record<string, unknown> | null;
  draftRev?: number;
  fileRefs: Record<string, string>;
};

// Same cadence as pages: the canvas autosaves into a private draft (cheap,
// never rendered or indexed); only Commit publishes and runs the extractor.
// The canvas fires onChange on every stroke, so the debounce is what keeps a
// sketching session from being hundreds of PUTs.
const DRAFT_DEBOUNCE_MS = 1500;
const DRAFT_MAX_WAIT_MS = 8000;
const META_DEBOUNCE_MS = 1000;

/** The excalidraw module namespace, loaded lazily — the package touches
 *  window at module scope, so it must never load during SSR. */
type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

/** The durable appState subset we persist (mirror of the server whitelist in
 *  normalizeScene — send only what will be stored). */
function pickAppState(appState: AppState): Record<string, unknown> {
  return {
    viewBackgroundColor: appState.viewBackgroundColor,
    ...(appState.gridSize !== undefined ? { gridSize: appState.gridSize } : {}),
    ...(appState.gridModeEnabled !== undefined
      ? { gridModeEnabled: appState.gridModeEnabled }
      : {}),
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom,
  };
}

/**
 * Outer gate: client-fetch the draw, then mount the editor with loaded data
 * (it seeds refs from `initial`, so it must only mount once data exists).
 * refetchOnMount 'always' + the isFetchedAfterMount gate mirror pages: the
 * editor seeds its draft etag from this response, and a cached rev would 409
 * on the first autosave and wipe the strokes.
 */
export function DrawDetailClient({ drawId }: { drawId: string }) {
  const drawQuery = useQuery({
    queryKey: ['draws', drawId],
    queryFn: () => apiFetch<{ draw: DrawDetail }>(`/api/draws/${drawId}`).then((r) => r.draw),
    refetchOnMount: 'always',
  });
  // Draw opens on this drawing next time (lib/last-opened.ts).
  useRememberLastOpened('draw', drawQuery.isSuccess ? drawId : null);

  if (drawQuery.isPending || (!drawQuery.isFetchedAfterMount && !drawQuery.isError)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (drawQuery.isError) {
    const notFound =
      drawQuery.error instanceof Error && /not found|404/i.test(drawQuery.error.message);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {notFound ? 'Drawing not found.' : 'Failed to load drawing.'}
        </p>
        <BackLink href="/draw">Back to drawings</BackLink>
      </div>
    );
  }

  return <DrawEditor initial={drawQuery.data} />;
}

function DrawEditor({ initial }: { initial: DrawDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Export is a route only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();
  // The login's caps on the drawing (W6b fix round): the read view and no
  // draft controls without mayEdit (never on a snapshot copy); no Grant
  // Access or Delete without mayManage. A snapshot copy keeps Delete for its
  // author.
  const access = itemAccess(initial);
  const readOnly = !access.edit;

  const [title, setTitle] = useState(initial.title);

  // Pin the open drawing. Until `draw` became a context kind this screen could
  // only be reached by marking it, which reported it to the agent as a file.
  useSurfaceAssist({ node: { id: initial.id, kind: 'draw', label: title || 'Untitled drawing' } });

  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [description, setDescription] = useState(initial.description ?? '');
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [dirty, setDirty] = useState(initial.draft !== null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  // The canvas mounts only after the module + scene files resolve; remounting
  // with a bumped key is how foreign draft changes (another device, later an
  // agent) are adopted — initialData only seeds on mount.
  const [canvasKey, setCanvasKey] = useState(0);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);

  const modRef = useRef<ExcalidrawModule | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Latest scene from onChange — what saves serialize. Seeded on load.
  const sceneRef = useRef<{
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState | null;
    files: BinaryFiles;
  }>({ elements: [], appState: null, files: {} });
  const fileRefsRef = useRef<Record<string, string>>(initial.fileRefs);
  const draftRevRef = useRef(initial.draftRev ?? 0);
  const committedHashRef = useRef<number>(0); // hash of the published elements
  const savedHashRef = useRef<number>(0); // hash last autosaved (or published)
  const metaSavedRef = useRef(
    JSON.stringify({
      title: initial.title,
      tags: initial.tags,
      icon: initial.icon ?? '',
      description: initial.description ?? '',
    }),
  );
  const lastDraftAtRef = useRef(Date.now());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedRef = useRef(false);
  const committingRef = useRef(false);
  const conflictRef = useRef(false); // pause autosave after a 409 until remount
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);

  // ── Load: restore() the working scene (draft ?? committed) + its files. ──
  // restore() is upstream's scene-format migration — every stored scene passes
  // through it on read, so package upgrades never hand the canvas stale JSON.
  const loadScene = useCallback(async (detail: DrawDetail) => {
    const mod = modRef.current ?? (await import('@excalidraw/excalidraw'));
    modRef.current = mod;
    const working = (detail.draft ?? detail.scene) as {
      elements?: OrderedExcalidrawElement[];
      appState?: Record<string, unknown>;
    };
    const committed = (detail.scene ?? {}) as { elements?: OrderedExcalidrawElement[] };
    const fileList = await loadSceneFiles(detail.fileRefs);
    const files: BinaryFiles = {};
    for (const f of fileList) files[f.id] = f;
    const restored = mod.restore(
      { elements: working.elements ?? [], appState: working.appState ?? {}, files },
      null,
      null,
    );
    sceneRef.current = {
      elements: restored.elements as readonly OrderedExcalidrawElement[],
      appState: null, // adopted from the first onChange
      files,
    };
    committedHashRef.current = mod.hashElementsVersion(
      (committed.elements ?? []) as OrderedExcalidrawElement[],
    );
    savedHashRef.current = mod.hashElementsVersion(restored.elements);
    setDirty(detail.draft !== null);
    setInitialData({
      elements: restored.elements,
      appState: restored.appState,
      files,
      // Saved scroll/zoom (if any) round-trips via appState; scrollToContent
      // only when nothing was saved, so a fresh open centres the drawing.
      scrollToContent: working.appState?.scrollX === undefined,
    });
  }, []);

  useEffect(() => {
    void loadScene(initial);
    // Mount-only: the draft watcher below handles subsequent server changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autosave the draft scene (no publish, no index). ──────────────────
  const saveDraft = useCallback(async () => {
    if (deletedRef.current) return;
    if (conflictRef.current) return;
    if (saveInFlightRef.current || committingRef.current) {
      saveQueuedRef.current = true;
      return;
    }
    const mod = modRef.current;
    if (!mod) return;
    // ONE snapshot for the whole save; drawing can continue during the await.
    const snapshot = sceneRef.current;
    const hash = mod.hashElementsVersion(snapshot.elements);
    if (hash === savedHashRef.current) return;
    saveInFlightRef.current = true;
    setDraftSaving(true);
    try {
      // New scene images ride the files pipeline before the scene references
      // them — the scene blob itself never carries bytes.
      const refs = await uploadNewSceneFiles(snapshot.files, fileRefsRef.current);
      const refsChanged = refs !== fileRefsRef.current;
      fileRefsRef.current = refs;
      let saved: { draft_rev?: number };
      try {
        saved = await apiSend<{ draft_rev: number }>(`/api/draws/${initial.id}/draft`, 'PUT', {
          scene: {
            elements: snapshot.elements,
            ...(snapshot.appState ? { appState: pickAppState(snapshot.appState) } : {}),
          },
          ...(refsChanged ? { file_refs: refs } : {}),
          if_rev: draftRevRef.current,
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        if (e instanceof ApiError && e.status === 409) {
          // Another writer advanced the draft. Pause autosaving until the
          // refetch remounts the canvas on server truth (draft watcher).
          conflictRef.current = true;
          savedHashRef.current = hash;
          toast.error('This drawing changed elsewhere. Reloading the latest draft');
          void queryClient.invalidateQueries({ queryKey: ['draws', initial.id] });
          return;
        }
        toast.error(e instanceof Error ? e.message : 'Could not save draft');
        return;
      }
      if (typeof saved.draft_rev === 'number') draftRevRef.current = saved.draft_rev;
      savedHashRef.current = hash;
      lastDraftAtRef.current = Date.now();
    } finally {
      saveInFlightRef.current = false;
      setDraftSaving(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void saveDraftRef.current();
      }
    }
  }, [initial.id, queryClient, toast]);

  // ── Title / tags save live (cheap metadata, never indexes). ───────────
  const saveMeta = useCallback(async () => {
    if (deletedRef.current) return;
    // `icon`/`description: ''` clear — updateDraw stores the blank and rowOf
    // normalises it back to null, same contract as pages icons.
    const payload = {
      title: title.trim() || 'Untitled drawing',
      tags,
      icon: icon ?? '',
      description: description.trim(),
    };
    const s = JSON.stringify(payload);
    if (s === metaSavedRef.current) return;
    try {
      await apiSend(`/api/draws/${initial.id}`, 'PATCH', payload);
      metaSavedRef.current = s;
    } catch {
      // Silent — reverts on next load; apiSend's 401 bounce still fires.
    }
  }, [initial.id, title, tags, icon, description]);

  // ── Commit: publish + index + capture the SVG snapshot. ───────────────
  const commit = useCallback(async () => {
    if (deletedRef.current || committingRef.current || readOnly) return;
    const mod = modRef.current;
    if (!mod) return;
    if (mod.hashElementsVersion(sceneRef.current.elements) === committedHashRef.current) return;
    committingRef.current = true;
    setCommitting(true);
    try {
      await saveMeta();
      // Wait out an in-flight autosave — it holds the same if_rev.
      while (saveInFlightRef.current) await new Promise((r) => setTimeout(r, 50));
      const snapshot = sceneRef.current;
      const hash = mod.hashElementsVersion(snapshot.elements);
      const refs = await uploadNewSceneFiles(snapshot.files, fileRefsRef.current);
      fileRefsRef.current = refs;
      // The published scene drops deleted elements (they exist only for
      // in-session undo); the draft keeps them.
      const live = snapshot.elements.filter((el) => !el.isDeleted);
      // The snapshot every non-editor surface renders. Best-effort: a failed
      // export commits without a preview rather than blocking the publish.
      let svg: string | undefined;
      try {
        const svgEl = await mod.exportToSvg({
          elements: live,
          appState: {
            exportBackground: true,
            exportWithDarkMode: false,
            exportEmbedScene: false,
            ...(snapshot.appState
              ? { viewBackgroundColor: snapshot.appState.viewBackgroundColor }
              : {}),
          },
          files: snapshot.files,
          // MANDATORY, not cosmetic: left unset, upstream renders an
          // embeddable element (paste a YouTube/Figma link and you have one)
          // into a <foreignObject>, which acceptSceneSvg rejects wholesale —
          // so one embed would silently blank the preview, the share link and
          // both exports. `false` makes upstream emit a plain sanitized <a>.
          renderEmbeddables: false,
        });
        svg = svgEl.outerHTML;
      } catch {
        svg = undefined;
      }
      let hasSvg = true;
      try {
        const { draw } = await apiSend<{ draw: { draftRev?: number; hasSvg?: boolean } }>(
          `/api/draws/${initial.id}/commit`,
          'POST',
          {
            scene: {
              elements: live,
              ...(snapshot.appState ? { appState: pickAppState(snapshot.appState) } : {}),
            },
            ...(svg ? { svg } : {}),
            file_refs: refs,
            if_rev: draftRevRef.current,
          },
        );
        if (typeof draw?.draftRev === 'number') draftRevRef.current = draw.draftRev;
        if (draw?.hasSvg === false) hasSvg = false;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        play(commitFailedSound(e instanceof ApiError ? e.status : null));
        if (e instanceof ApiError && e.status === 409) {
          toast.error('This drawing changed elsewhere. Reloading the latest draft');
          void queryClient.invalidateQueries({ queryKey: ['draws', initial.id] });
          return;
        }
        toast.error(e instanceof Error ? e.message : 'Commit failed');
        return;
      }
      committedHashRef.current = hash;
      savedHashRef.current = hash;
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['draws'], exact: false });
      // The scene is published either way, but without a snapshot the preview,
      // any live share link and both exports go blank — so say so instead of
      // reporting a clean commit the surfaces won't back up.
      // Committed either way: the scene is kept.
      play('commit');
      if (hasSvg) {
        toast.success('Committed');
      } else {
        toast.error('Committed, but the preview could not be generated');
      }
    } finally {
      committingRef.current = false;
      setCommitting(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void saveDraftRef.current();
      }
    }
  }, [initial.id, queryClient, readOnly, saveMeta, toast]);

  // Timers fire stale closures otherwise — always reach the latest fns.
  const saveDraftRef = useRef(saveDraft);
  const saveMetaRef = useRef(saveMeta);
  const commitRef = useRef(commit);
  useEffect(() => {
    saveDraftRef.current = saveDraft;
    saveMetaRef.current = saveMeta;
    commitRef.current = commit;
  }, [saveDraft, saveMeta, commit]);

  const scheduleDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const since = Date.now() - lastDraftAtRef.current;
    const wait = since >= DRAFT_MAX_WAIT_MS ? 0 : DRAFT_DEBOUNCE_MS;
    draftTimer.current = setTimeout(() => void saveDraftRef.current(), wait);
  }, []);

  const scheduleMeta = useCallback(() => {
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => void saveMetaRef.current(), META_DEBOUNCE_MS);
  }, []);

  // Every canvas change lands here — including pure selection/viewport moves,
  // which don't bump element versions and are filtered by the hash compare.
  const onSceneChange = useCallback(
    (change: SceneChange) => {
      sceneRef.current = {
        elements: change.elements,
        appState: change.appState,
        files: change.files,
      };
      const mod = modRef.current;
      if (!mod) return;
      const hash = mod.hashElementsVersion(change.elements);
      setDirty(hash !== committedHashRef.current);
      if (hash !== savedHashRef.current) scheduleDraft();
    },
    [scheduleDraft],
  );

  // Title / tags edits save live (skips the initial render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    scheduleMeta();
  }, [title, tags, icon, description, scheduleMeta]);

  // Leaving the editor flushes the draft + metadata — never commits.
  // Best-effort: the debounce window is the only exposure and the draft PUT is
  // cheap. The hook adds the two exits this had no listener for — `pagehide`
  // and an expired session.
  useFlushOnLeave(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (metaTimer.current) clearTimeout(metaTimer.current);
    void saveDraftRef.current();
    void saveMetaRef.current();
  });

  // ⌘/Ctrl+S commits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void commitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Watch the server-provided draft rev: rev-ahead ⇔ a foreign writer (second
  // device, later an agent) advanced the draft — adopt it by reloading the
  // scene and remounting the canvas. Echoes of our own writes are ≤ and
  // ignored (same reasoning as pages).
  useEffect(() => {
    const rev = initial.draftRev ?? 0;
    if (rev > draftRevRef.current) {
      draftRevRef.current = rev;
      fileRefsRef.current = initial.fileRefs;
      conflictRef.current = false;
      void loadScene(initial).then(() => setCanvasKey((k) => k + 1));
    }
  }, [initial, loadScene]);

  // Revert the whole draft to the last commit.
  const revertDraft = useCallback(async () => {
    if (reverting) return;
    setReverting(true);
    try {
      await apiSend(`/api/draws/${initial.id}/discard-draft`, 'POST');
      toast.success('Draft reverted to last commit');
      // Refetch → rev-ahead → loadScene + remount via the draft watcher.
      void queryClient.invalidateQueries({ queryKey: ['draws', initial.id] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not revert draft');
    } finally {
      setReverting(false);
    }
  }, [reverting, initial.id, queryClient, toast]);

  const download = useExportTool(initial.id, 'draw');

  const confirmDelete = async () => {
    deletedRef.current = true; // suppress the unmount flush
    try {
      await apiSend(`/api/draws/${initial.id}`, 'DELETE');
    } catch (e) {
      deletedRef.current = false;
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not delete drawing');
      return;
    }
    toast.success('Drawing deleted');
    void queryClient.invalidateQueries({ queryKey: ['draws'] });
    router.push('/draw');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SetPageTitle title={title || 'Untitled drawing'} />

      {/* The item header (contract 2026-10-21): the same one row as the
          read view, in edit mode. Title and icon edited in place; the
          description and tags behind Info; Commit the one word button; the
          pressed pencil leaves editing. Access publishes first
          (beforeEnable=commit) so a link never points at a stale or absent
          snapshot. */}
      <ItemHeader
        sticky
        section="Drawings"
        visual={
          <HeaderIconPicker
            icon={icon}
            fallback="✏️"
            onSelect={setIcon}
            onClear={() => setIcon(null)}
            label="Change drawing icon"
            readOnly={readOnly}
          />
        }
        title={
          <HeaderTitleField
            value={title}
            onChange={setTitle}
            placeholder="New drawing"
            label="Drawing title"
            readOnly={readOnly}
          />
        }
        badges={
          readOnly ? null : <DraftPill committing={committing} saving={draftSaving} dirty={dirty} />
        }
        textActions={
          readOnly ? null : (
            <Button size="sm" onClick={() => void commit()} disabled={!dirty || committing}>
              <GitCommitHorizontal /> Commit
            </Button>
          )
        }
        access={
          <AccessSlot
            type="draw"
            nodeId={initial.id}
            canShare={access.share}
            shares={initial}
            beforeEnable={commit}
          />
        }
        tools={[
          ...(dirty && !readOnly
            ? [
                {
                  key: 'revert',
                  label: reverting ? 'Reverting…' : 'Revert the drawing to the last commit',
                  icon: <Undo2 />,
                  onSelect: () => void revertDraft(),
                },
              ]
            : []),
          ...(isAdminUser ? [download] : []),
        ]}
        onDelete={access.manage ? () => setDeleteOpen(true) : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete drawing"
        edit={
          readOnly
            ? { disabled: true }
            : {
                href: itemHref('draw', initial.id),
                pressed: true,
                label: 'Done editing: back to the drawing',
              }
        }
        info={{
          rows: readOnly
            ? [
                ...(description ? [{ label: 'About', value: description }] : []),
                {
                  label: 'Tags',
                  value:
                    tags.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <TagPill key={t} tag={t} />
                        ))}
                      </span>
                    ) : (
                      'none'
                    ),
                },
                { label: 'Access', value: readOnlyNote(access) },
              ]
            : [
                {
                  label: 'About',
                  // The user-authored one-liner (data.description), not the
                  // extractor's summary; it saves with the metadata.
                  value: (
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Add a description…"
                      aria-label="Drawing description"
                      className="h-8"
                    />
                  ),
                },
                {
                  label: 'Tags',
                  value: <TagInput value={tags} onChange={setTags} placeholder="Add tags…" />,
                },
              ],
        }}
        infoLabel="About this drawing"
      />

      <div className="min-h-0 flex-1">
        {readOnly ? (
          // The read view: pan and zoom, no editing.
          <SurfaceErrorBoundary label="this drawing" resetKeys={[initial.id]}>
            <DrawViewer drawId={initial.id} />
          </SurfaceErrorBoundary>
        ) : initialData ? (
          // The canvas parses a scene written by another client, and a scene it
          // cannot read used to take the whole screen — header, tags, the lot —
          // with no way back but a reload. `resetKeys` on the drawing id so a
          // drawing that will not open never blocks the next one.
          <SurfaceErrorBoundary label="this drawing" resetKeys={[initial.id]}>
            <ExcalidrawCanvas
              key={canvasKey}
              initialData={initialData}
              onChange={onSceneChange}
              onApiReady={(api) => {
                apiRef.current = api;
              }}
            />
          </SurfaceErrorBoundary>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this drawing?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title || 'Untitled drawing'}” and its brain index will be removed. Images embedded
              from the files area are kept there.
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
