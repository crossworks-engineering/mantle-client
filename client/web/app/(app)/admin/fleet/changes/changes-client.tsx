'use client';

import { History, Server } from 'lucide-react';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { boxName, type FleetBox, type FleetOverview } from '@/lib/fleet';
import { changeCounts, changeRows, type ChangeRow } from '@/lib/fleet-view';
import {
  DetailPane,
  FleetScreen,
  ListEmpty,
  ListPane,
  Pill,
  Tile,
  Tiles,
  TONE_TEXT,
  useParam,
} from '../cc-kit';

const ALL = 'all';
const n = (count: number, word: string) => `${count} ${word}`;

function countsLine(c: { waiting: number; refused: number; done: number }): string {
  if (c.waiting + c.done === 0) return 'No change was sent yet';
  return [
    c.waiting > 0 ? n(c.waiting, 'waiting') : null,
    c.refused > 0 ? n(c.refused, 'refused') : null,
    n(c.done - c.refused, 'done'),
  ]
    .filter(Boolean)
    .join(' · ');
}

function StatePill({ row }: { row: ChangeRow }) {
  if (row.waiting) return <Pill tone="wait">Waiting</Pill>;
  return row.tone === 'bad' ? <Pill tone="bad">Refused</Pill> : <Pill tone="ok">Done</Pill>;
}

/**
 * Every change sent to the boxes: what waits, in the order asked, then each
 * box's last answers (at most 40 a box), newest first.
 */
function ChangeTable({ rows, withBox }: { rows: ChangeRow[]; withBox: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No change was sent yet.</p>;
  }
  return (
    <div className="rounded-lg border border-border">
      <Table aria-label="Fleet changes">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">State</TableHead>
            {withBox && <TableHead>Box</TableHead>}
            <TableHead>Change</TableHead>
            <TableHead>Answer</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="pr-3">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="pl-3">
                <StatePill row={r} />
              </TableCell>
              {withBox && <TableCell className="whitespace-nowrap font-medium">{r.box}</TableCell>}
              <TableCell className="font-mono text-[13px]">{r.label}</TableCell>
              <TableCell className={TONE_TEXT[r.tone]}>{r.text}</TableCell>
              <TableCell className="text-muted-foreground">{r.by}</TableCell>
              <TableCell className="whitespace-nowrap pr-3 text-muted-foreground">
                {formatDateTime(r.at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Changes({ data }: { data: FleetOverview }) {
  const [param, setParam] = useParam('box');
  const selected: FleetBox | null = data.boxes.find((b) => b.id === param) ?? null;
  const rows = changeRows(selected ? [selected] : data.boxes);
  const total = rows.reduce(
    (t, r) => ({
      waiting: t.waiting + (r.waiting ? 1 : 0),
      refused: t.refused + (!r.waiting && r.tone === 'bad' ? 1 : 0),
      done: t.done + (r.waiting ? 0 : 1),
    }),
    { waiting: 0, refused: 0, done: 0 },
  );
  return (
    <MasterDetail
      id="cc-changes"
      detailFills
      list={
        <ListPane title="Fleet changes">
          {data.boxes.length === 0 ? (
            <ListEmpty>No box is linked.</ListEmpty>
          ) : (
            <>
              <ListCard selected={!selected} onClick={() => setParam(ALL)}>
                <div className="flex items-center gap-2">
                  <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <ListCardTitle>All boxes</ListCardTitle>
                </div>
                <ListCardMeta>Every change, newest first</ListCardMeta>
              </ListCard>
              {data.boxes.map((b) => {
                const c = changeCounts(b);
                return (
                  <ListCard
                    key={b.id}
                    selected={selected?.id === b.id}
                    accent={c.refused > 0 ? 'warning' : c.waiting > 0 ? 'info' : undefined}
                    onClick={() => setParam(b.id)}
                  >
                    <div className="flex items-center gap-2">
                      <ListCardTitle className="min-w-0 flex-1">{boxName(b)}</ListCardTitle>
                      {c.waiting > 0 && <Pill tone="wait">{n(c.waiting, 'waiting')}</Pill>}
                    </div>
                    <ListCardMeta>{countsLine(c)}</ListCardMeta>
                  </ListCard>
                );
              })}
            </>
          )}
        </ListPane>
      }
      detail={
        <DetailPane
          icon={selected ? <Server /> : <History />}
          title={selected ? boxName(selected) : 'All boxes'}
          pill={total.waiting > 0 ? <Pill tone="wait">{n(total.waiting, 'waiting')}</Pill> : null}
        >
          <Tiles>
            <Tile
              label="Waiting"
              value={total.waiting}
              sub="For the next run"
              tone={total.waiting > 0 ? 'wait' : undefined}
            />
            <Tile label="Done" value={total.done - total.refused} />
            <Tile label="Refused" value={total.refused} tone={total.refused > 0 ? 'bad' : 'ok'} />
          </Tiles>
          <ChangeTable rows={rows} withBox={!selected} />
        </DetailPane>
      }
    />
  );
}

export function ChangesClient() {
  return <FleetScreen needs="writes">{(data) => <Changes data={data} />}</FleetScreen>;
}
