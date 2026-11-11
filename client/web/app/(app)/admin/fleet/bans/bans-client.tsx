'use client';

import { useState, type FormEvent } from 'react';
import { Plus, ShieldBan } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import {
  banBody,
  banKeysText,
  banState,
  boxName,
  FLEET_PATH,
  liftLabel,
  liftText,
  OWNER_MATCH_TEXT,
  previewLine,
  type FleetBan,
  type FleetBanKind,
  type FleetOverview,
  type FleetPreview,
} from '@/lib/fleet';
import {
  Callout,
  DetailPane,
  Facts,
  FleetScreen,
  ListEmpty,
  ListPane,
  Part,
  Pill,
  useParam,
} from '../cc-kit';
import { refusalText } from '../fleet-section';

const NEW = 'new';
const EMPTY_FORM = { kind: 'disable' as FleetBanKind, emails: '', issuer: '', oid: '', reason: '' };
const logins = (n: number) => (n === 1 ? '1 login' : `${n} logins`);
const boxes = (n: number) => (n === 1 ? '1 box' : `${n} boxes`);

function StatePill({ ban }: { ban: FleetBan }) {
  const state = banState(ban);
  if (state === 'active') return <Pill tone="bad">Active</Pill>;
  return <Pill>{state === 'retired' ? 'Retired' : 'Lifted'}</Pill>;
}

/** A new ban, in the pane: the form, then its preview, then the ban. Any
 *  change clears the preview, so the ban made is the ban previewed. */
