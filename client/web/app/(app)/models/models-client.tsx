'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Badge } from '@mantle/web-ui/ui/badge';
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
import {
  catalogFromResponse,
  catalogUrl,
  type CatalogResponse,
} from '@/app/(app)/settings/agents/use-model-catalog';
import { ModelsNav } from './models-nav';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import type { ExplorerModel, ModelSort } from '@mantle/client-types';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { JsonView } from '@mantle/web-ui/ui/json-view';
import { play } from '@/lib/sounds/play';

export type ProviderMeta = {
  id: string;
  label: string;
  description: string;
  signupUrl: string;
  docsUrl: string;
  isAggregator: boolean;
  canFetch: boolean;
};

type Meta = { needsKey: boolean; unsupported: boolean; error: string | null; fetchedAt: number };

const SORTS: { value: ModelSort; label: string }[] = [
  { value: 'name', label: 'Name (A→Z)' },
  { value: 'context', label: 'Context (high→low)' },
  { value: 'input', label: 'Input $ (low→high)' },
  { value: 'output', label: 'Output $ (low→high)' },
  { value: 'created', label: 'Newest' },
];

// ── formatters ───────────────────────────────────────────────────────────────

function fmtTokens(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
function fmtPrice(perM?: number): string {
  if (perM === undefined) return '—';
  if (perM === 0) return 'Free';
  if (perM < 0.01) return `$${perM.toFixed(4)}`;
  if (perM < 1) return `$${perM.toFixed(3)}`;
  return `$${perM.toFixed(2)}`;
}
function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// ── component ────────────────────────────────────────────────────────────────

type ExploreBundle = {
  providers: ProviderMeta[];
  provider: string;
  meta: Meta;
  rows: ExplorerModel[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  sort: ModelSort;
  kind: string;
  kinds: string[];
};

/** Outer query-gate so the page stays data-free. The URL params (kept by
 *  `useListNav`) key the query, so navigating refetches. */
export function ModelsClient({
  provider,
  q,
  sort,
  kind,
  page,
}: {
  provider: string;
  q: string;
  sort: string;
  kind: string;
  page: number;
}) {
  const exploreQuery = useQuery({
    queryKey: ['models', { provider, q, sort, kind, page }],
    queryFn: () => {
      const params = new URLSearchParams({ provider, sort, kind, page: String(page) });
      if (q) params.set('q', q);
      return apiFetch<ExploreBundle>(`/api/models/explore?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });

  if (exploreQuery.isPending && !exploreQuery.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (exploreQuery.isError && !exploreQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Couldn&apos;t load the model explorer.</p>
        <Button variant="outline" size="sm" onClick={() => exploreQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return <ModelsView data={exploreQuery.data} />;
}

function ModelsView({ data }: { data: ExploreBundle }) {
  const { providers, provider, meta, rows, total, page, pageSize, q, sort, kind, kinds } = data;
  const { pending: navPending, go } = useListNav();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState(q);
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [refreshing, setRefreshing] = useState(false);

  // Re-select the first row whenever the SSR result changes (provider switch,
  // search, sort, page). Keeps the detail pane in sync with the visible page.
  useEffect(() => {
    setSelectedId((prev) =>
      prev && rows.some((r) => r.id === prev) ? prev : (rows[0]?.id ?? null),
    );
  }, [rows]);

  // Keep the search box in sync if the URL q changes from elsewhere (provider
  // switch clears it, back/forward restores it) — but NEVER while the user is
  // typing in it. Each debounced commit round-trips through the router, and its
  // echo lands after further keystrokes: syncing unconditionally rewound
  // "chatg" to the in-flight "cha" unless you typed slower than the server.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setSearchInput(q);
  }, [q]);

  // Debounced URL-driven search (no client-side filtering of the loaded list).
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() !== q) go({ q: searchInput.trim() || null, page: null });
    }, 350);
    return () => clearTimeout(h);
  }, [searchInput, q, go]);

  const current = providers.find((p) => p.id === provider);
  const selected = rows.find((m) => m.id === selectedId) ?? null;
  const busy = navPending || refreshing;

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Bust the 5-min server cache, then refetch the explore bundle against it.
      const data = await apiFetch<CatalogResponse>(`${catalogUrl(provider)}&refresh=1`);
      // An empty list says why (no key saved, the key refused, no list API)
      // rather than "Loaded 0 models".
      const n = data.models?.length ?? 0;
      const why = catalogFromResponse(data).error;
      if (n === 0 && why) toast.error(why);
      else toast.success(`Loaded ${n} model${n === 1 ? '' : 's'}`);
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Refresh failed — network error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <MasterDetail
      id="models"
      list={
        <>
          {/* LEFT: screen switcher + provider picker + model list */}
          <div className="border-b border-border p-3">
            <ModelsNav />
          </div>
          <div className="flex items-center gap-2 border-b border-border p-3">
            <Select
              value={provider}
              onValueChange={(id) =>
                id !== provider && go({ provider: id, q: null, sort: null, kind: null, page: null })
              }
            >
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {!p.canFetch && ' (no catalog)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* §5: `icon-sm` IS size-9 — the hand-written size was the violation,
              not the dimension. */}
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              onClick={refresh}
              disabled={busy}
              aria-label="Refresh model list"
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              asChild
              aria-label="Curated pools"
            >
              <Link href="/models/pools" title="Curated pools">
                <Boxes />
              </Link>
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search models…"
                className="h-9 pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={sort}
                onValueChange={(v) => go({ sort: v === 'name' ? null : v, page: null })}
              >
                <SelectTrigger size="xs" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kinds.length > 1 && (
                <Select
                  value={kind}
                  onValueChange={(v) => go({ kind: v === 'all' ? null : v, page: null })}
                >
                  <SelectTrigger size="xs" className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {kinds.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {busy
                ? 'Loading…'
                : `${total} model${total === 1 ? '' : 's'} · updated ${timeAgo(meta.fetchedAt)}`}
            </p>
          </div>

          <div className="space-y-1.5 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
            {rows.length === 0 ? (
              <EmptyList meta={meta} provider={current} filtered={Boolean(q) || kind !== 'all'} />
            ) : (
              rows.map((m) => (
                <ListCard
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  selected={selectedId === m.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <ListCardTitle>{m.name ?? m.id}</ListCardTitle>
                    {m.kind && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {m.kind}
                      </Badge>
                    )}
                  </div>
                  {m.name && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{m.id}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                    <span>ctx {fmtTokens(m.contextTokens)}</span>
                    {(m.inputPricePerM !== undefined || m.outputPricePerM !== undefined) && (
                      <span>
                        in {fmtPrice(m.inputPricePerM)} · out {fmtPrice(m.outputPricePerM)} /M
                      </span>
                    )}
                  </div>
                </ListCard>
              ))
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
      }
      // 360px was this screen's own width; the list is a dense catalogue with a
      // provider picker above it, so it keeps the wider default rather than
      // being squeezed to 340px for uniformity's sake.
      defaultListSize="360px"
      detail={
        selected ? (
          <ModelDetail model={selected} provider={current} />
        ) : (
          <ProviderSplash meta={meta} provider={current} />
        )
      }
    />
  );
}

// ── left-list empty/error/needs-key states ───────────────────────────────────

function EmptyList({
  meta,
  provider,
  filtered,
}: {
  meta: Meta;
  provider?: ProviderMeta;
  filtered: boolean;
}) {
  const box =
    'rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground';
  if (meta.needsKey)
    return <p className={box}>No API key for {provider?.label}. Add one to browse its models.</p>;
  if (meta.unsupported)
    return <p className={box}>{provider?.label} doesn’t expose a model catalog here.</p>;
  if (meta.error) return <p className={box}>Couldn’t load models.</p>;
  if (filtered) return <p className={box}>No models match.</p>;
  return <p className={box}>No models returned.</p>;
}

// ── right-pane splash (no model selected) ─────────────────────────────────────

function ProviderSplash({ meta, provider }: { meta: Meta; provider?: ProviderMeta }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <Boxes className="size-8 text-muted-foreground" />
      {meta.needsKey ? (
        <>
          <p className="text-sm text-muted-foreground">
            No API key configured for <strong>{provider?.label}</strong>.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="sm">
              <a href="/settings/keys">
                <KeyRound /> Add API key
              </a>
            </Button>
            {provider && (
              <Button asChild size="sm" variant="outline">
                <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer">
                  Get a key <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </>
      ) : meta.unsupported ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          {provider?.label} is a voice/transcription provider — it doesn’t publish an LLM-style
          model catalog through this explorer.
        </p>
      ) : meta.error ? (
        <>
          <p className="text-sm font-medium">Couldn’t load models</p>
          <p className="max-w-md break-words font-mono text-xs text-muted-foreground">
            {meta.error}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a model to see everything its API reports.
        </p>
      )}
    </div>
  );
}

// ── right-pane model detail ──────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function ModelDetail({ model, provider }: { model: ExplorerModel; provider?: ProviderMeta }) {
  const toast = useToast();
  const [poolDialog, setPoolDialog] = useState(false);

  const copy = async (text: string, what: string) => {
    try {
      await copyText(text);
      toast.success(`Copied ${what}`);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{model.name ?? model.id}</h2>
          <RowButton
            onClick={() => copy(model.id, 'model id')}
            className="group mt-0.5 flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
            title="Copy model id"
          >
            <span className="truncate">{model.id}</span>
            <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </RowButton>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {model.kind && <Badge variant="secondary">{model.kind}</Badge>}
          {provider?.isAggregator && <Badge variant="outline">aggregator</Badge>}
          <Button type="button" size="sm" variant="outline" onClick={() => setPoolDialog(true)}>
            <Plus /> Add to pool
          </Button>
        </div>
      </div>
      {poolDialog && (
        <AddToPoolDialog model={model} provider={provider} onClose={() => setPoolDialog(false)} />
      )}

      {model.description && <p className="text-sm text-muted-foreground">{model.description}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Context" value={fmtTokens(model.contextTokens)} />
        <Fact label="Max output" value={fmtTokens(model.maxOutputTokens)} />
        <Fact label="Modality" value={model.modality ?? '—'} />
        <Fact label="Input / 1M" value={fmtPrice(model.inputPricePerM)} />
        <Fact label="Output / 1M" value={fmtPrice(model.outputPricePerM)} />
        <Fact
          label="Released"
          value={model.created ? new Date(model.created).toLocaleDateString() : '—'}
        />
      </div>

      {model.extraPricing && model.extraPricing.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Other pricing
          </h3>
          <div className="flex flex-wrap gap-2">
            {model.extraPricing.map((p) => (
              <Badge key={p.label} variant="outline" className="font-mono text-[11px]">
                {p.label}: {p.value}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Raw API response
        </h3>
        <JsonView value={model.raw} maxHeight={480} />
      </div>
    </div>
  );
}

// ── add-to-pool dialog (the curator's entry point) ───────────────────────────

type PoolDef = { id: string; label: string; description: string; group: 'agents' | 'workers' };

function AddToPoolDialog({
  model,
  provider,
  onClose,
}: {
  model: ExplorerModel;
  provider?: ProviderMeta;
  onClose: () => void;
}) {
  const toast = useToast();
  const poolsQuery = useQuery({
    queryKey: ['model-pools'],
    queryFn: () => apiFetch<{ pools: PoolDef[] }>('/api/model-pools'),
  });
  const pools = poolsQuery.data?.pools ?? [];
  const [poolId, setPoolId] = useState('agents');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const pool = pools.find((p) => p.id === poolId);

  // 'anthropic/claude-sonnet-5' on an aggregator → vendor 'anthropic'; direct
  // providers vend their own models.
  const vendor = provider?.isAggregator
    ? (model.id.split('/')[0] ?? provider.id)
    : (provider?.label ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    setSaving(true);
    try {
      await apiSend('/api/model-pools', 'POST', {
        pool: poolId,
        name: model.name ?? model.id,
        vendor: vendor || undefined,
        routes: [{ provider: provider.id, model: model.id }],
        ...(model.inputPricePerM != null || model.outputPricePerM != null
          ? {
              pricing: {
                inputPerM: model.inputPricePerM ?? null,
                outputPerM: model.outputPricePerM ?? null,
                currency: 'USD',
                capturedAt: new Date().toISOString(),
                source: provider.id,
              },
            }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      play('success');
      toast.success(`Added to ${pool?.label ?? poolId} — see /models/pools`);
      onClose();
    } catch (err) {
      play('danger');
      toast.error(err instanceof Error ? err.message : 'Add failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add “{model.name ?? model.id}” to a pool</DialogTitle>
          <DialogDescription>
            Copies the current pricing snapshot in, so the cost comparison works even on brains
            connected directly to a provider.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="add-pool">Pool</FieldLabel>
              <Select value={poolId} onValueChange={setPoolId}>
                <SelectTrigger id="add-pool">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pool && <p className="text-xs text-muted-foreground">{pool.description}</p>}
              {!poolsQuery.isPending && pools.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Couldn’t load the pool list — this needs a brain running v0.232.42+.
                </p>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="add-note">Note</FieldLabel>
              <Input
                id="add-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. flagship / gets the job done"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={saving}>Add to pool</SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
