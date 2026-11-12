'use client';

import { useMemo, useState } from 'react';
import { Copy, Lock, ShieldBan, ShieldCheck, UserRound } from 'lucide-react';
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
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { banKeysText, type FleetBan, type FleetOverview } from '@/lib/fleet';
import {
  cellChoices,
  cellStatus,
  copyPlan,
  describeChange,
  loginState,
  MAX_MEMBER_CHANGES,
  memberHistory,
  membershipGrid,
  peopleReasonText,
  roleWord,
  skipText,
  stateWord,
  type FleetPeopleBox,
  type GridCell,
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

const cellKey = (c: { boxId: string; loginId: string; workspaceId: string }) =>
  `${c.boxId}:${c.loginId}:${c.workspaceId}`;

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
  fleet,
  sending,
  onSend,
  onBan,
  onLift,
}: {
  person: Person;
  peopleBoxes: FleetPeopleBox[];
  fleet: FleetOverview;
  sending: boolean;
  onSend: (changes: MemberChange[]) => Promise<MembersSent>;
  onBan: () => void;
  onLift: (ban: FleetBan) => void;
}) {
  const grid = useMemo(() => membershipGrid(person, peopleBoxes), [person, peopleBoxes]);
  const fleetById = useMemo(() => new Map(fleet.boxes.map((b) => [b.id, b])), [fleet.boxes]);
  const peopleById = useMemo(() => new Map(peopleBoxes.map((b) => [b.id, b])), [peopleBoxes]);
  const [staged, setStaged] = useState<Map<string, MemberChange>>(() => new Map());
  const [left, setLeft] = useState(0);
  const [confirm, setConfirm] = useState<{ title: string; changes: MemberChange[] } | null>(null);
  const full = grid.columns.filter((c) => c.full && !c.owner);
  const sources = full;
  const targets = full.filter((c) => !c.off);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const plan = from && to && from !== to ? copyPlan(person, from, to, peopleBoxes) : null;
  const banned = person.bans.length > 0;
  const history = memberHistory(fleet.boxes, person.logins, peopleBoxes).slice(0, 12);

  const stage = (cell: Extract<GridCell, { kind: 'cell' }>, s: MemberState | undefined) => {
    setStaged((m) => {
      const next = new Map(m);
      const k = cellKey(cell);
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
    if (!confirm) return;
    const sent = await onSend(confirm.changes);
    if (!sent) return;
    setConfirm(null);
    // A box that was not queued keeps its changes here, to send again.
    setStaged(new Map(sent.left.map((c) => [cellKey(c), c])));
    setLeft(sent.left.length);
  };

  const stagedList = [...staged.values()];
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
        title={`Logins (${person.logins.length === 1 ? '1 box' : `${person.logins.length} boxes`})`}
      >
        <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Box</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Workspaces</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {person.logins.map((l) => {
                const st = loginState(l);
                return (
                  <TableRow key={`${l.boxId}-${l.loginId}`}>
                    <TableCell className="font-medium">{l.box}</TableCell>
                    <TableCell>{l.full ? roleWord(l.role) : '?'}</TableCell>
                    <TableCell
                      title={l.lastSignInAt ? formatDateTime(l.lastSignInAt) : undefined}
                      className="text-muted-foreground"
                    >
                      {!l.full ? '?' : l.lastSignInAt ? timeAgo(l.lastSignInAt) : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.full ? l.workspaces.length : '?'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {reasons.map(({ l, why }) => (
          <p key={`${l.boxId}-${l.loginId}`} className="text-xs text-warning-ink">
            {l.box}: {why}
          </p>
        ))}
      </Part>

      <Part
        title="Workspaces, box by box"
        action={
          stagedList.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStaged(new Map())}>
                Undo
              </Button>
              <Button
                size="sm"
                disabled={stagedList.length > MAX_MEMBER_CHANGES}
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
        {left > 0 && stagedList.length > 0 && (
          <Callout tone="warn" title="Not sent yet">
            {left === 1 ? '1 change was' : `${left} changes were`} not queued: 40 changes wait on
            that box already. They are kept here: send them again in a minute.
          </Callout>
        )}
        {grid.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No workspaces to show: none of this person&apos;s boxes sent its people list yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
            <Table aria-label="Workspaces, box by box">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  {grid.columns.map((c) => (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {row.label}
                        {row.admin && <Pill>Admin</Pill>}
                        {row.ambiguous && <Pill tone="warn">Same name twice</Pill>}
                      </span>
                    </TableCell>
                    {grid.columns.map((c) => {
                      const cell = row.cells[c.key]!;
                      if (!c.full) {
                        return (
                          <TableCell key={c.key} className="text-xs text-muted-foreground">
                            Not known
                          </TableCell>
                        );
                      }
                      const status =
                        cell.kind === 'cell'
                          ? cellStatus(
                              fleetById.get(c.boxId),
                              cell.loginId,
                              cell.workspaceId,
                              peopleById.get(c.boxId)?.people?.at ?? null,
                            )
                          : null;
                      return (
                        <TableCell key={c.key} className="align-top">
                          <Cell
                            label={`${row.label} on ${c.label}`}
                            cell={cell}
                            status={status}
                            staged={
                              cell.kind === 'cell' ? staged.get(cellKey(cell))?.role : undefined
                            }
                            onStage={(s) => cell.kind === 'cell' && stage(cell, s)}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Pick a role in any cell, then send the changes together. The Admin workspace and the box
          owner are changed on the box itself.
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
                    <li key={cellKey(c)}>{describeChange(c, peopleBoxes)}</li>
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
                    disabled={plan.changes.length > MAX_MEMBER_CHANGES}
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
        pending={sending}
        title={confirm?.title ?? ''}
        action="Send"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void go()}
      >
        <span className="block">Each box makes the change at its next run, within seconds.</span>
        <span className="mt-2 block space-y-1">
          {confirm?.changes.map((c) => (
            <span key={cellKey(c)} className="block text-foreground">
              {describeChange(c, peopleBoxes)}
            </span>
          ))}
        </span>
      </ConfirmSend>
    </DetailPane>
  );
}
