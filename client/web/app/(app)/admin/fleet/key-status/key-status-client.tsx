'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleDashed, CircleX, KeyRound, Minus, Server } from 'lucide-react';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
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
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { keyBoxText, keyUpdatePending, type FleetOverview } from '@/lib/fleet';
import {
  ageText,
  answerPending,
  boxSummary,
  boxWantsTest,
  canTest,
  FLEET_KEY_STATUS_KEY,
  FLEET_KEY_STATUS_PATH,
  FLEET_KEY_TEST_PATH,
  keyBoxName,
  keysReasonText,
  keyStateText,
  differentKeys,
  PENDING_REREAD_MS,
  printText,
  readFailNote,
  testAnswerText,
  testCallFailText,
  testedById,
  testedText,
  withTested,
  type FleetKeyBox,
  type FleetKeyLine,
  type FleetKeyStatus,
  type FleetKeyTestAnswer,
  type LastSetKey,
  type StateMark,
} from '@/lib/fleet-key-status';
import { ccHref, type Tone } from '@/lib/fleet-view';
import {
  Callout,
  DetailPane,
  Facts,
  FleetScreen,
  ListEmpty,
  ListPane,
  Part,
  Pill,
  ScreenLink,
  TONE_TEXT,
  useParam,
} from '../cc-kit';

