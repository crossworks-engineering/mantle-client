'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, CircleAlert, Sparkles, Trash2 } from 'lucide-react';
import type {
  RecallCardDetailDTO,
  RecallMapDetailDTO,
  RecallMapSummaryDTO,
  RecallNodeDTO,
  RecallWriteResultDTO,
} from '@mantle/web-ui/types/recall-v2';
import { RECALL_BODY_CHAR_BUDGET } from '@mantle/content-core/recall-compile';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { Field, FieldDescription, FieldError } from '@mantle/web-ui/ui/field';
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
import { MarkdownEditor } from '@/components/markdown-editor';
import {
  RECALL_ENTRY_SLUG,
  RECALL_TITLE_MAX,
  budgetState,
  cardPane,
  cardProblems,
  cardSync,
  cardTrail,
  cardWriteBody,
  droppedText,
  editorSync,
  editsOf,
  isStale,
  normalisedEdits,
  optionTargets,
  rebaseEdits,
  recallKeys,
  sameEdits,
  versionState,
  writeErrorText,
  type CardEdits,
  type CardSync,
} from '@/lib/recall-v2';
import { CardInspector } from './card-inspector';
import { cardQuery, mapQuery, type MapWrite } from './use-map-write';
import { play } from '@/lib/sounds/play';

/**
 * One card. The middle column is the text of it: the trail to it, its title
 * and its markdown body, with Save always in view. Everything about it (the
 * Prompt switch and its use-when line, its options, what leads to it, its
 * history) is the inspector, portaled into the right-hand column, or below
 * the text when the screen has no room for a third column.
 *
 * The body is fetched per card: the map's list shape carries only its size,
 * so a 100-card map does not ship every body to draw a sidebar. That makes
 * the card and the map two caches of different ages, and the editor saves
 * the card's text against the MAP's version, so the two are checked against
 * each other (cardSync) before the form is shown and on every render after.
 */
