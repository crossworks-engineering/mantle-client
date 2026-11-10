'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyBlock, CopyButton } from '@mantle/web-ui/ui/copy-button';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { SUPPORTED_PROVIDERS } from '@mantle/voice-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import {
  banBody,
  banKeysText,
  banState,
  boxName,
  FLEET_KEY,
  FLEET_KEYS_PATH,
  FLEET_PATH,
  fleetKeyProviders,
  fleetKeysOffered,
  keyBoxText,
  keyUpdatePending,
  liftLabel,
  liftText,
  OWNER_MATCH_TEXT,
  previewLine,
  reasonText,
  tickIsStale,
  type FleetBan,
  type FleetBanKind,
  type FleetBox,
  type FleetOverview,
  type FleetPreview,
  type FleetResult,
} from '@/lib/fleet';
import { fleetMatrixOffered } from '@/lib/fleet-matrix';
import { fleetWritesOffered, writeUpdatePending } from '@/lib/fleet-writes';
import { fleetQuery } from '@/lib/use-fleet-shown';
import { MatrixSection } from './fleet-matrix';
import { BoxPicker, useBoxPick } from './fleet-box-picker';
import { ModelsSection } from './fleet-models';
import { SettingsSections } from './fleet-settings';
import { WritesSection } from './fleet-writes';
import { refusalText, Section } from './fleet-section';

function OwnerWarning() {
  return (
    <p role="status" className="flex items-start gap-1.5 text-sm text-destructive-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{OWNER_MATCH_TEXT}</span>
    </p>
  );
}

// --- this Control Center ------------------------------------------------------

function ServiceSection({ data }: { data: FleetOverview }) {
  const service = data.service;
  if (!service) {
    return (
      <Section title="This Control Center">
        <p role="status" className="flex items-start gap-1.5 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            The control service has not made its key yet. Add control to COMPOSE_PROFILES in the
            .env of this box, then run docker compose up -d.
          </span>
        </p>
      </Section>
    );
  }
  const stale = tickIsStale(service.lastTickAt);
  return (
    <Section title="This Control Center">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Key fingerprint</p>
          <p className="break-all font-mono text-sm">{service.fingerprint}</p>
        </div>
        <CopyButton value={service.fingerprint} ariaLabel="Copy the key fingerprint" />
      </div>
      <p className="text-xs text-muted-foreground">
        Check it against the control key fingerprint line in the mantle_worker_control log.
      </p>
      {stale ? (
        <p role="status" className="flex items-start gap-1.5 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            The control service is not running.{' '}
            {service.lastTickAt
              ? `Its last run was at ${formatDateTime(service.lastTickAt)}.`
              : 'It has not run.'}{' '}
            No box gets a ban or a lift until it runs again.
          </span>
        </p>
      ) : (
        <p className="text-sm">
          The control service is running. Last run {formatDateTime(service.lastTickAt!)}.
        </p>
      )}
      {data.envLines && (
        <div className="space-y-2">
          <p className="text-sm">
            Add these two lines to the .env of each box this Control Center manages, then run docker
            compose up -d on that box.
          </p>
          <CopyBlock code={data.envLines.join('\n')} />
        </div>
      )}
    </Section>
  );
}

// --- boxes --------------------------------------------------------------------

function boxStatus(box: FleetBox): { bad: boolean; text: string } {
  const reason = reasonText(box.lastReason);
  if (reason) return { bad: true, text: reason };
  if (box.lastOkAt)
    return { bad: false, text: `Linked. Last good run ${formatDateTime(box.lastOkAt)}.` };
  return { bad: false, text: 'Waiting for the first run.' };
}

