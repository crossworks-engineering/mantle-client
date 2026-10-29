'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Input } from '@mantle/web-ui/ui/input';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { Field, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { cn } from '@mantle/web-ui/lib/utils';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { comparisonRows, fmtMTokens, fmtPerM, type PoolDef, type PoolEntry } from './pools-math';
import { ModelsNav } from '../models-nav';
import { RecurateDialog } from './recurate-dialog';
import { play } from '@/lib/sounds/play';

type Bundle = { pools: PoolDef[]; entries: PoolEntry[] };

export function PoolsClient({ initialPool }: { initialPool: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['model-pools'],
    queryFn: () => apiFetch<Bundle>('/api/model-pools'),
  });
  const [poolId, setPoolId] = useState(initialPool);
  const [editing, setEditing] = useState<PoolEntry | null>(null);
  const [deleting, setDeleting] = useState<PoolEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['model-pools'] });

  if (q.isPending) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!q.data) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Couldn’t load pools{q.error instanceof Error ? ` — ${q.error.message}` : ''}. This needs a
        brain running v0.232.42+.
      </p>
    );
  }
  const { pools, entries } = q.data;
  const pool = pools.find((p) => p.id === poolId) ?? pools[0];
  const poolEntries = entries
    .filter((e) => e.pool === pool?.id)
    .sort((a, b) => a.position - b.position);
  const rows = comparisonRows(poolEntries);

  async function move(entry: PoolEntry, dir: -1 | 1) {
    const idx = poolEntries.findIndex((e) => e.id === entry.id);
    const other = poolEntries[idx + dir];
    if (!other) return;
    try {
      await apiSend(`/api/model-pools/${entry.id}`, 'PATCH', { position: other.position });
      await apiSend(`/api/model-pools/${other.id}`, 'PATCH', { position: entry.position });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reorder failed.');
    }
    refresh();
  }

  async function setRating(entry: PoolEntry, rating: number) {
    try {
      await apiSend(`/api/model-pools/${entry.id}`, 'PATCH', {
        rating: entry.rating === rating ? null : rating,
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rating failed.');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await apiSend(`/api/model-pools/${target.id}`, 'DELETE');
      toast.success(`Removed ${target.name}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  async function exportPools() {
    try {
      const r = await apiFetch<{ ts: string }>('/api/model-pools/export');
      await copyText(r.ts);
      toast.success('Template module copied to clipboard');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.');
    }
  }

  const countFor = (id: string) => entries.filter((e) => e.pool === id).length;
  const groups: Array<{ title: string; items: PoolDef[] }> = [
    { title: 'Agents', items: pools.filter((p) => p.group === 'agents') },
    { title: 'Workers', items: pools.filter((p) => p.group === 'workers') },
  ];

  return (
    <>
      <MasterDetail
        id="model-pools"
        defaultListSize="300px"
        defaultDetailSize="900px"
        maxDetailSize="100%"
        list={
          <>
            <div className="border-b border-border p-3">
              <ModelsNav />
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {groups.map((g) => (
                <div key={g.title} className="space-y-2">
                  <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.title}
                  </p>
                  {g.items.map((p) => (
                    <ListCard
                      key={p.id}
                      onClick={() => setPoolId(p.id)}
                      selected={p.id === pool?.id}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <ListCardTitle>{p.label}</ListCardTitle>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {countFor(p.id)}
                        </span>
                      </div>
                    </ListCard>
                  ))}
                </div>
              ))}
            </div>
          </>
        }
        detail={
          pool ? (
            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{pool.label}</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{pool.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <Plus /> Add manually
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={exportPools}>
                    <Copy /> Export template
                  </Button>
                  <RecurateDialog onApplied={refresh} />
                </div>
              </div>

              {poolEntries.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing curated yet. Browse{' '}
                  <Link href="/models" className="underline">
                    the explorer
                  </Link>
                  , open a model, and click <strong>Add to pool</strong> — its pricing is copied in.
                </p>
              ) : (
                <div className="overflow-x-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Routes</TableHead>
                        <TableHead className="text-right">In $/M</TableHead>
                        <TableHead className="text-right">Out $/M</TableHead>
                        <TableHead className="text-right">$100 buys*</TableHead>
                        <TableHead className="text-right">vs top</TableHead>
                        <TableHead>Rating</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={r.entry.id}>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.entry.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.entry.vendor ?? '—'}
                              {r.entry.note ? ` · ${r.entry.note}` : ''}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex max-w-56 flex-wrap gap-1">
                              {r.entry.routes.map((rt) => (
                                <Badge
                                  key={`${rt.provider}:${rt.model}`}
                                  variant="outline"
                                  className="max-w-full"
                                >
                                  <span className="truncate font-mono text-[11px]">
                                    {rt.provider}: {rt.model}
                                  </span>
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPerM(r.entry.pricing?.inputPerM ?? null)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPerM(r.entry.pricing?.outputPerM ?? null)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.blended == null
                              ? '—'
                              : r.blended === 0
                                ? 'unlimited'
                                : fmtMTokens(100 / r.blended)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.multiplier == null
                              ? '—'
                              : r.multiplier === Infinity
                                ? 'free'
                                : r.multiplier <= 1.001
                                  ? 'anchor'
                                  : `${r.multiplier.toFixed(r.multiplier >= 10 ? 0 : 1)}× cheaper`}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <RowButton
                                  key={n}
                                  onClick={() => setRating(r.entry, n)}
                                  title={`Rate ${n}/5`}
                                >
                                  <Star
                                    className={cn(
                                      'size-3.5',
                                      (r.entry.rating ?? 0) >= n
                                        ? 'fill-warning-ink text-warning-ink'
                                        : 'text-muted-foreground/40',
                                    )}
                                  />
                                </RowButton>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={i === 0}
                                onClick={() => move(r.entry, -1)}
                                title="Move up"
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={i === rows.length - 1}
                                onClick={() => move(r.entry, 1)}
                                title="Move down"
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setEditing(r.entry)}
                                title="Edit"
                              >
                                <Pencil />
                              </Button>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => setDeleting(r.entry)}
                                title="Remove"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    * blended 75% input / 25% output tokens, from the pricing snapshot copied at
                    curation time. “vs top” compares against the priciest model in this pool.
                  </p>
                </div>
              )}
            </div>
          ) : null
        }
      />

      {(editing || adding) && pool && (
        <EntryDialog
          pool={pool}
          entry={editing}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
          onSaved={() => {
            setEditing(null);
            setAdding(false);
            refresh();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes it from the {pool?.label} pool only — nothing that currently uses this model
              changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── add/edit dialog ──────────────────────────────────────────────────────────

function EntryDialog({
  pool,
  entry,
  onClose,
  onSaved,
}: {
  pool: PoolDef;
  entry: PoolEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(entry?.name ?? '');
  const [vendor, setVendor] = useState(entry?.vendor ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [routes, setRoutes] = useState<{ provider: string; model: string }[]>(
    entry?.routes.length ? entry.routes : [{ provider: 'openrouter', model: '' }],
  );
  const [inPerM, setInPerM] = useState(entry?.pricing?.inputPerM?.toString() ?? '');
  const [outPerM, setOutPerM] = useState(entry?.pricing?.outputPerM?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanRoutes = routes
      .map((r) => ({ provider: r.provider.trim().toLowerCase(), model: r.model.trim() }))
      .filter((r) => r.provider && r.model);
    if (!name.trim() || cleanRoutes.length === 0) {
      toast.error('A name and at least one provider route are required.');
      return;
    }
    const inp = inPerM.trim() === '' ? null : Number(inPerM);
    const out = outPerM.trim() === '' ? null : Number(outPerM);
    const pricing =
      inp == null && out == null
        ? entry
          ? null
          : undefined
        : {
            inputPerM: Number.isFinite(inp as number) ? inp : null,
            outputPerM: Number.isFinite(out as number) ? out : null,
            currency: 'USD' as const,
            capturedAt: entry?.pricing?.capturedAt ?? new Date().toISOString(),
            source: entry?.pricing?.source ?? 'manual',
          };
    const body = {
      name: name.trim(),
      vendor: vendor.trim() || null,
      note: note.trim() || null,
      routes: cleanRoutes,
      ...(pricing !== undefined ? { pricing } : {}),
    };
    setSaving(true);
    try {
      if (entry) {
        await apiSend(`/api/model-pools/${entry.id}`, 'PATCH', body);
      } else {
        await apiSend('/api/model-pools', 'POST', {
          ...body,
          vendor: body.vendor ?? undefined,
          note: body.note ?? undefined,
          pricing: pricing ?? undefined,
          pool: pool.id,
        });
      }
      play('success');
      toast.success(entry ? 'Entry updated' : `Added to ${pool.label}`);
      onSaved();
    } catch (err) {
      play('danger');
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? `Edit ${entry.name}` : `Add to ${pool.label}`}</DialogTitle>
          <DialogDescription>
            A curated entry is the model, not one slug — add a route per provider it’s reachable
            through (OpenRouter and direct slugs differ).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pool-name">Name</FieldLabel>
                <Input
                  id="pool-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Claude Sonnet 5"
                  autoFocus={!entry}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pool-vendor">Vendor</FieldLabel>
                <Input
                  id="pool-vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. Anthropic"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Routes</FieldLabel>
              <div className="space-y-2">
                {routes.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={r.provider}
                      onChange={(e) =>
                        setRoutes((cur) =>
                          cur.map((c, j) => (j === i ? { ...c, provider: e.target.value } : c)),
                        )
                      }
                      placeholder="provider (openrouter, anthropic…)"
                      className="w-44 font-mono text-xs"
                    />
                    <Input
                      value={r.model}
                      onChange={(e) =>
                        setRoutes((cur) =>
                          cur.map((c, j) => (j === i ? { ...c, model: e.target.value } : c)),
                        )
                      }
                      placeholder="model slug for that provider"
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={routes.length === 1}
                      onClick={() => setRoutes((cur) => cur.filter((_, j) => j !== i))}
                      title="Remove route"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRoutes((cur) => [...cur, { provider: '', model: '' }])}
                >
                  <Plus /> Add route
                </Button>
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pool-in">Input $ / 1M tokens</FieldLabel>
                <Input
                  id="pool-in"
                  value={inPerM}
                  onChange={(e) => setInPerM(e.target.value)}
                  placeholder="e.g. 3"
                  inputMode="decimal"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pool-out">Output $ / 1M tokens</FieldLabel>
                <Input
                  id="pool-out"
                  value={outPerM}
                  onChange={(e) => setOutPerM(e.target.value)}
                  placeholder="e.g. 15"
                  inputMode="decimal"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="pool-note">Note</FieldLabel>
              <Input
                id="pool-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. flagship / gets the job done"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={saving}>{entry ? 'Save entry' : 'Add model'}</SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