export function CardEditor({
  map,
  node,
  gone,
  catalog,
  write,
  onDirtyChange,
  onHoldChange,
  onLeave,
  inspectorSlot,
  onOpenCard,
  onShowRevisions,
}: {
  map: RecallMapDetailDTO;
  /** The card's row in the map's list. When `gone`, the last row seen
   *  before it left the map. */
  node: RecallNodeDTO;
  /** The card left the map (deleted elsewhere) while the form held text. */
  gone: boolean;
  catalog: RecallMapSummaryDTO[];
  write: MapWrite;
  onDirtyChange: (dirty: boolean) => void;
  /** Keep this card open even if it leaves the map: it holds text. */
  onHoldChange: (node: RecallNodeDTO | null) => void;
  /** Close this card (after a delete, or discarding a deleted card). */
  onLeave: () => void;
  /** The inspector column to portal into; null renders it under the text. */
  inspectorSlot: HTMLElement | null;
  /** Open another card of this map (the screen asks first if edits would go). */
  onOpenCard: (slug: string) => void;
  /** Switch to the Revisions view. */
  onShowRevisions: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery(cardQuery(map.id, node.slug));
  const mapQ = useQuery(mapQuery(map.id));
  const [mounted, setMounted] = useState(false);

  // A card that left the map is compared with nothing: its row is the last
  // one seen, and its own refetch can only fail.
  let sync: CardSync | null = null;
  if (gone) sync = 'match';
  else if (q.data) {
    sync = cardSync(node, q.data, { card: q.dataUpdatedAt, map: mapQ.dataUpdatedAt });
  }
  const pane = cardPane({
    hasData: q.data !== undefined,
    sync,
    isFetching: q.isFetching,
    isError: q.isError,
    mounted,
  });
  if (pane.show === 'editor' && !mounted) setMounted(true);

  // A card copy older than the map's row is fetched again, once per pair of
  // stamps, so a brain that keeps answering the same copy is not polled. A
  // map list older than the card catches up the same way.
  const { refetch } = q;
  const { refetch: refetchMap } = mapQ;
  const stamps = q.data
    ? `${node.sourceVersion}|${node.updatedAt}|${q.data.sourceVersion}|${q.data.updatedAt}`
    : '';
  const askedCard = useRef<string | null>(null);
  useEffect(() => {
    if (!pane.refetch || askedCard.current === stamps) return;
    askedCard.current = stamps;
    void refetch();
  }, [pane.refetch, stamps, refetch]);
  const mapBehind = sync === 'map-behind' && !mapQ.isFetching;
  const askedMap = useRef<string | null>(null);
  useEffect(() => {
    if (!mapBehind || askedMap.current === stamps) return;
    askedMap.current = stamps;
    void refetchMap();
  }, [mapBehind, stamps, refetchMap]);

  // Nothing in flight, and the map is not waiting on a refetch a write asked
  // for (a write marks it invalid until the refetch lands, and a failed one
  // leaves it so).
  const settled =
    !q.isFetching &&
    !mapQ.isFetching &&
    !(qc.getQueryState(recallKeys.map(map.id))?.isInvalidated ?? false);

  if (pane.show === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Could not load this card.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (pane.show === 'loading' || !q.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return (
    <Editor
      map={map}
      node={node}
      card={q.data}
      sync={sync ?? 'match'}
      settled={settled}
      gone={gone}
      refreshFailed={pane.refreshFailed && !gone}
      onRetry={() => void refetch()}
      catalog={catalog}
      write={write}
      onDirtyChange={onDirtyChange}
      onHoldChange={onHoldChange}
      onLeave={onLeave}
      inspectorSlot={inspectorSlot}
      onOpenCard={onOpenCard}
      onShowRevisions={onShowRevisions}
    />
  );
}

/** Why the last save did not happen, when it was refused as stale. `gone`:
 *  the card could not even be reloaded (deleted under the edit). */
type Refused = 'card' | 'map' | 'gone' | null;

/** The copy an edit started from: its fields, the map version it was read
 *  at (a save sends THAT version, so a change made under the edit is
 *  refused by the brain instead of being overwritten), and the card's own
 *  `sourceVersion` then. */
type Base = { edits: CardEdits; version: number; stamp: number };

function Editor({
  map,
  node,
  card,
  sync,
  settled,
  gone,
  refreshFailed,
  onRetry,
  catalog,
  write,
  onDirtyChange,
  onHoldChange,
  onLeave,
  inspectorSlot,
  onOpenCard,
  onShowRevisions,
}: {
  map: RecallMapDetailDTO;
  node: RecallNodeDTO;
  card: RecallCardDetailDTO;
  sync: CardSync;
  settled: boolean;
  gone: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
  catalog: RecallMapSummaryDTO[];
  write: MapWrite;
  onDirtyChange: (dirty: boolean) => void;
  onHoldChange: (node: RecallNodeDTO | null) => void;
  onLeave: () => void;
  inspectorSlot: HTMLElement | null;
  onOpenCard: (slug: string) => void;
  onShowRevisions: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const fresh = useMemo(() => editsOf(card), [card]);
  const [base, setBase] = useState<Base>(() => ({
    edits: fresh,
    version: map.version,
    stamp: card.sourceVersion,
  }));
  const [edits, setEdits] = useState<CardEdits>(fresh);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<Refused>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Set while this tab deletes the card itself: the card leaving the map is
  // then expected, and must not be held open as "deleted elsewhere".
  const [leaving, setLeaving] = useState(false);
  const dirty = !sameEdits(edits, base.edits);

  // Has the brain's copy moved away from the base? The rules are in
  // editorSync: a clean form follows the brain, and a dirty one is never
  // re-based silently; it says what happened instead.
  const cardChanged = !sameEdits(fresh, base.edits);
  const mapState = versionState(base.version, map.version, write.chain);
  const { move, conflict } = editorSync({
    dirty,
    saving,
    gone,
    sync,
    settled,
    cardChanged,
    sameStamp: card.sourceVersion === base.stamp,
    mapState,
  });
  if (move === 'follow') {
    setBase({ edits: fresh, version: map.version, stamp: card.sourceVersion });
    setEdits(fresh);
    if (refused) setRefused(null);
  } else if (move === 'version') {
    setBase({ ...base, version: map.version });
  }
  const conflictKey = `${map.version}:${card.sourceVersion}:${card.updatedAt}:${sync}`;

  // A save in flight is not "unsaved": leaving then must not ask to discard.
  const unsaved = dirty && !saving;
  useEffect(() => {
    onDirtyChange(unsaved);
  }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Text the brain does not have (unsaved, mid-save, or a refused save) keeps
  // this card open even if it leaves the map, so it can be copied out.
  const hold = (dirty || refused !== null) && !leaving;
  useEffect(() => {
    onHoldChange(hold ? node : null);
  }, [hold, node, onHoldChange]);
  useEffect(() => () => onHoldChange(null), [onHoldChange]);

  const entry = card.slug === RECALL_ENTRY_SLUG;
  const problems = cardProblems(edits, RECALL_BODY_CHAR_BUDGET, card.promptPending);
  const valid = Object.keys(problems).length === 0;
  const chars = edits.bodyMd.length;
  const budget = budgetState(chars, RECALL_BODY_CHAR_BUDGET);
  const targets = useMemo(() => optionTargets(map, card.slug, catalog), [map, card.slug, catalog]);
  const trail = useMemo(() => cardTrail(map.nodes, card.slug), [map.nodes, card.slug]);

  function set<K extends keyof CardEdits>(key: K, value: CardEdits[K]) {
    setEdits((e) => ({ ...e, [key]: value }));
  }

  // The card copy on screen is the brain's current one, at the map's
  // version: only then can it become the base (a copy older than the map's
  // row would pair old text with a version that no longer refuses anything).
  const current = sync === 'match' && settled;

  /** Throw the edits away and show the brain's copy as it is now. */
  function showNewCopy() {
    setBase({ edits: fresh, version: map.version, stamp: card.sourceVersion });
    setEdits(fresh);
    setRefused(null);
  }

  /** Throw the edits away and go back to the base. */
  function discard() {
    setEdits(base.edits);
    setRefused(null);
  }

  /** After a stale refusal: reload the card and the map, and make the
   *  reloaded copy the base, so the next save is an informed one. The
   *  owner's edits stay; a field they did not touch takes the new copy's
   *  value (a title the map rename changed, an agent's options). */
  async function reloadAfterRefusal() {
    try {
      const [m, c] = await Promise.all([
        qc.fetchQuery({ ...mapQuery(map.id), staleTime: 0 }),
        qc.fetchQuery({ ...cardQuery(map.id, card.slug), staleTime: 0 }),
      ]);
      const reloaded = editsOf(c);
      setRefused(sameEdits(reloaded, base.edits) ? 'map' : 'card');
      setEdits((cur) => rebaseEdits(cur, base.edits, reloaded));
      setBase({ edits: reloaded, version: m.version, stamp: c.sourceVersion });
    } catch {
      setRefused('gone');
    }
  }

  async function save() {
    const sent = normalisedEdits(edits);
    let stale = false;
    setSaving(true);
    try {
      const res = await write.run(
        (version) =>
          apiSend<RecallWriteResultDTO>(
            `/api/recall/maps/${map.id}/cards/${card.slug}`,
            'PUT',
            cardWriteBody(sent, base.edits, version),
          ),
        'Could not save the card.',
        {
          version: base.version,
          onError: (err) => {
            play('danger');
            if (isStale(err)) stale = true;
            else toast.error(writeErrorText(err, 'Could not save the card.'));
          },
        },
      );
      if (res) {
        play('success');
        // Show the saved copy now rather than wait for the refetch: until it
        // lands, the cached card is the old one, and a clean form would
        // otherwise follow it back for a moment.
        const promptMoved = sent.prompt !== base.edits.prompt;
        qc.setQueryData<RecallCardDetailDTO>(recallKeys.card(map.id, card.slug), (c) =>
          c
            ? {
                ...c,
                title: sent.title,
                bodyMd: sent.bodyMd,
                useWhen: sent.useWhen,
                options: sent.options,
                bodyChars: sent.bodyMd.length,
                // What the brain stamps the card with on this write, so the
                // map's refetched row and this copy agree (cardSync).
                sourceVersion: res.version,
                ...(promptMoved
                  ? { kind: sent.prompt ? 'prompt' : 'knowledge', promptPending: false }
                  : {}),
              }
            : c,
        );
        setBase({ edits: sent, version: res.version, stamp: res.version });
        // Typed more while it saved: keep that, it is a new edit.
        setEdits((cur) => (sameEdits(cur, sent) ? sent : cur));
        setRefused(null);
      } else if (stale) {
        toast.error('Not saved: this card or its map changed since you started editing.');
        await reloadAfterRefusal();
      }
    } finally {
      setSaving(false);
    }
  }

  async function answerPrompt(confirm: boolean) {
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(
          `/api/recall/maps/${map.id}/cards/${card.slug}/prompt`,
          'POST',
          { confirm, version },
        ),
      confirm ? 'Could not confirm the prompt.' : 'Could not drop the request.',
    );
    if (res) toast.success(confirm ? 'This card is a prompt now.' : 'Request dropped.');
  }

  async function deleteCard() {
    setLeaving(true);
    const res = await write.run(
      (version) =>
        apiSend<RecallWriteResultDTO>(
          `/api/recall/maps/${map.id}/cards/${card.slug}?version=${version}`,
          'DELETE',
        ),
      'Could not delete the card.',
    );
    setDeleting(false);
    if (!res) {
      setLeaving(false);
      return;
    }
    const dropped = droppedText(res.optionsDropped ?? []);
    toast.success(dropped ? `Card deleted. ${dropped}` : 'Card deleted.');
    onLeave();
  }

  const inspector = (
    <CardInspector
      map={map}
      card={card}
      edits={edits}
      problems={problems}
      targets={targets}
      onEdit={set}
      onOpen={onOpenCard}
      onShowRevisions={onShowRevisions}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The card's bar: the trail an agent walks to reach it, then the save.
          Chrome over scrolling text, so /60 and the blur (style guide §2a). */}
      <div className="flex min-h-11 items-center gap-2 border-b border-border bg-background/60 px-4 py-1.5 backdrop-blur">
        <nav aria-label="Trail to this card" className="min-w-0 flex-1">
          {trail ? (
            <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
              {trail.map((n, i) => (
                <Fragment key={n.slug}>
                  {i > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden />}
                  <li className="min-w-0">
                    {i === trail.length - 1 ? (
                      <span aria-current="page" className="font-medium text-foreground">
                        {i === 0 ? 'Entry card' : n.title}
                      </span>
                    ) : (
                      <Button
                        variant="link"
                        onClick={() => onOpenCard(n.slug)}
                        className="h-auto max-w-[16rem] truncate p-0 align-bottom text-xs font-normal text-muted-foreground hover:text-foreground"
                        title={n.title}
                      >
                        {n.title}
                      </Button>
                    )}
                  </li>
                </Fragment>
              ))}
            </ol>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-warning-ink">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              {card.kind === 'prompt'
                ? 'No option leads here: found by meaning only.'
                : 'No option leads here from the entry card.'}
            </p>
          )}
        </nav>
        {dirty && !saving && <span className="text-xs text-muted-foreground">Unsaved</span>}
        {!entry && !gone && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete card"
            title="Delete card"
            className="text-muted-foreground hover:text-destructive-ink"
            onClick={() => setDeleting(true)}
            disabled={write.pending}
          >
            <Trash2 />
          </Button>
        )}
        {dirty && (
          <Button variant="ghost" size="sm" onClick={discard} disabled={saving || gone}>
            Discard
          </Button>
        )}
        <SubmitButton
          size="sm"
          pending={saving}
          disabled={!dirty || !valid || gone || (write.pending && !saving)}
          onClick={save}
          type="button"
          title={!valid && dirty ? Object.values(problems)[0] : undefined}
        >
          Save card
        </SubmitButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex min-h-full flex-col gap-4 p-4">
          {refreshFailed && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">Could not refresh; showing the last copy.</span>
              <Button size="xs" variant="ghost" onClick={onRetry}>
                Retry
              </Button>
            </p>
          )}

          {gone ? (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-destructive-ink"
                  aria-hidden
                />
                <span>This card was deleted. Copy your text, it is not saved anywhere.</span>
              </p>
              <div className="flex justify-end">
                <Button size="xs" variant="outline" onClick={onLeave}>
                  Discard and close
                </Button>
              </div>
            </div>
          ) : refused ? (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-destructive-ink"
                  aria-hidden
                />
                <span>
                  {refused === 'card' &&
                    'Your save did not happen: this card changed since you started editing. The new copy is loaded: the fields you had not touched show it, and your own edits are still here. Save again to write them over it, or show the new copy and lose your edits.'}
                  {refused === 'map' &&
                    'Your save did not happen: the map changed since you started editing (another card or its settings). This card is as you last saw it, and your edits are still here. Save again to write them.'}
                  {refused === 'gone' &&
                    'Your save did not happen, and this card could not be reloaded. It may have been deleted. Copy your text somewhere safe before you leave it.'}
                </span>
              </p>
              {refused === 'card' && (
                <div className="flex justify-end">
                  <Button size="xs" variant="outline" onClick={showNewCopy} disabled={!current}>
                    Show the new copy
                  </Button>
                </div>
              )}
            </div>
          ) : (
            conflict &&
            dismissed !== conflictKey && (
              <div
                role="status"
                className="space-y-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
              >
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
                  <span>
                    {conflict === 'card'
                      ? 'This card changed since you started editing, maybe by an agent.'
                      : 'This map changed since you started editing (another card or its settings, maybe by an agent).'}{' '}
                    A save now is refused rather than overwrite it; the next save after that writes
                    your version.
                  </span>
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="outline" onClick={() => setDismissed(conflictKey)}>
                    Keep editing
                  </Button>
                  <Button size="xs" variant="outline" onClick={showNewCopy} disabled={!current}>
                    Show the new copy (discard mine)
                  </Button>
                </div>
              </div>
            )
          )}

          {card.promptPending && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-sm">
              <Sparkles className="size-4 shrink-0 text-info-ink" aria-hidden />
              <span className="min-w-0 flex-1">
                An agent asked for this card to be a prompt, or changed the text of a prompt you had
                confirmed. Until you confirm it again, it is never matched.
              </span>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => answerPrompt(false)}
                  disabled={write.pending || dirty || !current || gone}
                >
                  Drop request
                </Button>
                <Button
                  size="xs"
                  onClick={() => answerPrompt(true)}
                  disabled={write.pending || dirty || !current || gone}
                  title={
                    dirty
                      ? 'Save or discard your edits first.'
                      : !current
                        ? 'Loading the latest copy of this card.'
                        : undefined
                  }
                >
                  Make it a prompt
                </Button>
              </div>
            </div>
          )}

          <Field data-invalid={problems.title ? true : undefined}>
            <Input
              id="recall-card-title"
              aria-label="Title"
              value={edits.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={RECALL_TITLE_MAX}
              placeholder="Card title"
              aria-invalid={problems.title ? true : undefined}
              className="h-auto border-x-0 border-t-0 border-b-2 border-transparent rounded-none px-0 py-1 text-lg font-semibold shadow-none focus-visible:border-primary focus-visible:ring-0 md:text-lg"
            />
            {entry && (
              <FieldDescription>
                The entry card. Renaming the map in its settings renames this card too; this field
                does not rename the map.
              </FieldDescription>
            )}
            <FieldError>{problems.title}</FieldError>
          </Field>

          <Field data-invalid={problems.bodyMd ? true : undefined} className="min-h-[20rem] flex-1">
            <MarkdownEditor
              id="recall-card-body"
              value={edits.bodyMd}
              onChange={(v) => set('bodyMd', v)}
              placeholder="What an agent should know when it opens this card."
              className="min-h-0 flex-1"
              height="min-h-[16rem] flex-1"
              defaultMode="edit"
            />
            <p
              className={cn(
                'text-xs tabular-nums',
                budget === 'ok' && 'text-muted-foreground',
                budget === 'near' && 'text-warning-ink',
                budget === 'over' && 'text-destructive-ink',
              )}
            >
              {chars.toLocaleString()} / {RECALL_BODY_CHAR_BUDGET.toLocaleString()} characters
            </p>
            <FieldError>{problems.bodyMd}</FieldError>
          </Field>

          {!inspectorSlot && <div className="-mx-4 border-t border-border">{inspector}</div>}
        </div>
      </div>
      {inspectorSlot && createPortal(inspector, inspectorSlot)}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {card.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Options on other cards that lead here are removed with it. Restoring the card from
              Revisions brings it back with those options, under its old link name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteCard}
            >
              Delete card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
