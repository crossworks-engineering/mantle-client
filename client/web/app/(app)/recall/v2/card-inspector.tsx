'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, CircleAlert, Copy, History, User } from 'lucide-react';
import type {
  RecallCardDetailDTO,
  RecallMapDetailDTO,
  RecallRevisionDTO,
} from '@mantle/web-ui/types/recall-v2';
import { RECALL_BODY_CHAR_BUDGET } from '@mantle/content-core/recall-compile';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { Field, FieldDescription, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  CARD_KIND_LABEL,
  RECALL_LINE_MAX,
  actorLabel,
  budgetState,
  cardKindOf,
  incomingOptions,
  type CardEdits,
  type OptionTarget,
} from '@/lib/recall-v2';
import { CardKindIcon } from './card-list';
import { OptionsEditor } from './options-editor';
import { revisionsQuery } from './use-map-write';

/** How many of the card's own writes the inspector lists. */
const HISTORY_ROWS = 5;

/**
 * The right-hand column of the Cards view: everything ABOUT the open card,
 * beside the text OF it. What it is and when it last changed; whether it is a
 * prompt (and the line it is matched on); where it leads and what leads to
 * it, each a link to follow; and its last few writes, agents' included.
 *
 * The fields here (prompt, use when, options) are part of the card's edits:
 * they are saved with the editor's Save, never on their own.
 */
