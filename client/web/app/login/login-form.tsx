'use client';

import { useEffect, useState } from 'react';
import type { OidcRefusal } from '@mantle/client-types';
import { destinationAfterSignIn } from '@/lib/sign-in-destination';
import { goAfterSignIn } from '@/lib/oauth-consent';
import { useRouter } from 'next/navigation';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { Label } from '@mantle/web-ui/ui/label';
import { apiUrl } from '@mantle/web-ui/api-fetch';
import { isCrossOrigin } from '@mantle/web-ui/runtime-env';
import { currentBrainOrigin } from '@mantle/web-ui/session-registry';
import { tokenStore } from '@mantle/web-ui/token-store';
import { sameBrainAddress } from '@/lib/brain-address';
import {
  SIGN_IN_TIMEOUT_MS,
  UNEXPECTED_RESPONSE,
  readBearer,
  signInErrorMessage,
} from '@/lib/sign-in-error';
import { rememberOfferTicket } from '@/lib/oidc/offer-ticket';
import { settleSessionCookie } from '@/lib/oidc/settle';
import { SetupCodeField, isSetupCodeRefusal } from './setup-code-field';
import { PasswordStrength } from '@/components/auth/password-strength';
import { passwordRuleError, usePasswordRule } from '@/lib/password-rule';

/**
 * Owner sign-in. One transport in both topologies: POST /api/auth/token, and
 * the response bearer is held as a session of its own (the token store, which
 * also sets the presence flag for the boot route guard, lib/route-guard.ts).
 * A device can hold several logins, and a login that is a bearer can be
 * switched to by swapping a token; one that is a cookie cannot.
 *
 *   split (the API is on another origin): that is all. No cross-origin
 *     cookies anywhere.
 *
 *   same-origin (single-host deploys, local dev): the browser-native loaders
 *     (`<img>`, `<iframe>`, download anchors) can only send a cookie, so the
 *     bearer is traded for one straight away (POST /api/auth/sso, the same
 *     upgrade the shell runs on every load) and the navigation waits for it.
 *     A box signed in bearer-only and holding no cookie is the bug that
 *     upgrade was written for.
 *
 * The topology test is a REAL origin comparison (`isCrossOrigin`), not
 * `apiBase set`, which is true on every same-origin box that configures one.
 *
 * Signup (first-run) creates the account first, then exchanges the same
 * credentials for a bearer like any other sign-in. A brain the installer set
 * up asks for its setup code too (`setupCodeRequired`); a setup-code refusal
 * shows on that field.
 *
 * Inside the desktop app, adding a login also offers a BRAIN ADDRESS. Left as
 * it is, the login is added here. Changed, nothing is signed in from this
 * window at all: the shell checks the address, saves the brain and opens that
 * brain's own window on its sign-in screen, email carried over. The password
 * is typed there, in the window of the brain it is for, because a window only
 * ever reaches its own brain's logins. The browser never shows the field: a
 * web client talks to the one brain it was deployed for.
 *
 * With company sign-in on, a right password can still be refused (OidcRefusal):
 * a login that must link goes to the one link step (`onHeld`), and one that signs
 * in with the company account only is told so (`onCompanyOnly`). A password
 * sign-in that works answers the ticket "Link now" starts on.
 */
