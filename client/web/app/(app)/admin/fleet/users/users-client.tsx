'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Input } from '@mantle/web-ui/ui/input';
import { ListCard, ListCardMeta, ListCardTags, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { cn } from '@mantle/web-ui/lib/utils';
import { timeAgo } from '@mantle/web-ui/lib/format-datetime';
import {
  banKeysText,
  boxName,
  liftText,
  OWNER_MATCH_TEXT,
  previewLine,
  type FleetBan,
  type FleetOverview,
  type FleetPreview,
} from '@/lib/fleet';
import {
  filterCounts,
  filterPeople,
  agoText,
  groupPeople,
  PEOPLE_FILTERS,
  peopleReasonText,
  roleWord,
  type PeopleFilter,
  type Person,
} from '@/lib/fleet-people';
import {
  Callout,
  DetailPane,
  FleetScreen,
  ListEmpty,
  ListPane,
  Part,
  Pill,
  ScreenLink,
  useMatrixRows,
  useParam,
} from '../cc-kit';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { ccHref } from '@/lib/fleet-view';
import { NO_CHANNEL_TEXT } from '@/lib/fleet-tool';
import { BulkPane } from './bulk-pane';
import { PersonDetail } from './person-detail';
import { useBanWrite, useMembersWrite, usePeople } from './use-people';

/** A card names this many boxes, then says how many more. */
const CARD_BOXES = 6;

const isFilter = (v: string | null): v is PeopleFilter => PEOPLE_FILTERS.some((f) => f.id === v);

function PersonCard({
  person,
  selected,
  picked,
  onOpen,
  onPick,
}: {
  person: Person;
  selected: boolean;
  picked: boolean;
  onOpen: () => void;
  onPick: (on: boolean) => void;
}) {
  const banned = person.bans.length > 0;
  return (
    <ListCard asChild selected={selected} dimmed={person.disabled && !banned}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          className="mt-0.5"
          checked={picked}
          aria-label={`Pick ${person.email}`}
          onCheckedChange={(v) => onPick(v === true)}
        />
        <RowButton
          className="min-w-0 flex-1 rounded-sm"
          onClick={onOpen}
          aria-current={selected ? 'true' : undefined}
        >
          <div className="flex items-start gap-2">
            <ListCardTitle className="min-w-0 flex-1">{person.name ?? person.email}</ListCardTitle>
            {banned && <Pill tone="bad">Banned</Pill>}
          </div>
          {person.name && <ListCardMeta>{person.email}</ListCardMeta>}
          <ListCardMeta>
            {person.full
              ? `${person.memberships === 1 ? '1 workspace' : `${person.memberships} workspaces`} · ${
                  person.lastSignInAt ? `seen ${timeAgo(person.lastSignInAt)}` : 'never signed in'
                }`
              : 'A box runs a release before Fleet users'}
          </ListCardMeta>
          <ListCardTags>
            {person.logins.slice(0, CARD_BOXES).map((l) => (
              <span
                key={`${l.boxId}-${l.loginId}`}
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4',
                  l.disabled || l.archived
                    ? 'border-destructive/50 text-destructive-ink line-through'
                    : 'border-border text-muted-foreground',
                )}
                title={l.disabled || l.archived ? 'Disabled on this box' : undefined}
              >
                {l.box}
                {l.role === 'admin' && ` · ${roleWord(l.role)}`}
              </span>
            ))}
            {person.logins.length > CARD_BOXES && (
              <span
                className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground"
                title={person.logins
                  .slice(CARD_BOXES)
                  .map((l) => l.box)
                  .join(', ')}
              >
                +{person.logins.length - CARD_BOXES} more
              </span>
            )}
          </ListCardTags>
        </RowButton>
      </div>
    </ListCard>
  );
}

