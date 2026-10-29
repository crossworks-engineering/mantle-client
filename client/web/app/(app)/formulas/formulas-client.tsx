'use client';

import { useItemAddress } from '@/components/layout/use-item-address';
import { useZenMode } from '@/components/layout/zen-mode';
import { shareMarksOf } from '@/components/share/access-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceChips } from '@/components/share/workspace-chips';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import YAML from 'yaml';
import { Plus, Search, Sigma, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { FormulaEditor, type Draft } from './formula-editor';
import { FORMULA_TEMPLATES } from './formula-templates';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { useListNav } from '@/lib/use-list-nav';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import type { CoverageGap } from '@mantle/content-core/formula-spec';
import type { DimensionIssue } from '@mantle/content-core/formula-dimensions';
import type { TargetSignature } from '@mantle/content-core/formula-signature';
import { useSurfaceAssist } from '@/components/assistant/use-surface-assist';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { formulasAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { FormulaDetail, type FormulaRow } from './formula-detail';
import { play } from '@/lib/sounds/play';

type ListResponse = {
  formulas: FormulaRow[];
  total: number;
  page: number;
  pageSize: number;
  standards: string[];
};

type DetailResponse = {
  formula: FormulaRow;
  coverageGaps: CoverageGap[];
  dimensionIssues: DimensionIssue[];
  signature: TargetSignature[];
  specErrors?: string[];
};

/** Radix Select has no empty-string value, so "no filter" needs a sentinel. */
const ANY = '__any__';

/** Which editor is open, if any. `new` carries the chosen template's spec,
 *  and `in` the tree folder it goes in ("New formula inside"). */
/** A new formula's editor; an existing one edits at its address (`?edit=1`). */
type EditorState = { mode: 'new'; spec: Draft; in: TreeFolder | null } | null;

export function FormulasClient() {
  const searchParams = useSearchParams();
  const { pending, go } = useListNav();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editor, setEditor] = useState<EditorState>(null);
  const [picking, setPicking] = useState(false);
  const [pickIn, setPickIn] = useState<TreeFolder | null>(null);
  const { fileNew, confirm: fileConfirm } = useFileNewItem('formulas', 'formula');
  const startNew = (folder: TreeFolder | null = null) => {
    setPickIn(folder);
    setPicking(true);
  };
  const [seeding, setSeeding] = useState(false);

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const query = searchParams.get('q')?.trim() ?? '';
  const standard = searchParams.get('standard')?.trim() ?? '';
  const tag = searchParams.get('tag')?.trim() ?? '';
  // The formula in the address (`/formulas/<id>`, `?edit=1` to edit); an old
  // `?id=` link moves there.
  const address = useItemAddress('formulas', 'id');
  const urlId = address.id;

  // The item tree when this brain serves it for formulas (docs/folder-tree.md);
  // the paged list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('formulas');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;
  const [treeQuery, setTreeQuery] = useTreeSearch();

  // Selection lives in client state, NOT read back off the URL. `select` mirrors
  // it to the address bar with history.replaceState, which deliberately performs
  // no navigation — so `useSearchParams` would never observe the change and the
  // list would not respond to a click. The URL param is therefore an entry point
  // (deep link, back/forward) rather than the source of truth.
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  // The tree row a formula was opened from: its share marks, for Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);
  const { zen } = useZenMode();
  useEffect(() => {
    if (urlId) setSelectedId(urlId);
  }, [urlId]);

  const [searchInput, setSearchInput] = useState(query);
  // Sync from the URL only while the user is NOT typing — the debounced
  // commit's router echo lands after further keystrokes and would rewind the
  // input to the in-flight value (same fix as /models).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setSearchInput(query);
  }, [query]);

  // Debounce the search box into the URL, which stays the source of truth.
  useEffect(() => {
    if (searchInput === query) return;
    const t = setTimeout(() => go({ q: searchInput || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [searchInput, query, go]);

  const listQuery = useQuery({
    queryKey: ['formulas', { q: query, standard, tag, page }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (standard) qs.set('standard', standard);
      if (tag) qs.set('tag', tag);
      if (page > 1) qs.set('page', String(page));
      const suffix = qs.toString();
      return apiFetch<ListResponse>(`/api/formulas${suffix ? `?${suffix}` : ''}`);
    },
    enabled: !showTree,
  });

  const formulas = useMemo(
    () => (showTree ? [] : (listQuery.data?.formulas ?? [])),
    [showTree, listQuery.data],
  );
  const standards = useMemo(
    () => (showTree ? [] : (listQuery.data?.standards ?? [])),
    [showTree, listQuery.data],
  );

  // Auto-select the first row, matching every other master-detail screen.
  const activeId = selectedId ?? formulas[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['formula', activeId],
    queryFn: () => apiFetch<DetailResponse>(`/api/formulas/${activeId}`),
    enabled: Boolean(activeId),
  });

  // Pin the open formula. The label comes from the list row when it's in the
  // current slice and from the detail fetch otherwise, so a deep link doesn't
  // sit as a bare uuid in the chip while the row loads.
  const activeTitle =
    formulas.find((f) => f.id === activeId)?.title ?? detailQuery.data?.formula.title;
  useSurfaceAssist({
    node: activeId
      ? { id: activeId, kind: 'formula', label: activeTitle || 'Untitled formula' }
      : null,
  });

  function select(id: string) {
    setSelectedId(id);
    if (id !== address.id || address.editing) address.open(id);
  }

  function openTemplate(yaml: string) {
    // The templates are YAML because that is how a spec is authored; parse once
    // here so the editor only ever deals in the draft object.
    let spec: Draft = {};
    try {
      const parsed = YAML.parse(yaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) spec = parsed as Draft;
    } catch {
      spec = {};
    }
    setPicking(false);
    setEditor({ mode: 'new', spec, in: pickIn });
  }

  async function addSeedSet() {
    setSeeding(true);
    try {
      const res = await apiSend<{ created: string[] }>('/api/formulas/seed', 'POST');
      await queryClient.invalidateQueries({ queryKey: ['formulas'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('formulas') });
      play('success');
      toast.success(
        res.created.length > 0
          ? `Added ${res.created.length} example formula${res.created.length === 1 ? '' : 's'}`
          : 'The examples are already here',
      );
    } catch (err) {
      play('danger');
      toast.error(err instanceof Error ? err.message : 'Could not add the examples');
    } finally {
      setSeeding(false);
    }
  }

  async function afterSave(id: string, folder: TreeFolder | null = null) {
    setEditor(null);
    if (folder) await fileNew(id, folder);
    await queryClient.invalidateQueries({ queryKey: ['formulas'] });
    await queryClient.invalidateQueries({ queryKey: ['formula'] });
    void queryClient.invalidateQueries({ queryKey: treeKey('formulas') });
    select(id);
  }

  if (!showTree && listQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!showTree && listQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Could not load formulas.</p>
        <Button variant="outline" onClick={() => void listQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const newButton = (
    <Button size="sm" onClick={() => startNew()}>
      <Plus />
      New
    </Button>
  );

  return (
    <>
      {/* Outside the panes on purpose: Radix portals the content to the body,
          so nesting the root in a resizable panel buys nothing and only makes
          the list markup harder to read. */}
      {fileConfirm}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{pickIn ? `New formula in “${pickIn.name}”` : 'New formula'}</DialogTitle>
            <DialogDescription>
              Start from a template. The annotated example carries teaching comments on every field
              — worth reading once even if you delete it after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {FORMULA_TEMPLATES.map((t) => (
              <RowButton
                key={t.key}
                onClick={() => openTemplate(t.yaml)}
                className="block w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="text-sm font-medium text-foreground">{t.name}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.blurb}</p>
              </RowButton>
            ))}
          </div>
          {/* Also reachable here, not only in the empty state — a brain with
              even one formula never shows the empty state again, which made
              the seed set undiscoverable exactly when someone wants worked
              examples beside their own work. Idempotent server-side. */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Or add the 5 worked examples — gas density, Reynolds, head loss, orifice flow, pump
              power.
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={seeding}
              onClick={async () => {
                await addSeedSet();
                setPicking(false);
              }}
            >
              {seeding ? <Spinner /> : null}
              Add examples
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* `models` and `runs` keep 360px rather than being squeezed to the
          340px default; formulas does too. The list rows carry a title, the
          citing standard and a row of tag pills, and at 340px the standard
          truncates on most of the seeded examples. */}
      <MasterDetail
        id="formulas"
        defaultListSize="360px"
        listCollapsed={zen}
        list={
          showTree ? (
            // No private formulas, and delete lives in the detail pane: the
            // tree's own item menu is all a row needs.
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="formulas"
                adapter={formulasAdapter}
                selectedItemId={activeId}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search formulas and folders…"
                actions={newButton}
                newItemInFolder={{ label: 'formula', onCreate: (f) => startNew(f) }}
                onOpenItem={(item) => {
                  setOpenedRow(item);
                  select(item.id);
                }}
                onUnsupported={() => setTreeGone(true)}
              />
            </aside>
          ) : (
            <>
              {/* ── Left: list ───────────────────────────────────────── */}
              <div className="space-y-2 border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchRef}
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search formulas…"
                      className="pl-8"
                    />
                  </div>
                  {newButton}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={standard || ANY}
                    onValueChange={(v) => go({ standard: v === ANY ? null : v, page: null })}
                  >
                    <SelectTrigger size="sm" className="flex-1 text-xs">
                      <SelectValue placeholder="Any standard" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any standard</SelectItem>
                      {standards.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {tag ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => go({ tag: null, page: null })}
                      title="Clear the tag filter"
                    >
                      <X />
                      {tag}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin p-3">
                {formulas.length === 0 && (query || standard || tag) ? (
                  // A FILTERED nothing is not an empty collection — "no formulas
                  // yet" plus a seed button here would be a lie with a call to action.
                  <div className="space-y-3 px-1 py-8 text-center">
                    <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => go({ q: null, standard: null, tag: null, page: null })}
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : formulas.length === 0 ? (
                  <div className="space-y-3 px-1 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No formulas yet. Write one from a standard, or ask the assistant to transcribe
                      one.
                    </p>
                    <div className="flex flex-col items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => startNew()}>
                        <Plus />
                        New formula
                      </Button>
                      <Button variant="ghost" size="sm" disabled={seeding} onClick={addSeedSet}>
                        {seeding ? <Spinner /> : null}
                        Add 5 example formulas
                      </Button>
                      <p className="max-w-[260px] text-xs text-muted-foreground">
                        Widely-known models — gas density, Reynolds number, head loss, orifice flow,
                        pump power — that show how each part of the format is written. Delete them
                        any time.
                      </p>
                    </div>
                  </div>
                ) : (
                  formulas.map((f) => (
                    // The tags are filter buttons, so they sit OUTSIDE the row button
                    // rather than inside it — a button nested in a button is invalid
                    // and swallows the inner click in some browsers.
                    <ListCard key={f.id} asChild selected={activeId === f.id} className="p-0">
                      <div>
                        <RowButton
                          onClick={() => select(f.id)}
                          data-mark-id={f.id}
                          data-mark-kind="formula"
                          data-mark-label={f.title}
                          className="block w-full rounded-lg p-2.5 text-left"
                        >
                          <div className="flex items-start gap-2">
                            <Sigma className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <ListCardTitle className="min-w-0">{f.title}</ListCardTitle>
                                <WorkspaceChips item={f} />
                              </div>
                              {f.spec?.source?.standard ? (
                                <ListCardMeta>{f.spec.source.standard}</ListCardMeta>
                              ) : null}
                            </div>
                          </div>
                        </RowButton>
                        {f.tags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2.5 pl-[34px]">
                            {f.tags.map((t) => (
                              <RowButton
                                key={t}
                                onClick={() => go({ tag: t === tag ? null : t, page: null })}
                                title={t === tag ? `Clear the ${t} filter` : `Show only ${t}`}
                              >
                                <TagPill
                                  tag={t}
                                  className={cn(
                                    'transition-opacity hover:opacity-80',
                                    t === tag && 'ring-1 ring-primary',
                                  )}
                                />
                              </RowButton>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </ListCard>
                  ))
                )}
              </div>

              <ListPager
                page={page}
                total={listQuery.data?.total ?? 0}
                pageSize={listQuery.data?.pageSize ?? 50}
                pending={pending}
                onGo={(p) => go({ page: p > 1 ? p : null })}
              />
            </>
          )
        }
        detail={
          /* ── Right: detail ────────────────────────────────────── */
          // The editor sits in the detail pane too, the folders beside it
          // (phase 5): a new formula from its template, or the open one at
          // its edit address.
          editor?.mode === 'new' ? (
            <FormulaEditor
              initialSpec={editor.spec}
              initialTitle=""
              initialTags={[]}
              onSaved={(id) => afterSave(id, editor.in)}
              onCancel={() => setEditor(null)}
            />
          ) : address.editing && detailQuery.data ? (
            <FormulaEditor
              key={detailQuery.data.formula.id}
              formulaId={detailQuery.data.formula.id}
              initialSpec={detailQuery.data.formula.spec as unknown as Draft}
              initialTitle={detailQuery.data.formula.title}
              initialTags={detailQuery.data.formula.tags}
              onSaved={(id) => afterSave(id)}
              onCancel={() => address.open(detailQuery.data!.formula.id)}
            />
          ) : detailQuery.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : detailQuery.data ? (
            <FormulaDetail
              // Remount per formula: the detail pane holds evaluator state
              // (chosen target, typed inputs, last result). Without this, switching
              // formulas would keep the previous one's inputs and show its result
              // under the new title — and the target id would name a target the
              // new spec may not even have.
              key={detailQuery.data.formula.id}
              formula={detailQuery.data.formula}
              shares={shareMarksOf(detailQuery.data.formula, openedRow)}
              coverageGaps={detailQuery.data.coverageGaps}
              dimensionIssues={detailQuery.data.dimensionIssues ?? []}
              signature={detailQuery.data.signature ?? []}
              specErrors={detailQuery.data.specErrors}
              onEdit={() => address.open(detailQuery.data!.formula.id, true)}
              onDeleted={async () => {
                setSelectedId(null);
                address.close();
                void queryClient.invalidateQueries({ queryKey: treeKey('formulas') });
                await queryClient.invalidateQueries({ queryKey: ['formulas'] });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a formula.</p>
            </div>
          )
        }
      />
    </>
  );
}
