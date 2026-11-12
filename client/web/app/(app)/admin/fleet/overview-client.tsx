'use client';

import Link from 'next/link';
import { ArrowRight, CircleCheck, Cpu, Radar, TriangleAlert } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyBlock, CopyButton } from '@mantle/web-ui/ui/copy-button';
import { ListCard, ListCardSnippet, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { banState, tickIsStale, type FleetOverview } from '@/lib/fleet';
import { healthLevel } from '@/lib/fleet-matrix';
import {
  boxesText,
  ccHref,
  changeCounts,
  fleetIssues,
  linkState,
  type FleetIssue,
} from '@/lib/fleet-view';
import {
  Callout,
  DetailPane,
  Facts,
  FleetScreen,
  ListPane,
  Part,
  Pill,
  ScreenLink,
  Tile,
  Tiles,
  useMatrixRows,
  useParam,
} from './cc-kit';
import {
  DEFAULT_MODEL_CARD,
  DefaultModelPane,
  defaultModelLine,
  useDefaultModel,
} from './default-model';

const SUMMARY = 'summary';

/** The state of the fleet in numbers, then this Control Center's own service. */
function Summary({ data, issues }: { data: FleetOverview; issues: FleetIssue[] }) {
  const { rows } = useMatrixRows(data.boxes);
  const service = data.service;
  const stale = service ? tickIsStale(service.lastTickAt) : true;
  const linked = data.boxes.filter((b) => linkState(b).tone === 'ok').length;
  const withFacts = rows.filter((r) => r.facts);
  const healthy = withFacts.filter((r) => healthLevel(r.facts!.status) === 'ok').length;
  const activeBans = data.bans.filter((b) => banState(b) === 'active').length;
  const waiting = data.boxes.reduce((t, b) => t + changeCounts(b).waiting, 0);
  const spends = withFacts.flatMap((r) =>
    r.facts!.status?.spend ? [r.facts!.status.spend.last24hMicroUsd] : [],
  );
  const bad = issues.filter((i) => i.tone === 'bad').length;
  return (
    <DetailPane
      icon={<Radar />}
      title="Fleet setup"
      pill={
        issues.length === 0 ? (
          <Pill tone="ok">All good</Pill>
        ) : (
          <Pill tone={bad > 0 ? 'bad' : 'warn'}>{issues.length} to check</Pill>
        )
      }
    >
      <Tiles>
        <Tile
          label="Boxes linked"
          value={`${linked} of ${data.boxes.length}`}
          tone={linked === data.boxes.length ? 'ok' : 'bad'}
        />
        {withFacts.length > 0 && (
          <Tile
            label="Healthy"
            value={`${healthy} of ${withFacts.length}`}
            tone={healthy === withFacts.length ? 'ok' : 'warn'}
          />
        )}
        <Tile label="Active bans" value={activeBans} />
        <Tile label="Changes waiting" value={waiting} tone={waiting > 0 ? 'wait' : undefined} />
        {spends.length > 0 && (
          <Tile
            label="Spend today"
            value={formatMicroUsd(spends.reduce((a, b) => a + b, 0))}
            sub={`On ${boxesText(spends.length)}`}
          />
        )}
      </Tiles>

      <Part title="Control service">
        {!service ? (
          <Callout tone="warn" title="The control service has not made its key yet">
            Add control to COMPOSE_PROFILES in the .env of this box, then run docker compose up -d.
          </Callout>
        ) : stale ? (
          <Callout tone="warn" title="The control service is not running">
            {service.lastTickAt
              ? `Its last run was at ${formatDateTime(service.lastTickAt)}.`
              : 'It has not run.'}{' '}
            No box gets a ban or a lift until it runs again.
          </Callout>
        ) : (
          <Callout tone="ok" title="The control service is running">
            Last run {formatDateTime(service.lastTickAt!)}.
          </Callout>
        )}
        {service && (
          <Facts
            rows={[
              {
                label: 'Key fingerprint',
                value: (
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 break-all font-mono text-[13px]">
                      {service.fingerprint}
                    </span>
                    <CopyButton value={service.fingerprint} ariaLabel="Copy the key fingerprint" />
                  </span>
                ),
              },
            ]}
          />
        )}
        {service && (
          <p className="text-xs text-muted-foreground">
            Check it against the control key fingerprint line in the mantle_worker_control log.
          </p>
        )}
      </Part>

      {data.envLines && (
        <Part
          title="To link a box"
          action={<ScreenLink href={ccHref('boxes', 'new')}>Link a box</ScreenLink>}
        >
          <p className="text-sm">
            Add these two lines to the .env of each box this Control Center manages, then run docker
            compose up -d on that box.
          </p>
          <CopyBlock code={data.envLines.join('\n')} />
        </Part>
      )}
    </DetailPane>
  );
}

function Issue({ issue }: { issue: FleetIssue }) {
  return (
    <DetailPane
      icon={<TriangleAlert />}
      title={issue.title}
      pill={<Pill tone={issue.tone}>{issue.tone === 'bad' ? 'Problem' : 'Warning'}</Pill>}
    >
      <Callout tone={issue.tone} title={issue.title}>
        {issue.text}
      </Callout>
      <div>
        <Button asChild>
          <Link href={issue.href}>
            {issue.action} <ArrowRight />
          </Link>
        </Button>
      </div>
    </DetailPane>
  );
}

/** Overview: the fleet setup first, then the Default Model, then one card
 *  per thing that needs an admin now, worst first. */
function Overview({ data }: { data: FleetOverview }) {
  const [param, setParam] = useParam('open');
  const { rows } = useMatrixRows(data.boxes);
  const issues = fleetIssues(data, rows);
  const open = issues.find((i) => i.id === param) ?? null;
  const modelOpen = param === DEFAULT_MODEL_CARD;
  const { state: model } = useDefaultModel();
  return (
    <MasterDetail
      id="cc-overview"
      list={
        <ListPane title="Control Center">
          <ListCard selected={!open && !modelOpen} onClick={() => setParam(SUMMARY)}>
            <div className="flex items-center gap-2">
              <Radar className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <ListCardTitle>Fleet setup</ListCardTitle>
            </div>
            <ListCardSnippet>
              {boxesText(data.boxes.length)}, and this Control Center&apos;s own service
            </ListCardSnippet>
          </ListCard>
          <ListCard
            selected={modelOpen}
            accent={model.kind === 'key-missing' || model.kind === 'unset' ? 'info' : undefined}
            onClick={() => setParam(DEFAULT_MODEL_CARD)}
          >
            <div className="flex items-center gap-2">
              <Cpu className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <ListCardTitle>Default Model</ListCardTitle>
            </div>
            <ListCardSnippet>{defaultModelLine(model)}</ListCardSnippet>
          </ListCard>
          <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Needs you ({issues.length})
          </p>
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              <CircleCheck className="size-4 shrink-0 text-success-ink" aria-hidden />
              Nothing needs you now.
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Needs you">
              {issues.map((i) => (
                <li key={i.id}>
                  <ListCard
                    selected={open?.id === i.id}
                    accent={i.tone === 'bad' ? 'warning' : 'info'}
                    onClick={() => setParam(i.id)}
                  >
                    <div className="flex items-start gap-2">
                      <ListCardTitle wrap className="min-w-0 flex-1">
                        {i.title}
                      </ListCardTitle>
                      <Pill tone={i.tone}>{i.tone === 'bad' ? 'Problem' : 'Warning'}</Pill>
                    </div>
                    <ListCardSnippet>{i.text}</ListCardSnippet>
                  </ListCard>
                </li>
              ))}
            </ul>
          )}
        </ListPane>
      }
      detail={
        open ? (
          <Issue issue={open} />
        ) : modelOpen ? (
          <DefaultModelPane />
        ) : (
          <Summary data={data} issues={issues} />
        )
      }
    />
  );
}

export function OverviewClient() {
  return <FleetScreen>{(data) => <Overview data={data} />}</FleetScreen>;
}
