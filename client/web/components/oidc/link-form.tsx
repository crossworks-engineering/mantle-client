'use client';

import { useCallback, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bounceToLogin } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { startLink } from '@/lib/oidc/actions';
import { takeOfferTicket } from '@/lib/oidc/offer-ticket';
import { OIDC_STATUS_KEY } from '@/lib/oidc/use-oidc';
import { signInErrorMessage } from '@/lib/sign-in-error';
import { useReturnReset } from './use-return-reset';

/**
 * One button to the provider and back, linked: the offer card, Settings >
 * Profile and the one link step all use it.
 *
 * Right after a password sign-in the brain's short ticket stands in for the
 * password. Later it asks for the password, in place, and only then: the brain
 * says so (`password-needed`).
 */
export function LinkForm({
  label,
  action,
  held,
  next,
  add,
  onEnded,
  start = false,
  children,
}: {
  label: string;
  /** The button's words. */
  action: string;
  /** A login with no session yet, on its held ticket (required mode). */
  held?: { ticket: string };
  next?: string;
  add?: boolean;
  /** A held ticket ended: the person signs in again. */
  onEnded?: () => void;
  /** The button at the start of its row, where the form sits in a page. */
  start?: boolean;
  /** A button beside this one ("Not now"). */
  children?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const passwordId = useId();
  const [asks, setAsks] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [inBrowser, setInBrowser] = useState(false);
  const [error, setError] = useState<string>();
  useReturnReset(useCallback(() => setBusy(false), []));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setInBrowser(false);
    // The password is never kept after a try, whatever the answer.
    const typed = asks ? password : undefined;
    setPassword('');
    let leaving = false;
    try {
      const ticket = held ? undefined : takeOfferTicket();
      const res = await startLink({
        ...(held ? { held } : {}),
        ...(ticket ? { ticket } : {}),
        ...(typed ? { password: typed } : {}),
        // Back to this screen. A held login has no session yet, so this screen
        // (the sign-in or the invite) is not where it goes on to.
        next: next ?? (held ? '/' : window.location.pathname + window.location.search),
        ...(add ? { add } : {}),
      });
      switch (res.kind) {
        case 'started':
          leaving = res.how === 'leaving';
          setInBrowser(res.how === 'in-browser');
          break;
        case 'password-needed':
          setAsks(true);
          break;
        case 'wrong-password':
          setAsks(true);
          setError(res.message);
          break;
        case 'signed-out':
          if (onEnded) onEnded();
          else bounceToLogin();
          break;
        case 'already-linked':
          void queryClient.invalidateQueries({ queryKey: OIDC_STATUS_KEY });
          break;
        case 'error':
          setError(res.message);
          break;
      }
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
      {asks && (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={passwordId}>Your password</FieldLabel>
          <SecretInput
            id={passwordId}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <p className="text-xs text-muted-foreground">
            Type your password to link {label} to this login.
          </p>
        </Field>
      )}
      {error && <FieldError>{error}</FieldError>}
      {inBrowser && (
        <p className="text-xs text-muted-foreground">
          Finish signing in in your browser. This window comes back when you are done.
        </p>
      )}
      <div
        className={`flex flex-wrap items-center gap-2 ${start ? 'justify-start' : 'justify-end'}`}
      >
        {children}
        <Button type="submit" disabled={busy || (asks && !password)}>
          {action}
        </Button>
      </div>
    </form>
  );
}
