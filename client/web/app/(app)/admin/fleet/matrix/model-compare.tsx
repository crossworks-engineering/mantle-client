'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { Button } from '@mantle/web-ui/ui/button';
import { Label } from '@mantle/web-ui/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Switch } from '@mantle/web-ui/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@mantle/web-ui/ui/tooltip';
import { cn } from '@mantle/web-ui/lib/utils';
import { boxName, type FleetBox } from '@/lib/fleet';
import { factsAge, FLEET_MATRIX_KEY, type FleetMatrixRow } from '@/lib/fleet-matrix';
import {
  agentChange,
  canCopy,
  compareLines,
  agentRun,
  copyAllLines,
  defaultPair,
  FLEET_MODELS_PATH,
  MAX_MODEL_CHANGES,
  shippedSlugs,
  workerChange,
  workerKinds,
  workerKindSettable,
  workerRun,
  writeAnswer,
  writeWaiting,
  type BoxModel,
  type BoxRun,
  type CompareLine,
} from '@/lib/fleet-models';
import {
  answerText,
  FLEET_SETTINGS_PATH,
  fleetWritesOffered,
  type FleetWriteChange,
} from '@/lib/fleet-writes';
import { ccHref } from '@/lib/fleet-view';
import { Part, Pill, ScreenLink, useParam } from '../cc-kit';
import { ConfirmSend, useFleetSend } from '../fleet-writes';

type Side = 'left' | 'right';
type Change = { key: string; provider: string; model: string };
/** The question before a send: the target and source boxes are taken when
 *  the arrow is pressed, so a change of the pair meanwhile never redirects
 *  it. */
