'use client';

import { useEffect, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Search } from 'lucide-react';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { FormShell } from '@mantle/web-ui/ui/form-shell';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { ListPager } from '@mantle/web-ui/layout/list-pager';
import { useListNav } from '@/lib/use-list-nav';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTags, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { TagPill } from '@mantle/web-ui/tag-pill';
import { SecretForm, emptySecretForm, KINDS, type SecretBody } from './secret-form';
import { SecretDetail, type SecretRow } from './secret-detail';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { secretsAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { useFileNewItem } from '@/components/item-tree/use-file-new-item';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import { play } from '@/lib/sounds/play';

/** `in`: "New secret inside" a tree folder, where it goes once saved. */
type Selection = { mode: 'create'; in?: TreeFolder } | { mode: 'view'; id: string } | null;

type SecretsPage = { secrets: SecretRow[]; total: number; page: number; pageSize: number };

/** What the view gets while the tree shows (the list is not fetched then).
 *  Module-level so its `secrets` keeps one identity for the re-seed effect. */
const NO_PAGE: SecretsPage = { secrets: [], total: 0, page: 1, pageSize: 50 };

/** Outer query-gate so the page stays data-free. The URL params (kept by
 *  `useListNav`) key the query, so navigating refetches. */
export function SecretsClient({
  page,
  query,
  kind,
}: {
  page: number;
  query: string;
  kind: string;
}) {
  // The item tree when this brain serves it for secrets (docs/folder-tree.md);
  // the paged card list for a brain before it, or if a tree call 404s.
  const treeServes = useTreeServes('secrets');
  const [treeGone, setTreeGone] = useState(false);
  const showTree = treeServes === true && !treeGone;

  const secretsQuery = useQuery({
    queryKey: ['secrets', { query, kind, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set('q', query);
      if (kind && kind !== 'all') params.set('kind', kind);
      return apiFetch<SecretsPage>(`/api/secrets?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
    enabled: !showTree,
  });

  if (!showTree && secretsQuery.isPending && !secretsQuery.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!showTree && secretsQuery.isError && !secretsQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Couldn&apos;t load secrets.</p>
        <Button variant="outline" size="sm" onClick={() => secretsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <SecretsView
      data={showTree || !secretsQuery.data ? NO_PAGE : secretsQuery.data}
      query={query}
      kind={kind}
      showTree={showTree}
      onTreeGone={() => setTreeGone(true)}
    />
  );
}

function SecretsView({
  data,
  query,
  kind,
  showTree,
  onTreeGone,
}: {
  data: SecretsPage;
  query: string;
  kind: string;
  showTree: boolean;
  onTreeGone: () => void;
}) {
  const { secrets: initialSecrets, total, page, pageSize } = data;
  const { pending: navPending, go } = useListNav();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [secrets, setSecrets] = useState(initialSecrets);
  const [searchInput, setSearchInput] = useState(query);
  const [pending, startTransition] = useTransition();
  const [treeQuery, setTreeQuery] = useTreeSearch();
  // The tree has no rows to default to, so it opens on the empty pane rather
  // than the create form.
  const [sel, setSel] = useState<Selection>(() =>
    initialSecrets[0]
      ? { mode: 'view', id: initialSecrets[0].id }
      : showTree
        ? null
        : { mode: 'create' },
  );
  const { fileNew, confirm: fileConfirm } = useFileNewItem('secrets', 'secret');
  /** Where selection lands when the open secret goes away. */
  const fallbackSel = (rows: SecretRow[]): Selection =>
    showTree ? null : rows[0] ? { mode: 'view', id: rows[0].id } : { mode: 'create' };

  const refresh = () => {
    startTransition(() => {
      void queryClient.invalidateQueries({ queryKey: ['secrets'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('secrets') });
    });
  };

  // Re-seed on nav (search / filter / page) when the fetched page changes.
  useEffect(() => setSecrets(initialSecrets), [initialSecrets]);

  // Debounced search → URL (?q=); resets to page 1.
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() !== query) go({ q: searchInput.trim() || null, page: null });
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const filtering = !!query || kind !== 'all';
  // A secret outside the loaded rows (every one opened from the tree) is
  // fetched on its own; same key and shape as the /secrets/[id] deep link.
  const viewId = sel?.mode === 'view' ? sel.id : null;
  const selectedSecretQuery = useQuery({
    queryKey: ['secrets', viewId],
    queryFn: () => apiFetch<{ secret: SecretRow }>(`/api/secrets/${viewId}`),
    enabled: !!viewId && !secrets.some((s) => s.id === viewId),
  });
  const selected = viewId
    ? (secrets.find((s) => s.id === viewId) ??
      (selectedSecretQuery.data?.secret.id === viewId ? selectedSecretQuery.data.secret : null))
    : null;

  const createSecret = async (body: SecretBody) => {
    const fileIn = sel?.mode === 'create' ? sel.in : undefined;
    let secret: SecretRow;
    try {
      ({ secret } = await apiSend<{ secret: SecretRow }>('/api/secrets', 'POST', body));
    } catch (err) {
      play('danger');
      toast.error(err instanceof ApiError ? err.message : 'Could not save secret');
      return;
    }
    setSecrets((prev) => [secret, ...prev]);
    setSel({ mode: 'view', id: secret.id });
    if (fileIn) void fileNew(secret.id, fileIn);
    play('success');
    toast.success(`Saved “${secret.title}”`);
    refresh();
  };

  const onUpdated = (s: SecretRow) => {
    setSecrets((prev) => prev.map((x) => (x.id === s.id ? s : x)));
    queryClient.setQueryData(['secrets', s.id], { secret: s });
    void queryClient.invalidateQueries({ queryKey: treeKey('secrets') });
  };

  const onDeleted = (id: string) => {
    setSecrets((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setSel(fallbackSel(next));
      return next;
    });
    refresh();
  };

  // ONE detail pane for all three states, as /tasks does it.
  const detailPane =
    sel?.mode === 'create' ? (
      <div className="p-6">
        {/* §6c: boxed, left-aligned card, width from the divider. */}
        <FormShell>
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary-ink" aria-hidden />
            <h2 className="text-lg font-semibold">
              {sel.in ? `New secret in “${sel.in.name}”` : 'New secret'}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored sealed (AES-256-GCM). Only the title, description, and tags are indexed.
          </p>
          <SecretForm
            initial={emptySecretForm()}
            submitLabel="Save secret"
            submitting={pending}
            onSubmit={createSecret}
            onCancel={() => setSel(fallbackSel(secrets))}
          />
        </FormShell>
      </div>
    ) : selected ? (
      <SecretDetail
        key={selected.id}
        secret={selected}
        onUpdated={onUpdated}
        onDeleted={() => onDeleted(selected.id)}
      />
    ) : (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        Select a secret, or add a new one.
      </div>
    );

  return (
    <MasterDetail
      id="secrets"
      list={
        showTree ? (
          <aside className="flex h-full flex-col bg-muted/20">
            {fileConfirm}
            <ItemTree
              kind="secrets"
              adapter={secretsAdapter}
              selectedItemId={viewId}
              query={treeQuery}
              onQueryChange={setTreeQuery}
              searchPlaceholder="Search secrets and folders…"
              newItemInFolder={{
                label: 'secret',
                icon: KeyRound,
                onCreate: (f) => setSel({ mode: 'create', in: f }),
              }}
              actions={
                <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
                  <Plus /> New
                </Button>
              }
              onOpenItem={(item) => setSel({ mode: 'view', id: item.id })}
              onUnsupported={onTreeGone}
            />
          </aside>
        ) : (
          <>
            {/* ── Left: secret list ────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Secrets
              </h2>
              <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
                <Plus /> New
              </Button>
            </div>
            <div className="flex items-center gap-2 border-b border-border p-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search…"
                  className="h-9 pl-8"
                />
              </div>
              {/* Was a raw `<select>` — no focus ring, native chevron (§6d). */}
              <Select
                value={kind}
                onValueChange={(v) => go({ kind: v === 'all' ? null : v, page: null })}
              >
                <SelectTrigger size="sm" className="w-28" aria-label="Filter by kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {secrets.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  {filtering ? (
                    'No secrets match your search or filter.'
                  ) : (
                    <>
                      No secrets yet. Click <strong>New</strong> to add one.
                    </>
                  )}
                </p>
              ) : (
                secrets.map((s) => {
                  const isSel = sel?.mode === 'view' && sel.id === s.id;
                  return (
                    <ListCard
                      key={s.id}
                      onClick={() => setSel({ mode: 'view', id: s.id })}
                      selected={isSel}
                    >
                      <div className="flex items-center gap-2">
                        <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <ListCardTitle>{s.title}</ListCardTitle>
                        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {s.kind}
                        </span>
                      </div>
                      {(s.description || s.summary) && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {s.description || s.summary}
                        </p>
                      )}
                      {(s.fieldCount > 0 || s.hasNote) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          {s.fieldCount > 0 && (
                            <span>
                              {s.fieldCount} field{s.fieldCount === 1 ? '' : 's'}
                            </span>
                          )}
                          {s.hasNote && <span>· note</span>}
                        </div>
                      )}
                      {s.tags.length > 0 && (
                        <ListCardTags>
                          {s.tags.map((t) => (
                            <TagPill key={t} tag={t} />
                          ))}
                        </ListCardTags>
                      )}
                    </ListCard>
                  );
                })
              )}
            </div>
            <ListPager
              page={page}
              total={total}
              pageSize={pageSize}
              pending={navPending}
              onGo={(p) => go({ page: p > 1 ? p : null })}
            />
          </>
        )
      }
      detail={detailPane}
    />
  );
}
