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
import { FLEET_MATRIX_KEY, type FleetMatrixRow } from '@/lib/fleet-matrix';
import {
  canCopy,
  compareLines,
  copyAllChanges,
  defaultPair,
  FLEET_MODELS_PATH,
  MAX_MODEL_CHANGES,
  modelAnswer,
  modelWaiting,
  shippedSlugs,
  type CompareLine,
} from '@/lib/fleet-models';
import { answerText, fleetWritesOffered } from '@/lib/fleet-writes';
import { ccHref } from '@/lib/fleet-view';
import { Part, Pill, ScreenLink, useParam } from '../cc-kit';
import { ConfirmSend, useFleetSend } from '../fleet-writes';

type Side = 'left' | 'right';
type Change = { slug: string; model: string };
type Ask = { to: Side; changes: Change[] };

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

function ModelText({ model }: { model: string | null }) {
  if (model === null) return <span className="text-muted-foreground">Not on this box</span>;
  if (model === '') return <span className="text-muted-foreground">no model</span>;
  return <span className="break-all">{model}</span>;
}

/**
 * Agent models, two boxes at a time (owner, 2026-11-12: a column per box
 * does not scale to 50 boxes). Each column head picks its box. A row whose
 * boxes differ is marked; one click puts one side's model on the other box
 * (one fleet write, after one question), so one box set up well can be
 * carried to the rest.
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
  const queryClient = useQueryClient();
  const slugs = shippedSlugs(rows);
  const writes = fleetWritesOffered(boxes);
  const [leftParam, setLeftParam] = useParam('left');
  const [rightParam, setRightParam] = useParam('right');
  // This box: the brain this page reads (its API origin, or the page's own).
  const origin =
    typeof window === 'undefined' ? null : runtimeApiBase() || window.location.origin;
  const [defLeft] = defaultPair(rows, origin);
  const has = (id: string | null) => id !== null && rows.some((r) => r.id === id);
  const leftId = has(leftParam) ? leftParam : defLeft;
  const rightId =
    has(rightParam) && rightParam !== leftId
      ? rightParam
      : (rows.find((r) => r.id !== leftId)?.id ?? null);
  const ids: Record<Side, string | null> = { left: leftId, right: rightId };
  const row = (s: Side) => rows.find((r) => r.id === ids[s]);
  const box = (s: Side) => boxes.find((b) => b.id === ids[s]);
  const name = (s: Side) => {
    const r = row(s);
    return r ? boxName(r) : 'the other box';
  };

  const [onlyDiffer, setOnlyDiffer] = useState(false);
  // When this page sent a model for (box, agent): its answer shows from then.
  const [sent, setSent] = useState<Record<string, number>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const { pending, send } = useFleetSend(FLEET_MODELS_PATH, refresh);

  const lines = compareLines(slugs, row('left'), row('right'));
  const differing = lines.filter((l) => l.differs).length;
  const shown = onlyDiffer ? lines.filter((l) => l.differs || l.oneSided) : lines;
  const allTo: Record<Side, Change[]> = {
    right: copyAllChanges(lines, 'left'),
    left: copyAllChanges(lines, 'right'),
  };
  const countable = (from: Side) => lines.filter((l) => canCopy(l, from)).length;

  // An answer lands with the write result; the box's facts (the new model)
  // follow in the same run, a moment later: read the matrix again then.
  const answered = Object.entries(sent).filter(([key, since]) => {
    const [boxId, slug] = key.split('\u0000') as [string, string];
    return (
      modelAnswer(
        boxes.find((b) => b.id === boxId),
        slug,
        since,
      ) !== null
    );
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
    const target = ids[ask.to];
    if (!target) return;
    const at = Date.now() - 60_000; // the brain stamps it; allow for clock drift
    if (await send(ask.changes, [target], 'Could not send the model.')) {
      setSent((prev) => {
        const next = { ...prev };
        for (const c of ask.changes) next[`${target}\u0000${c.slug}`] = at;
        return next;
      });
      setAsk(null);
    }
  };

  const status = (line: CompareLine) => {
    for (const s of ['left', 'right'] as const) {
      const id = ids[s];
      if (!id) continue;
      const key = `${id}\u0000${line.slug}`;
      if (sent[key] === undefined) continue;
      if (modelWaiting(box(s), line.slug)) {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-info-ink">
            <Spinner size={12} /> Sending to {name(s)}
          </span>
        );
      }
      const a = modelAnswer(box(s), line.slug, sent[key]);
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
    if (!writes || !canCopy(line, from)) return null;
    const to = other(from);
    const label = `Use this model on ${name(to)}`;
    const Icon = from === 'left' ? ArrowRight : ArrowLeft;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-2xs"
            aria-label={`${label} (${line.slug})`}
            disabled={pending || modelWaiting(box(to), line.slug)}
            onClick={() => setAsk({ to, changes: [{ slug: line.slug, model: line[from]! }] })}
          >
            <Icon aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
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
        onClick={() => setAsk({ to, changes: allTo[to] })}
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
  const was = one && ask ? lines.find((l) => l.slug === one.slug)?.[ask.to] : null;

  return (
    <Part
      title="Agent models, two boxes"
      action={<ScreenLink href={ccHref('models')}>Set a model</ScreenLink>}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {rows.length < 2
            ? 'Link a second box to compare.'
            : differing === 0
              ? 'These two boxes run the same models.'
              : `${differing} ${differing === 1 ? 'agent differs' : 'agents differ'}.`}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {allButton('left')}
          {allButton('right')}
          <div className="flex items-center gap-2 pl-1">
            <Switch id="matrix-only-differ" checked={onlyDiffer} onCheckedChange={setOnlyDiffer} />
            <Label htmlFor="matrix-only-differ" className="text-xs font-normal">
              Differs only
            </Label>
          </div>
        </div>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className="rounded-lg border border-border">
          <Table aria-label="Agent models on two boxes" className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[22%] pl-3">Agent</TableHead>
                <TableHead className="w-[39%]">
                  <BoxPicker
                    label="Left box"
                    rows={rows}
                    value={leftId}
                    taken={rightId}
                    onChange={setLeftParam}
                  />
                </TableHead>
                <TableHead className="w-[39%] pr-3">
                  {rows.length > 1 && (
                    <BoxPicker
                      label="Right box"
                      rows={rows}
                      value={rightId}
                      taken={leftId}
                      onChange={setRightParam}
                    />
                  )}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                    No agent differs on these two boxes.
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((line) => {
                  const note = status(line);
                  return (
                    <TableRow
                      key={line.slug}
                      className={cn(line.differs && 'bg-warning/5 hover:bg-warning/10')}
                    >
                      <TableCell className="pl-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{line.slug}</span>
                          {line.differs && <Pill tone="warn">differs</Pill>}
                          {line.oneSided && <Pill>one box</Pill>}
                        </div>
                        {note && <div className="mt-1">{note}</div>}
                      </TableCell>
                      <TableCell className="align-top font-mono text-[13px]">
                        <div className="flex items-start justify-between gap-1">
                          <ModelText model={line.left} />
                          {copyButton(line, 'left')}
                        </div>
                      </TableCell>
                      <TableCell className="pr-3 align-top font-mono text-[13px]">
                        <div className="flex items-start gap-1">
                          {copyButton(line, 'right')}
                          <ModelText model={line.right} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>
      <ConfirmSend
        open={ask !== null}
        pending={pending}
        title={
          one
            ? `Set ${one.slug} to ${one.model} on ${askTo}?`
            : `Copy ${ask?.changes.length ?? 0} models from ${askFrom} to ${askTo}?`
        }
        action={one ? 'Set model' : 'Copy models'}
        onCancel={() => setAsk(null)}
        onConfirm={() => void confirm()}
      >
        {one
          ? `${askTo} runs ${was || 'no model'} for it now. `
          : `${ask?.changes.map((c) => c.slug).join(', ')}. `}
        {askTo} checks its own model policy first. If it refuses, it keeps the model it had. The
        agent keeps its provider and key.
      </ConfirmSend>
    </Part>
  );
}