export function LoginForm({
  mode = 'login',
  next,
  error: initialError,
  setupCodeRequired = false,
  add = false,
  initialEmail,
  onHeld,
  onCompanyOnly,
}: {
  mode?: 'login' | 'signup';
  next?: string;
  error?: string;
  /** First-run signup asks for the installer's setup code. */
  setupCodeRequired?: boolean;
  /** Someone already signed in is adding (or signing back in to) a login. */
  add?: boolean;
  /** The login being signed back in to. Arrives after mount, from the device's
   *  own list, so it fills the field once rather than seeding the state. */
  initialEmail?: string;
  /** Required mode: the password was right, and this login must link first. */
  onHeld?: (ticket: string) => void;
  /** Required mode: this login signs in with the company account only. */
  onCompanyOnly?: () => void;
}) {
  const router = useRouter();
  const isSignup = mode === 'signup';
  const rule = usePasswordRule();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  // Shown when the brain says so, or when it refuses a signup for the code
  // (a bootstrap state that had not loaded yet must not hide the field).
  const [codeRefused, setCodeRefused] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();
  const askCode = isSignup && (setupCodeRequired || codeRefused);
  const [error, setError] = useState<string | undefined>(initialError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialEmail) setEmail((current) => current || initialEmail);
  }, [initialEmail]);

  // The shell's other-brains API, found after mount: the server pass has no
  // `window`, and a field that appears only in the client render would be a
  // hydration mismatch if it were decided during it.
  type BrainsApi = NonNullable<NonNullable<Window['mantleDesktop']>['brains']>;
  const [brains, setBrains] = useState<BrainsApi | null>(null);
  const [here, setHere] = useState('');
  const [address, setAddress] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const api = add ? window.mantleDesktop?.brains : undefined;
    if (!api) return;
    const origin = currentBrainOrigin();
    setBrains(api);
    setHere(origin);
    setAddress(origin);
  }, [add]);
  /** The address names a brain other than this window's. */
  const elsewhere = brains !== null && !sameBrainAddress(address, here);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setCodeError(undefined);
    setOpened(null);
    try {
      if (brains && elsewhere) {
        const result = await brains.openForLogin(address, email.trim() || undefined);
        if (!result.ok) setError(result.error);
        else if (result.same) {
          // The shell is the judge of what counts as the same brain.
          setAddress(here);
          setError('That is this brain. Enter the password to add a login here.');
        } else setOpened(result.name);
        return;
      }

      const split = isCrossOrigin();

      if (isSignup) {
        // The brain's rule, said before the request (the brain still checks).
        const weak = rule ? passwordRuleError(password, rule) : null;
        if (weak) {
          setError(weak);
          return;
        }
        const res = await fetch(apiUrl('/api/auth/signup'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(askCode ? { email, password, setupCode } : { email, password }),
          credentials: split ? 'omit' : 'include',
          signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
          if (isSetupCodeRefusal(res.status, data)) {
            setCodeRefused(true);
            setCodeError(data.error ?? 'Enter the setup code the installer printed.');
            return;
          }
          setError(data.error ?? 'Could not create your login.');
          return;
        }
      }

      const res = await fetch(apiUrl('/api/auth/token'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, deviceName: 'Web client' }),
        credentials: split ? 'omit' : 'include',
        signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Partial<OidcRefusal>;
        if (data.code === 'sso-link-required' && data.ticket && onHeld) {
          setPassword('');
          onHeld(data.ticket);
          return;
        }
        if (data.code === 'sso-required') {
          // It was right, and it is no way in here: it does not stay on screen.
          setPassword('');
          onCompanyOnly?.();
        }
        setError(data.error ?? 'Sign-in failed.');
        return;
      }
      rememberOfferTicket(
        (
          (await res
            .clone()
            .json()
            .catch(() => null)) as { oidcTicket?: unknown } | null
        )?.oidcTicket,
      );
      const token = await readBearer(res);
      if (!token) {
        setError(UNEXPECTED_RESPONSE);
        return;
      }
      tokenStore.signIn({ email, token });
      if (!split) {
        // Not after a signup, whose cookie is this very login's.
        await settleSessionCookie({ keepCookie: isSignup });
      }

      if (add) {
        // This tab has been someone else until now: its query cache, asset
        // token and mounted providers are all theirs. A client navigation
        // would carry that heap into the new login (sign-out.ts tells the
        // story); a page load is the guarantee. The destination is the one any
        // sign-in gets, so the role hints describe the login just added.
        await goAfterSignIn(await destinationAfterSignIn(next), (to) => window.location.assign(to));
        return;
      }

      // New accounts go straight into onboarding; returning users to where
      // they were headed (AppShell redirects to /onboarding if not yet done).
      // A sign-in the MCP consent page sent here goes back to it, as a page
      // load (lib/oauth-consent.ts).
      const go = (to: string) => {
        router.push(to);
        router.refresh();
      };
      if (isSignup) go('/onboarding');
      else await goAfterSignIn(await destinationAfterSignIn(next), go);
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {brains && (
        <div className="space-y-2">
          <Label htmlFor="brain-address">Brain address</Label>
          <Input
            id="brain-address"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {elsewhere
              ? 'Another brain opens in its own window, and you sign in there.'
              : 'This brain. Change it to add a login on another one.'}
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required={!elsewhere}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {/* No password field for another brain: it is typed in that brain's own
          window, never in this one. */}
      {!elsewhere && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <SecretInput
            id="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            aria-describedby={isSignup ? 'password-strength' : undefined}
          />
          {isSignup ? (
            <PasswordStrength id="password-strength" password={password} rule={rule} />
          ) : null}
        </div>
      )}
      {/* This brain's setup code: nothing to do with another brain. */}
      {askCode && !elsewhere && (
        <SetupCodeField
          value={setupCode}
          onChange={(v) => {
            setSetupCode(v);
            setCodeError(undefined);
          }}
          error={codeError}
        />
      )}
      {error && <p className="text-sm text-destructive-ink">{error}</p>}
      {opened && (
        <p className="text-sm text-muted-foreground">
          {opened} is open in its own window. Sign in there.
        </p>
      )}
      <SubmitButton pending={busy} className="w-full">
        {elsewhere ? 'Open brain' : isSignup ? 'Create login' : 'Sign in'}
      </SubmitButton>
    </form>
  );
}
