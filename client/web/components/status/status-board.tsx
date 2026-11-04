'use client';

import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Power,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@mantle/web-ui/ui/card';
import { Skeleton } from '@mantle/web-ui/ui/skeleton';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatBytes, formatCount, formatUptime } from '@mantle/web-ui/lib/format-bytes';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { ProviderAlertCard } from '@/components/needs-you/provider-alert-card';
import {
  overallText,
  pctLevel,
  sidecarTally,
  type Level,
  type ProcessState,
  type SectionId,
  type SidecarState,
} from '@/lib/status';
import { BrainBreakdown } from './brain-breakdown';
import { BrainStats } from './brain-stats';
import { BuildCard } from './build-card';
import { CapacityDial } from './capacity-dial';
import { IngestChart } from './ingest-chart';
import { OpsPanels } from './ops-panels';
import { SpendChart } from './spend-chart';
import {
  Figure,
  Gauge,
  LEVEL_INK,
  LevelDot,
  LevelPill,
  Sparkline,
  StatusSection,
} from './status-parts';
import { SECTIONS } from './status-sections';
import type { StatusData } from './use-status';

const bytes = (n: number | null | undefined) => (n == null ? 'n/a' : formatBytes(n));
const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'n/a' : `${Math.round(v)}%`;

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : formatDistanceToNowStrict(d, { addSuffix: true });
}

/** The words for a section's level in its heading pill. */
function levelWord(level: Level): string {
  return level === 'crit'
    ? 'Problem'
    : level === 'warn'
      ? 'Watch'
      : level === 'unknown'
        ? 'Loading'
        : 'Healthy';
}

function title(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)!.title;
}
function description(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)!.description;
}

/**
 * The Status board: every section, top to bottom, in the detail pane. Each
 * section is an anchor the list scrolls to. It reads what `useStatus`
 * fetched; a part whose answer has not come shows a skeleton, and a part a
 * brain does not serve (an older brain) is left out with a line saying so.
 */
