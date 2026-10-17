'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { ContactsGateNotice } from '../contacts-gate-notice';

/** Probe result from a successful `intent: 'test'` (saves navigate instead). */
type TestOk = { ok: true; foldersFound: number; folderSample: string[]; serverName?: string };

/** Existing account passed in for edit mode (never includes the password). */
export type ImapFormAccount = {
  id: string;
  address: string;
  displayName: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  firstScanDays: number;
};

/**
 * Add OR edit an IMAP account. In edit mode the address is fixed (it's the
 * account identity / encryption AAD) and the password field is optional —
 * blank keeps the stored one.
 *
 * React 19 resets uncontrolled inputs after every server action submission,
 * which would blow away everything you just typed when you hit "Test".
 * Keeping inputs controlled in component state side-steps that — typed
 * values survive across test → fix → save cycles.
 */
export function ImapForm({ account }: { account?: ImapFormAccount }) {
  const isEdit = !!account;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState(account?.address ?? '');
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [host, setHost] = useState(account?.imapHost ?? '');
  const [port, setPort] = useState(account?.imapPort ?? 993);
  const [secure, setSecure] = useState(account?.imapSecure ?? true);
  const [password, setPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState(account?.smtpHost ?? '');
  const [smtpPort, setSmtpPort] = useState<number | ''>(account?.smtpPort ?? '');
  const [smtpSecure, setSmtpSecure] = useState(account?.smtpSecure ?? true);
  const [firstScanDays, setFirstScanDays] = useState(account?.firstScanDays ?? 365);

  const submit = useMutation({
    mutationFn: ({ intent }: { intent: 'test' | 'save' }) => {
      const body = {
        intent,
        // Edit uses the stored address (the encryption AAD); add sends it.
        ...(isEdit ? {} : { address }),
        displayName: displayName || undefined,
        host,
        port,
        secure,
        // Blank = keep the stored password (edit) / required (add, enforced by the input).
        password: password || undefined,
        firstScanDays,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort === '' ? undefined : smtpPort,
        smtpSecure,
      };
      return isEdit
        ? apiSend<TestOk>(`/api/email/accounts/${account.id}`, 'PATCH', body)
        : apiSend<TestOk>('/api/email/accounts', 'POST', body);
    },
    onSuccess: (_res, { intent }) => {
      if (intent === 'save') {
        void queryClient.invalidateQueries({ queryKey: ['email', 'accounts'] });
        // Land on the plain list (mirrors the old action's redirect).
        router.push('/settings/accounts');
      }
    },
  });

  /**
   * §6b: a failure lands on the control at fault, not in a bar at the foot of
   * the form. The rules below are exactly the ones `required` / `type="email"`
   * / `min` / `max` already encoded — the attributes stay as documentation,
   * `noValidate` stops them raising the browser's own bubble, which announces
   * nothing and disappears on the next click.
   *
   * Both intents validate. Probing a server with a blank host wastes a round
   * trip and comes back as an opaque connection error.
   */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clear = (key: string) =>
    setErrors((cur) => {
      if (!cur[key]) return cur;
      const next = { ...cur };
      delete next[key];
      return next;
    });

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!isEdit) {
      // Fixed in edit mode — it is the account identity and the encryption AAD.
      if (!address.trim()) e.address = 'An email address is required.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()))
        e.address = 'That does not look like an email address.';
      if (!password) e.password = 'An app password is required.';
    }
    if (!host.trim()) e.host = 'An IMAP host is required.';
    if (!port || port < 1 || port > 65535) e.port = 'Port must be between 1 and 65535.';
    if (smtpPort !== '' && (smtpPort < 1 || smtpPort > 65535))
      e.smtpPort = 'Port must be between 1 and 65535.';
    if (!firstScanDays || firstScanDays < 1 || firstScanDays > 3650)
      e.firstScanDays = 'Scan history must be between 1 and 3650 days.';
    return e;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move the caret to the first thing that is wrong, in DOM order.
      const first = ['address', 'password', 'host', 'port', 'smtpPort', 'firstScanDays'].find(
        (k) => found[k],
      );
      if (first) document.getElementById(first)?.focus();
      return;
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === 'test' ? 'test' : 'save';
    submit.mutate({ intent });
  };

  const pending = submit.isPending;
  const lastIntent = submit.variables?.intent;

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <ContactsGateNotice />
        {isEdit && <input type="hidden" name="accountId" value={account.id} />}

        <Field data-invalid={!!errors.address || undefined}>
          <FieldLabel htmlFor="address">Email address</FieldLabel>
          <Input
            id="address"
            name="address"
            type="email"
            placeholder="you@yourdomain.com"
            disabled={isEdit}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              clear('address');
            }}
            aria-invalid={!!errors.address || undefined}
            aria-describedby={
              [errors.address ? 'address-error' : null, isEdit ? 'address-hint' : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
          />
          {isEdit && (
            <FieldDescription id="address-hint">
              The address can&apos;t be changed. Remove the account and add it again to use a
              different one.
            </FieldDescription>
          )}
          <FieldError id="address-error">{errors.address}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="displayName">Display name (optional)</FieldLabel>
          <Input
            id="displayName"
            name="displayName"
            placeholder="Personal"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-describedby="displayName-hint"
          />
          <FieldDescription id="displayName-hint">
            How this mailbox is listed. Falls back to the address when blank.
          </FieldDescription>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field className="col-span-2" data-invalid={!!errors.host || undefined}>
            <FieldLabel htmlFor="host">IMAP host</FieldLabel>
            <Input
              id="host"
              name="host"
              placeholder="imap.fastmail.com"
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                clear('host');
              }}
              aria-invalid={!!errors.host || undefined}
              aria-describedby={errors.host ? 'host-error host-hint' : 'host-hint'}
            />
            <FieldDescription id="host-hint">
              Your provider&apos;s incoming-mail server — where messages are read from.
            </FieldDescription>
            <FieldError id="host-error">{errors.host}</FieldError>
          </Field>
          <Field data-invalid={!!errors.port || undefined}>
            <FieldLabel htmlFor="port">Port</FieldLabel>
            <Input
              id="port"
              name="port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => {
                setPort(Number(e.target.value) || 0);
                clear('port');
              }}
              aria-invalid={!!errors.port || undefined}
              aria-describedby={errors.port ? 'port-error port-hint' : 'port-hint'}
            />
            <FieldDescription id="port-hint">993 for TLS.</FieldDescription>
            <FieldError id="port-error">{errors.port}</FieldError>
          </Field>
        </div>
        {/* Was a raw `<input type="checkbox">`: no focus ring, no themed
            check, none of the states the rest of the form has (§6d). */}
        <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
          <Checkbox id="secure" checked={secure} onCheckedChange={(v) => setSecure(v === true)} />
          <FieldLabel htmlFor="secure" className="cursor-pointer font-normal">
            Use TLS
          </FieldLabel>
          <span className="ml-auto text-xs text-muted-foreground">
            Recommended: TLS on port 993
          </span>
        </div>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="password">App password</FieldLabel>
          <SecretInput
            id="password"
            name="password"
            autoComplete="off"
            placeholder={isEdit ? 'Leave blank to keep current password' : undefined}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            aria-invalid={!!errors.password || undefined}
            aria-describedby={errors.password ? 'password-error password-hint' : 'password-hint'}
          />
          <FieldDescription id="password-hint">
            {isEdit
              ? 'Only enter a password if you want to replace the stored one.'
              : 'Use a provider-issued app password (Fastmail, iCloud, Gmail-as-IMAP). MantleOS encrypts this at rest with your master key before storing it.'}
          </FieldDescription>
          <FieldError id="password-error">{errors.password}</FieldError>
        </Field>
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Sending (SMTP) — optional</p>
            <p className="text-xs text-muted-foreground">
              Lets the assistant send email from this address. Uses the same app password. Leave
              blank to keep the account receive-only.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field className="col-span-2">
              <FieldLabel htmlFor="smtpHost">SMTP host</FieldLabel>
              <Input
                id="smtpHost"
                name="smtpHost"
                placeholder="smtp.fastmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                aria-describedby="smtpHost-hint"
              />
              <FieldDescription id="smtpHost-hint">
                The outgoing server. Usually the same domain as the IMAP host.
              </FieldDescription>
            </Field>
            <Field data-invalid={!!errors.smtpPort || undefined}>
              <FieldLabel htmlFor="smtpPort">Port</FieldLabel>
              <Input
                id="smtpPort"
                name="smtpPort"
                type="number"
                min={1}
                max={65535}
                placeholder="465"
                value={smtpPort}
                onChange={(e) => {
                  setSmtpPort(e.target.value === '' ? '' : Number(e.target.value) || 0);
                  clear('smtpPort');
                }}
                aria-invalid={!!errors.smtpPort || undefined}
                aria-describedby={errors.smtpPort ? 'smtpPort-error' : undefined}
              />
              <FieldError id="smtpPort-error">{errors.smtpPort}</FieldError>
            </Field>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm">
            <Checkbox
              id="smtpSecure"
              checked={smtpSecure}
              onCheckedChange={(v) => setSmtpSecure(v === true)}
            />
            <FieldLabel htmlFor="smtpSecure" className="cursor-pointer font-normal">
              Use TLS
            </FieldLabel>
            <span className="ml-auto text-xs text-muted-foreground">
              TLS on 465 · off for STARTTLS on 587
            </span>
          </div>
        </div>

        <Field data-invalid={!!errors.firstScanDays || undefined}>
          <FieldLabel htmlFor="firstScanDays">Scan history (days)</FieldLabel>
          <Input
            id="firstScanDays"
            name="firstScanDays"
            type="number"
            min={1}
            max={3650}
            value={firstScanDays}
            onChange={(e) => {
              setFirstScanDays(Number(e.target.value) || 0);
              clear('firstScanDays');
            }}
            aria-invalid={!!errors.firstScanDays || undefined}
            aria-describedby={
              errors.firstScanDays ? 'firstScanDays-error firstScanDays-hint' : 'firstScanDays-hint'
            }
          />
          {/* Still `FieldHint`, not `FieldDescription`: this is one of the few
              fields where overdoing it has a real cost, and `warn` is the only
              thing that says so in a second tone. */}
          <FieldHint
            id="firstScanDays"
            warn="A long history makes the first sync slow and pulls in a lot of mail."
          >
            How far back to scan headers on the first sync (e.g. 30 for the last month, 365 for a
            year).
            {isEdit
              ? ' Applies to folders not yet scanned — lowering it later won’t delete already-synced mail.'
              : ''}
          </FieldHint>
          <FieldError id="firstScanDays-error">{errors.firstScanDays}</FieldError>
        </Field>

        {/* Error from either intent. */}
        {!pending && submit.isError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-ink">
            <X className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{lastIntent === 'test' ? 'Test failed' : 'Save failed'}</p>
              <p className="text-destructive-ink/90">
                {submit.error instanceof Error ? submit.error.message : String(submit.error)}
              </p>
            </div>
          </div>
        )}
        {/* Successful probe (saves navigate away, so only `test` lands a panel). */}
        {!pending && submit.isSuccess && lastIntent === 'test' && submit.data && (
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-ink">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">Connected.</p>
              <p className="text-success-ink/80">
                Authenticated and found{' '}
                <span className="font-medium">{submit.data.foldersFound}</span> folder
                {submit.data.foldersFound === 1 ? '' : 's'}
                {submit.data.serverName ? (
                  <>
                    {' '}
                    on <span className="font-medium">{submit.data.serverName}</span>
                  </>
                ) : null}
                .
              </p>
              {submit.data.folderSample.length > 0 && (
                <p className="mt-1 truncate text-xs text-success-ink/70">
                  e.g. {submit.data.folderSample.join(' · ')}
                  {submit.data.foldersFound > submit.data.folderSample.length ? ' …' : ''}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            value="test"
            variant="outline"
            disabled={pending}
            className="flex-1"
          >
            {pending && lastIntent === 'test' ? 'Testing…' : 'Test connection'}
          </Button>
          <SubmitButton pending={pending && lastIntent === 'save'} value="save" className="flex-1">
            {isEdit ? 'Save changes' : 'Connect & save'}
          </SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
