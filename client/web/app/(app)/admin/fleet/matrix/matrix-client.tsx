'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid3x3, Server } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Badge } from '@mantle/web-ui/ui/badge';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { boxName, type FleetBox, type FleetOverview } from '@/lib/fleet';
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
import { shippedSlugs } from '@/lib/fleet-models';
import { ccHref } from '@/lib/fleet-view';

import { pctLevel, type BoxStatus } from '@/lib/status';
import {
  Callout,
  DetailPane,
  Dot,
  FleetScreen,
  LEVEL_TONE,
  ListEmpty,
  ListPane,
  matrixQuery,
  Part,
  Pill,
  ScreenLink,
  Tile,
  Tiles,
  useParam,
  type MatrixAnswer,
} from '../cc-kit';
import { ModelCompare } from './model-compare';

const ALL = 'all';

function HealthPill({ row }: { row: FleetMatrixRow }) {
  if (!row.facts) return <Pill>No facts</Pill>;
  const level = healthLevel(row.facts.status);
  return <Pill tone={LEVEL_TONE[level]}>{healthLabel(level)}</Pill>;
}

/** When the facts were read, and why they may be old. Nothing while fresh. */
function FactsCallout({ row }: { row: FleetMatrixRow }) {
  const age = factsAge(row);
  const reason = factsReasonText(row.factsReason);
  if (age === 'none') {
    return (
      <Callout tone={reason ? 'bad' : 'info'} title="No facts yet">
        {reason ?? 'They come with the next good run.'}
      </Callout>
    );
  }
  if (age === 'fresh') return null;
  return (
    <Callout tone="warn" title="This may be out of date">
      Read {formatDateTime(row.facts!.at)}. {reason ?? 'No newer read.'}
    </Callout>
  );
}

function backupText(backup: FleetFacts['backup']): string {
  const tone = backupTone(backup);
  if (tone === 'none' || !backup) return 'None yet';
  return tone === 'ok' ? 'Good' : 'Failed';
}

// --- all boxes, side by side ------------------------------------------------------

function sum(rows: readonly FleetMatrixRow[], pick: (s: BoxStatus) => number | undefined) {
  let total = 0;
  let known = false;
  for (const r of rows) {
    const v = r.facts?.status ? pick(r.facts.status) : undefined;
    if (v !== undefined) {
      total += v;
      known = true;
    }
  }
  return known ? formatMicroUsd(total) : '–';
}

