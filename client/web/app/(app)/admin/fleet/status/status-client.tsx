'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { StatusBoard } from '@/components/status/status-board';
import { StatusNav } from '@/components/status/status-nav';
import { LevelDot } from '@/components/status/status-parts';
import { SECTIONS } from '@/components/status/status-sections';
import { boxName, type FleetOverview } from '@/lib/fleet';
import {
  BOX_READ_TIMEOUT_MS,
  BOX_STATUS_TOOL,
  boxMark,
  boxReasonText,
  boxVersion,
  OWN_BOX_STATUS_PATH,
  parseBoxStatus,
  parseBoxStatusView,
  remoteStatus,
  SELF,
  type BoxRead,
} from '@/lib/fleet-status';
import { runFleetTool } from '@/lib/fleet-tool';
import type { SectionId } from '@/lib/status';
import { Callout, FleetScreen, ListPane, useParam } from '../cc-kit';

/** One box's reading: this box from its own route, a linked box with its
 *  own box_status over the admin channel. Never throws. */
async function readBox(id: string): Promise<BoxRead> {
  if (id === SELF) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), BOX_READ_TIMEOUT_MS);
    try {
      const view = parseBoxStatusView(
        await apiFetch<unknown>(OWN_BOX_STATUS_PATH, { cache: 'no-store', signal: ctl.signal }),
      );
      return view
        ? { state: 'ok', view, at: Date.now() }
        : { state: 'failed', reason: 'bad-reply' };
    } catch {
      return { state: 'failed', reason: ctl.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  const out = await runFleetTool(
    [id],
    BOX_STATUS_TOOL,
    {},
    {
      followUps: 0,
      timeoutMs: BOX_READ_TIMEOUT_MS,
    },
  );
  if (out === null) return { state: 'failed', reason: 'no-channel' };
  const one = out[0];
  if (!one || one.outcome !== 'ok') return { state: 'failed', reason: one?.reason ?? 'pending' };
  const box = parseBoxStatus(one.output);
  if (!box) return { state: 'failed', reason: 'bad-reply' };
  return {
    state: 'ok',
    view: { box, containers: null, containersCheckedAt: null, core: null },
    at: Date.now(),
  };
}

/** Every box's reading, read on open and on Refresh, each box on its own:
 *  one late box never holds the others. No timer. */
function useBoxReads(ids: readonly string[]) {
  const [reads, setReads] = useState<Record<string, BoxRead>>({});
  // The newest read of each box wins; an older one that lands late is dropped.
  const turn = useRef<Record<string, number>>({});
  const read = useCallback((list: readonly string[]) => {
    setReads((r) => {
      const next = { ...r };
      for (const id of list) next[id] = { state: 'loading' };
      return next;
    });
    for (const id of list) {
      const mine = (turn.current[id] ?? 0) + 1;
      turn.current[id] = mine;
      void readBox(id).then((res) => {
        if (turn.current[id] === mine) setReads((r) => ({ ...r, [id]: res }));
      });
    }
  }, []);
  const key = ids.join(',');
  useEffect(() => {
    read(key ? key.split(',') : []);
  }, [key, read]);
  return { reads, read };
}

type Row = { id: string; name: string };

function BoxCard({
  row,
  read,
  selected,
  onOpen,
}: {
  row: Row;
  read: BoxRead | undefined;
  selected: boolean;
  onOpen: () => void;
}) {
  const mark = boxMark(read);
  const version = boxVersion(read);
  return (
    <ListCard
      selected={selected}
      accent={mark.level === 'warn' || mark.level === 'crit' ? 'warning' : undefined}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <ListCardTitle className="min-w-0 flex-1">{row.name}</ListCardTitle>
        <LevelDot level={mark.level} />
      </div>
      <ListCardMeta className="tabular-nums">
        {version ?? 'Version not known'} · {mark.text}
      </ListCardMeta>
    </ListCard>
  );
}

function Status({ data }: { data: FleetOverview }) {
  const rows: Row[] = useMemo(
    () => [
      { id: SELF, name: 'This box' },
      ...data.boxes.map((b) => ({ id: b.id, name: boxName(b) })),
    ],
    [data.boxes],
  );
  const { reads, read } = useBoxReads(rows.map((r) => r.id));
  const [boxParam, setBox] = useParam('box');
  const [sectionParam, setSection] = useParam('section');

  const row = rows.find((r) => r.id === boxParam) ?? rows[0]!;
  const section: SectionId = SECTIONS.find((s) => s.id === sectionParam)?.id ?? SECTIONS[0]!.id;
  const current = reads[row.id];
  const status = remoteStatus(current?.state === 'ok' ? current.view : null);
  const loading = !current || current.state === 'loading';

  return (
    <MasterDetail
      id="cc-status"
      defaultListSize="300px"
      minListSize="240px"
      maxListSize="420px"
      detailFills
      list={
        <ListPane
          title={`Boxes (${rows.length})`}
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={rows.some((r) => !reads[r.id] || reads[r.id]!.state === 'loading')}
              onClick={() => read(rows.map((r) => r.id))}
              aria-label="Refresh every box"
            >
              <RefreshCw /> Refresh
            </Button>
          }
        >
          <ul className="space-y-2" aria-label="Boxes">
            {rows.map((r) => (
              <li key={r.id}>
                <BoxCard
                  row={r}
                  read={reads[r.id]}
                  selected={r.id === row.id}
                  onOpen={() => setBox(r.id)}
                />
              </li>
            ))}
          </ul>
        </ListPane>
      }
      detail={
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
            <h2 className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold">
              <Activity className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{row.name}</span>
            </h2>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {current?.state === 'ok' && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Read {new Date(current.at).toLocaleTimeString()}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => read([row.id])}
                aria-label={`Refresh ${row.name}`}
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} /> Refresh
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <MasterDetail
              id="cc-status-sections"
              defaultListSize="280px"
              minListSize="220px"
              maxListSize="380px"
              detailFills
              list={
                <StatusNav
                  status={status}
                  active={section}
                  onPick={setSection}
                  emptyText={
                    current?.state === 'ok'
                      ? 'Not reported'
                      : current?.state === 'failed'
                        ? 'No reading'
                        : 'Loading'
                  }
                />
              }
              detail={
                current?.state === 'failed' ? (
                  <div className="p-6">
                    <Callout tone="warn" title="No status from this box">
                      {boxReasonText(current.reason)}
                    </Callout>
                  </div>
                ) : (
                  <StatusBoard status={status} only={section} onJump={setSection} />
                )
              }
            />
          </div>
        </div>
      }
    />
  );
}

export function FleetStatusClient() {
  return <FleetScreen>{(data) => <Status data={data} />}</FleetScreen>;
}