export function StatusBoard({
  status,
  onJump,
}: {
  status: StatusData;
  onJump: (id: SectionId) => void;
}) {
  return (
    <div className="@container/status space-y-10 p-6">
      <Overview status={status} onJump={onJump} />
      <Compute status={status} />
      <Brain status={status} />
      <Spend status={status} />
      <Queues status={status} />
      <Sidecars status={status} />
      <Providers status={status} />
      <Version status={status} />
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-4 text-sm">
        <Link href="/debug" className="text-primary-ink underline-offset-2 hover:underline">
          Operator view
        </Link>
        <Link href="/traces" className="text-primary-ink underline-offset-2 hover:underline">
          Traces
        </Link>
        <Link
          href="/debug/integrity"
          className="text-primary-ink underline-offset-2 hover:underline"
        >
          Integrity checks
        </Link>
      </footer>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────

function Overview({ status, onJump }: { status: StatusData; onJump: (id: SectionId) => void }) {
  const { health, issues } = status;
  const overall: Level = !health.data
    ? 'unknown'
    : issues.some((i) => i.level === 'crit')
      ? 'crit'
      : issues.length
        ? 'warn'
        : 'ok';
  const h = health.data?.host;
  const box = status.box.data?.box;
  const t = sidecarTally(status.sidecars);
  const cpuHist = status.history.map((s) => s.cpu);
  const memHist = status.history.map((s) => s.mem);
  const spend7 = status.dashboard.data?.spend30.slice(-14).map((d) => d.costMicroUsd / 1e6) ?? [];

  return (
    <section
      id="status-overview"
      aria-labelledby="status-overview-h"
      className="scroll-mt-4 space-y-4"
    >
      <Card
        className={cn(
          'overflow-hidden border-l-4 bg-card/70',
          overall === 'ok' && 'border-l-success',
          overall === 'warn' && 'border-l-warning',
          overall === 'crit' && 'border-l-destructive',
          overall === 'unknown' && 'border-l-border',
        )}
      >
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-full',
                overall === 'ok' && 'bg-success/15',
                overall === 'warn' && 'bg-warning/15',
                overall === 'crit' && 'bg-destructive/15',
                overall === 'unknown' && 'bg-muted',
              )}
            >
              {overall === 'ok' ? (
                <ShieldCheck className={cn('size-6', LEVEL_INK.ok)} aria-hidden />
              ) : overall === 'unknown' ? (
                <RefreshCw className="size-5 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <AlertTriangle className={cn('size-6', LEVEL_INK[overall])} aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <h2 id="status-overview-h" className="text-xl font-semibold">
                {health.data ? overallText(issues) : 'Reading the box'}
              </h2>
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <LevelDot level={health.isError ? 'warn' : overall} pulse />
                {health.isError
                  ? 'The last reading failed; showing the one before'
                  : health.data
                    ? `Live, updated ${new Date(health.data.ts).toLocaleTimeString()}`
                    : 'Waiting for the first reading'}
                {box && <span>· up {formatUptime(box.process.uptimeSec)}</span>}
              </p>
            </div>
          </div>
          {issues.length > 0 && (
            <ul className="w-full space-y-1.5 @2xl/status:w-auto @2xl/status:max-w-md">
              {issues.slice(0, 6).map((i) => (
                <li key={`${i.section}:${i.text}`}>
                  <RowButton
                    onClick={() => onJump(i.section)}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <LevelDot level={i.level} />
                    <span className={cn('min-w-0 flex-1 truncate', LEVEL_INK[i.level])}>
                      {i.text}
                    </span>
                    <ArrowRight
                      className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </RowButton>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 @md/status:grid-cols-2 @4xl/status:grid-cols-4">
        <Tile
          label="Processor"
          value={pct(h?.cpuLoadPct)}
          hint={h ? `${h.cpuCores} cores · load ${h.loadAvg[0]?.toFixed(2) ?? 'n/a'}` : undefined}
          level={pctLevel(h?.cpuLoadPct)}
          onClick={() => onJump('compute')}
        >
          <Sparkline data={cpuHist} max={100} label="Processor load, last ten minutes" />
        </Tile>
        <Tile
          label="Memory"
          value={pct(h?.mem?.usedPct)}
          hint={h?.mem ? `${bytes(h.mem.usedBytes)} of ${bytes(h.mem.totalBytes)}` : undefined}
          level={pctLevel(h?.mem?.usedPct)}
          onClick={() => onJump('compute')}
        >
          <Sparkline
            data={memHist}
            max={100}
            color="var(--chart-2)"
            label="Memory in use, last ten minutes"
          />
        </Tile>
        <Tile
          label="Sidecars"
          value={health.data || status.services.data ? `${t.up} / ${t.on}` : 'n/a'}
          hint={t.down ? `${t.down} not answering` : 'running of those switched on'}
          level={health.data ? (t.down ? 'crit' : 'ok') : 'unknown'}
          onClick={() => onJump('sidecars')}
        >
          <SidecarStrip sidecars={status.sidecars} />
        </Tile>
        <Tile
          label="Spend today"
          value={box?.spend ? formatMicroUsd(box.spend.last24hMicroUsd) : 'n/a'}
          hint={
            box?.spend
              ? `${formatCount(box.spend.traces24h)} model calls, ${formatCount(box.spend.errors24h)} failed`
              : status.dashboard.data
                ? 'last 14 days'
                : undefined
          }
          level={box?.spend || status.dashboard.data ? 'ok' : 'unknown'}
          neutral
          onClick={() => onJump('spend')}
        >
          <Sparkline data={spend7} color="var(--chart-3)" label="Spend per day, last 14 days" />
        </Tile>
      </div>
    </section>
  );
}

/** A big-number tile: label, value in its level's ink, a hint, a visual. */
function Tile({
  label,
  value,
  hint,
  level,
  neutral = false,
  onClick,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  level: Level;
  /** Money is not good or bad: keep the value in plain ink. */
  neutral?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <RowButton
      onClick={onClick}
      className="group flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card/70 p-4 shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <LevelDot level={level} />
      </div>
      <div
        className={cn(
          'text-3xl font-semibold tabular-nums tracking-tight',
          !neutral && (level === 'warn' || level === 'crit') && LEVEL_INK[level],
        )}
      >
        {value}
      </div>
      {children}
      <div className="truncate text-xs text-muted-foreground">{hint ?? ' '}</div>
    </RowButton>
  );
}

/** One slim bar per sidecar, coloured by its level: the fleet at a glance. */
function SidecarStrip({ sidecars }: { sidecars: SidecarState[] }) {
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden>
      {sidecars.map((s) => (
        <span
          key={s.id}
          title={`${s.title}: ${s.label}`}
          className={cn(
            'w-full rounded-sm',
            s.level === 'ok' && 'h-full bg-success/70',
            s.level === 'warn' && 'h-3/4 bg-warning',
            s.level === 'crit' && 'h-full bg-destructive',
            s.level === 'idle' && 'h-1/4 bg-muted-foreground/25',
            s.level === 'unknown' && 'h-1/2 bg-muted-foreground/20',
          )}
        />
      ))}
    </div>
  );
}

// ── Compute ─────────────────────────────────────────────────────────────

function Compute({ status }: { status: StatusData }) {
  const level = status.level('compute');
  const data = status.health.data;
  if (!data) {
    return (
      <StatusSection
        id="compute"
        title={title('compute')}
        description={description('compute')}
        level="unknown"
        levelText="Loading"
      >
        <Skeleton className="h-64 w-full rounded-xl" />
      </StatusSection>
    );
  }
  const { host, postgres } = data;
  const box = status.box.data?.box;
  const hist = status.history;
  return (
    <StatusSection
      id="compute"
      title={title('compute')}
      description={`${description('compute')} Measured ${data.scope === 'host' ? 'on the host' : 'inside the brain container'}.`}
      level={level}
      levelText={levelWord(level)}
    >
      <Card className="bg-card/70">
        <CardContent className="grid grid-cols-1 gap-6 p-5 @xl/status:grid-cols-3">
          <GaugeWithHistory
            label="CPU"
            pct={host.cpuLoadPct}
            caption={`${host.cpuCores} cores · load ${host.loadAvg.map((l) => l.toFixed(2)).join(' / ')}`}
            history={hist.map((s) => s.cpu)}
            color="var(--chart-1)"
          />
          <GaugeWithHistory
            label="Memory"
            pct={host.mem?.usedPct ?? null}
            caption={
              host.mem ? `${bytes(host.mem.usedBytes)} of ${bytes(host.mem.totalBytes)}` : 'n/a'
            }
            history={hist.map((s) => s.mem)}
            color="var(--chart-2)"
          />
          <GaugeWithHistory
            label="Disk"
            pct={host.disk?.usedPct ?? null}
            caption={
              host.disk
                ? `${bytes(host.disk.totalBytes - host.disk.usedBytes)} free of ${bytes(host.disk.totalBytes)}`
                : 'n/a'
            }
            history={hist.map((s) => s.disk)}
            color="var(--chart-4)"
          />
        </CardContent>
        <div className="grid grid-cols-2 gap-4 border-t px-5 py-4 @xl/status:grid-cols-4">
          <Figure
            label="Brain process"
            value={formatUptime(host.uptimeSec)}
            hint={`${bytes(host.rssBytes)} resident · ${bytes(host.heapUsedBytes)} heap`}
          />
          <Figure
            label="Database"
            value={bytes(postgres.dbSizeBytes)}
            hint={postgres.up ? 'Postgres answering' : 'Postgres not answering'}
          />
          <Figure
            label="Connections"
            value={postgres.connections == null ? 'n/a' : formatCount(postgres.connections)}
            hint="open to the database"
          />
          <Figure
            label="Cache hit"
            value={pct(postgres.cacheHitPct)}
            hint="reads served from memory"
          />
        </div>
        {postgres.topTables.length > 0 && (
          <div className="space-y-2 border-t px-5 py-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Database className="size-3.5" aria-hidden /> Largest tables
            </div>
            <TableBars tables={postgres.topTables} />
          </div>
        )}
        {box?.logins && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden />
            <span>
              <b className="text-foreground">{box.logins.admin}</b> admins
            </span>
            <span>
              <b className="text-foreground">{box.logins.member}</b> members
            </span>
            {box.logins.disabled > 0 && (
              <span>
                <b className="text-foreground">{box.logins.disabled}</b> disabled
              </span>
            )}
          </div>
        )}
      </Card>
    </StatusSection>
  );
}

function GaugeWithHistory({
  label,
  pct: value,
  caption,
  history,
  color,
}: {
  label: string;
  pct: number | null;
  caption: string;
  history: (number | null)[];
  color: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <Gauge pct={value} level={pctLevel(value)} label={label} caption={caption} />
      <div className="w-full max-w-56 space-y-0.5">
        <Sparkline data={history} max={100} color={color} label={`${label}, last ten minutes`} />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>10 min ago</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}

function TableBars({ tables }: { tables: { name: string; bytes: number }[] }) {
  const max = Math.max(...tables.map((t) => t.bytes), 1);
  return (
    <ul className="space-y-1.5">
      {tables.map((t) => (
        <li
          key={t.name}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs"
        >
          <span className="truncate font-mono text-muted-foreground">{t.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-chart-1"
              style={{ width: `${(t.bytes / max) * 100}%` }}
            />
          </span>
          <span className="tabular-nums">{bytes(t.bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Brain ───────────────────────────────────────────────────────────────

function Brain({ status }: { status: StatusData }) {
  const d = status.dashboard.data;
  const level = status.level('brain');
  return (
    <StatusSection
      id="brain"
      title={title('brain')}
      description={description('brain')}
      level={level}
      levelText={levelWord(level)}
    >
      {!d ? (
        status.dashboard.isError ? (
          <Unavailable text="The brain numbers did not load." />
        ) : (
          <Skeleton className="h-72 w-full rounded-xl" />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 @3xl/status:grid-cols-2">
          <CapacityDial capacity={d.capacity} />
          <BrainStats vectors={d.vectors} brain={d.brain} integrity={d.integrity} />
          <IngestChart data={d.ingest} />
          <BrainBreakdown
            nodesByType={d.brain.nodesByType}
            entitiesByKind={d.brain.entitiesByKind}
          />
        </div>
      )}
    </StatusSection>
  );
}

// ── Spend ───────────────────────────────────────────────────────────────

function Spend({ status }: { status: StatusData }) {
  const d = status.dashboard.data;
  const spend = status.box.data?.box.spend;
  const level = status.level('spend');
  const errRate = spend && spend.traces24h > 0 ? (spend.errors24h / spend.traces24h) * 100 : null;
  return (
    <StatusSection
      id="spend"
      title={title('spend')}
      description={description('spend')}
      level={level}
      levelText={levelWord(level)}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/debug/spend">By model and agent</Link>
        </Button>
      }
    >
      {spend && (
        <Card className="bg-card/70">
          <CardContent className="grid grid-cols-2 gap-4 p-5 @2xl/status:grid-cols-3 @4xl/status:grid-cols-6">
            <Figure label="Last 24 hours" value={formatMicroUsd(spend.last24hMicroUsd)} />
            <Figure label="Last 7 days" value={formatMicroUsd(spend.last7dMicroUsd)} />
            <Figure label="Last 30 days" value={formatMicroUsd(spend.last30dMicroUsd)} />
            <Figure label="Model calls, 24 h" value={formatCount(spend.traces24h)} />
            <Figure label="Assistant turns, 24 h" value={formatCount(spend.turns24h)} />
            <Figure
              label="Failed, 24 h"
              value={
                <span className={cn(errRate != null && errRate >= 10 && LEVEL_INK.warn)}>
                  {formatCount(spend.errors24h)}
                  {errRate != null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {errRate.toFixed(errRate < 1 ? 1 : 0)}%
                    </span>
                  )}
                </span>
              }
            />
          </CardContent>
        </Card>
      )}
      {d ? <SpendChart data={d.spend30} /> : <Skeleton className="h-72 w-full rounded-xl" />}
    </StatusSection>
  );
}

// ── Queues and workers ──────────────────────────────────────────────────

function Queues({ status }: { status: StatusData }) {
  const level = status.level('queues');
  const box = status.box.data;
  const ex = box?.box.extraction;
  const parser = status.health.data?.parser;
  const d = status.dashboard.data;
  return (
    <StatusSection
      id="queues"
      title={title('queues')}
      description={description('queues')}
      level={level}
      levelText={levelWord(level)}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/runners">Runner queue</Link>
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 @3xl/status:grid-cols-2">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Background jobs</CardTitle>
            <CardDescription>Extraction reads new content; the parser reads files.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ex ? (
              <QueueBar
                segments={[
                  { label: 'Running', value: ex.running, className: 'bg-chart-1' },
                  { label: 'Waiting', value: ex.waiting, className: 'bg-chart-2' },
                  { label: 'Retrying', value: ex.retrying, className: 'bg-warning' },
                  { label: 'Gave up', value: ex.deadLettered, className: 'bg-destructive' },
                ]}
                footer={`${formatCount(ex.doneLast10Min)} done in the last 10 minutes`}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {status.box.isPending
                  ? 'Loading the extraction queue.'
                  : 'This brain does not report its extraction queue yet.'}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 border-t pt-3">
              <Figure
                label="Parser"
                value={parser ? (parser.up ? 'Up' : 'Down') : 'n/a'}
                hint={
                  parser?.running != null
                    ? `${parser.running} running, ${parser.queued ?? 0} queued`
                    : undefined
                }
              />
              <Figure
                label="Approvals"
                value={d ? formatCount(d.pendingTools) : 'n/a'}
                hint="tool calls waiting"
              />
              <Figure
                label="Telegram"
                value={d ? formatCount(d.telegram.unprocessed) : 'n/a'}
                hint="messages not processed"
              />
            </div>
          </CardContent>
        </Card>
        <Processes
          processes={status.processes}
          known={!!box?.containers}
          checkedAt={box?.containersCheckedAt ?? null}
        />
      </div>
      {d && (
        <OpsPanels
          email={d.email}
          telegram={d.telegram}
          heartbeats={d.heartbeats}
          topErrors={d.errs}
          recentFailures={d.fails}
        />
      )}
    </StatusSection>
  );
}

/** A stacked bar with a legend: the parts of one queue. */
function QueueBar({
  segments,
  footer,
}: {
  segments: { label: string; value: number; className: string }[];
  footer: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? (
              <span
                key={s.label}
                className={cn('h-full', s.className)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
            <span className={cn('size-2 rounded-sm', s.className)} aria-hidden />
            {s.label}
            <b className="tabular-nums text-foreground">{formatCount(s.value)}</b>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {total === 0 ? 'Queue empty. ' : ''}
        {footer}
      </p>
    </div>
  );
}

function Processes({
  processes,
  known,
  checkedAt,
}: {
  processes: ProcessState[];
  known: boolean;
  checkedAt: string | null;
}) {
  const shown = processes.filter((p) => p.level !== 'idle');
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardTitle className="text-base">Brain processes</CardTitle>
        <CardDescription>
          {known
            ? `As docker reports them, checked ${ago(checkedAt)}. Autoheal restarts a worker that stops.`
            : 'This box does not report its containers yet: its updater is older than this screen.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2 @lg/status:grid-cols-2">
          {(known ? shown : processes).map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-2.5 text-sm">
              <LevelDot level={p.level} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.role}</span>
              </span>
              <span className="shrink-0 text-right text-xs">
                <span className={cn('block', LEVEL_INK[p.level])}>{p.label}</span>
                {p.restarts != null && p.restarts > 0 && (
                  <span className="block text-muted-foreground">
                    {p.restarts} restart{p.restarts === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ── Sidecars ────────────────────────────────────────────────────────────

function Sidecars({ status }: { status: StatusData }) {
  const level = status.level('sidecars');
  const t = sidecarTally(status.sidecars);
  const switchable = status.sidecars.filter((s) => !s.alwaysOn);
  const always = status.sidecars.filter((s) => s.alwaysOn);
  const reason =
    status.services.data?.switching.available === false
      ? status.services.data.switching.reason
      : null;
  return (
    <StatusSection
      id="sidecars"
      title={title('sidecars')}
      description={`${t.up} of ${t.on} switched-on sidecars answer. Switch the optional ones on Services.`}
      level={level}
      levelText={levelWord(level)}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/services">
            <Power aria-hidden /> Services
          </Link>
        </Button>
      }
    >
      {reason && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {reason}
        </p>
      )}
      <SidecarGroup title="Switchable" sidecars={switchable} />
      <SidecarGroup title="Always on" sidecars={always} />
    </StatusSection>
  );
}

function SidecarGroup({ title: heading, sidecars }: { title: string; sidecars: SidecarState[] }) {
  if (sidecars.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <ul className="grid grid-cols-1 gap-3 @xl/status:grid-cols-2 @4xl/status:grid-cols-3">
        {sidecars.map((s) => (
          <li key={s.id}>
            <SidecarCard s={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidecarCard({ s }: { s: SidecarState }) {
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-2 rounded-xl border border-border bg-card/70 p-4 shadow-sm',
        s.level === 'crit' && 'border-destructive/50',
        s.level === 'warn' && 'border-warning/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{s.title}</div>
          <div className="truncate text-xs text-muted-foreground">{s.engine}</div>
        </div>
        <LevelPill level={s.level}>{s.label}</LevelPill>
      </div>
      <p className="text-sm text-muted-foreground">{s.role}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">
          {[
            s.detail,
            s.startedAt && s.level !== 'idle'
              ? `up since ${ago(s.startedAt).replace(' ago', '')}`
              : null,
            s.restarts ? `${s.restarts} restart${s.restarts === 1 ? '' : 's'}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || ' '}
        </span>
        {s.switchHref ? (
          <Link
            href={s.switchHref}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-primary-ink underline-offset-2 hover:underline"
          >
            <Power className="size-3.5" aria-hidden />
            {s.level === 'idle' ? 'Switch on' : 'Switch'}
          </Link>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden /> Always on
          </span>
        )}
      </div>
    </div>
  );
}

// ── Providers ───────────────────────────────────────────────────────────

function Providers({ status }: { status: StatusData }) {
  const level = status.level('providers');
  const e = status.health.data?.embedder;
  const docs = status.health.data?.documents;
  return (
    <StatusSection
      id="providers"
      title={title('providers')}
      description={description('providers')}
      level={level}
      levelText={levelWord(level)}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/embedding">Embedding</Link>
        </Button>
      }
    >
      <ProviderAlertCard showLink />
      <div className="grid grid-cols-1 gap-4 @3xl/status:grid-cols-2">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              Embedder
              {e && (
                <LevelPill level={e.up === true ? 'ok' : e.up === false ? 'crit' : 'unknown'}>
                  {e.up === true ? 'Answering' : e.up === false ? 'Failing' : 'Not probed'}
                </LevelPill>
              )}
            </CardTitle>
            <CardDescription>Turns text into search vectors for every new item.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {e ? (
              <>
                <Figure
                  label="Provider"
                  value={e.provider ?? 'n/a'}
                  hint={
                    e.scope === 'local'
                      ? 'on this box'
                      : e.scope === 'remote'
                        ? 'online'
                        : undefined
                  }
                />
                <Figure
                  label="Model"
                  value={<span className="text-sm">{e.model ?? 'n/a'}</span>}
                  hint={e.detail ?? undefined}
                />
              </>
            ) : (
              <Skeleton className="col-span-2 h-12" />
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Outages</CardTitle>
            <CardDescription>
              Embedding and extraction calls the brain could not make.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {status.alerts.length === 0 ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className={cn('size-4', LEVEL_INK.ok)} aria-hidden />
                No open outages.
              </p>
            ) : (
              status.alerts.map((a) => (
                <p key={`${a.subject}:${a.code}`} className="flex items-center gap-2">
                  <LevelDot level={a.permanent ? 'crit' : 'warn'} />
                  <span className="min-w-0 truncate">
                    {a.subject === 'embedding' ? 'Embeddings' : 'Extraction'}: {a.reason}
                  </span>
                </p>
              ))
            )}
            {docs && (
              <p className="flex items-center gap-2 border-t pt-2 text-muted-foreground">
                <LevelDot level={docs.up === true ? 'ok' : docs.up === false ? 'crit' : 'idle'} />
                Documents engine{' '}
                {docs.up === true ? 'answering' : docs.up === false ? 'not answering' : 'off'}
                {docs.version ? ` · ${docs.version}` : ''}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </StatusSection>
  );
}

// ── Version and updates ─────────────────────────────────────────────────

function Version({ status }: { status: StatusData }) {
  const level = status.level('version');
  const u = status.updates.data;
  const b = status.backups.data;
  const runningUpdate =
    u?.status && ['requested', 'pulling', 'rolling'].includes(u.status.phase) ? u.status : null;
  const lastBackupLevel: Level = !b
    ? 'unknown'
    : !b.config.enabled
      ? 'idle'
      : !b.status
        ? 'warn'
        : b.status.ok
          ? 'ok'
          : 'crit';
  return (
    <StatusSection
      id="version"
      title={title('version')}
      description={description('version')}
      level={level}
      levelText={levelWord(level)}
    >
      <div className="grid grid-cols-1 gap-4 @3xl/status:grid-cols-3">
        <BuildCard />
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              Updates
              {u && (
                <LevelPill level={u.check.updateAvailable ? 'warn' : 'ok'}>
                  {u.check.updateAvailable ? 'Available' : 'Up to date'}
                </LevelPill>
              )}
            </CardTitle>
            <CardDescription>
              {u ? `Checked ${ago(u.check.checkedAt)}` : 'Checking for a newer release'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {u ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">This box</span>
                  <span className="font-mono tabular-nums">v{u.check.currentVersion}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Newest release</span>
                  <span className="font-mono tabular-nums">
                    {u.check.latest ? u.check.latest.tag : 'n/a'}
                  </span>
                </div>
                {runningUpdate && (
                  <p className="flex items-center gap-2 text-info-ink">
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                    Updating to {runningUpdate.target}
                  </p>
                )}
                {!u.available && (
                  <p className="text-xs text-muted-foreground">
                    No updater sidecar: this box updates from the server.
                  </p>
                )}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/settings/updates">Open Updates</Link>
                </Button>
              </>
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              Backups
              <LevelPill level={lastBackupLevel}>
                {lastBackupLevel === 'idle'
                  ? 'Off'
                  : lastBackupLevel === 'crit'
                    ? 'Failed'
                    : lastBackupLevel === 'warn'
                      ? 'None yet'
                      : lastBackupLevel === 'ok'
                        ? 'Good'
                        : 'Loading'}
              </LevelPill>
            </CardTitle>
            <CardDescription>
              {b?.config.enabled
                ? `Every ${b.config.frequency === 'weekly' ? 'week' : 'day'} at ${String(b.config.hour).padStart(2, '0')}:00, keeping ${b.config.keep}`
                : b
                  ? 'Scheduled backups are off'
                  : 'Reading the backup schedule'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {b ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden /> Last run
                  </span>
                  <span>{ago(b.status?.lastRunAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <CheckCircle2 className="size-3.5" aria-hidden /> Last good
                  </span>
                  <span>
                    {ago(b.status?.lastSuccessAt ?? (b.status?.ok ? b.status.lastRunAt : null))}
                  </span>
                </div>
                {b.status?.bytes != null && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <HardDrive className="size-3.5" aria-hidden /> Size
                    </span>
                    <span className="tabular-nums">{bytes(b.status.bytes)}</span>
                  </div>
                )}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/settings/backups">Open Backups</Link>
                </Button>
              </>
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>
      </div>
    </StatusSection>
  );
}

function Unavailable({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