function BoxRow({ box, onRemove }: { box: FleetBox; onRemove: () => void }) {
  const status = boxStatus(box);
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{boxName(box)}</span>
          {box.lastReason && (
            <Badge variant="outline" className="font-mono text-destructive-ink">
              {box.lastReason}
            </Badge>
          )}
        </div>
        <p className="break-all text-xs text-muted-foreground">{box.url}</p>
        <p className={`text-xs ${status.bad ? 'text-destructive-ink' : 'text-muted-foreground'}`}>
          {status.text}
        </p>
        <p className="text-xs text-muted-foreground">
          {box.lastRunAt ? `Last run ${formatDateTime(box.lastRunAt)}` : 'No run yet'}
          {box.loginCount !== null &&
            ` · ${box.loginCount === 1 ? '1 login' : `${box.loginCount} logins`}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${boxName(box)}`}
        className="text-muted-foreground hover:text-destructive-ink"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function AddBoxForm({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setPending(true);
    try {
      await apiSend(`${FLEET_PATH}/boxes`, 'POST', {
        url: url.trim(),
        label: label.trim() || null,
      });
      setUrl('');
      setLabel('');
      toast.success('Box added. Its first run starts now.');
      onAdded();
    } catch (err) {
      toast.error(refusalText(err, 'Could not add the box.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="fleet-box-url">Box URL</FieldLabel>
            <Input
              id="fleet-box-url"
              value={url}
              placeholder="https://box.example.com"
              inputMode="url"
              maxLength={400}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="fleet-box-label">Label (optional)</FieldLabel>
            <Input
              id="fleet-box-label"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
        <FieldDescription>
          HTTPS and the host only, no path. The box needs the two lines above in its .env, and this
          box must reach it over HTTPS.
        </FieldDescription>
        <div className="flex justify-end">
          <SubmitButton pending={pending} disabled={!url.trim()}>
            Add box
          </SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}

function BoxesSection({ boxes, onChanged }: { boxes: FleetBox[]; onChanged: () => void }) {
  const toast = useToast();
  const [removing, setRemoving] = useState<FleetBox | null>(null);
  const [pending, setPending] = useState(false);

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    try {
      await apiSend(`${FLEET_PATH}/boxes/${removing.id}`, 'DELETE');
      toast.success('Box removed');
      setRemoving(null);
      onChanged();
    } catch (err) {
      toast.error(refusalText(err, 'Could not remove the box.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section title={`Boxes (${boxes.length})`}>
      {boxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No box is linked.</p>
      ) : (
        <ul className="divide-y divide-border">
          {boxes.map((b) => (
            <BoxRow key={b.id} box={b} onRemove={() => setRemoving(b)} />
          ))}
        </ul>
      )}
      <AddBoxForm onAdded={onChanged} />
      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => !o && !pending && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing ? boxName(removing) : 'this box'}?</AlertDialogTitle>
            <AlertDialogDescription>
              All calls to this box stop. Logins it disabled stay disabled. To unlink it fully, also
              remove the two control lines from its .env.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Remove box
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

// --- bans ---------------------------------------------------------------------

const EMPTY_FORM = { kind: 'disable' as FleetBanKind, emails: '', issuer: '', oid: '', reason: '' };

function NewBanDialog({
  open,
  onOpenChange,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMade: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  // The preview of the form as it is now: any change clears it, so the ban
  // made is the ban previewed.
  const [preview, setPreview] = useState<FleetPreview | null>(null);
  const [pending, setPending] = useState(false);

  const set = (patch: Partial<typeof EMPTY_FORM>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
  };
  const change = (next: boolean) => {
    if (!next && pending) return;
    if (!next) {
      setForm(EMPTY_FORM);
      setPreview(null);
    }
    onOpenChange(next);
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
        await apiSend(`${FLEET_PATH}/bans`, 'POST', body);
        toast.success('Ban made. Every box runs it now.');
        setForm(EMPTY_FORM);
        setPreview(null);
        onOpenChange(false);
        onMade();
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
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New ban</DialogTitle>
          <DialogDescription>
            Disables the person on every linked box. Check the preview, then make the ban.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={send} noValidate>
          <FieldGroup>
            <div className="-mx-1 max-h-[55vh] space-y-4 overflow-y-auto px-1 scrollbar-thin">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
                <div className="space-y-2 rounded-md border border-border bg-primary/5 p-3">
                  <p className="text-sm font-medium">
                    Preview, from each box&apos;s last login list
                  </p>
                  {preview.boxes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No box is linked.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {preview.boxes.map((b) => (
                        <li
                          key={b.boxId}
                          className={b.owners > 0 ? 'text-destructive-ink' : undefined}
                        >
                          {previewLine(b)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {owners && <OwnerWarning />}
                  {preview.unknown > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Boxes with no login list yet are checked at their next run.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => change(false)}
              >
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
      </DialogContent>
    </Dialog>
  );
}

function BanCard({
  ban,
  results,
  boxes,
  onLift,
}: {
  ban: FleetBan;
  results: FleetResult[];
  boxes: Map<string, FleetBox>;
  onLift: () => void;
}) {
  const state = banState(ban);
  const mine = results.filter(
    (r) => r.banId === ban.id && (r.matched > 0 || r.ownerIds.length > 0),
  );
  const ownerHit = mine.some((r) => r.ownerIds.length > 0);
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="break-all text-sm font-medium">{banKeysText(ban)}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{ban.kind === 'archive' ? 'Archive' : 'Disable'}</Badge>
            {state !== 'active' && (
              <Badge variant="secondary">{state === 'retired' ? 'Retired' : 'Lifted'}</Badge>
            )}
          </div>
        </div>
        {state === 'active' && (
          <Button size="sm" variant="outline" onClick={onLift}>
            {liftLabel(ban.kind)}
          </Button>
        )}
      </div>
      {ban.reason && <p className="text-sm">{ban.reason}</p>}
      <p className="text-xs text-muted-foreground">
        Made by {ban.madeBy ?? 'a login that is gone'}, {formatDateTime(ban.madeAt)}
        {ban.liftedAt &&
          `. ${state === 'retired' ? 'Retired' : 'Lifted'} by ${ban.liftedBy ?? 'a login that is gone'}, ${formatDateTime(ban.liftedAt)}`}
        .
      </p>
      <p className="text-xs text-muted-foreground">
        {ban.loginsMatched === 1 ? '1 login' : `${ban.loginsMatched} logins`} on{' '}
        {ban.boxesMatched === 1 ? '1 box' : `${ban.boxesMatched} boxes`} at the last run.
      </p>
      {mine.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {mine.map((r) => {
            const box = boxes.get(r.boxId);
            const name = box ? boxName(box) : 'A removed box';
            const owner = r.ownerIds.length > 0;
            return (
              <li
                key={r.boxId}
                className={owner ? 'text-destructive-ink' : 'text-muted-foreground'}
              >
                {name}: {r.matched === 1 ? '1 login' : `${r.matched} logins`}
                {owner && ', the owner among them'}
              </li>
            );
          })}
        </ul>
      )}
      {ownerHit && <OwnerWarning />}
    </li>
  );
}

function BansSection({ data, onChanged }: { data: FleetOverview; onChanged: () => void }) {
  const toast = useToast();
  const [making, setMaking] = useState(false);
  const [lifting, setLifting] = useState<FleetBan | null>(null);
  const [pending, setPending] = useState(false);
  const boxes = new Map(data.boxes.map((b) => [b.id, b]));
  // Active bans first, each part newest first.
  const bans = [...data.bans].sort((a, b) => {
    if (!a.liftedAt !== !b.liftedAt) return a.liftedAt ? 1 : -1;
    return b.madeAt.localeCompare(a.madeAt);
  });

  const lift = async () => {
    if (!lifting) return;
    setPending(true);
    try {
      await apiSend(`${FLEET_PATH}/bans/${lifting.id}/lift`, 'POST');
      toast.success(lifting.kind === 'archive' ? 'Ban retired' : 'Ban lifted');
      setLifting(null);
      onChanged();
    } catch (err) {
      toast.error(refusalText(err, 'Could not change the ban.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section
      title={`Bans (${bans.length})`}
      action={
        <Button size="sm" onClick={() => setMaking(true)}>
          <Plus /> New ban
        </Button>
      }
    >
      {bans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ban.</p>
      ) : (
        <ul className="space-y-2">
          {bans.map((b) => (
            <BanCard
              key={b.id}
              ban={b}
              results={data.results}
              boxes={boxes}
              onLift={() => setLifting(b)}
            />
          ))}
        </ul>
      )}
      <NewBanDialog open={making} onOpenChange={setMaking} onMade={onChanged} />
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
    </Section>
  );
}

// --- provider keys (phase 2) ------------------------------------------------------

const KEY_PROVIDERS = fleetKeyProviders(SUPPORTED_PROVIDERS);
const providerLabel = (service: string) =>
  KEY_PROVIDERS.find((p) => p.id === service)?.label ?? service;

const TONE: Record<'ok' | 'wait' | 'warn' | 'bad', string> = {
  ok: 'text-muted-foreground',
  wait: 'text-muted-foreground',
  warn: 'text-warning-ink',
  bad: 'text-destructive-ink',
};

/** Each box's last provider key: waiting, or its answer. Never the key. */
function KeyStates({ boxes }: { boxes: FleetBox[] }) {
  const rows = boxes.flatMap((b) => {
    const answer = keyBoxText(b);
    if (!answer) return [];
    const of = b.keyPending ?? b.keyResult!;
    return [{ box: b, answer, of }];
  });
  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map(({ box, answer, of }) => (
        <li key={box.id} className="space-y-0.5 p-3">
          <p className="text-sm">
            <span className="font-medium">{boxName(box)}</span>: {providerLabel(of.service)} key
          </p>
          <p className={`text-xs ${TONE[answer.tone]}`}>{answer.text}</p>
          <p className="text-xs text-muted-foreground">
            By {of.by}, {formatDateTime(of.at)}.
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Set one provider key on one or many boxes. The key is typed once, sent once
 * and never shown: the field empties when it is sent, and the Control Center
 * keeps no key. Each box seals it in its own vault and tests it. A box whose
 * test fails keeps the key it had.
 */
function KeysSection({ data, onChanged }: { data: FleetOverview; onChanged: () => void }) {
  const toast = useToast();
  const [service, setService] = useState(KEY_PROVIDERS[0]?.id ?? '');
  const [value, setValue] = useState('');
  // Bumped by a send: the next key starts hidden again.
  const [fieldKey, setFieldKey] = useState(0);
  const { picked, setPicked, chosen, count } = useBoxPick(data.boxes);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const send = async () => {
    setPending(true);
    try {
      await apiSend(FLEET_KEYS_PATH, 'POST', {
        service,
        value,
        boxIds: chosen.map((b) => b.id),
      });
      setValue('');
      setFieldKey((k) => k + 1);
      setConfirming(false);
      toast.success(`Key sent to ${count}. Each box tests it now.`);
      onChanged();
    } catch (err) {
      toast.error(refusalText(err, 'Could not send the key.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section title="Provider keys">
      <p className="text-sm text-muted-foreground">
        Set one provider key on the boxes you pick. Each box seals it in its own vault and tests it.
        A box whose test fails keeps the key it had. This box keeps no key.
      </p>
      {data.boxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No box is linked.</p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && chosen.length > 0) setConfirming(true);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="fleet-key-provider">Provider</FieldLabel>
              <Select value={service} onValueChange={setService}>
                <SelectTrigger id="fleet-key-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEY_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="fleet-key-value">Key</FieldLabel>
              <SecretInput
                id="fleet-key-value"
                noun="key"
                // Not `off`: a browser may fill the Admin's own password here.
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                key={fieldKey}
                value={value}
                maxLength={8192}
                onChange={(e) => setValue(e.target.value)}
              />
              <FieldDescription>
                Typed once. It is never shown again, here or on a box.
              </FieldDescription>
            </Field>
            <BoxPicker
              boxes={data.boxes}
              picked={picked}
              setPicked={setPicked}
              idPrefix="fleet-key-box"
            />
            <div className="flex justify-end">
              <SubmitButton pending={false} disabled={!value.trim() || chosen.length === 0}>
                {chosen.length > 0 ? `Set key on ${count}` : 'Set key'}
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      )}
      <KeyStates boxes={data.boxes} />
      <AlertDialog open={confirming} onOpenChange={(o) => !o && !pending && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Set the {providerLabel(service)} key on {count}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each box replaces its {providerLabel(service)} key with this one and tests it. A box
              whose test fails keeps the key it had.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              Set key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

/** The screen. Off a Control Center the brain answers 404 and the sidebar
 *  hides the entry; a deep link lands on the plain line below. */
export function FleetClient() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...fleetQuery,
    // While a box still waits on a key update or a fleet write, read again soon.
    refetchInterval: (q: { state: { data?: FleetOverview | null } }) =>
      keyUpdatePending(q.state.data?.boxes) || writeUpdatePending(q.state.data?.boxes)
        ? 3000
        : false,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: FLEET_KEY });

  if (query.isLoading) {
    return <div className="p-4 text-sm text-muted-foreground md:p-5">Loading…</div>;
  }
  if (query.data === undefined) {
    return <div className="p-4 text-sm text-destructive-ink md:p-5">Could not load the Fleet.</div>;
  }
  if (query.data === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground md:p-5">
        This box is not a Control Center.
      </div>
    );
  }
  const data = query.data;

  return (
    <div>
      {query.isError && (
        <p role="status" className="px-4 pt-4 text-sm text-destructive-ink md:px-5">
          Could not read the latest state. This may be out of date.
        </p>
      )}
      <ServiceSection data={data} />
      <BoxesSection boxes={data.boxes} onChanged={refresh} />
      {/* Phase 3: a brain before it has no factsAt on its boxes, and no matrix route. */}
      {fleetMatrixOffered(data.boxes) && <MatrixSection />}
      <BansSection data={data} onChanged={refresh} />
      {/* Phase 2: a brain before it has no key fields on its boxes, and no key call. */}
      {fleetKeysOffered(data.boxes) && <KeysSection data={data} onChanged={refresh} />}
      {/* Phase 4: a brain before it has no writeJob on its boxes, and no write call. */}
      {fleetWritesOffered(data.boxes) && (
        <>
          <ModelsSection data={data} onChanged={refresh} />
          <SettingsSections boxes={data.boxes} onChanged={refresh} />
          <WritesSection boxes={data.boxes} />
        </>
      )}
    </div>
  );
}