/** The read. Null: a Control Center a release behind (no such route). */
async function readKeyStatus(): Promise<FleetKeyStatus | null> {
  try {
    return await apiFetch<FleetKeyStatus>(FLEET_KEY_STATUS_PATH);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

const ALL = 'all';

const toneText = (tone: Tone | 'muted') =>
  tone === 'muted' ? 'text-muted-foreground' : tone === 'ok' ? 'text-success-ink' : TONE_TEXT[tone];

const MARKS: Record<StateMark, typeof CircleCheck> = {
  tick: CircleCheck,
  cross: CircleX,
  dot: CircleDashed,
  none: Minus,
};

/** A time as its age, the exact time on hover. */
function Age({ iso, now }: { iso: string | null; now: number }) {
  if (!iso) return <span className="text-muted-foreground">unknown</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {ageText(iso, now)}
    </time>
  );
}

/**
 * The print. `data-secret`: an agent never reads it (lib/agent-ui: the
 * screen read names it "(hidden)", the window's picture paints it over).
 * No ancestor of it carries a role, so no row's name holds its text.
 */
function Print({ print }: { print: string | null }) {
  if (print === null) return <span className="text-muted-foreground">{printText(null)}</span>;
  return (
    <span data-secret="" data-testid="key-print" className="font-mono text-[13px]">
      {print}
    </span>
  );
}

function StateCell({ line, now }: { line: FleetKeyLine; now: number }) {
  const s = keyStateText(line, now);
  const Mark = MARKS[s.mark];
  return (
    <span title={s.text} className={cn('inline-flex items-center gap-1.5', toneText(s.tone))}>
      <Mark className="size-4 shrink-0" aria-hidden />
      {s.label}
    </span>
  );
}

const COLS = 5;

/** The lines of some boxes, one table, so the same service reads down a
 *  column: its set time and print line up box under box. With `onOpen`
 *  (all boxes), each box opens with a row of its own: its name and read. */
function KeyTable({
  label,
  boxes,
  different,
  now,
  onOpen,
}: {
  label: string;
  boxes: FleetKeyBox[];
  different: Map<string, LastSetKey>;
  now: number;
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">Service</TableHead>
            <TableHead>Set</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Tested</TableHead>
            <TableHead className="pr-3">Print</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {boxes.map((b) => (
            <BoxRows key={b.id} box={b} different={different} now={now} onOpen={onOpen} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BoxRows({
  box: b,
  different,
  now,
  onOpen,
}: {
  box: FleetKeyBox;
  different: Map<string, LastSetKey>;
  now: number;
  onOpen?: (id: string) => void;
}) {
  const head = onOpen && (
    <TableRow data-box-head={b.id} className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={COLS} className="py-2 pl-3">
        <RowButton
          className="rounded-sm font-medium underline-offset-2 hover:underline"
          onClick={() => onOpen(b.id)}
        >
          {keyBoxName(b)}
        </RowButton>
        <span className="ml-2 text-xs text-muted-foreground">
          {b.at ? (
            <>
              read <Age iso={b.at} now={now} />
            </>
          ) : (
            'not read yet'
          )}
          {b.reason !== null && <span className="text-warning-ink">, the last read failed</span>}
        </span>
      </TableCell>
    </TableRow>
  );
  if (b.keys === null || b.keys.length === 0) {
    return (
      <>
        {head}
        <TableRow data-box={b.id}>
          <TableCell colSpan={COLS} className="pl-3 text-muted-foreground">
            {b.keys === null ? keysReasonText(b.keysReason) : 'Holds no keys.'}
          </TableCell>
        </TableRow>
      </>
    );
  }
  return (
    <>
      {head}
      {b.keys.map((l) => (
        <TableRow key={l.service} data-box={b.id} data-service={l.service}>
          <TableCell className="pl-3 font-medium">{l.service}</TableCell>
          <TableCell className="whitespace-nowrap">
            <Age iso={l.setAt} now={now} />
            <DifferentMark of={different.get(`${b.id}:${l.service}`)} now={now} />
          </TableCell>
          <TableCell className="min-w-[8rem] max-w-[12rem]">
            <StateCell line={l} now={now} />
          </TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {l.test ? (
              <span title={formatDateTime(l.test.at)}>{testedText(l, now)}</span>
            ) : (
              testedText(l, now)
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap pr-3">
            <Print print={l.print} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** A line that holds another key than the one set last for its service:
 *  neutral words, as a fleet may keep a key of its own on each box. */
function DifferentMark({ of, now }: { of: LastSetKey | undefined; now: number }) {
  if (!of) return null;
  return (
    <span
      className="block text-xs text-muted-foreground"
      title={`Not the key set last (on ${of.box}, ${ageText(of.at, now)})`}
    >
      different key
    </span>
  );
}

/** The busy line, beside the table's heading: always on the page (never
 *  display:none), so a screen reader hears its text come; it takes no line
 *  of its own, so nothing moves. */
function BusyLine({ busy }: { busy: boolean }) {
  return (
    <p
      role="status"
      data-testid="busy-line"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {busy && (
        <>
          <Spinner size={14} /> Testing the keys. This can take up to 25 seconds.
        </>
      )}
    </p>
  );
}

/** A Test now call that failed (the route, not a box): beside the result. */
function CallFail({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Callout tone="bad" title="Test now">
      {text}
    </Callout>
  );
}

function TestedLine({ code }: { code: string | undefined }) {
  if (code === undefined) return null;
  const t = testAnswerText(code);
  return <span className={cn('block text-xs', toneText(t.tone))}>{t.text}</span>;
}

function BoxCard({
  box,
  tested,
  selected,
  onOpen,
}: {
  box: FleetKeyBox;
  tested: string | undefined;
  selected: boolean;
  onOpen: () => void;
}) {
  const s = boxSummary(box);
  return (
    <ListCard selected={selected} onClick={onOpen} data-box={box.id}>
      <ListCardTitle>{keyBoxName(box)}</ListCardTitle>
      <span className={cn('mt-0.5 block text-xs', toneText(s.tone))}>{s.text}</span>
      {box.reason !== null && (
        <span className="block text-xs text-warning-ink">The last read failed.</span>
      )}
      <TestedLine code={tested} />
    </ListCard>
  );
}

function TestButton({
  box,
  busy,
  onTest,
}: {
  box: FleetKeyBox;
  busy: boolean;
  onTest: () => void;
}) {
  if (!canTest(box)) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant={boxWantsTest(box) ? 'default' : 'outline'}
      disabled={busy}
      onClick={onTest}
    >
      {busy ? (
        <>
          <Spinner size={14} /> Testing…
        </>
      ) : (
        'Test now'
      )}
    </Button>
  );
}

function OneBox({
  box,
  tested,
  busy,
  callFail,
  different,
  now,
  onTest,
}: {
  box: FleetKeyBox;
  tested: string | undefined;
  busy: boolean;
  callFail: string | null;
  different: Map<string, LastSetKey>;
  now: number;
  onTest: () => void;
}) {
  const fail = readFailNote(box, now);
  const lastSet = box.lastSet ? keyBoxText({ keyPending: null, keyResult: box.lastSet }) : null;
  const answer = tested === undefined ? null : testAnswerText(tested);
  return (
    <DetailPane
      icon={<Server />}
      title={keyBoxName(box)}
      pill={box.id === 'self' ? <Pill>Control Center</Pill> : undefined}
      actions={<TestButton box={box} busy={busy} onTest={onTest} />}
    >
      {answer && (
        <Callout
          tone={answer.tone === 'ok' ? 'ok' : answer.tone === 'bad' ? 'bad' : 'warn'}
          title="Test now"
        >
          {answer.text}
        </Callout>
      )}
      <CallFail text={callFail} />
      {fail && (
        <Callout tone="warn" title="The last read failed">
          {fail}
        </Callout>
      )}
      <Facts
        rows={[
          ...(box.url ? [{ label: 'Address', value: box.url }] : []),
          { label: 'Read', value: <Age iso={box.at} now={now} /> },
          ...(lastSet && box.lastSet
            ? [
                {
                  label: 'Last key set here',
                  value: (
                    <span className={TONE_TEXT[lastSet.tone]}>
                      {box.lastSet.service}: {lastSet.text}{' '}
                      <span className="text-muted-foreground">
                        ({ageText(box.lastSet.at, now)})
                      </span>
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Part title="Keys" action={<BusyLine busy={busy} />}>
        <KeyTable
          label={`Keys on ${keyBoxName(box)}`}
          boxes={[box]}
          different={different}
          now={now}
        />
      </Part>
    </DetailPane>
  );
}

function AllBoxes({
  boxes,
  busy,
  callFail,
  different,
  now,
  onOpen,
}: {
  boxes: FleetKeyBox[];
  busy: boolean;
  callFail: string | null;
  different: Map<string, LastSetKey>;
  now: number;
  onOpen: (id: string) => void;
}) {
  return (
    <DetailPane
      icon={<KeyRound />}
      title="All boxes"
      pill={<Pill>{boxes.length === 1 ? '1 box' : `${boxes.length} boxes`}</Pill>}
      actions={<ScreenLink href={ccHref('keys')}>Set a key</ScreenLink>}
    >
      <Callout>
        Each line is the key a box uses for that service. Compare the set time and the print down a
        column: a line marked different key holds another key than the one set last for that
        service. That can be on purpose, a key of its own for each box.
      </Callout>
      <CallFail text={callFail} />
      <Part title="Side by side" action={<BusyLine busy={busy} />}>
        <KeyTable
          label="Key status"
          boxes={boxes}
          different={different}
          now={now}
          onOpen={onOpen}
        />
      </Part>
    </DetailPane>
  );
}

function KeyStatus({ data }: { data: FleetOverview }) {
  const queryClient = useQueryClient();
  const [param, setParam] = useParam('box');
  const query = useQuery({
    queryKey: FLEET_KEY_STATUS_KEY,
    queryFn: readKeyStatus,
    staleTime: 0,
    retry: 1,
  });
  const [tested, setTested] = useState<Record<string, string>>({});
  // 'all', a box id, or null.
  const [busy, setBusy] = useState<string | null>(null);
  // A failed Test now call, with what was tested: a box id, or ALL.
  const [callFail, setCallFail] = useState<{ of: string; text: string } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reread = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: FLEET_KEY_STATUS_KEY }),
    [queryClient],
  );

  // A key set from Provider keys: once no box waits on it, its new set time,
  // test and print are in the key status.
  const keyWaits = keyUpdatePending(data.boxes);
  const keyWaited = useRef(keyWaits);
  useEffect(() => {
    if (keyWaited.current && !keyWaits) reread();
    keyWaited.current = keyWaits;
  }, [keyWaits, reread]);

  const test = async (boxIds?: string[]) => {
    setBusy(boxIds?.[0] ?? ALL);
    setCallFail(null);
    try {
      const answer = await apiSend<FleetKeyTestAnswer>(
        FLEET_KEY_TEST_PATH,
        'POST',
        boxIds ? { boxIds } : {},
      );
      queryClient.setQueryData<FleetKeyStatus | null>(FLEET_KEY_STATUS_KEY, (old) =>
        old ? withTested(old, answer) : old,
      );
      setTested((prev) => ({ ...prev, ...testedById(answer) }));
      if (answerPending(answer)) {
        timers.current.forEach(clearTimeout);
        timers.current = PENDING_REREAD_MS.map((ms, i) =>
          setTimeout(() => {
            reread();
            // After the last read, the lines say what the box answered.
            if (i === PENDING_REREAD_MS.length - 1) {
              setTested((prev) =>
                Object.fromEntries(Object.entries(prev).filter(([, c]) => c !== 'pending')),
              );
            }
          }, ms),
        );
      }
    } catch (err) {
      setCallFail({ of: boxIds?.[0] ?? ALL, text: testCallFailText(err) });
    } finally {
      setBusy(null);
    }
  };

  const status = query.data;
  const boxes = status?.boxes ?? [];
  const selected = boxes.find((b) => b.id === param) ?? null;
  const different = differentKeys(boxes);

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Spinner size={20} /> Loading…
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This brain is a release behind: it does not have the key status yet.
      </div>
    );
  }

  return (
    <MasterDetail
      id="cc-key-status"
      defaultListSize="280px"
      detailFills
      list={
        <ListPane
          title="Key status"
          action={
            boxes.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void test()}
              >
                {busy === ALL ? (
                  <>
                    <Spinner size={14} /> Testing…
                  </>
                ) : (
                  'Test all'
                )}
              </Button>
            ) : undefined
          }
        >
          {callFail && (
            <p role="status" className="text-sm text-destructive-ink">
              {callFail.text}
            </p>
          )}
          {query.isError && !status ? (
            <p className="text-sm text-destructive-ink">Could not load the key status.</p>
          ) : boxes.length === 0 ? (
            <ListEmpty>No box to show.</ListEmpty>
          ) : (
            <>
              <ListCard selected={!selected} onClick={() => setParam(ALL)}>
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <ListCardTitle>All boxes</ListCardTitle>
                </div>
                <ListCardMeta>Every key side by side</ListCardMeta>
              </ListCard>
              <ul className="space-y-2" aria-label="Boxes">
                {boxes.map((b) => (
                  <li key={b.id}>
                    <BoxCard
                      box={b}
                      tested={tested[b.id]}
                      selected={selected?.id === b.id}
                      onOpen={() => setParam(b.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </ListPane>
      }
      detail={
        selected ? (
          <OneBox
            key={selected.id}
            box={selected}
            tested={tested[selected.id]}
            busy={busy === selected.id || busy === ALL}
            callFail={callFail?.of === selected.id ? callFail.text : null}
            different={different}
            now={now}
            onTest={() => void test([selected.id])}
          />
        ) : boxes.length > 0 ? (
          <AllBoxes
            boxes={boxes}
            busy={busy !== null}
            callFail={callFail?.of === ALL ? callFail.text : null}
            different={different}
            now={now}
            onOpen={setParam}
          />
        ) : null
      }
    />
  );
}

export function KeyStatusClient() {
  return <FleetScreen>{(data) => <KeyStatus data={data} />}</FleetScreen>;
}