function AllBoxes({
  rows,
  boxes,
  refresh,
  onOpen,
}: {
  rows: FleetMatrixRow[];
  boxes: readonly FleetBox[];
  refresh: () => void;
  onOpen: (id: string) => void;
}) {
  const withFacts = rows.filter((r) => r.facts);
  const healthy = withFacts.filter((r) => healthLevel(r.facts!.status) === 'ok').length;
  const versions = new Set(
    withFacts.flatMap((r) => (r.facts!.status ? [r.facts!.status.build.version] : [])),
  );
  const backupsFailed = withFacts.filter((r) => backupTone(r.facts!.backup) === 'bad').length;
  return (
    <DetailPane
      icon={<Grid3x3 />}
      title="All boxes"
      pill={<Pill>{rows.length === 1 ? '1 box' : `${rows.length} boxes`}</Pill>}
    >
      <Tiles>
        <Tile
          label="Healthy"
          value={`${healthy} of ${rows.length}`}
          tone={healthy === rows.length ? 'ok' : 'warn'}
        />
        <Tile label="Spend today" value={sum(rows, (s) => s.spend?.last24hMicroUsd)} />
        <Tile label="Spend in 30 days" value={sum(rows, (s) => s.spend?.last30dMicroUsd)} />
        <Tile
          label="Versions in use"
          value={versions.size}
          sub={versions.size > 1 ? 'The boxes differ' : undefined}
          tone={versions.size > 1 ? 'warn' : 'ok'}
        />
        <Tile
          label="Backups failed"
          value={backupsFailed}
          tone={backupsFailed > 0 ? 'bad' : 'ok'}
        />
      </Tiles>

      <Part title="Side by side">
        <div className="rounded-lg border border-border">
          <Table aria-label="Fleet matrix">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-3">Box</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">30 days</TableHead>
                <TableHead>Sign-in</TableHead>
                <TableHead className="text-right">Agents</TableHead>
                <TableHead className="text-right">Logins</TableHead>
                <TableHead>Backup</TableHead>
                <TableHead className="pr-3">Read</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const f = r.facts;
                const s = f?.status ?? null;
                const stale = factsAge(r) === 'stale';
                return (
                  <TableRow key={r.id}>
                    <TableCell className="pl-3 font-medium">
                      <RowButton
                        className="rounded-sm underline-offset-2 hover:underline"
                        onClick={() => onOpen(r.id)}
                      >
                        {boxName(r)}
                      </RowButton>
                    </TableCell>
                    <TableCell>
                      <HealthPill row={r} />
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {s ? `v${s.build.version}` : '–'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.spend ? formatMicroUsd(s.spend.last24hMicroUsd) : '–'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.spend ? formatMicroUsd(s.spend.last30dMicroUsd) : '–'}
                    </TableCell>
                    <TableCell>{f ? signInLabel(f.signIn) : '–'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f ? f.agents.length : '–'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s?.logins ? s.logins.total : '–'}
                    </TableCell>
                    <TableCell
                      className={cn(f && backupTone(f.backup) === 'bad' && 'text-destructive-ink')}
                    >
                      {f ? backupText(f.backup) : '–'}
                    </TableCell>
                    <TableCell
                      className={cn('pr-3', stale ? 'text-warning-ink' : 'text-muted-foreground')}
                    >
                      {f ? `${timeAgo(f.at) || formatDateTime(f.at)}${stale ? ', old' : ''}` : '–'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Part>

      {shippedSlugs(rows).length > 0 && (
        <ModelCompare rows={rows} boxes={boxes} refresh={refresh} />
      )}
    </DetailPane>
  );
}

// --- one box ------------------------------------------------------------------------

function Meter({ label, pct, text }: { label: string; pct: number | null; text: string }) {
  const tone = LEVEL_TONE[pctLevel(pct)];
  const fill = { ok: 'bg-success', warn: 'bg-warning', bad: 'bg-destructive' }[
    tone as 'ok' | 'warn' | 'bad'
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{text}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        {pct !== null && (
          <div
            className={cn('h-full rounded-full', fill ?? 'bg-muted-foreground/40')}
            style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
          />
        )}
      </div>
    </div>
  );
}

function Service({ name, up }: { name: string; up: boolean | null }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
      <Dot tone={up === null ? 'muted' : up ? 'ok' : 'bad'} />
      <span>{name}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {up === null ? 'Off' : up ? 'Up' : 'Down'}
      </span>
    </li>
  );
}

type RunRow = { name: string; sub: string | null; provider: string; model: string; on: boolean };

function RunTable({ label, first, rows }: { label: string; first: string; rows: RunRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <div className="rounded-lg border border-border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">{first}</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="pr-3 text-right">State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className={cn(!r.on && 'text-muted-foreground')}>
              <TableCell className="pl-3">
                <span className="font-medium">{r.name}</span>
                {r.sub && <span className="text-muted-foreground"> · {r.sub}</span>}
              </TableCell>
              <TableCell className="font-mono text-[13px]">{r.provider}</TableCell>
              <TableCell className="break-all font-mono text-[13px]">
                {r.model || 'no model'}
              </TableCell>
              <TableCell className="pr-3 text-right">
                {r.on ? <Pill tone="ok">On</Pill> : <Pill>Off</Pill>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function pctText(pct: number | null | undefined): string {
  return pct == null ? 'Not known' : `${Math.round(pct)}%`;
}

function BoxFacts({ facts }: { facts: FleetFacts }) {
  const s = facts.status;
  const agentsOff = facts.agents.filter((a) => !a.enabled).length;
  const workersOff = facts.workers.filter((w) => !w.enabled).length;
  const backup = backupTone(facts.backup);
  const models = modelsInUse(facts);
  const tiles: ReactNode = (
    <Tiles>
      <Tile
        label="Spend today"
        value={s?.spend ? formatMicroUsd(s.spend.last24hMicroUsd) : '–'}
        sub={s?.spend ? `${formatMicroUsd(s.spend.last30dMicroUsd)} in 30 days` : 'Not known'}
      />
      <Tile label="Company sign-in" value={signInLabel(facts.signIn)} />
      <Tile
        label="Logins"
        value={s?.logins ? s.logins.total : '–'}
        sub={s?.logins && s.logins.disabled > 0 ? `${s.logins.disabled} off` : undefined}
      />
      <Tile
        label="Workspaces"
        value={facts.counts.workspaces}
        sub={countText(facts.counts.apps, 0, 'app')}
      />
      <Tile
        label="Last backup"
        value={backup === 'none' ? 'None yet' : backup === 'ok' ? 'Good' : 'Failed'}
        sub={
          facts.backup
            ? backup === 'bad'
              ? facts.backup.lastSuccessAt
                ? `Last good ${formatDateTime(facts.backup.lastSuccessAt)}`
                : 'No good backup yet'
              : formatDateTime(facts.backup.lastRunAt)
            : undefined
        }
        tone={backup === 'bad' ? 'bad' : undefined}
      />
    </Tiles>
  );
  return (
    <>
      {tiles}
      {s && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Part title="Host">
            <div className="space-y-3">
              <Meter label="CPU" pct={s.host.cpuLoadPct} text={pctText(s.host.cpuLoadPct)} />
              <Meter
                label="Memory"
                pct={s.host.mem?.usedPct ?? null}
                text={pctText(s.host.mem?.usedPct)}
              />
              <Meter
                label="Disk"
                pct={s.host.disk?.usedPct ?? null}
                text={pctText(s.host.disk?.usedPct)}
              />
            </div>
          </Part>
          <Part title="Services">
            <ul className="grid grid-cols-2 gap-2" aria-label="Services">
              <Service name="Database" up={s.postgres.up} />
              <Service name="Parser" up={s.services.parser.up} />
              <Service name="Object store" up={s.services.objectStore} />
              <Service name="Browser" up={s.services.browser} />
              <Service name="Documents" up={s.services.documents} />
              <Service name="Embedder" up={s.services.embedder} />
              <Service name="Sandboxes" up={s.services.sandboxes} />
              <Service name="Network" up={s.services.network} />
            </ul>
          </Part>
        </div>
      )}
      <Part title="Models in use">
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">No model in use.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Models in use">
            {models.map((m) => (
              <li key={`${m.provider}/${m.model}`}>
                <Badge variant="outline" className="font-mono text-xs font-normal">
                  {m.provider} · {m.model}
                  {m.uses > 1 ? ` ×${m.uses}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Part>
      <Part title={`Agents: ${countText(facts.agents.length, agentsOff, 'agent')}`}>
        <RunTable
          label="Agents"
          first="Agent"
          rows={facts.agents.map((a) => ({
            name: agentName(a),
            sub: a.role,
            provider: a.provider,
            model: a.model,
            on: a.enabled,
          }))}
        />
      </Part>
      <Part title={`AI workers: ${countText(facts.workers.length, workersOff, 'worker')}`}>
        <RunTable
          label="AI workers"
          first="Worker"
          rows={facts.workers.map((w) => ({
            name: w.kind,
            sub: null,
            provider: w.provider,
            model: w.model,
            on: w.enabled,
          }))}
        />
      </Part>
    </>
  );
}

/** One box, read with `?box=<id>`: the list row shows until that read lands. */
function OneBox({ row }: { row: FleetMatrixRow }) {
  const query = useQuery({
    queryKey: [...FLEET_MATRIX_KEY, row.id],
    queryFn: () => apiFetch<MatrixAnswer>(`${FLEET_MATRIX_PATH}?box=${encodeURIComponent(row.id)}`),
    staleTime: 30_000,
  });
  const fresh = query.data?.boxes[0] ?? row;
  const version = fresh.facts?.status?.build.version;
  return (
    <DetailPane
      icon={<Server />}
      title={boxName(fresh)}
      pill={
        <>
          <HealthPill row={fresh} />
          {version && <span className="font-mono text-xs text-muted-foreground">v{version}</span>}
        </>
      }
      actions={<ScreenLink href={ccHref('boxes', fresh.id)}>Open the box</ScreenLink>}
    >
      <FactsCallout row={fresh} />
      {query.isError && (
        <Callout tone="bad">
          Could not read this box again. This shows the facts as they were.
        </Callout>
      )}
      {fresh.facts && (
        <>
          {factsAge(fresh) === 'fresh' && (
            <p className="text-xs text-muted-foreground">Read {formatDateTime(fresh.facts.at)}.</p>
          )}
          <BoxFacts facts={fresh.facts} />
        </>
      )}
    </DetailPane>
  );
}

function BoxCard({
  row,
  selected,
  onOpen,
}: {
  row: FleetMatrixRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const s = row.facts?.status;
  const age = factsAge(row);
  return (
    <ListCard selected={selected} accent={age === 'stale' ? 'warning' : undefined} onClick={onOpen}>
      <div className="flex items-center gap-2">
        <ListCardTitle className="min-w-0 flex-1">{boxName(row)}</ListCardTitle>
        <HealthPill row={row} />
      </div>
      <ListCardMeta>
        {s ? <span className="font-mono">v{s.build.version}</span> : 'No version'}
        {s?.spend && ` · ${formatMicroUsd(s.spend.last24hMicroUsd)} today`}
      </ListCardMeta>
      <ListCardMeta className={age === 'stale' ? 'text-warning-ink' : undefined}>
        {age === 'none'
          ? 'No facts yet'
          : age === 'stale'
            ? `Old facts, read ${formatDateTime(row.facts!.at)}`
            : `Read ${formatDateTime(row.facts!.at)}`}
      </ListCardMeta>
    </ListCard>
  );
}

function Matrix({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const [param, setParam] = useParam('box');
  const query = useQuery(matrixQuery);
  const rows = query.data?.boxes ?? [];
  const selected = rows.find((r) => r.id === param) ?? null;
  return (
    <MasterDetail
      id="cc-matrix"
      detailFills
      list={
        <ListPane title="Fleet matrix">
          {query.isLoading ? (
            <div className="flex items-center gap-3 px-1 py-6 text-sm text-muted-foreground">
              <Spinner size={20} /> Loading…
            </div>
          ) : query.isError && !query.data ? (
            <p className="text-sm text-destructive-ink">Could not load the fleet matrix.</p>
          ) : rows.length === 0 ? (
            <ListEmpty>
              {data.boxes.length === 0 ? 'No box is linked.' : 'No box has sent its facts yet.'}
            </ListEmpty>
          ) : (
            <>
              <ListCard selected={!selected} onClick={() => setParam(ALL)}>
                <div className="flex items-center gap-2">
                  <Grid3x3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <ListCardTitle>All boxes</ListCardTitle>
                </div>
                <ListCardMeta>Every box side by side</ListCardMeta>
              </ListCard>
              {rows.map((r) => (
                <BoxCard
                  key={r.id}
                  row={r}
                  selected={selected?.id === r.id}
                  onOpen={() => setParam(r.id)}
                />
              ))}
            </>
          )}
        </ListPane>
      }
      detail={
        selected ? (
          <OneBox key={selected.id} row={selected} />
        ) : rows.length > 0 ? (
          <AllBoxes rows={rows} boxes={data.boxes} refresh={refresh} onOpen={setParam} />
        ) : null
      }
    />
  );
}

export function MatrixClient() {
  return (
    <FleetScreen needs="matrix">
      {(data, refresh) => <Matrix data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
