'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Copy, Lock, ShieldBan, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { banKeysText, type FleetBan } from '@/lib/fleet';
import {
  boxWorkspaces,
  cellChoices,
  changeKey,
  colKey,
  openAtStart,
  stagedPerColumn,
  stagedPerRow,
  workspaceBoxes,
  cellStatus,
  copyPlan,
  describeChange,
  loginState,
  MAX_MEMBER_CHANGES,
  memberHistory,
  membershipGrid,
  peopleReasonText,
  staleNotes,
  roleWord,
  skipText,
  stateWord,
  type FleetPeopleBox,
  type GridCell,
  type GridRow,
  type MemberAnswer,
  type MemberChange,
  type MemberState,
  type Person,
} from '@/lib/fleet-people';
import { Callout, DetailPane, Dot, Part, Pill, TONE_TEXT } from '../cc-kit';
import { ConfirmSend } from '../fleet-writes';
import type { MembersSent } from './use-people';

/** The keys a ban holds besides this person's email. */
const otherKeys = (b: FleetBan, email: string) =>
  banKeysText({ ...b, emails: b.emails.filter((e) => e.toLowerCase() !== email) });

/** A set with one key in or out: a row opened or closed. */
const flip = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** The button that opens a row: a real button, which says if it is open. */
function Toggle({
  open,
  controls,
  onClick,
  children,
}: {
  open: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onClick}
      className="mr-1.5 inline-flex items-center gap-1 rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-90',
        )}
        aria-hidden
      />
      {children}
    </button>
  );
}

/** How many changes a closed row holds, so a fold never hides work. */
function StagedPill({ n }: { n: number }) {
  return n > 0 ? <Pill tone="wait">{n} staged</Pill> : null;
}

/** A workspace's name, with the Admin and "same name twice" marks. */
function RowName({ row }: { row: GridRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.label}
      {row.admin && <Pill>Admin</Pill>}
      {row.ambiguous && <Pill tone="warn">Same name twice</Pill>}
    </span>
  );
}

/** One line of an open row: a name, then its role select. */
function Line({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2 pl-8 pr-3 text-sm">
      <span className="min-w-0 pt-1 break-words">{name}</span>
      {children}
    </li>
  );
}

