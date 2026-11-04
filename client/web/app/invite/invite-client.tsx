'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import type { MemberInvitePreview } from '@mantle/client-types';
import { apiUrl } from '@mantle/web-ui/api-fetch';
import { isCrossOrigin } from '@mantle/web-ui/runtime-env';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  INVITE_NOT_VALID,
  acceptOutcome,
  readInviteCode,
  validateInviteForm,
  type InviteFormErrors,
} from '@/lib/user-invites';
import { PasswordStrength } from '@/components/auth/password-strength';
import { takeLinkCode } from '@/lib/link-code';
import { usePasswordRule } from '@/lib/password-rule';
import { UNEXPECTED_RESPONSE, signInErrorMessage } from '@/lib/sign-in-error';
import { signInAfterInvite } from '@/lib/invite-sign-in';
import { tokenStore } from '@mantle/web-ui/token-store';
import { LinkStep } from '@/components/oidc/link-step';
import { companyLabel, useOidcConfig } from '@/lib/oidc/use-oidc';

type Preview =
  | { kind: 'idle' }
  /** `fromLink`: the code came in the link, so there is no form to show yet. */
  | { kind: 'checking'; code: string; fromLink: boolean }
  | { kind: 'ok'; code: string; invite: MemberInvitePreview }
  | { kind: 'invalid'; code: string }
  | { kind: 'error'; code: string; message: string };

/**
 * GET /api/auth/invite/:code, raw. A 404 is "not valid", and must stay on
 * this page: `apiFetch` would read a 401 anywhere as a dead session and send
 * the browser to /login. No credentials: the route is public.
 */
async function fetchPreview(code: string): Promise<Preview> {
  try {
    const res = await fetch(apiUrl(`/api/auth/invite/${encodeURIComponent(code)}`), {
      credentials: 'omit',
    });
    if (res.status === 404) return { kind: 'invalid', code };
    if (res.status === 429) {
      return { kind: 'error', code, message: 'Too many attempts. Try again in a minute.' };
    }
    const body = (await res.json().catch(() => null)) as MemberInvitePreview | null;
    if (!res.ok || !body || typeof body.email !== 'string') {
      return { kind: 'error', code, message: UNEXPECTED_RESPONSE };
    }
    return { kind: 'ok', code, invite: body };
  } catch (err) {
    return { kind: 'error', code, message: signInErrorMessage(err) };
  }
}

/**
 * The browser half of /invite: check the code, then set a password and
 * accept. Two steps, one card: the code step shows only while there is no
 * valid code (a link carries one); the password step greets the person by
 * the invite's name and email.
 *
 * Accepting signs the person in the way the sign-in form does: it
 * exchanges the new email and password for a bearer at /api/auth/token and
 * holds it as one of the device's logins (same-origin the accept answer has
 * also set this login's session cookie; if the exchange fails there, that
 * cookie alone signs the browser in). Then the browser loads the home, the
 * one shell every login uses.
 */