function NewBan({
  onMade,
  onCancel,
}: {
  onMade: (id: string | null) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState<FleetPreview | null>(null);
  const [pending, setPending] = useState(false);

  const set = (patch: Partial<typeof EMPTY_FORM>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      const body = banBody(form);
      if (!preview) {
        const res = await apiSend<{ preview: FleetPreview }>(`${FLEET_PATH}/bans`, 'POST', {
          ...body,
          preview: true,
        });
        setPreview(res.preview);
      } else {
        const res = await apiSend<{ ban?: { id?: string } }>(`${FLEET_PATH}/bans`, 'POST', body);
        toast.success('Ban made. Every box runs it now.');
        setForm(EMPTY_FORM);
        setPreview(null);
        onMade(res?.ban?.id ?? null);
      }
    } catch (err) {
      toast.error(refusalText(err, 'Could not make the ban.'));
    } finally {
      setPending(false);
    }
  };

  const nothing = !form.emails.trim() && !form.oid.trim();
  const owners = preview?.boxes.some((b) => b.owners > 0) ?? false;

  return (
    <DetailPane icon={<Plus />} title="New ban">
      <p className="text-sm text-muted-foreground">
        A ban disables the person on every linked box. Check the preview, then make the ban.
      </p>
      <form onSubmit={send} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="fleet-ban-emails">Emails</FieldLabel>
            <Textarea
              id="fleet-ban-emails"
              rows={2}
              value={form.emails}
              onChange={(e) => set({ emails: e.target.value })}
              placeholder="person@example.com"
            />
            <FieldDescription>
              One or more, split by commas or new lines. The match is exact: an alias or a +tag
              address does not match.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="fleet-ban-kind">Kind</FieldLabel>
            <Select value={form.kind} onValueChange={(v) => set({ kind: v as FleetBanKind })}>
              <SelectTrigger id="fleet-ban-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disable">Disable (the ban can be lifted)</SelectItem>
                <SelectItem value="archive">Archive (a permanent disable)</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              {form.kind === 'archive'
                ? 'Only a box Admin undoes an archive, by hand, on that box. This screen never enables it.'
                : 'Lift the ban here to enable the logins again.'}
            </FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="fleet-ban-issuer">Sign-in issuer (optional)</FieldLabel>
              <Input
                id="fleet-ban-issuer"
                value={form.issuer}
                maxLength={300}
                placeholder="https://"
                onChange={(e) => set({ issuer: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="fleet-ban-oid">Object id (optional)</FieldLabel>
              <Input
                id="fleet-ban-oid"
                value={form.oid}
                maxLength={128}
                onChange={(e) => set({ oid: e.target.value })}
              />
            </Field>
          </div>
          <FieldDescription>
            A company sign-in link with this issuer and object id also matches. Give both or
            neither.
          </FieldDescription>
          <Field>
            <FieldLabel htmlFor="fleet-ban-reason">Reason (optional)</FieldLabel>
            <Input
              id="fleet-ban-reason"
              value={form.reason}
              maxLength={500}
              onChange={(e) => set({ reason: e.target.value })}
            />
          </Field>
          {preview && (
            <div
              className="space-y-2 rounded-lg border border-border bg-primary/5 p-3"
              aria-label="Ban preview"
              role="group"
            >
              <p className="text-sm font-medium">Preview, from each box&apos;s last login list</p>
              {preview.boxes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No box is linked.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {preview.boxes.map((b) => (
                    <li key={b.boxId} className={b.owners > 0 ? 'text-destructive-ink' : undefined}>
                      {previewLine(b)}
                    </li>
                  ))}
                </ul>
              )}
              {owners && <Callout tone="bad" title={OWNER_MATCH_TEXT} />}
              {preview.unknown > 0 && (
                <p className="text-xs text-muted-foreground">
                  Boxes with no login list yet are checked at their next run.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            {preview ? (
              <SubmitButton
                pending={pending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {form.kind === 'archive' ? 'Make archive ban' : 'Make ban'}
              </SubmitButton>
            ) : (
              <SubmitButton pending={pending} disabled={nothing}>
                Preview ban
              </SubmitButton>
            )}
          </div>
        </FieldGroup>
      </form>
    </DetailPane>
  );
}

function BanDetail({
  ban,
  data,
  onLift,
}: {
  ban: FleetBan;
  data: FleetOverview;
  onLift: () => void;
}) {
  const state = banState(ban);
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const mine = data.results.filter(
    (r) => r.banId === ban.id && (r.matched > 0 || r.ownerIds.length > 0),
  );
  const ownerHit = mine.some((r) => r.ownerIds.length > 0);
  const gone = 'a login that is gone';
  return (
    <DetailPane
      icon={<ShieldBan />}
      title={banKeysText(ban)}
      pill={<StatePill ban={ban} />}
      actions={
        state === 'active' ? (
          <Button size="sm" variant="outline" onClick={onLift}>
            {liftLabel(ban.kind)}
          </Button>
        ) : undefined
      }
    >
      {ownerHit && <Callout tone="bad" title={OWNER_MATCH_TEXT} />}
      <Part title="The ban">
        <Facts
          rows={[
            {
              label: 'Kind',
              value:
                ban.kind === 'archive'
                  ? 'Archive: a permanent disable'
                  : 'Disable: it can be lifted',
            },
            {
              label: 'Emails',
              value: ban.emails.length > 0 ? ban.emails.join(', ') : 'None',
            },
            ...(ban.issuer && ban.oid
              ? [
                  { label: 'Sign-in issuer', value: ban.issuer },
                  { label: 'Object id', value: <span className="font-mono">{ban.oid}</span> },
                ]
              : []),
            { label: 'Reason', value: ban.reason ?? 'None given' },
            {
              label: 'Made',
              value: `By ${ban.madeBy ?? gone}, ${formatDateTime(ban.madeAt)}`,
            },
            ...(ban.liftedAt
              ? [
                  {
                    label: state === 'retired' ? 'Retired' : 'Lifted',
                    value: `By ${ban.liftedBy ?? gone}, ${formatDateTime(ban.liftedAt)}`,
                  },
                ]
              : []),
          ]}
        />
      </Part>
      <Part title="At the last run">
        <p className="text-sm">
          {logins(ban.loginsMatched)} on {boxes(ban.boxesMatched)} at the last run.
        </p>
        {mine.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {mine.map((r) => {
              const box = byId.get(r.boxId);
              const owner = r.ownerIds.length > 0;
              return (
                <li
                  key={r.boxId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">
                    {box ? boxName(box) : 'A removed box'}
                  </span>
                  <span className={owner ? 'text-destructive-ink' : 'text-muted-foreground'}>
                    {logins(r.matched)}
                    {owner && ', the owner among them'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Part>
    </DetailPane>
  );
}

function Bans({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  const toast = useToast();
  const [param, setParam] = useParam('ban');
  const [lifting, setLifting] = useState<FleetBan | null>(null);
  const [pending, setPending] = useState(false);
  // Active bans first, each part newest first.
  const bans = [...data.bans].sort((a, b) => {
    if (!a.liftedAt !== !b.liftedAt) return a.liftedAt ? 1 : -1;
    return b.madeAt.localeCompare(a.madeAt);
  });
  const active = bans.filter((b) => !b.liftedAt).length;
  const making = param === NEW || bans.length === 0;
  const selected = making ? null : (bans.find((b) => b.id === param) ?? bans[0]!);

  const lift = async () => {
    if (!lifting) return;
    setPending(true);
    try {
      await apiSend(`${FLEET_PATH}/bans/${lifting.id}/lift`, 'POST');
      toast.success(lifting.kind === 'archive' ? 'Ban retired' : 'Ban lifted');
      setLifting(null);
      refresh();
    } catch (err) {
      toast.error(refusalText(err, 'Could not change the ban.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-bans"
        list={
          <ListPane
            title={`Bans (${active} active)`}
            action={
              <Button size="sm" onClick={() => setParam(NEW)}>
                <Plus /> New ban
              </Button>
            }
          >
            {bans.length === 0 ? (
              <ListEmpty>No ban. Make the first one on the right.</ListEmpty>
            ) : (
              <ul className="space-y-2" aria-label="Bans">
                {bans.map((b) => {
                  const owner = data.results.some((r) => r.banId === b.id && r.ownerIds.length > 0);
                  return (
                    <li key={b.id}>
                      <ListCard
                        selected={selected?.id === b.id}
                        dimmed={!!b.liftedAt}
                        accent={owner && !b.liftedAt ? 'warning' : undefined}
                        onClick={() => setParam(b.id)}
                      >
                        <div className="flex items-start gap-2">
                          <ListCardTitle wrap className="min-w-0 flex-1 break-all">
                            {banKeysText(b)}
                          </ListCardTitle>
                          <StatePill ban={b} />
                        </div>
                        <ListCardMeta>
                          {b.kind === 'archive' ? 'Archive' : 'Disable'} · {logins(b.loginsMatched)}{' '}
                          on {boxes(b.boxesMatched)}
                        </ListCardMeta>
                        <ListCardMeta>Made {formatDateTime(b.madeAt)}</ListCardMeta>
                      </ListCard>
                    </li>
                  );
                })}
              </ul>
            )}
          </ListPane>
        }
        detail={
          selected ? (
            <BanDetail ban={selected} data={data} onLift={() => setLifting(selected)} />
          ) : (
            <NewBan
              onMade={(id) => {
                setParam(id);
                refresh();
              }}
              onCancel={() => setParam(null)}
            />
          )
        }
      />
      <AlertDialog open={lifting !== null} onOpenChange={(o) => !o && !pending && setLifting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifting?.kind === 'archive' ? 'Retire this ban?' : 'Lift this ban?'}
            </AlertDialogTitle>
            <AlertDialogDescription>{lifting ? liftText(lifting.kind) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void lift();
              }}
            >
              {lifting ? `${liftLabel(lifting.kind)} ban` : 'Lift ban'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function BansClient() {
  return <FleetScreen>{(data, refresh) => <Bans data={data} refresh={refresh} />}</FleetScreen>;
}