type Ask = { to: Side; toId: string; fromId: string; changes: Change[] };
type Match = (c: FleetWriteChange) => boolean;

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** A box picker in a column head: any linked box, never the other column's. */
function BoxPicker({
  label,
  rows,
  value,
  taken,
  onChange,
}: {
  label: string;
  rows: FleetMatrixRow[];
  value: string | null;
  taken: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="xs" aria-label={label} className="h-7 max-w-56 font-medium">
        <SelectValue placeholder="Pick a box" />
      </SelectTrigger>
      <SelectContent>
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id} disabled={r.id === taken}>
            {boxName(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelText({ model, provider }: { model: BoxModel; provider: string | null }) {
  if (model === null) return <span className="text-muted-foreground">Not on this box</span>;
  if (model === undefined) return <span className="text-muted-foreground">Not known</span>;
  return (
    <span className="min-w-0">
      {model === '' ? (
        <span className="text-muted-foreground">no model</span>
      ) : (
        <span className="break-all">{model}</span>
      )}
      {provider && (
        <span className="block font-sans text-xs text-muted-foreground">{provider}</span>
      )}
    </span>
  );
}

/** What one table compares: agents (by shipped slug) or AI workers (by
 *  kind, the worker that runs it), and the write that sets one. */
type Spec = {
  title: string;
  /** The first column's head, and the noun in the counts. */
  head: string;
  noun: string;
  keys: string[];
  read: (row: FleetMatrixRow, key: string) => BoxRun;
  /** Whether the fleet may set this item at all. */
  may: (key: string) => boolean;
  path: string;
  change: (c: Change) => FleetWriteChange | { slug: string; model: string };
  match: (key: string) => Match;
  /** What the item keeps, in the question. */
  keeps: string;
};

type Pair = {
  rows: FleetMatrixRow[];
  boxes: readonly FleetBox[];
  ids: Record<Side, string | null>;
  setLeft: (id: string) => void;
  setRight: (id: string) => void;
  onlyDiffer: boolean;
  writes: boolean;
  refresh: () => void;
};

/** One table of the compare: a row per item, the two boxes' models, the
 *  marks and the copy actions, each after one question. */
function CompareTable({ spec, pair }: { spec: Spec; pair: Pair }) {
  const { rows, boxes, ids, onlyDiffer, writes, refresh } = pair;
  const queryClient = useQueryClient();
  const row = (s: Side) => rows.find((r) => r.id === ids[s]);
  const box = (s: Side) => boxes.find((b) => b.id === ids[s]);
  const name = (s: Side) => {
    const r = row(s);
    return r ? boxName(r) : 'the other box';
  };
  // When this page sent a model for (box, item): its answer shows from then.
  const [sent, setSent] = useState<Record<string, number>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const { pending, send } = useFleetSend(spec.path, refresh);

  const lines = compareLines(spec.keys, row('left'), row('right'), spec.read);
  const differing = lines.filter((l) => l.differs).length;
  const shown = onlyDiffer ? lines.filter((l) => l.differs || l.oneSided) : lines;
  // Only from facts read lately: an old read may no longer be what the box runs.
  const fresh = (s: Side) => {
    const r = row(s);
    return !!r && factsAge(r) === 'fresh';
  };
  const copyable = (l: CompareLine, from: Side) =>
    spec.may(l.key) && fresh(from) && !!row(other(from))?.facts && canCopy(l, from);
  const countable = (from: Side) => lines.filter((l) => copyable(l, from)).length;

  // An answer lands with the write result; the box's facts (the new model)
  // follow in the same run, a moment later: read the matrix again then.
  const answered = Object.entries(sent).filter(([k, since]) => {
    const [boxId, key] = k.split('\u0000') as [string, string];
    const b = boxes.find((x) => x.id === boxId);
    return writeAnswer(b, spec.match(key), since) !== null;
  }).length;
  const seen = useRef(answered);
  useEffect(() => {
    if (answered <= seen.current) return;
    seen.current = answered;
    const t = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: FLEET_MATRIX_KEY }),
      4000,
    );
    return () => clearTimeout(t);
  }, [answered, queryClient]);

  const confirm = async () => {
    if (!ask) return;
    const target = ask.toId;
    // The pair changed while the question was open: send nothing.
    if (ids[ask.to] !== target || ids[other(ask.to)] !== ask.fromId) {
      setAsk(null);
      return;
    }
    const at = Date.now() - 60_000; // the brain stamps it; allow for clock drift
    const changes = ask.changes.map((c) => spec.change(c));
    if (await send(changes as FleetWriteChange[], [target], 'Could not send the model.')) {
      setSent((prev) => {
        const next = { ...prev };
        for (const c of ask.changes) next[`${target}\u0000${c.key}`] = at;
        return next;
      });
      setAsk(null);
    }
  };

  const status = (line: CompareLine) => {
    for (const s of ['left', 'right'] as const) {
      const id = ids[s];
      if (!id) continue;
      const since = sent[`${id}\u0000${line.key}`];
      if (since === undefined) continue;
      if (writeWaiting(box(s), spec.match(line.key))) {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-info-ink">
            <Spinner size={12} /> Sending to {name(s)}
          </span>
        );
      }
      const a = writeAnswer(box(s), spec.match(line.key), since);
      if (a) {
        const t = answerText(a);
        return (
          <span
            className={cn('text-xs', t.tone === 'ok' ? 'text-success-ink' : 'text-destructive-ink')}
          >
            {name(s)}: {t.text}
          </span>
        );
      }
    }
    return null;
  };

  const copyButton = (line: CompareLine, from: Side) => {
    if (!writes || !copyable(line, from)) return null;
    const to = other(from);
    const label = `Use this model on ${name(to)}`;
    const Icon = from === 'left' ? ArrowRight : ArrowLeft;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-2xs"
            aria-label={`${label} (${line.key})`}
            disabled={pending || writeWaiting(box(to), spec.match(line.key))}
            onClick={() =>
              askFor(to, [
                { key: line.key, provider: line.leftProvider!, model: line[from] as string },
              ])
            }
          >
            <Icon aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
  };

  const askFor = (to: Side, changes: Change[]) => {
    const toId = ids[to];
    const fromId = ids[other(to)];
    if (toId && fromId && changes.length > 0) setAsk({ to, toId, fromId, changes });
  };

  const allButton = (from: Side) => {
    const to = other(from);
    const n = countable(from);
    if (!writes || n === 0) return null;
    const more = n > MAX_MODEL_CHANGES ? ` (first ${MAX_MODEL_CHANGES})` : '';
    return (
      <Button
        variant="outline"
        size="2xs"
        disabled={pending}
        onClick={() =>
          askFor(
            to,
            copyAllLines(lines, from, (k) => spec.may(k)),
          )
        }
      >
        {from === 'left' ? null : <ArrowLeft aria-hidden />}
        Copy {n === 1 ? '1 model' : `${n} models`} to {name(to)}
        {more}
        {from === 'left' ? <ArrowRight aria-hidden /> : null}
      </Button>
    );
  };

  const askTo = ask ? name(ask.to) : '';
  const askFrom = ask ? name(other(ask.to)) : '';
  const one = ask?.changes.length === 1 ? ask.changes[0]! : null;
  const was = one && ask ? lines.find((l) => l.key === one.key)?.[ask.to] : null;
  const plural = (n: number) => (n === 1 ? spec.noun : `${spec.noun}s`);

  return (
    <section className="space-y-2" aria-label={spec.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="text-sm font-medium">{spec.title}</h4>
        <p className="text-sm text-muted-foreground">
          {rows.length < 2
            ? 'Link a second box to compare.'
            : differing === 0
              ? 'The same on both boxes.'
              : `${differing} ${plural(differing)} ${differing === 1 ? 'differs' : 'differ'}.`}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {allButton('left')}
          {allButton('right')}
        </div>
      </div>
      <div className="rounded-lg border border-border">
        <Table aria-label={`${spec.title} on two boxes`} className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[22%] pl-3">{spec.head}</TableHead>
              <TableHead className="w-[39%]">
                <BoxPicker
                  label={`${spec.title}: left box`}
                  rows={rows}
                  value={ids.left}
                  taken={ids.right}
                  onChange={pair.setLeft}
                />
              </TableHead>
              <TableHead className="w-[39%] pr-3">
                {rows.length > 1 && (
                  <BoxPicker
                    label={`${spec.title}: right box`}
                    rows={rows}
                    value={ids.right}
                    taken={ids.left}
                    onChange={pair.setRight}
                  />
                )}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  No {spec.noun} differs on these two boxes.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((line) => {
                const note = status(line);
                return (
                  <TableRow
                    key={line.key}
                    className={cn(line.differs && 'bg-warning/5 hover:bg-warning/10')}
                  >
                    <TableCell className="pl-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{line.key}</span>
                        {line.differs && <Pill tone="warn">differs</Pill>}
                        {line.oneSided && <Pill>one box</Pill>}
                        {line.differs &&
                          line.leftProvider &&
                          line.rightProvider &&
                          line.leftProvider !== line.rightProvider && <Pill>other provider</Pill>}
                      </div>
                      {note && <div className="mt-1">{note}</div>}
                    </TableCell>
                    <TableCell className="align-top font-mono text-[13px]">
                      <div className="flex items-start justify-between gap-1">
                        <ModelText model={line.left} provider={line.leftProvider} />
                        {copyButton(line, 'left')}
                      </div>
                    </TableCell>
                    <TableCell className="pr-3 align-top font-mono text-[13px]">
                      <div className="flex items-start gap-1">
                        {copyButton(line, 'right')}
                        <ModelText model={line.right} provider={line.rightProvider} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <ConfirmSend
        open={ask !== null}
        pending={pending}
        title={
          one
            ? `Set ${one.key} to ${one.model} on ${askTo}?`
            : `Copy ${ask?.changes.length ?? 0} models from ${askFrom} to ${askTo}?`
        }
        action={one ? 'Set model' : 'Copy models'}
        onCancel={() => setAsk(null)}
        onConfirm={() => void confirm()}
      >
        {one
          ? `${askTo} runs ${was || 'no model'} for it now. `
          : `${ask?.changes.map((c) => c.key).join(', ')}. `}
        {askTo} checks its own model policy first. If it refuses, it keeps the model it had.{' '}
        {spec.keeps}
      </ConfirmSend>
    </section>
  );
}

const AGENTS = {
  title: 'Agents',
  head: 'Agent',
  noun: 'agent',
  read: agentRun,
  may: () => true,
  path: FLEET_MODELS_PATH,
  change: (c: Change) => ({ slug: c.key, model: c.model }),
  match: agentChange,
  keeps: 'The agent keeps its provider and key.',
} satisfies Omit<Spec, 'keys'>;

const WORKERS = {
  title: 'AI workers',
  head: 'Worker',
  noun: 'worker',
  read: workerRun,
  may: workerKindSettable,
  path: FLEET_SETTINGS_PATH,
  change: (c: Change): FleetWriteChange => ({
    kind: 'workerModel',
    worker: c.key,
    provider: c.provider,
    model: c.model,
  }),
  match: workerChange,
  keeps: 'The worker that runs this kind keeps its provider and key.',
} satisfies Omit<Spec, 'keys'>;

/**
 * Models, two boxes at a time (owner, 2026-11-12: a column per box does
 * not scale to 50 boxes). Each column head picks its box. A row whose
 * boxes differ is marked; one click puts one side's model on the other box
 * (one fleet write, after one question), so one box set up well can be
 * carried to the rest. Agents by shipped slug, AI workers by kind.
 */
export function ModelCompare({
  rows,
  boxes,
  refresh,
}: {
  rows: FleetMatrixRow[];
  boxes: readonly FleetBox[];
  refresh: () => void;
}) {
  const [leftParam, setLeft] = useParam('left');
  const [rightParam, setRight] = useParam('right');
  const [onlyDiffer, setOnlyDiffer] = useState(false);
  // This box: the brain this page reads (its API origin, or the page's own).
  const origin = typeof window === 'undefined' ? null : runtimeApiBase() || window.location.origin;
  const [defLeft] = defaultPair(rows, origin);
  const has = (id: string | null) => id !== null && rows.some((r) => r.id === id);
  const leftId = has(leftParam) ? leftParam : defLeft;
  const rightId =
    has(rightParam) && rightParam !== leftId
      ? rightParam
      : (rows.find((r) => r.id !== leftId)?.id ?? null);
  const pair: Pair = {
    rows,
    boxes,
    ids: { left: leftId, right: rightId },
    setLeft,
    setRight,
    onlyDiffer,
    writes: fleetWritesOffered(boxes),
    refresh,
  };
  const slugs = shippedSlugs(rows);
  const kinds = workerKinds(rows);
  return (
    <Part
      title="Models, two boxes"
      action={<ScreenLink href={ccHref('models')}>Set a model</ScreenLink>}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Pick a box in each column. An arrow puts that model on the other box.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Switch id="matrix-only-differ" checked={onlyDiffer} onCheckedChange={setOnlyDiffer} />
          <Label htmlFor="matrix-only-differ" className="text-xs font-normal">
            Differs only
          </Label>
        </div>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className="space-y-6">
          {slugs.length > 0 && <CompareTable spec={{ ...AGENTS, keys: slugs }} pair={pair} />}
          {kinds.length > 0 && <CompareTable spec={{ ...WORKERS, keys: kinds }} pair={pair} />}
        </div>
      </TooltipProvider>
    </Part>
  );
}
