'use client';

import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { DraftPill, HeaderIconPicker, HeaderTitleField } from '@/components/layout/header-fields';
import { AccessSlot } from '@/components/share/access-slot';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { SetPageTitle } from '@/components/layout/page-title';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { useToast } from '@mantle/web-ui/ui/toast';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { useExportTool } from '@/components/export/export-menu';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { itemAccess, readOnlyNote } from '@/lib/item-access';
import { TableGrid } from '@/components/table-grid/table-grid';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { useRealtime } from '@/components/realtime/use-realtime';
import { diffTableDocs, ensureTableDoc, type TableDoc } from '@mantle/content-core/table-model';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { uuid } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { useFlushOnLeave } from '@mantle/web-ui/use-flush-on-leave';
import type { TableDetail } from '@mantle/content-core/table-model';

const DRAFT_DEBOUNCE_MS = 1200;
const META_DEBOUNCE_MS = 800;

type TabInfo = NonNullable<TableDetail['tabs']>[number];

export function TableDetailClient({ initial }: { initial: TableDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Import and Export are routes only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();

  // App-bound table (mantle v0.232.14): a derived, read-only export of one
  // table in a mini-app's SQLite. The server refuses every grid mutation
  // (AppBoundTableError), so the whole draft/commit cycle is off — only
  // metadata (title/icon/tags/sharing) stays editable here.
  const appLink = initial.appLink ?? null;
  // The login's caps on the table (W6b fix round): a read only grid and no
  // draft controls without mayEdit (never on a snapshot copy); no Grant
  // Access or Delete without mayManage. A snapshot copy keeps Delete for its
  // author.
  const access = itemAccess(initial);
  const readOnly = !access.edit;
  const readNote = readOnlyNote(access);

  const published = ensureTableDoc(initial.data);
  const [doc, setDoc] = useState<TableDoc>(ensureTableDoc(initial.draft ?? initial.data));
  const [title, setTitle] = useState(initial.title);
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [committing, setCommitting] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Workbook tabs (v2.1 P5). File-backed tables always have the list;
  // legacy JSONB tables (undefined) keep the pre-tabs single-grid UI. ──
  const [tabs, setTabs] = useState<TabInfo[] | undefined>(initial.tabs);
  const [activeTab, setActiveTab] = useState<string | undefined>(initial.tabId);
  const [tabSwitching, setTabSwitching] = useState(false);
  const fileBacked = tabs !== undefined;

  const docRef = useRef(doc);
  docRef.current = doc;
  const committedRef = useRef(JSON.stringify(published));
  // Last SAVED draft state — the diff base for the op autosave (object) and
  // the cheap change check (string).
  const savedDocRef = useRef<TableDoc>(ensureTableDoc(initial.draft ?? initial.data));
  const savedKeyRef = useRef(JSON.stringify(initial.draft ?? initial.data));
  const draftRevRef = useRef(initial.draftRev ?? 0);
  const metaSavedRef = useRef(initial.title);
  const iconSavedRef = useRef(initial.icon ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Past the materialize window the grid shows a leading window of the rows
  // (read-only — a whole-doc edit of a window would truncate the table; the
  // assistant's row tools edit at any size) and pages the rest in on demand.
  // A server draft can exist beyond the ACTIVE tab's doc (tab added/deleted,
  // import, another tab edited) — track it so Commit/Discard light up.
  const [hasDraft, setHasDraft] = useState(initial.draft != null);
  const [clipped, setClipped] = useState(initial.docClipped === true);
  const [loadedTotal, setLoadedTotal] = useState(initial.rowCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const draftParam = initial.draft != null ? '&draft=1' : '';
      const tabParam = activeTabRef.current
        ? `&tab=${encodeURIComponent(activeTabRef.current)}`
        : '';
      const page = await apiFetch<{ rows: TableDoc['rows']; total: number }>(
        `/api/tables/${initial.id}/rows?offset=${docRef.current.rows.length}&limit=1000${draftParam}${tabParam}`,
      );
      setLoadedTotal(page.total);
      if (page.rows.length > 0) {
        setDoc((d) => ({ ...d, rows: [...d.rows, ...page.rows] }));
        // Appending display rows must not trip the autosave differ.
        savedKeyRef.current = '';
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) toast.error('Could not load more rows');
    } finally {
      setLoadingMore(false);
    }
  }, [initial.draft, initial.id, loadingMore, toast]);

  const dirty =
    !appLink && (hasDraft || (!clipped && JSON.stringify(doc) !== committedRef.current));

  /** Re-read the detail for a tab (or the current one) and reset the local
   *  refs to the server truth. */
  const reloadTab = useCallback(
    async (tabId?: string) => {
      const tabParam = tabId ?? activeTabRef.current;
      let table: TableDetail;
      try {
        ({ table } = await apiFetch<{ table: TableDetail }>(
          `/api/tables/${initial.id}${tabParam ? `?tab=${encodeURIComponent(tabParam)}` : ''}`,
        ));
      } catch (e) {
        // The tab may no longer exist (deleted in this or another session) —
        // fall back to the first tab instead of stranding the view.
        if (e instanceof ApiError && e.status === 404 && tabParam) {
          ({ table } = await apiFetch<{ table: TableDetail }>(`/api/tables/${initial.id}`));
        } else {
          throw e;
        }
      }
      const fresh = ensureTableDoc(table.draft ?? table.data);
      setDoc(fresh);
      setTabs(table.tabs);
      setActiveTab(table.tabId);
      setClipped(table.docClipped === true);
      setLoadedTotal(table.rowCount);
      committedRef.current = JSON.stringify(ensureTableDoc(table.data));
      savedDocRef.current = fresh;
      savedKeyRef.current = JSON.stringify(fresh);
      draftRevRef.current = table.draftRev ?? 0;
      setHasDraft(table.draft != null);
    },
    [initial.id],
  );

  // ── Autosave the working grid to the DRAFT. File-backed tables send the
  // diff as an OP BATCH scoped to the active tab (multi-tab safe, etag'd);
  // legacy JSONB tables keep the whole-doc PUT. Returns false on failure —
  // commit MUST abort then, or it would promote the PREVIOUS autosave and
  // mark the newest edits committed while silently dropping them (audit). ──
  const runSaveDraft = useCallback(async (): Promise<boolean> => {
    if (appLink) return true; // app-bound — the grid is read-only, nothing drafts
    if (clipped) return true; // read-only window — nothing autosaves
    // ONE snapshot for the whole save: the user can keep editing during the
    // network await, and marking the LIVE doc as saved would silently drop
    // those in-flight edits from every future diff (audit: they were then
    // "committed" without ever reaching the server).
    const snapshot = docRef.current;
    const s = JSON.stringify(snapshot);
    if (s === savedKeyRef.current) return true;
    setDraftSaving(true);
    try {
      if (fileBacked) {
        const ops = diffTableDocs(savedDocRef.current, snapshot);
        if (ops === null) {
          // Not expressible as ops (reorder / view deletion). Single-tab
          // workbooks can still save whole; multi-tab cannot (it would drop
          // the other tabs server-side).
          if ((tabs?.length ?? 1) > 1) {
            toast.error('That change (reordering) isn’t supported on multi-tab tables yet');
            return false;
          }
          const j = await apiSend<{ draft_rev: number }>(`/api/tables/${initial.id}/draft`, 'PUT', {
            data: snapshot,
            if_rev: draftRevRef.current,
          });
          draftRevRef.current = j.draft_rev;
          setHasDraft(true);
        } else if (ops.length > 0) {
          const tabId = activeTabRef.current;
          const j = await apiSend<{ draft_rev: number }>(
            `/api/tables/${initial.id}/draft-ops`,
            'POST',
            {
              ops: tabId ? ops.map((o) => ({ ...o, tabId })) : ops,
              if_rev: draftRevRef.current,
            },
          );
          draftRevRef.current = j.draft_rev;
          setHasDraft(true);
        }
      } else {
        await apiSend(`/api/tables/${initial.id}/draft`, 'PUT', { data: snapshot });
      }
      savedDocRef.current = snapshot;
      savedKeyRef.current = s;
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error('This table changed elsewhere — reloading the latest draft');
        void reloadTab();
        return false;
      }
      if (e instanceof ApiError && e.status === 400) {
        // The server rejected an op in the batch — e.g. a reference column
        // whose source column was deleted in another surface between the pick
        // and the save. That op would otherwise stay in every future diff and
        // wedge ALL saves; reload the base so it leaves the delta, and name the
        // cause instead of a generic failure (audit C1).
        toast.error(`Change couldn’t be saved: ${e.message} — reloaded the latest draft`);
        void reloadTab();
        return false;
      }
      if (!(e instanceof ApiError && e.status === 401)) toast.error('Could not save draft');
      return false;
    } finally {
      setDraftSaving(false);
    }
  }, [appLink, clipped, fileBacked, initial.id, reloadTab, tabs?.length, toast]);

  // Saves are SERIALIZED: a debounce tick and a commit flush can otherwise
  // overlap, and the second diff would run from a base the first hasn't
  // updated yet — a guaranteed spurious 409 (reload = discarded edits).
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveDraft = useCallback((): Promise<boolean> => {
    const p = saveChainRef.current.then(runSaveDraft, runSaveDraft);
    saveChainRef.current = p;
    return p;
  }, [runSaveDraft]);

  // Debounced draft autosave whenever the grid changes.
  useEffect(() => {
    if (appLink || clipped) return;
    const s = JSON.stringify(doc);
    if (s === savedKeyRef.current) return;
    const h = setTimeout(() => void saveDraft(), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [appLink, clipped, doc, saveDraft]);

  // App-bound: the app writes, the server re-derives the export, and a
  // realtime 'table' ping is the only signal — pull the fresh grid in place.
  // This is what the banner's "refreshes automatically" promises.
  useRealtime(['table'], (c) => {
    if (appLink && c.id === initial.id) {
      void reloadTab().catch(() => {
        /* transient refetch failure; the next ping retries */
      });
    }
  });

  // Leaving the table flushes whatever the debounce above still holds — the
  // effect's cleanup only CANCELS the pending tick, so without this an edit
  // followed by a click on another table (or any nav link) inside
  // DRAFT_DEBOUNCE_MS was silently gone. Shared with the Pages and Draw
  // editors now — useFlushOnLeave covers unmount, hide, pagehide and an
  // expired session, which the three of them each covered differently.
  // saveDraft already no-ops when nothing changed or the view is clipped.
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  useFlushOnLeave(() => void saveDraftRef.current());

  // Title saves live (cheap metadata; never indexes).
  useEffect(() => {
    if (title === metaSavedRef.current) return;
    const h = setTimeout(async () => {
      try {
        await apiSend(`/api/tables/${initial.id}`, 'PATCH', {
          title: title.trim() || 'Untitled table',
        });
        metaSavedRef.current = title;
      } catch {
        // metadata autosave is best-effort; the next edit retries.
      }
    }, META_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [title, initial.id]);

  // Icon (emoji) saves live, same as the title.
  useEffect(() => {
    if (icon === iconSavedRef.current) return;
    const h = setTimeout(async () => {
      try {
        await apiSend(`/api/tables/${initial.id}`, 'PATCH', { icon: icon.trim() });
        iconSavedRef.current = icon;
      } catch {
        // metadata autosave is best-effort; the next edit retries.
      }
    }, META_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [icon, initial.id]);

  // ── Tab switching: flush pending edits, then load the other tab. ──
  const switchTab = useCallback(
    async (tabId: string) => {
      if (tabId === activeTabRef.current || tabSwitching) return;
      setTabSwitching(true);
      try {
        const flushed = await saveDraft();
        if (!flushed) return;
        await reloadTab(tabId);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) toast.error('Could not switch tab');
      } finally {
        setTabSwitching(false);
      }
    },
    [reloadTab, saveDraft, tabSwitching, toast],
  );

  /** Dispatch tab CRUD ops (add/rename/delete), then reload from the server
   *  (the draft's tab list is the truth). */
  const tabOp = useCallback(
    async (op: Record<string, unknown> | Record<string, unknown>[], nextTab?: string) => {
      const ops = Array.isArray(op) ? op : [op];
      try {
        const flushed = await saveDraft();
        if (!flushed) return;
        const j = await apiSend<{ draft_rev: number; created_ids: (string | null)[] }>(
          `/api/tables/${initial.id}/draft-ops`,
          'POST',
          { ops, if_rev: draftRevRef.current },
        );
        draftRevRef.current = j.draft_rev;
        const addIdx = ops.findIndex((o) => o.op === 'tab_add');
        await reloadTab(nextTab ?? (addIdx >= 0 ? (j.created_ids[addIdx] as string) : undefined));
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          toast.error('This table changed elsewhere — reloading the latest draft');
          void reloadTab();
          return;
        }
        if (!(e instanceof ApiError && e.status === 401)) {
          toast.error(e instanceof Error ? e.message : 'Tab change failed');
        }
      }
    },
    [initial.id, reloadTab, saveDraft, toast],
  );

  // ── Commit: publish + index. The only path that touches the brain. ──
  // Flush the draft, then promote the SERVER draft (empty body) — the client
  // never posts the doc at commit time, so a windowed doc can never truncate
  // the published table (plan §4).
  const commit = useCallback(async () => {
    if (committing) return;
    const s = JSON.stringify(docRef.current);
    if (!clipped && !hasDraft && s === committedRef.current) return;
    setCommitting(true);
    try {
      const flushed = await saveDraft();
      if (!flushed) {
        toast.error('Draft not saved — commit aborted (nothing was published)');
        return;
      }
      await apiSend(`/api/tables/${initial.id}/commit`, 'POST', {});
      committedRef.current = s;
      savedKeyRef.current = s;
      savedDocRef.current = docRef.current;
      setHasDraft(false);
      toast.success('Committed');
      // Refresh the list summary (title/updatedAt) + the selected-table query.
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Commit failed');
      return;
    } finally {
      setCommitting(false);
    }
  }, [clipped, committing, hasDraft, initial.id, queryClient, saveDraft, toast]);

  // ── Discard: throw away the draft, revert to the published grid. ──
  const discard = useCallback(async () => {
    try {
      await apiSend(`/api/tables/${initial.id}/discard-draft`, 'POST');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      // fire-and-forget: the re-read below reflects whatever the server kept.
    }
    try {
      await reloadTab();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      // re-read failed; leave the current grid in place.
    }
    toast.success('Draft discarded');
  }, [initial.id, reloadTab, toast]);

  // Wire the global assistant overlay to this table: arm the Ledger specialist
  // and pin this table as context. When Ledger edits the draft (server-side), pull
  // it back into the grid and mark it saved so the autosave doesn't re-send it.
  const onTableEdited = useCallback(async () => {
    try {
      await reloadTab();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      // re-read failed; the edit still landed server-side — a reload reconciles.
    }
  }, [reloadTab]);
  // The open tab rides along as meta. A workbook's title alone doesn't say which
  // sheet you're looking at, so "sort this by date" would be ambiguous without
  // it: the name is what the user means by "this tab", the id is what the table
  // tools act on. Legacy JSONB tables have no tabs, and then there's nothing to
  // say — a single grid is unambiguous.
  const activeTabInfo = tabs?.find((t) => t.id === activeTab);
  const { busy: assistBusy } = useSurfaceAssist({
    node: {
      id: initial.id,
      kind: 'table',
      label: title || 'Untitled table',
      ...(activeTabInfo ? { meta: { tab: activeTabInfo.name, tabId: activeTabInfo.id } } : {}),
    },
    onEdited: onTableEdited,
  });

  // ── Import a spreadsheet: every sheet becomes a TAB of this table's draft. ──
  const onImportFile = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        // FormData body: apiFetch (NOT apiSend) so the multipart boundary survives.
        const j = await apiFetch<{
          sheets: number;
          tabs: { name: string; columns: number; rows: number }[];
        }>(`/api/tables/${initial.id}/import`, { method: 'POST', body: fd });
        try {
          await reloadTab(undefined);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) return;
          // re-read failed; the import still landed server-side.
        }
        const totalRows = (j.tabs ?? []).reduce((a, t) => a + t.rows, 0);
        toast.success(
          `Imported ${totalRows.toLocaleString()} rows across ${j.sheets} tab${j.sheets === 1 ? '' : 's'}. Review, then Commit.`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        toast.error(e instanceof Error ? e.message : 'Import failed');
        return;
      } finally {
        setImporting(false);
      }
    },
    [initial.id, reloadTab, toast],
  );

  const download = useExportTool(initial.id, 'table');

  const doDelete = useCallback(async () => {
    try {
      await apiSend(`/api/tables/${initial.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error('Could not delete table');
      return;
    }
    toast.success('Table deleted');
    await queryClient.invalidateQueries({ queryKey: ['tables'] });
    router.push('/tables');
  }, [initial.id, queryClient, router, toast]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SetPageTitle title={title || 'Table'} />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImportFile(f);
          e.target.value = '';
        }}
      />
      {/* The item header (contract 2026-10-21): one row. A table is always
          open for editing, so it has no pencil. Commit is the one word
          button; Import, Discard and Download are its tools; the read-only
          note sits behind Info. An app's table names its app as the pill. */}
      <ItemHeader
        sticky
        section="Tables"
        visual={
          <HeaderIconPicker
            icon={icon || null}
            fallback="📊"
            onSelect={setIcon}
            onClear={() => setIcon('')}
            label="Change table icon"
            readOnly={readOnly}
          />
        }
        title={
          <HeaderTitleField
            value={title}
            onChange={setTitle}
            placeholder="Table"
            label="Table title"
            readOnly={readOnly}
          />
        }
        badges={
          appLink ? (
            // App-bound: no draft cycle, so the app takes the pill and
            // Import/Commit/Discard don't render at all.
            <Link
              href={`/apps/${appLink.appId}`}
              title={`Open ${appLink.appName ?? 'the app'}`}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HeaderPill>
                <AppWindow className="mr-1 size-3" aria-hidden />
                app table{appLink.appName ? ` · ${appLink.appName}` : ''}
              </HeaderPill>
            </Link>
          ) : readOnly ? null : (
            <DraftPill committing={committing} saving={draftSaving} dirty={dirty} />
          )
        }
        textActions={
          !appLink && !readOnly ? (
            <Button
              size="sm"
              onClick={() => void commit()}
              disabled={(clipped ? !hasDraft : !dirty) || committing}
            >
              <GitCommitHorizontal /> Commit
            </Button>
          ) : null
        }
        access={
          <AccessSlot
            type="table"
            nodeId={initial.id}
            canShare={access.share}
            shares={initial}
            hint="Others and link holders always see the last committed version, never your draft."
          />
        }
        tools={[
          ...(!appLink && !readOnly && isAdminUser
            ? [
                {
                  key: 'import',
                  label: importing ? 'Importing…' : 'Import a spreadsheet (xlsx, xls, csv)',
                  icon: importing ? <Loader2 className="animate-spin" /> : <Upload />,
                  onSelect: () => fileRef.current?.click(),
                },
              ]
            : []),
          ...(dirty && !readOnly
            ? [
                {
                  key: 'discard',
                  label: 'Discard the draft',
                  icon: <Undo2 />,
                  onSelect: () => void discard(),
                },
              ]
            : []),
          ...(isAdminUser ? [download] : []),
        ]}
        onDelete={access.manage ? () => setConfirmDelete(true) : undefined}
        deleteDisabled={!access.manage}
        deleteLabel="Delete table"
        move={access.move ? { kind: 'tables', item: { id: initial.id, title } } : null}
        info={{ rows: readNote ? [{ label: 'Access', value: readNote }] : [] }}
        infoLabel="About this table"
      />

      {fileBacked && (
        <TabBar
          tabs={tabs ?? []}
          activeTab={activeTab}
          switching={tabSwitching}
          readOnly={!!appLink || readOnly}
          onSwitch={(id) => void switchTab(id)}
          onAdd={() => {
            // Seed a fresh sheet with a labeled first column + a few empty rows
            // (mirrors a brand-new table). An empty tab renders the "+" adrift
            // mid-grid with nowhere obvious to type — the named column anchors it.
            const tabId = uuid();
            void tabOp(
              [
                { op: 'tab_add', tabId, name: `Sheet${(tabs?.length ?? 0) + 1}` },
                { op: 'column_add', tabId, column: { name: 'Column 1', type: 'text' } },
                { op: 'row_add', tabId },
                { op: 'row_add', tabId },
                { op: 'row_add', tabId },
              ],
              tabId,
            );
          }}
          onRename={(id, name) => void tabOp({ op: 'tab_rename', tabId: id, name }, id)}
          onDelete={(id) =>
            void tabOp({ op: 'tab_delete', tabId: id }, (tabs ?? []).find((t) => t.id !== id)?.id)
          }
        />
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Lock the grid while Ledger is editing the draft so a stray edit can't
            race the specialist's server-side write (it lands in draft_data). */}
        <div
          className={
            'flex min-h-0 flex-1 flex-col overflow-hidden' +
            (assistBusy || tabSwitching ? ' pointer-events-none opacity-60' : '')
          }
        >
          {appLink && (
            <div className="border-b border-border bg-accent px-3 py-1.5 text-xs text-accent-foreground">
              Read-only — this table is exported from the app{' '}
              <Link
                href={`/apps/${appLink.appId}`}
                className="font-medium underline underline-offset-2"
              >
                {appLink.appName ?? 'app'}
              </Link>{' '}
              (table <span className="font-mono">{appLink.sqliteTable}</span>). Data is edited in
              the app and refreshes here automatically.
            </div>
          )}
          {clipped && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-accent px-3 py-1.5 text-xs text-accent-foreground">
              <span>
                Large table — showing {doc.rows.length.toLocaleString()} of{' '}
                {loadedTotal.toLocaleString()} rows
                {appLink
                  ? '.'
                  : ', read-only in the grid. Edit rows via the assistant, or query with SQL.'}
              </span>
              {doc.rows.length < loadedTotal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Load more rows
                </Button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            {/* The grid builds its columns from a schema the table carries, so
                a column type it cannot render is data, not a bug in the screen
                — and taking the toolbar and the tab strip down with it left no
                way to fix the table that caused it. */}
            <SurfaceErrorBoundary label="this table" resetKeys={[initial.id, activeTab]}>
              <TableGrid
                doc={doc}
                onChange={clipped || appLink || readOnly ? () => {} : setDoc}
                tableId={initial.id}
                tabs={tabs}
                activeTabId={activeTab}
                readOnly={!!appLink || readOnly}
              />
            </SurfaceErrorBoundary>
          </div>
        </div>
        {assistBusy && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm shadow-sm">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary-ink" aria-hidden />
            <span className="font-medium text-foreground">Ledger is editing this table…</span>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this table?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the table and its index entries. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void doDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The workbook tab bar (v2.1 P5): switch, add, rename (double-click or menu),
 *  delete. Every change lands on the DRAFT — Discard reverts, Commit
 *  publishes. `readOnly` (app-bound tables) keeps switching and drops the
 *  add/rename/delete affordances — tab structure belongs to the app. */
function TabBar({
  tabs,
  activeTab,
  switching,
  readOnly = false,
  onSwitch,
  onAdd,
  onRename,
  onDelete,
}: {
  tabs: { id: string; name: string; rows: number }[];
  activeTab: string | undefined;
  switching: boolean;
  readOnly?: boolean;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const finishRename = (id: string) => {
    const name = editName.trim();
    setEditing(null);
    const current = tabs.find((t) => t.id === id);
    if (name && current && name !== current.name) onRename(id, name);
  };
  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin border-b border-border bg-muted/30 px-2"
      role="tablist"
      aria-label="Workbook tabs"
    >
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <span key={t.id} className="group flex items-center">
            {editing === t.id ? (
              // The `xs` rung puts this at 32px against the 34px the tabs beside
              // it measure (`text-sm` on `py-1.5`, plus their 2px bottom border),
              // so the strip shifts by 2px on a rename where the old h-7 field
              // shifted it by 6. The raw field it replaces also suppressed its own
              // focus ring while being the only thing on screen that takes keys.
              <Input
                size="xs"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => finishRename(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="mx-1 w-28 focus-visible:ring-inset focus-visible:ring-offset-0"
                aria-label={`Rename tab ${t.name}`}
                autoFocus
              />
            ) : (
              <RowButton
                role="tab"
                aria-selected={active}
                disabled={switching}
                onClick={() => onSwitch(t.id)}
                onDoubleClick={
                  readOnly
                    ? undefined
                    : () => {
                        setEditing(t.id);
                        setEditName(t.name);
                      }
                }
                className={
                  'flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ' +
                  (active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground')
                }
                title={
                  readOnly
                    ? `${t.name} — ${t.rows.toLocaleString()} rows`
                    : `${t.name} — ${t.rows.toLocaleString()} rows (double-click to rename)`
                }
              >
                {t.name}
              </RowButton>
            )}
            {readOnly ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Tab options: ${t.name}`}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditing(t.id);
                      setEditName(t.name);
                    }}
                  >
                    <Pencil className="mr-2 size-3.5" /> Rename tab
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive-ink focus:text-destructive-ink"
                    disabled={tabs.length <= 1}
                    onClick={() => onDelete(t.id)}
                  >
                    <Trash2 className="mr-2 size-3.5" /> Delete tab
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        );
      })}
      {!readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={onAdd}
          disabled={switching}
          aria-label="Add tab"
        >
          <Plus className="size-4" />
        </Button>
      )}
    </div>
  );
}