export function CardInspector({
  map,
  card,
  edits,
  problems,
  targets,
  onEdit,
  onOpen,
  onShowRevisions,
}: {
  map: RecallMapDetailDTO;
  card: RecallCardDetailDTO;
  edits: CardEdits;
  problems: Partial<Record<keyof CardEdits, string>>;
  targets: OptionTarget[];
  onEdit: <K extends keyof CardEdits>(key: K, value: CardEdits[K]) => void;
  onOpen: (slug: string) => void;
  onShowRevisions: () => void;
}) {
  const toast = useToast();
  const kind = cardKindOf(card);
  const entry = kind === 'entry';
  const incoming = incomingOptions(map.nodes, card.slug);
  const revQ = useQuery(revisionsQuery(map.id));
  const history = (revQ.data ?? []).filter((r) => r.cardId === card.id);
  const last = history[0];
  const chars = edits.bodyMd.length;
  const budget = budgetState(chars, RECALL_BODY_CHAR_BUDGET);
  const position = map.nodes.findIndex((n) => n.slug === card.slug) + 1;

  return (
    <div className="divide-y divide-border">
      <Section title="This card">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="flex items-center gap-1.5">
            <CardKindIcon kind={kind} />
            {CARD_KIND_LABEL[kind]}
          </dd>

          <dt className="text-muted-foreground">Link name</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs" title={card.slug}>
              {card.slug}
            </span>
            <Button
              variant="ghost"
              size="icon-2xs"
              aria-label="Copy the link name"
              title="What agents and other maps use to reach this card"
              onClick={() =>
                void copyText(card.slug).then(
                  () => toast.success('Link name copied.'),
                  () => toast.error('Could not copy.'),
                )
              }
            >
              <Copy />
            </Button>
          </dd>

          <dt className="text-muted-foreground">Changed</dt>
          <dd title={formatDateTime(last?.createdAt ?? card.updatedAt)}>
            {timeAgo(last?.createdAt ?? card.updatedAt) || '—'}
            {last && <span className="text-muted-foreground"> · {actorLabel(last)}</span>}
          </dd>

          <dt className="text-muted-foreground">Place</dt>
          <dd>
            {position} of {map.nodes.length}
          </dd>

          <dt className="text-muted-foreground">Length</dt>
          <dd className="space-y-1">
            <span
              className={cn(
                'tabular-nums',
                budget === 'near' && 'text-warning-ink',
                budget === 'over' && 'text-destructive-ink',
              )}
            >
              {chars.toLocaleString()}{' '}
              <span className="text-muted-foreground">
                / {RECALL_BODY_CHAR_BUDGET.toLocaleString()}
              </span>
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
              <span
                className={cn(
                  'block h-full rounded-full',
                  budget === 'ok' && 'bg-primary/60',
                  budget === 'near' && 'bg-warning',
                  budget === 'over' && 'bg-destructive',
                )}
                style={{ width: `${Math.min(100, (chars / RECALL_BODY_CHAR_BUDGET) * 100)}%` }}
              />
            </span>
          </dd>
        </dl>
      </Section>

      {/* Not on the entry card: it is where every walk of the map starts, and
          the brain refuses to make it a prompt. */}
      {!entry && (
        <Section title="Prompt">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              A prompt is also found by meaning (recall_match), not only by walking the map.
            </p>
            <Switch
              id="recall-card-prompt"
              aria-label="Prompt"
              checked={edits.prompt}
              onCheckedChange={(v) => onEdit('prompt', v)}
            />
          </div>
          {/* Also open while an agent's request waits: the brain refuses a
              pending card with no line, so the problem must be visible. */}
          {(edits.prompt || card.promptPending) && (
            <Field data-invalid={problems.useWhen ? true : undefined} className="mt-3">
              <FieldLabel htmlFor="recall-card-use-when">Matched when</FieldLabel>
              <Input
                id="recall-card-use-when"
                value={edits.useWhen}
                onChange={(e) => onEdit('useWhen', e.target.value)}
                maxLength={RECALL_LINE_MAX}
                placeholder="deploying a release to the fleet"
                aria-invalid={problems.useWhen ? true : undefined}
              />
              <FieldDescription>The task line an agent's need is matched against.</FieldDescription>
              <FieldError>{problems.useWhen}</FieldError>
            </Field>
          )}
        </Section>
      )}

      <Section title="Leads to" count={edits.options.length}>
        <OptionsEditor
          options={edits.options}
          targets={targets}
          nodes={map.nodes}
          onChange={(o) => onEdit('options', o)}
          onOpen={onOpen}
        />
        {problems.options && (
          <p className="mt-2 text-xs text-destructive-ink">{problems.options}</p>
        )}
      </Section>

      <Section title="Reached from" count={incoming.length}>
        {entry ? (
          <p className="text-xs text-muted-foreground">
            Every walk of this map starts here: agents enter it from the catalog.
          </p>
        ) : incoming.length === 0 ? (
          <p
            className={cn(
              'flex items-start gap-1.5 text-xs',
              kind === 'prompt' ? 'text-muted-foreground' : 'text-warning-ink',
            )}
          >
            {kind !== 'prompt' && <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />}
            {kind === 'prompt'
              ? 'No option leads here. As a prompt it is still found by meaning.'
              : 'No option leads here, so no agent walking the map will reach it. Add an option to it from another card.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {incoming.map(({ from, option }, i) => (
              <li key={`${from.slug}-${i}`}>
                <RowButton
                  onClick={() => onOpen(from.slug)}
                  className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-foreground/[0.06]"
                >
                  <ArrowLeft className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm break-words">{from.title}</span>
                    <span className="block text-xs break-words text-muted-foreground">
                      as “{option.label}”
                    </span>
                  </span>
                </RowButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="History"
        action={
          <Button variant="ghost" size="2xs" onClick={onShowRevisions}>
            All revisions
          </Button>
        }
      >
        {revQ.isPending ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : revQ.isError ? (
          <p className="text-xs text-muted-foreground">Could not load the history.</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No writes to this card in the map's recent log.
          </p>
        ) : (
          <ol className="space-y-2">
            {history.slice(0, HISTORY_ROWS).map((r) => (
              <HistoryRow key={r.id} rev={r} />
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function HistoryRow({ rev }: { rev: RecallRevisionDTO }) {
  const Icon = rev.actorKind === 'agent' ? Bot : User;
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon
        className={cn(
          'mt-px size-3.5 shrink-0',
          rev.actorKind === 'agent' ? 'text-info-ink' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-foreground">{rev.summary}</span>
        <span className="block text-muted-foreground" title={formatDateTime(rev.createdAt)}>
          {actorLabel(rev)} · {timeAgo(rev.createdAt)}
        </span>
      </span>
    </li>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 px-4 py-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title === 'History' && <History className="size-3.5" aria-hidden />}
        <span className="flex-1">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 font-normal tabular-nums normal-case">{count}</span>
          )}
        </span>
        {action}
      </h3>
      {children}
    </section>
  );
}