/** Ban one person: the preview of the Bans screen first, then the ban. */
function BanDialog({
  person,
  onClose,
  write,
}: {
  person: Person | null;
  onClose: () => void;
  write: ReturnType<typeof useBanWrite>;
}) {
  const [preview, setPreview] = useState<FleetPreview | null>(null);
  const [reason, setReason] = useState('');
  const email = person?.email ?? null;
  const { preview: ask } = write;
  useEffect(() => {
    setPreview(null);
    setReason('');
    if (!email) return;
    let live = true;
    void ask(email).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
    // `ask` is new each render; the email decides when to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
  const owners = preview?.boxes.some((b) => b.owners > 0) ?? false;
  return (
    <AlertDialog open={person !== null} onOpenChange={(o) => !o && !write.pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban {email}?</AlertDialogTitle>
          <AlertDialogDescription>
            A ban disables this person on every linked box: every way in ends at once. Lift the ban
            here to enable the logins again. For a permanent archive, use the Bans screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          {preview === null ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner size={14} /> Checking each box&apos;s last login list…
            </p>
          ) : (
            <ul className="space-y-1" aria-label="Ban preview">
              {preview.boxes.map((b) => (
                <li key={b.boxId} className={b.owners > 0 ? 'text-destructive-ink' : undefined}>
                  {previewLine(b)}
                </li>
              ))}
            </ul>
          )}
          {owners && <Callout tone="bad" title={OWNER_MATCH_TEXT} />}
          <Input
            aria-label="Reason (optional)"
            placeholder="Reason (optional)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={write.pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={write.pending || preview === null}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              if (email) void write.make(email, reason).then((ok) => ok && onClose());
            }}
          >
            Ban on every box
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LiftDialog({
  ban,
  emails,
  onClose,
  write,
}: {
  ban: FleetBan | null;
  /** The person's emails (the person pane), or the ban's own (a lift from
   *  the list of bans): any other key the ban holds is said. */
  emails: readonly string[];
  onClose: () => void;
  write: ReturnType<typeof useBanWrite>;
}) {
  const mine = new Set(emails.map((e) => e.toLowerCase()));
  const others = ban ? ban.emails.filter((e) => !mine.has(e.toLowerCase())) : [];
  const keys = ban ? banKeysText(ban) : '';
  return (
    <AlertDialog open={ban !== null} onOpenChange={(o) => !o && !write.pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {ban?.kind === 'archive' ? 'Retire this ban?' : 'Lift this ban?'}
          </AlertDialogTitle>
          <AlertDialogDescription>{ban ? liftText(ban.kind) : ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">
          This ban holds: <span className="break-all font-medium">{keys}</span>
        </p>
        {(others.length > 0 || (ban?.issuer && ban.oid)) && (
          <Callout tone="warn" title="This ban holds more than this person">
            Lifting it lifts it for every key above.
          </Callout>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={write.pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={write.pending}
            onClick={(e) => {
              e.preventDefault();
              if (ban) void write.lift(ban).then((ok) => ok && onClose());
            }}
          >
            {ban?.kind === 'archive' ? 'Retire ban' : 'Lift ban'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What shows while the Control Center has no admin channel: the login
 *  counts each box already sends in its facts, and the active bans. */
function Fallback({ data, onLift }: { data: FleetOverview; onLift: (ban: FleetBan) => void }) {
  const { rows } = useMatrixRows(data.boxes);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bans = data.bans.filter((b) => !b.liftedAt);
  return (
    <div className="mx-auto max-w-4xl">
      <DetailPane icon={<Users />} title="Fleet users">
        <Callout title="Names and workspaces show once the admin channel is on (Control Center release + each box's scope).">
          {NO_CHANNEL_TEXT} Until then this screen shows how many logins each box has, and the bans.
          A ban disables a person on every linked box.
        </Callout>
        <Part title="Logins on each box">
          <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
            <Table aria-label="Logins on each box">
              <TableHeader>
                <TableRow>
                  <TableHead>Box</TableHead>
                  <TableHead className="text-right">Admins</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Disabled</TableHead>
                  <TableHead className="text-right">All</TableHead>
                  <TableHead className="text-right">As of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.boxes.map((b) => {
                  const facts = byId.get(b.id)?.facts ?? null;
                  const l = facts?.status?.logins ?? null;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{boxName(b)}</TableCell>
                      {l ? (
                        <>
                          <TableCell className="text-right tabular-nums">{l.admin}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.member}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.disabled}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.total}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {agoText(facts!.at)}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={5} className="text-right text-muted-foreground">
                          {b.loginCount === null ? 'No facts yet' : `${b.loginCount} logins`}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Part>
        <Part
          title={`Active bans (${bans.length})`}
          action={<ScreenLink href={ccHref('bans')}>Open Bans</ScreenLink>}
        >
          {bans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active ban.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {bans.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-all">
                    {banKeysText(b)}
                    {b.reason ? <span className="text-muted-foreground">: {b.reason}</span> : null}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onLift(b)}>
                    {b.kind === 'archive' ? 'Retire ban' : 'Lift ban'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Part>
      </DetailPane>
    </div>
  );
}

function People({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const read = usePeople(data);
  const query = read.query;
  const [param, setParam] = useParam('person');
  const [filterParam, setFilterParam] = useParam('show');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [banning, setBanning] = useState<Person | null>(null);
  const [lifting, setLifting] = useState<{ ban: FleetBan; emails: string[] } | null>(null);
  const members = useMembersWrite(read.reread);
  const banWrite = useBanWrite(refresh);
  const filter: PeopleFilter = isFilter(filterParam) ? filterParam : 'all';

  const peopleBoxes = read.boxes;
  const people = useMemo(() => groupPeople(peopleBoxes, data.bans), [peopleBoxes, data.bans]);
  const shown = useMemo(() => filterPeople(people, filter, q), [people, filter, q]);
  const counts = useMemo(() => filterCounts(people, q), [people, q]);
  const pickedPeople = people.filter((p) => picked.has(p.email));

  const liftDialog = (
    <LiftDialog
      ban={lifting?.ban ?? null}
      emails={lifting?.emails ?? []}
      onClose={() => setLifting(null)}
      write={banWrite}
    />
  );
  if (data.boxes.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No box is linked.</p>;
  }
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Spinner size={20} /> Asking each box for its logins…
      </div>
    );
  }
  if (read.channel === false) {
    return (
      <>
        <Fallback data={data} onLift={(ban) => setLifting({ ban, emails: ban.emails })} />
        {liftDialog}
      </>
    );
  }
  if (query.isError || read.channel === null) {
    return <p className="p-6 text-sm text-destructive-ink">Could not load the people.</p>;
  }

  const selected =
    pickedPeople.length > 0
      ? null
      : (shown.find((p) => p.logins.some((l) => `${l.boxId}:${l.loginId}` === param)) ??
        shown[0] ??
        null);
  const pick = (email: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(email);
      else next.delete(email);
      return next;
    });
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.email));
  const boxNotes = peopleBoxes
    .map((b) => ({ b, why: peopleReasonText(b) }))
    .filter((x): x is { b: (typeof peopleBoxes)[number]; why: string } => x.why !== null);

  return (
    <>
      <MasterDetail
        id="cc-fleet-users"
        defaultListSize="380px"
        list={
          <ListPane
            title={`People (${people.length})`}
            action={
              shown.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPicked(allShownPicked ? new Set() : new Set(shown.map((p) => p.email)))
                  }
                >
                  {allShownPicked ? 'Clear' : 'Pick all'}
                </Button>
              ) : undefined
            }
          >
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                size="sm"
                className="pl-8"
                aria-label="Search people"
                placeholder="Search by name, email or box"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
              {PEOPLE_FILTERS.map((f) => (
                <Button
                  key={f.id}
                  size="2xs"
                  variant={filter === f.id ? 'secondary' : 'outline'}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilterParam(f.id === 'all' ? null : f.id)}
                >
                  {f.label}
                  <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
                </Button>
              ))}
            </div>
            {boxNotes.length > 0 && (
              <ul className="space-y-1" aria-label="Boxes not shown in full">
                {boxNotes.map(({ b, why }) => (
                  <li key={b.id} className="text-xs text-warning-ink">
                    <span className="font-medium">{boxName(b)}:</span> {why}
                  </li>
                ))}
              </ul>
            )}
            {pickedPeople.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  {pickedPeople.length === 1 ? '1 picked' : `${pickedPeople.length} picked`}
                </span>
                <Button size="2xs" variant="ghost" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
            )}
            {shown.length === 0 ? (
              <ListEmpty>
                {people.length === 0 ? 'No box has sent its logins yet.' : 'Nobody matches.'}
              </ListEmpty>
            ) : (
              <ul className="space-y-2" aria-label="People">
                {shown.map((p) => (
                  <li key={p.email}>
                    <PersonCard
                      person={p}
                      selected={selected?.email === p.email}
                      picked={picked.has(p.email)}
                      onOpen={() => {
                        setPicked(new Set());
                        // An opaque key in the address: the first login's id, never the email.
                        setParam(
                          p.logins[0] ? `${p.logins[0].boxId}:${p.logins[0].loginId}` : null,
                        );
                      }}
                      onPick={(on) => pick(p.email, on)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </ListPane>
        }
        detail={
          pickedPeople.length > 0 ? (
            <BulkPane
              people={pickedPeople}
              peopleBoxes={peopleBoxes}
              sending={members.pending}
              onSend={members.send}
              onClear={() => setPicked(new Set())}
            />
          ) : selected ? (
            <PersonDetail
              key={selected.email}
              person={selected}
              peopleBoxes={peopleBoxes}
              answers={members.answers}
              sending={members.sending}
              onSend={members.send}
              onBan={() => setBanning(selected)}
              onLift={(ban) => setLifting({ ban, emails: [selected.email] })}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Pick a person on the left.</div>
          )
        }
      />
      <BanDialog person={banning} onClose={() => setBanning(null)} write={banWrite} />
      {liftDialog}
    </>
  );
}

export function UsersClient() {
  return <FleetScreen>{(data, refresh) => <People data={data} refresh={refresh} />}</FleetScreen>;
}
