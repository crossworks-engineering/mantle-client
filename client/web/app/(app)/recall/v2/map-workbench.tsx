'use client';

import { ItemHeader } from '@/components/layout/item-header';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, EyeOff, Map as MapIcon, Send, Settings2, Sparkles, X } from 'lucide-react';
import type {
  RecallCardDetailDTO,
  RecallMapDetailDTO,
  RecallMapSummaryDTO,
  RecallNodeDTO,
  RecallWriteResultDTO,
} from '@mantle/web-ui/types/recall-v2';
import { RECALL_MAX_MAP_NODES } from '@mantle/content-core/recall-compile';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
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
import { StatePill } from '@/components/item-list/state-pill';
import { treeKey } from '@/components/item-tree/tree-api';
import { useListNav } from '@/lib/use-list-nav';
import {
  RECALL_ENTRY_SLUG,
  detailPane,
  isNativeMap,
  linkFromBody,
  openCardOf,
  recallKeys,
  writeErrorText,
} from '@/lib/recall-v2';
import { RecallGraph } from '../recall-graph';
import { CardEditor } from './card-editor';
import { CardList } from './card-list';
import { AddCardDialog, MapSettingsDialog } from './map-dialogs';
import { RevisionsPanel } from './revisions-panel';
import { cardQuery, mapQuery, useMapWrite } from './use-map-write';
import type { RecallV2View } from './recall-v2-client';

/** What the screen hands the workbench for its unsaved-edit guard: whether
 *  the open card has unsaved edits, and a way to run a navigation that would
 *  lose them (it asks first). */
export type EditGuard = {
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  guarded: (nav: () => void) => void;
};

/**
 * One map. A native map gets its header (publish, settings, delete) and three
 * views of it: Cards is the editor; Graph draws the same rows; Revisions is
 * the log of every write, agents' included, with restore.
 */
export function MapWorkbench({
  mapId,
  catalog,
  view,
  cardSlug,
  guard,
}: {
  mapId: string;
  catalog: RecallMapSummaryDTO[];
  view: RecallV2View;
  cardSlug: string | null;
  guard: EditGuard;
}) {
  const q = useQuery(mapQuery(mapId));
  // A failed background refetch keeps the last copy (and the card open in
  // it): only a map that never loaded gets the error screen.
  const pane = detailPane(q);

  if (pane.show === 'loading' || !q.data) {
    if (pane.show === 'error') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>Could not load this map.</p>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!isNativeMap(q.data)) {
    // A page-built (v1) map, from a brain just before mantle R5 retired
    // them. Nothing here can write it.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">This map is built from pages</p>
        <p className="max-w-md">
          Page-built maps are retired. Update the brain, and re-create this map in Recall if it is
          still needed.
        </p>
      </div>
    );
  }
  return (
    <Workbench
      map={q.data}
      catalog={catalog}
      view={view}
      cardSlug={cardSlug}
      guard={guard}
      refreshFailed={pane.refreshFailed}
      onRetry={() => void q.refetch()}
    />
  );
}