export function InviteClient({
  mark,
  initialCode,
}: {
  mark: React.ReactNode;
  /** A link's code from the query (links issued before the fragment). */
  initialCode: string;
}) {
  // The link's code: the query's, as the server saw it, until the first
  // layout effect reads the fragment's (which wins).
  const [linkCode, setLinkCode] = useState(() => readInviteCode(initialCode));
  const [codeInput, setCodeInput] = useState(initialCode);
  const [preview, setPreview] = useState<Preview>(() => {
    const code = readInviteCode(initialCode);
    return code ? { kind: 'checking', code, fromLink: true } : { kind: 'idle' };
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const rule = usePasswordRule();
  const [errors, setErrors] = useState<InviteFormErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  // Required mode: the login is made, and it links before it has a session.
  const oidc = useOidcConfig();
  const [heldTicket, setHeldTicket] = useState<string>();
  // Read once, before the first paint: the code leaves the address bar (and
  // so the history); the inline script already took it (lib/link-code.ts).
  useLayoutEffect(() => {
    const code = readInviteCode(takeLinkCode(window, document.documentElement));
    if (!code) return;
    setLinkCode(code);
    setCodeInput(code);
    setPreview({ kind: 'checking', code, fromLink: true });
  }, []);
  // The link's code is checked on arrival.
  useEffect(() => {
    if (!linkCode) return;
    let live = true;
    void fetchPreview(linkCode).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
  }, [linkCode]);

  async function checkCode(e: React.FormEvent) {
    e.preventDefault();
    const code = readInviteCode(codeInput);
    if (!code) {
      setErrors({ code: 'Enter your invite code.' });
      document.getElementById('invite-code')?.focus();
      return;
    }
    setErrors({});
    setPreview({ kind: 'checking', code, fromLink: false });
    const next = await fetchPreview(code);
    setPreview(next);
    if (next.kind !== 'ok') document.getElementById('invite-code')?.focus();
  }

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (preview.kind !== 'ok') return;
    const errs = validateInviteForm({ code: preview.code, password, confirm }, rule ?? undefined);
    setErrors(errs);
    setFormError(undefined);
    if (errs.password || errs.confirm) {
      document.getElementById(errs.password ? 'invite-password' : 'invite-confirm')?.focus();
      return;
    }
    setPending(true);
    try {
      const split = isCrossOrigin();
      // RAW fetch, never apiFetch: a bad code is a 401 here, which apiFetch
      // would turn into a trip to /login.
      const res = await fetch(apiUrl('/api/auth/invite/accept'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: preview.code, password }),
        credentials: split ? 'omit' : 'include',
      });
      const outcome = acceptOutcome(res.status, await res.json().catch(() => null));
      if (outcome.kind !== 'ok') {
        setFormError(outcome.message);
        return;
      }
      const email = outcome.email || preview.invite.email;

      // A bearer, held as one of this device's logins (see signInAfterInvite).
      const signedIn = await signInAfterInvite(email, password, split, outcome.linkRequired);
      if (signedIn.kind === 'held') {
        setPassword('');
        setConfirm('');
        setHeldTicket(signedIn.ticket);
        return;
      }
      if (signedIn.kind === 'sign-in-at-login') {
        setFormError(signedIn.message);
        return;
      }
      // A full load, not a client navigation: nothing an earlier session
      // cached on this tab survives.
      window.location.assign('/');
    } catch (err) {
      setFormError(signInErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const useAnotherCode = () => {
    setPreview({ kind: 'idle' });
    setCodeInput('');
    setPassword('');
    setConfirm('');
    setErrors({});
    setFormError(undefined);
  };

  const invite = preview.kind === 'ok' ? preview.invite : null;
  const codeError =
    errors.code ??
    (preview.kind === 'invalid'
      ? INVITE_NOT_VALID
      : preview.kind === 'error'
        ? preview.message
        : undefined);
  const checkingLink = preview.kind === 'checking' && preview.fromLink;

  return (
    // The settings-card shell (ui-style-guide §6e), as /login wears it.
    <section className="rounded-xl border border-border bg-card">
      <div className="space-y-2 border-b border-border p-4 text-center md:p-5">
        {mark}
        <p className="text-sm text-muted-foreground">
          {invite
            ? `Welcome${invite.displayName ? `, ${invite.displayName}` : ''}. Set a password to join ${invite.siteName || 'this workspace'}.`
            : 'Enter your invite code to join.'}
        </p>
      </div>
      <div
        className="p-4 md:p-5"
        // Hidden while the inline script holds a link's code this render has
        // not read yet: no flash of the code form before "Checking your invite".
        data-link-code-wait={preview.kind === 'idle' ? '' : undefined}
      >
        {heldTicket ? (
          <LinkStep
            label={companyLabel(oidc)}
            held={{ ticket: heldTicket }}
            onEnded={() => window.location.assign(tokenStore.get() ? '/login?add=1' : '/login')}
          />
        ) : invite ? (
          <form onSubmit={accept} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  readOnly
                  value={invite.email}
                  autoComplete="username"
                  aria-describedby="invite-email-hint"
                />
                <FieldDescription id="invite-email-hint">
                  You sign in with this email.
                </FieldDescription>
              </Field>
              <Field data-invalid={!!errors.password || undefined}>
                <FieldLabel htmlFor="invite-password">Password</FieldLabel>
                <SecretInput
                  id="invite-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  aria-invalid={!!errors.password || undefined}
                  aria-describedby={
                    errors.password
                      ? 'invite-password-error invite-password-hint'
                      : 'invite-password-hint'
                  }
                />
                <PasswordStrength id="invite-password-hint" password={password} rule={rule} />
                <FieldError id="invite-password-error">{errors.password}</FieldError>
              </Field>
              <Field data-invalid={!!errors.confirm || undefined}>
                <FieldLabel htmlFor="invite-confirm">Repeat password</FieldLabel>
                <SecretInput
                  id="invite-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={!!errors.confirm || undefined}
                  aria-describedby={errors.confirm ? 'invite-confirm-error' : undefined}
                />
                <FieldError id="invite-confirm-error">{errors.confirm}</FieldError>
              </Field>
              <FieldError id="invite-form-error">{formError}</FieldError>
              <SubmitButton pending={pending} className="w-full">
                Join
              </SubmitButton>
              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={useAnotherCode}
                  disabled={pending}
                >
                  Use another code
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : checkingLink ? (
          <p className="text-center text-sm text-muted-foreground">Checking your invite…</p>
        ) : (
          <form onSubmit={checkCode} noValidate>
            <FieldGroup>
              <Field data-invalid={!!codeError || undefined}>
                <FieldLabel htmlFor="invite-code">Invite code</FieldLabel>
                <Input
                  id="invite-code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                  className="font-mono"
                  aria-invalid={!!codeError || undefined}
                  aria-describedby={
                    codeError ? 'invite-code-error invite-code-hint' : 'invite-code-hint'
                  }
                />
                <FieldDescription id="invite-code-hint">
                  The 16-character code from your invite link.
                </FieldDescription>
                <FieldError id="invite-code-error">{codeError}</FieldError>
              </Field>
              <SubmitButton pending={preview.kind === 'checking'} className="w-full">
                Continue
              </SubmitButton>
            </FieldGroup>
          </form>
        )}
      </div>
    </section>
  );
}