/** One cell of the grid: a role select, or why it cannot be changed. */
function Cell({
  cell,
  staged,
  status,
  label,
  onStage,
}: {
  label: string;
  cell: GridCell;
  staged: MemberState | undefined;
  status: ReturnType<typeof cellStatus>;
  onStage: (s: MemberState | undefined) => void;
}) {
  if (cell.kind === 'missing') {
    return <span className="text-xs text-muted-foreground/60">No such workspace</span>;
  }
  if (cell.kind === 'ambiguous') {
    return (
      <span className="text-xs text-warning-ink">
        {cell.count} workspaces have this name: see their own rows
      </span>
    );
  }
  if (cell.lock) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={
          cell.lock === 'admin'
            ? 'Who is an Admin is a role, changed on the box itself.'
            : cell.lock === 'owner'
              ? 'The owner of the box is never changed here.'
              : 'This login is disabled on that box: it gets no workspace. Lift the ban or enable it first.'
        }
      >
        <Lock className="size-3" aria-hidden />
        {stateWord(cell.state)}
      </span>
    );
  }
  const shown = staged ?? (status?.waiting ? status.role : cell.state);
  return (
    <div className="space-y-1">
      <Select
        value={shown}
        disabled={status?.waiting}
        onValueChange={(v) => onStage(v === cell.state ? undefined : (v as MemberState))}
      >
        <SelectTrigger
          size="xs"
          className={cn('w-32', staged !== undefined && 'border-primary ring-1 ring-primary')}
          aria-label={`Role in ${label}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {cellChoices(cell).map((s) => (
            <SelectItem key={s} value={s}>
              {stateWord(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {status && (
        <p className={cn('max-w-40 text-[11px] leading-4', TONE_TEXT[status.tone])}>
          {status.text}
        </p>
      )}
    </div>
  );
}

export function PersonDetail({
  person,
  peopleBoxes,
  answers,
  sending,
  onSend,
  onBan,
  onLift,
}: {
  person: Person;
  peopleBoxes: FleetPeopleBox[];
  /** This session's answers to workspace changes. */
  answers: MemberAnswer[];
  /** The changes on their way now. */
  sending: MemberChange[];
  onSend: (changes: MemberChange[]) => Promise<MembersSent>;
  onBan: () => void;
  onLift: (ban: FleetBan) => void;
}) {
  const grid = useMemo(() => membershipGrid(person, peopleBoxes), [person, peopleBoxes]);
  const peopleById = useMemo(() => new Map(peopleBoxes.map((b) => [b.id, b])), [peopleBoxes]);
  const [staged, setStaged] = useState<Map<string, MemberChange>>(() => new Map());
  const [view, setView] = useState<'box' | 'workspace'>('box');
  const byBox = useMemo(() => boxWorkspaces(grid), [grid]);
  const byWorkspace = useMemo(() => workspaceBoxes(grid), [grid]);
  const [openBoxes, setOpenBoxes] = useState(() =>
    openAtStart(grid.columns.filter((c) => c.full).map((c) => c.key)),
  );
  const [openRows, setOpenRows] = useState(() => openAtStart(grid.rows.map((r) => r.key)));
  const [left, setLeft] = useState(0);
  const [confirm, setConfirm] = useState<{ title: string; changes: MemberChange[] } | null>(null);
  const full = grid.columns.filter((c) => c.full && !c.owner);
  const sources = full;
  const targets = full.filter((c) => !c.off);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const plan = from && to && from !== to ? copyPlan(person, from, to, peopleBoxes) : null;
  const banned = person.bans.length > 0;
  const history = memberHistory(answers, person.logins, peopleBoxes).slice(0, 12);

  const stage = (cell: Extract<GridCell, { kind: 'cell' }>, s: MemberState | undefined) => {
    setStaged((m) => {
      const next = new Map(m);
      const k = changeKey(cell);
      if (s === undefined) next.delete(k);
      else
        next.set(k, {
          boxId: cell.boxId,
          loginId: cell.loginId,
          workspaceId: cell.workspaceId,
          role: s,
        });
      return next;
    });
  };

  const go = async () => {
    if (!confirm || sending.length > 0) return;
    const changes = confirm.changes;
    // The confirm closes at once: an answer can take a minute or two, and
    // each cell says it is on its way. The changes sent leave the staged
    // ones; a change its box never ran joins them again, to send again.
    // Never a replace: a copy keeps what the grid had staged.
    setConfirm(null);
    const sentKeys = new Set(changes.map(changeKey));
    setStaged((m) => new Map([...m].filter(([k]) => !sentKeys.has(k))));
    const sent = await onSend(changes);
    if (!sent) return;
    setStaged((m) => {
      const next = new Map(m);
      for (const c of sent.left) next.set(changeKey(c), c);
      return next;
    });
    setLeft(sent.left.length);
  };

  // A staged change whose cell became locked, gone or already so (the
  // boxes were read again) no longer applies: it is dropped, and said.
  const [dropped, setDropped] = useState(0);
  useEffect(() => {
    const cells = new Map<string, Extract<GridCell, { kind: 'cell' }>>();
    for (const r of grid.rows) {
      for (const c of Object.values(r.cells)) if (c.kind === 'cell') cells.set(changeKey(c), c);
    }
    const bad = [...staged.entries()].filter(([k, c]) => {
      const cell = cells.get(k);
      return (
        !cell || cell.lock !== null || !cellChoices(cell).includes(c.role) || cell.state === c.role
      );
    });
    if (bad.length === 0) return;
    setStaged((m) => new Map([...m].filter(([k]) => !bad.some(([b]) => b === k))));
    setDropped((n) => n + bad.length);
  }, [grid, staged]);

  const stagedList = [...staged.values()];
  const perBox = stagedPerColumn(stagedList);
  const perRow = stagedPerRow(grid, stagedList);
  /** A members send is on its way: no other send starts until it ends. */
  const busy = sending.length > 0;
  const stale = confirm ? staleNotes(confirm.changes, peopleBoxes) : [];
  const reasons = person.logins
    .map((l) => ({ l, why: peopleReasonText(peopleById.get(l.boxId)!) }))
    .filter((x) => x.why !== null);

  return (
    <DetailPane
      icon={<UserRound />}
      title={person.name ?? person.email}
      pill={
        banned ? (
          <Pill tone="bad">Banned</Pill>
        ) : person.disabled ? (
          <Pill tone="warn">Disabled somewhere</Pill>
        ) : person.admin ? (
          <Pill>Admin</Pill>
        ) : undefined
      }
      actions={
        banned ? undefined : (
          <Button size="sm" variant="outline" onClick={onBan}>
            <ShieldBan /> Ban
          </Button>
        )
      }
    >
      {person.name && <p className="-mt-2 text-sm text-muted-foreground">{person.email}</p>}

      {banned && (
        <Callout tone="bad" title="Banned on every linked box">
          <p className="text-sm">A ban disables this person on every linked box.</p>
          <ul className="mt-2 space-y-2">
            {person.bans.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {b.kind === 'archive' ? 'Archive ban' : 'Ban'} made {formatDateTime(b.madeAt)}
                  {b.madeBy ? ` by ${b.madeBy}` : ''}
                  {b.reason ? `: ${b.reason}` : ''}
                  {otherKeys(b, person.email) && (
                    <span className="block text-xs text-muted-foreground">
                      Also holds {otherKeys(b, person.email)}.
                    </span>
                  )}
                </span>
                <Button size="sm" variant="outline" onClick={() => onLift(b)}>
                  <ShieldCheck /> {b.kind === 'archive' ? 'Retire ban' : 'Lift ban'}
                </Button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Part
        title={
          view === 'box'
            ? `Logins (${person.logins.length === 1 ? '1 box' : `${person.logins.length} boxes`})`
            : `Workspaces (${grid.rows.length})`
        }
        action={
          stagedList.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStaged(new Map())}>
                Undo
              </Button>
              <Button
                size="sm"
                disabled={busy || stagedList.length > MAX_MEMBER_CHANGES}
                onClick={() =>
                  setConfirm({
                    title:
                      stagedList.length === 1
                        ? 'Send 1 change?'
                        : `Send ${stagedList.length} changes?`,
                    changes: stagedList,
                  })
                }
              >
                Send {stagedList.length === 1 ? '1 change' : `${stagedList.length} changes`}
              </Button>
            </div>
          ) : undefined
        }
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && setView(v as 'box' | 'workspace')}
          aria-label="View"
        >
          <ToggleGroupItem value="box" className="px-3">
            By box
          </ToggleGroupItem>
          <ToggleGroupItem value="workspace" className="px-3">
            By workspace
          </ToggleGroupItem>
        </ToggleGroup>
        {dropped > 0 && (
          <Callout tone="warn" title="Some staged changes no longer apply">
            {dropped === 1 ? '1 staged change was' : `${dropped} staged changes were`} dropped: the
            box now shows that cell locked, gone or already so.
          </Callout>
        )}
        {left > 0 && stagedList.length > 0 && (
          <Callout tone="warn" title="Not sent yet">
            {left === 1 ? '1 change was' : `${left} changes were`} not run: the box did not take the
            call (see each change below). They are kept here: send them again.
          </Callout>
        )}
        {view === 'box' ? (
          <div className="@container rounded-lg border border-border">
            <Table aria-label="Boxes">
              <TableHeader>
                <TableRow>
                  <TableHead>Box</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden @md:table-cell">Last sign-in</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden text-right @md:table-cell">Workspaces</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {person.logins.map((l) => {
                  const st = loginState(l);
                  const key = colKey(l.boxId, l.loginId);
                  const column = grid.columns.find((c) => c.key === key)!;
                  const isOpen = l.full && openBoxes.has(key);
                  const lines = byBox.get(key) ?? [];
                  return (
                    <Fragment key={key}>
                      <TableRow>
                        <TableCell className="font-medium">
                          {l.full ? (
                            <Toggle
                              open={isOpen}
                              controls={`box-${key}`}
                              onClick={() => setOpenBoxes((o) => flip(o, key))}
                            >
                              {column.label}
                            </Toggle>
                          ) : (
                            <span className="pl-5">{column.label}</span>
                          )}
                          <StagedPill n={perBox.get(key) ?? 0} />
                        </TableCell>
                        <TableCell>{l.full ? roleWord(l.role) : '?'}</TableCell>
                        <TableCell
                          title={l.lastSignInAt ? formatDateTime(l.lastSignInAt) : undefined}
                          className="hidden text-muted-foreground @md:table-cell"
                        >
                          {!l.full ? '?' : l.lastSignInAt ? timeAgo(l.lastSignInAt) : 'Never'}
                        </TableCell>
                        <TableCell>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums @md:table-cell">
                          {l.full ? l.workspaces.length : '?'}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="whitespace-normal p-0">
                            {lines.length === 0 ? (
                              <p
                                id={`box-${key}`}
                                className="px-3 py-2 pl-8 text-sm text-muted-foreground"
                              >
                                No workspaces on this box.
                              </p>
                            ) : (
                              <ul
                                id={`box-${key}`}
                                aria-label={`Workspaces on ${column.label}`}
                                className="divide-y divide-border bg-muted/20"
                              >
                                {lines.map(({ row, cell }) => (
                                  <Line key={row.key} name={<RowName row={row} />}>
                                    <Cell
                                      label={`${row.label} on ${column.label}`}
                                      cell={cell}
                                      status={cellStatus(
                                        answers,
                                        sending,
                                        cell.boxId,
                                        cell.loginId,
                                        cell.workspaceId,
                                      )}
                                      staged={staged.get(changeKey(cell))?.role}
                                      onStage={(s) => stage(cell, s)}
                                    />
                                  </Line>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : grid.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No workspaces to show: none of this person&apos;s boxes sent its people list yet.
          </p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table aria-label="Workspaces">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Boxes</TableHead>
                  <TableHead className="text-right">In it on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.rows.map((row) => {
                  const lines = byWorkspace.get(row.key) ?? [];
                  const isOpen = openRows.has(row.key);
                  const inIt = lines.filter(
                    ({ cell }) => cell.kind === 'cell' && cell.state !== 'none',
                  ).length;
                  return (
                    <Fragment key={row.key}>
                      <TableRow>
                        <TableCell className="font-medium whitespace-normal">
                          <Toggle
                            open={isOpen}
                            controls={`ws-${row.key}`}
                            onClick={() => setOpenRows((o) => flip(o, row.key))}
                          >
                            {row.label}
                          </Toggle>
                          {row.admin && <Pill>Admin</Pill>}
                          {row.ambiguous && <Pill tone="warn">Same name twice</Pill>}
                          <StagedPill n={perRow.get(row.key) ?? 0} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{lines.length}</TableCell>
                        <TableCell className="text-right tabular-nums">{inIt}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="whitespace-normal p-0">
                            <ul
                              id={`ws-${row.key}`}
                              aria-label={`Boxes with ${row.label}`}
                              className="divide-y divide-border bg-muted/20"
                            >
                              {lines.map(({ column, cell }) => (
                                <Line key={column.key} name={column.label}>
                                  <Cell
                                    label={`${row.label} on ${column.label}`}
                                    cell={cell}
                                    status={
                                      cell.kind === 'cell'
                                        ? cellStatus(
                                            answers,
                                            sending,
                                            cell.boxId,
                                            cell.loginId,
                                            cell.workspaceId,
                                          )
                                        : null
                                    }
                                    staged={
                                      cell.kind === 'cell'
                                        ? staged.get(changeKey(cell))?.role
                                        : undefined
                                    }
                                    onStage={(s) => cell.kind === 'cell' && stage(cell, s)}
                                  />
                                </Line>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {reasons.map(({ l, why }) => (
          <p key={`${l.boxId}-${l.loginId}`} className="text-xs text-warning-ink">
            {l.box}: {why}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          Open a {view === 'box' ? 'box' : 'workspace'} and pick a role, then send the changes
          together. The Admin workspace and the box owner are changed on the box itself.
        </p>
      </Part>

      {sources.length >= 2 && targets.length >= 1 && (
        <Part title="Copy workspaces from one box to another">
          <p className="text-sm text-muted-foreground">
            Set this person up on one box, then copy: the same workspaces, by name, with the same
            role. A copy adds and sets roles only; it never removes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger size="sm" className="w-48" aria-label="Copy from box">
                <SelectValue placeholder="From box" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Copy className="size-4 text-muted-foreground" aria-hidden />
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger size="sm" className="w-48" aria-label="Copy to box">
                <SelectValue placeholder="To box" />
              </SelectTrigger>
              <SelectContent>
                {targets
                  .filter((c) => c.key !== from)
                  .map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {plan && (
            <div className="space-y-2 rounded-lg border border-border bg-primary/5 p-3 text-sm">
              {plan.changes.length === 0 ? (
                <p>Nothing to copy: the other box has these already.</p>
              ) : (
                <ul className="space-y-1">
                  {plan.changes.map((c) => (
                    <li key={changeKey(c)}>{describeChange(c, peopleBoxes)}</li>
                  ))}
                </ul>
              )}
              {plan.same.length > 0 && (
                <p className="text-xs text-muted-foreground">Already so: {plan.same.join(', ')}.</p>
              )}
              {plan.skipped.map((s, i) => (
                <p key={`${s.why}-${s.name}-${i}`} className="text-xs text-warning-ink">
                  {skipText(s)}
                </p>
              ))}
              {plan.changes.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={busy || plan.changes.length > MAX_MEMBER_CHANGES}
                    onClick={() =>
                      setConfirm({
                        title: `Copy ${plan.changes.length === 1 ? '1 workspace' : `${plan.changes.length} workspaces`}?`,
                        changes: plan.changes,
                      })
                    }
                  >
                    Copy{' '}
                    {plan.changes.length === 1
                      ? '1 workspace'
                      : `${plan.changes.length} workspaces`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Part>
      )}

      {history.length > 0 && (
        <Part title="Workspace changes">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {history.map((h) => (
              <li key={h.key} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                <span className="mt-1.5">
                  <Dot tone={h.tone} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{h.label}</span>
                  <span className={cn('block text-xs', TONE_TEXT[h.tone])}>{h.text}</span>
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  title={formatDateTime(h.at)}
                >
                  {timeAgo(h.at)}
                </span>
              </li>
            ))}
          </ul>
        </Part>
      )}

      <ConfirmSend
        open={confirm !== null}
        pending={sending.length > 0}
        title={confirm?.title ?? ''}
        action="Send"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void go()}
      >
        <span className="block">
          Each box runs it now with its own checks. An answer can take a minute or two.
        </span>
        {stale.map((t) => (
          <span key={t} className="mt-2 block text-warning-ink">
            Planned from an old list. {t}
          </span>
        ))}
        <span className="mt-2 block space-y-1">
          {confirm?.changes.map((c) => (
            <span key={changeKey(c)} className="block text-foreground">
              {describeChange(c, peopleBoxes)}
            </span>
          ))}
        </span>
      </ConfirmSend>
    </DetailPane>
  );
}