function Workbench({
  map,
  catalog,
  view,
  cardSlug,
  guard,
  refreshFailed,
  onRetry,
}: {
  map: RecallMapDetailDTO;
  catalog: RecallMapSummaryDTO[];
  view: RecallV2View;
  cardSlug: string | null;
  guard: EditGuard;
  refreshFailed: boolean;
  onRetry: () => void;
}) {
  const { go } = useListNav();
  const qc = useQueryClient();
  const toast = useToast();
  const write = useMapWrite(map.id);
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { dirty, guarded } = guard;
  // The card the editor holds text for. If it leaves the map under the edit
  // (deleted from another tab or by an agent), it stays open, marked gone,
  // until the owner discards it; see openCardOf.
  const [held, setHeld] = useState<RecallNodeDTO | null>(null);
  const { node: open, gone } = openCardOf(map.nodes, cardSlug, held);
  const pendingPrompts = map.nodes.filter((n) => n.promptPending).length;

  function openCard(slug: string) {
    go({ view: null, card: slug === RECALL_ENTRY_SLUG ? null : slug });
  }
  function openCardGuarded(slug: string) {
    if (slug === open?.slug && view === 'cards') return;
    guarded(() => openCard(slug));
  }

  async function publish(published: boolean) {
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(`/api/recall/maps/${map.id}`, 'PATCH', {
          published,
          version,
        }),
      published ? 'Could not publish the map.' : 'Could not unpublish the map.',
    );
    if (res) toast.success(published ? 'Published. Agents can find this map now.' : 'Unpublished.');
  }

  async function deleteMap() {
    try {
      await apiSend(`/api/recall/maps/${map.id}`, 'DELETE');
      setDeleting(false);
      await qc.invalidateQueries({ queryKey: recallKeys.maps });
      void qc.invalidateQueries({ queryKey: treeKey('recall') });
      toast.success('Map deleted.');
      go({ selected: null, card: null, view: null }, '/recall');
    } catch (err) {
      toast.error(writeErrorText(err, 'Could not delete the map.'));
    }
  }

  // Shows the new order at once, then writes it. Any refusal puts the old
  // order back straight away and reloads the map, so the list never shows
  // an order the brain does not hold.
  async function reorder(slugs: string[]) {
    const key = recallKeys.map(map.id);
    const before = qc.getQueryData<RecallMapDetailDTO>(key);
    qc.setQueryData<RecallMapDetailDTO>(key, (m) => {
      if (!m) return m;
      const bySlug = new Map(m.nodes.map((n) => [n.slug, n]));
      const nodes = slugs.flatMap((s) => bySlug.get(s) ?? []);
      return nodes.length === m.nodes.length ? { ...m, nodes } : m;
    });
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(`/api/recall/maps/${map.id}/cards/reorder`, 'POST', {
          slugs,
          version,
        }),
      'Could not move the card.',
    );
    if (!res) {
      if (before) {
        qc.setQueryData<RecallMapDetailDTO>(key, (m) =>
          m ? { ...m, nodes: before.nodes } : before,
        );
      }
      void qc.invalidateQueries({ queryKey: key, exact: true });
    }
  }

  // "Link from" for a new card: read the card it was added from fresh (the
  // list shape has no body) and give it one more option. The card is already
  // made by now, so a failure here is reported, never retried.
  async function linkFrom(
    from: { slug: string; title: string },
    targetSlug: string,
    label: string,
    useWhen: string,
  ) {
    const failed = (why: string) =>
      toast.error(
        `The card was added, but the option to it from ${from.title} was not: ${why} Add it from that card's options.`,
      );
    let card: RecallCardDetailDTO;
    try {
      card = await qc.fetchQuery({ ...cardQuery(map.id, from.slug), staleTime: 0 });
    } catch (err) {
      failed(writeErrorText(err, 'the card could not be read.'));
      return;
    }
    await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(
          `/api/recall/maps/${map.id}/cards/${from.slug}`,
          'PUT',
          linkFromBody(card, { label, useWhen, targetSlug }, version),
        ),
      'Could not add the option.',
      { onError: (err) => failed(writeErrorText(err, 'the write was refused.')) },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The item header (contract 2026-10-21): one row; the slug, folder
          and when to enter it behind Info. A draft says why in its pill and
          in Info, not in a banner. Publish is the word button; the map's
          settings are its own tool. */}
      <ItemHeader
        section="Recall"
        visual={<MapIcon className="size-4" aria-hidden />}
        title={map.title}
        badges={
          map.published ? null : (
            <span title="Draft: no agent can see this map until it is published">
              <StatePill state="draft" />
            </span>
          )
        }
        textActions={
          map.published ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => publish(false)}
              disabled={write.pending}
            >
              <EyeOff />
              Unpublish
            </Button>
          ) : (
            <Button size="sm" onClick={() => publish(true)} disabled={write.pending}>
              <Send />
              Publish
            </Button>
          )
        }
        tools={[
          {
            key: 'settings',
            label: 'Map settings',
            icon: <Settings2 />,
            onSelect: () => setSettings(true),
          },
        ]}
        onDelete={() => setDeleting(true)}
        deleteLabel="Delete map"
        move={{ kind: 'recall', item: { id: map.id, title: map.title } }}
        info={{
          description: map.enterWhen,
          path: map.folder ? [map.folder] : [],
          rows: [
            { label: 'Slug', value: <span className="font-mono">{map.slug}</span> },
            ...(map.published
              ? []
              : [
                  {
                    label: 'Draft',
                    value:
                      'No agent can see this map until it is published. An agent created it, or it was unpublished.',
                  },
                ]),
          ],
        }}
        infoLabel="About this map"
      />

      {refreshFailed && (
        <p className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">Could not refresh this map; showing the last copy.</span>
          <Button size="xs" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </p>
      )}

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Tabs
          value={view}
          onValueChange={(v) => guarded(() => go({ view: v === 'cards' ? null : v }))}
        >
          <TabsList>
            <TabsTrigger value="cards">Cards</TabsTrigger>
            <TabsTrigger value="graph">Graph</TabsTrigger>
            <TabsTrigger value="revisions">Revisions</TabsTrigger>
          </TabsList>
        </Tabs>
        {pendingPrompts > 0 && (
          <span className="flex items-center gap-1 text-xs text-info-ink">
            <Sparkles className="size-3.5" aria-hidden />
            {pendingPrompts} prompt {pendingPrompts === 1 ? 'request' : 'requests'} to review
          </span>
        )}
      </div>

      {/* The last write's advisory warnings. They are about the map (an
          orphan card, an entry card with no options), so they sit above
          every view rather than inside one card. */}
      {write.warnings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-border bg-warning/5 px-4 py-2 text-xs">
          <ul className="min-w-0 flex-1 space-y-1">
            {write.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="icon-2xs"
            aria-label="Dismiss the warnings"
            onClick={write.clearWarnings}
          >
            <X />
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {view === 'graph' ? (
          <RecallGraph
            map={map}
            onEditNode={(n) => openCardGuarded(n.slug)}
            className="h-full rounded-none border-none"
          />
        ) : view === 'revisions' ? (
          <RevisionsPanel map={map} write={write} />
        ) : (
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <CardList
              nodes={map.nodes}
              openSlug={open?.slug ?? null}
              onOpen={openCardGuarded}
              onReorder={reorder}
              onAdd={() => setAdding(true)}
              busy={write.pending}
              full={map.nodes.length >= RECALL_MAX_MAP_NODES}
            />
            <div className="min-h-0 min-w-0 flex-1">
              {open ? (
                <CardEditor
                  key={open.slug}
                  map={map}
                  node={open}
                  catalog={catalog}
                  write={write}
                  gone={gone}
                  onDirtyChange={guard.onDirtyChange}
                  onHoldChange={setHeld}
                  onLeave={() => {
                    setHeld(null);
                    openCard(RECALL_ENTRY_SLUG);
                  }}
                />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">This map has no cards.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {settings && <MapSettingsDialog map={map} write={write} open onOpenChange={setSettings} />}
      {adding && (
        <AddCardDialog
          mapId={map.id}
          from={open ? { slug: open.slug, title: open.title } : null}
          write={write}
          open
          onOpenChange={setAdding}
          onAdded={(slug) => openCardGuarded(slug)}
          linkFrom={
            open && !dirty ? (slug, title, useWhen) => linkFrom(open, slug, title, useWhen) : null
          }
        />
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {map.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the map and all {map.nodes.length}{' '}
              {map.nodes.length === 1 ? 'card' : 'cards'} for good. Options on other maps that lead
              here stop working. There is no restore for a deleted map.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteMap}
            >
              Delete map
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
