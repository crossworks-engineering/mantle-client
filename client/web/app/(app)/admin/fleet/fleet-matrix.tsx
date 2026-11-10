'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { boxName } from '@/lib/fleet';
import {
  agentName,
  backupTone,
  countText,
  factsAge,
  factsReasonText,
  FLEET_MATRIX_KEY,
  FLEET_MATRIX_PATH,
  healthLabel,
  healthLevel,
  modelsInUse,
  signInLabel,
  type FleetFacts,
  type FleetMatrixRow,
} from '@/lib/fleet-matrix';
import type { Level } from '@/lib/status';
import { Section } from './fleet-section';

type MatrixAnswer = { boxes: FleetMatrixRow[] };

/** The one read of the whole matrix: its section and the model update share it. */
export const matrixQuery = {
  queryKey: FLEET_MATRIX_KEY,
  queryFn: () => apiFetch<MatrixAnswer>(FLEET_MATRIX_PATH),
  staleTime: 30_000,
};

const HEALTH_TONE: Record<Level, string> = {
  ok: 'text-success-ink',
  warn: 'text-warning-ink',
  crit: 'text-destructive-ink',
  idle: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

/** When the facts were read, and why they may be old. */
function FactsLine({ row }: { row: FleetMatrixRow }) {
  const age = factsAge(row);
  const reason = factsReasonText(row.factsReason);
  if (age === 'none') {
    return (
      <p className={`text-xs ${reason ? 'text-destructive-ink' : 'text-muted-foreground'}`}>
        No facts yet.{reason ? ` ${reason}` : ' They come with the next good run.'}
      </p>
    );
  }
  const read = `Read ${formatDateTime(row.facts!.at)}.`;
  if (age === 'fresh') return <p className="text-xs text-muted-foreground">{read}</p>;
  return (
    <p role="status" className="text-xs text-warning-ink">
      {read} {reason ?? 'No newer read.'} This may be out of date.
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function BackupText({ backup }: { backup: FleetFacts['backup'] }) {
  const tone = backupTone(backup);
  if (tone === 'none' || !backup)
    return <span className="text-muted-foreground">No backup yet</span>;
  if (tone === 'ok') return <span>{formatDateTime(backup.lastRunAt)}</span>;
  return (
    <span className="text-destructive-ink">
      Failed {formatDateTime(backup.lastRunAt)}.{' '}
      {backup.lastSuccessAt
        ? `Last good ${formatDateTime(backup.lastSuccessAt)}.`
        : 'No good backup yet.'}
    </span>
  );
}

function FactsGrid({ facts }: { facts: FleetFacts }) {
  const s = facts.status;
  const agentsOff = facts.agents.filter((a) => !a.enabled).length;
  const workersOff = facts.workers.filter((w) => !w.enabled).length;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
      <Fact label="Spend">
        {s?.spend
          ? `${formatMicroUsd(s.spend.last24hMicroUsd)} today · ${formatMicroUsd(s.spend.last30dMicroUsd)} in 30 days`
          : 'Not known'}
      </Fact>
      <Fact label="Company sign-in">{signInLabel(facts.signIn)}</Fact>
      <Fact label="Agents">
        {countText(facts.agents.length, agentsOff, 'agent')},{' '}
        {countText(facts.workers.length, workersOff, 'worker')}
      </Fact>
      <Fact label="Counts">
        {countText(facts.counts.workspaces, 0, 'workspace')},{' '}
        {countText(facts.counts.apps, 0, 'app')}
        {s?.logins ? `, ${countText(s.logins.total, s.logins.disabled, 'login')}` : ''}
      </Fact>
      <Fact label="Last backup">
        <BackupText backup={facts.backup} />
      </Fact>
    </dl>
  );
}

function ModelList({ facts }: { facts: FleetFacts }) {
  const models = modelsInUse(facts);
  if (models.length === 0) return <p className="text-xs text-muted-foreground">No model in use.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Models in use">
      {models.map((m) => (
        <li key={`${m.provider}/${m.model}`}>
          <Badge variant="outline" className="font-mono text-[11px] font-normal">
            {m.provider} · {m.model}
            {m.uses > 1 ? ` ×${m.uses}` : ''}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Every agent and worker of one box, read with `?box=<id>`. */
function BoxDetail({ row, onClose }: { row: FleetMatrixRow; onClose: () => void }) {
  const query = useQuery({
    queryKey: [...FLEET_MATRIX_KEY, row.id],
    queryFn: () => apiFetch<MatrixAnswer>(`${FLEET_MATRIX_PATH}?box=${encodeURIComponent(row.id)}`),
    staleTime: 30_000,
  });
  const fresh = query.data?.boxes[0] ?? row;
  const facts = fresh.facts;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{boxName(fresh)}</DialogTitle>
          <DialogDescription>
            Each agent and AI worker, with its provider and model.
          </DialogDescription>
        </DialogHeader>
        <FactsLine row={fresh} />
        {query.isError && (
          <p role="status" className="text-xs text-destructive-ink">
            Could not read this box again. This shows the list as it was.
          </p>
        )}
        {facts && (
          <div className="space-y-4">
            <DetailList
              title="Agents"
              rows={facts.agents.map((a) => ({
                name: agentName(a),
                sub: a.role,
                provider: a.provider,
                model: a.model,
                enabled: a.enabled,
              }))}
            />
            <DetailList
              title="AI workers"
              rows={facts.workers.map((w) => ({
                name: w.kind,
                sub: null,
                provider: w.provider,
                model: w.model,
                enabled: w.enabled,
              }))}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailList({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; sub: string | null; provider: string; model: string; enabled: boolean }[];
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold">
        {title} ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r, i) => (
            <li key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.name}
                  {r.sub && <span className="font-normal text-muted-foreground"> · {r.sub}</span>}
                </p>
                <p className="break-all font-mono text-muted-foreground">
                  {r.provider} · {r.model || 'no model'}
                </p>
              </div>
              {!r.enabled && <Badge variant="outline">Off</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatrixRow({ row, onOpen }: { row: FleetMatrixRow; onOpen: () => void }) {
  const facts = row.facts;
  const level = healthLevel(facts?.status ?? null);
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{boxName(row)}</span>
            {facts && (
              <Badge variant="outline" className={HEALTH_TONE[level]}>
                {healthLabel(level)}
              </Badge>
            )}
            {facts?.status && (
              <span className="font-mono text-xs text-muted-foreground">
                v{facts.status.build.version}
              </span>
            )}
          </div>
          <FactsLine row={row} />
        </div>
        {facts && (
          <Button variant="outline" size="sm" onClick={onOpen}>
            Details
          </Button>
        )}
      </div>
      {facts && (
        <>
          <FactsGrid facts={facts} />
          <ModelList facts={facts} />
        </>
      )}
    </li>
  );
}

/**
 * The fleet matrix: per linked box its version, health, spend, sign-in mode,
 * agents with their models, the counts and the last backup. The control
 * service reads them each run; the Control Center keeps the last good answer.
 */
export function MatrixSection() {
  const [open, setOpen] = useState<FleetMatrixRow | null>(null);
  const query = useQuery(matrixQuery);
  const rows = query.data?.boxes ?? [];
  return (
    <Section title="Fleet matrix">
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError && !query.data ? (
        <p className="text-sm text-destructive-ink">Could not load the fleet matrix.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No box is linked.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Fleet matrix">
          {rows.map((row) => (
            <MatrixRow key={row.id} row={row} onOpen={() => setOpen(row)} />
          ))}
        </ul>
      )}
      {open && <BoxDetail row={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}
