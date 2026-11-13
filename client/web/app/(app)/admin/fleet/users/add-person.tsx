'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  emailProblem,
  inviteReasonText,
  inviteRefusalText,
  inviteTargets,
  LINK_ONCE_TEXT,
  REPLACE_TEXT,
  sendInvite,
  type FleetInvite,
  type InviteMark,
} from '@/lib/fleet-invite';
import type { FleetPeopleBox } from '@/lib/fleet-people';
import { refusalText } from '../fleet-section';
import { Callout } from '../cc-kit';

/** What the dialog shows after a send: the link once, or why not. */
type Done = { kind: 'made'; invite: FleetInvite; box: string } | { kind: 'refused'; text: string };

/**
 * Add a person to a box: the box makes a member invite, the CC shows its
 * link once. `email` fixed (the person view), or typed (the list's "Add a
 * person"). The link lives in this dialog's state only, until it closes.
 */
export function AddPersonDialog({
  open,
  onOpenChange,
  email: fixedEmail,
  peopleBoxes,
  older,
  onInvited,
  onOlder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person's email, or null to type one. */
  email: string | null;
  peopleBoxes: readonly FleetPeopleBox[];
  /** Boxes that answered bad-call to an invite: a release behind. */
  older: ReadonlySet<string>;
  onInvited: (mark: InviteMark) => void;
  onOlder: (boxId: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [boxId, setBoxId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const email = (fixedEmail ?? typed).trim().toLowerCase();
  const targets = useMemo(
    () => inviteTargets(email, peopleBoxes, older),
    [email, peopleBoxes, older],
  );
  const available = targets.filter((t) => t.available);
  const chosen = available.find((t) => t.boxId === boxId) ?? null;

  const reset = () => {
    setTyped('');
    setBoxId('');
    setPassword('');
    setError(null);
    setEmailError(null);
    setDone(null);
  };
  const change = (next: boolean) => {
    if (!next && pending) return;
    if (!next) reset();
    onOpenChange(next);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = fixedEmail ? null : emailProblem(typed);
    setEmailError(bad);
    if (bad || !chosen) return;
    setPending(true);
    setError(null);
    try {
      const r = await sendInvite(chosen.boxId, email, password);
      setPassword('');
      const got = r.invites.find((i) => i.boxId.toLowerCase() === chosen.boxId.toLowerCase());
      if (got?.ok && got.link && got.expiresAt) {
        onInvited({
          boxId: chosen.boxId,
          email,
          at: new Date().toISOString(),
          expiresAt: got.expiresAt,
        });
        setDone({ kind: 'made', invite: got, box: chosen.label });
      } else {
        const code = got ? (got.reason ?? null) : r.pending.length > 0 ? 'pending' : 'gone';
        if (code === 'bad-call') onOlder(chosen.boxId);
        setDone({ kind: 'refused', text: inviteReasonText(code) });
      }
    } catch (err) {
      const code =
        err instanceof ApiError && typeof err.body?.code === 'string' ? err.body.code : null;
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many asks. Wait a minute, then try again.');
      } else {
        setError(
          inviteRefusalText(code, refusalText(err, 'Could not send the invite. Try again.')),
        );
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{fixedEmail ? 'Add to a box' : 'Add a person'}</DialogTitle>
          <DialogDescription>
            The box makes a member invite. The person opens the link and sets their own password.
            Add workspaces once they have joined.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-4">
            {done.kind === 'made' ? (
              <Callout tone="ok" title={`Invite made on ${done.box} for ${done.invite.email}`}>
                <span className="mt-2 flex items-center gap-2">
                  <Input
                    readOnly
                    aria-label="Invite link"
                    value={done.invite.link}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <CopyButton value={done.invite.link ?? ''} ariaLabel="Copy the invite link" />
                </span>
                <span className="mt-2 block text-sm">{LINK_ONCE_TEXT}</span>
              </Callout>
            ) : (
              <Callout tone="bad" title="The box made no invite">
                <span className="text-sm">{done.text}</span>
              </Callout>
            )}
            <div className="flex justify-end border-t border-border pt-4">
              <Button type="button" onClick={() => change(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              {fixedEmail ? (
                <p className="text-sm">
                  Person: <span className="font-medium break-all">{fixedEmail}</span>
                </p>
              ) : (
                <Field data-invalid={emailError ? true : undefined}>
                  <FieldLabel htmlFor="fleet-invite-email">Email</FieldLabel>
                  <Input
                    id="fleet-invite-email"
                    type="email"
                    autoComplete="off"
                    maxLength={320}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    aria-invalid={emailError ? true : undefined}
                    aria-describedby={emailError ? 'fleet-invite-email-error' : undefined}
                  />
                  <FieldError id="fleet-invite-email-error">{emailError}</FieldError>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="fleet-invite-box">Box</FieldLabel>
                <Select value={chosen ? chosen.boxId : ''} onValueChange={setBoxId}>
                  <SelectTrigger id="fleet-invite-box" size="sm" aria-label="Box">
                    <SelectValue
                      placeholder={available.length ? 'Pick a box' : 'No box can take this person'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.boxId} value={t.boxId} disabled={!t.available}>
                        {t.available ? t.label : `${t.label}: not available`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targets.some((t) => !t.available) && (
                  <ul
                    className="space-y-0.5 text-xs text-muted-foreground"
                    aria-label="Not available"
                  >
                    {targets
                      .filter((t) => !t.available)
                      .map((t) => (
                        <li key={t.boxId}>
                          <span className="font-medium">{t.label}:</span> {t.why}
                        </li>
                      ))}
                  </ul>
                )}
                <FieldDescription>{REPLACE_TEXT}</FieldDescription>
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="fleet-invite-password">Your password</FieldLabel>
                <SecretInput
                  id="fleet-invite-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'fleet-invite-password-error' : undefined}
                />
                <FieldError id="fleet-invite-password-error">{error}</FieldError>
              </Field>
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => change(false)}
                >
                  Cancel
                </Button>
                <SubmitButton
                  pending={pending}
                  disabled={!password || !chosen || (!fixedEmail && !typed.trim())}
                  data-agent-risk="person"
                >
                  Send invite
                </SubmitButton>
              </div>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
