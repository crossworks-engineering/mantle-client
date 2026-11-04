import type { OidcRefusal } from '@mantle/client-types';
import { apiUrl } from '@mantle/web-ui/api-fetch';
import { tokenStore } from '@mantle/web-ui/token-store';
import { readBearer } from './sign-in-error';

/** What signing in after an accepted invite came to. */
export type InviteSignIn =
  /** A bearer, held as one of the logins this device holds. */
  | { kind: 'bearer' }
  /** Same-origin, no bearer: the accept answer's cookie is the session. */
  | { kind: 'cookie' }
  /** Split, no bearer: nothing signs this browser in; the login is ready. */
  | { kind: 'sign-in-at-login'; message: string }
  /** Required mode: the login must link before it has a session. */
  | { kind: 'held'; ticket: string };

/**
 * Sign in as the member an invite just made, the way the sign-in form does in
 * both topologies: exchange the new email and password for a bearer at
 * /api/auth/token and hold it with `tokenStore.signIn`, so the new login is
 * one of the logins this device holds and any other login held here stays as
 * it was. (`tokenStore.set` would not do: it rotates the ACTIVE login's bearer,
 * which would file the member's bearer under someone else's row.)
 *
 * Split, the accept answer's cookie is on the API origin, which a split client
 * never uses, so without a bearer the person signs in at /login. Same-origin
 * that cookie is this very login's: without a bearer it is the session, and a
 * bearer left by an earlier login would ride along with every request and
 * answer for the wrong login, so it goes.
 */
export async function signInAfterInvite(
  email: string,
  password: string,
  split: boolean,
  /** The accept set no cookie (company sign-in in required mode). */
  linkRequired = false,
): Promise<InviteSignIn> {
  const res = await fetch(apiUrl('/api/auth/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceName: 'Web client' }),
    credentials: 'omit',
  }).catch(() => null);
  if (res?.status === 403) {
    const refused = (await res.json().catch(() => null)) as Partial<OidcRefusal> | null;
    if (refused?.code === 'sso-link-required' && refused.ticket) {
      return { kind: 'held', ticket: refused.ticket };
    }
  }
  const token = res?.ok ? await readBearer(res) : null;
  if (token) {
    tokenStore.signIn({ email, token });
    return { kind: 'bearer' };
  }
  if (split || linkRequired) {
    return {
      kind: 'sign-in-at-login',
      message: `Your login is ready. Sign in at /login with ${email} and your password.`,
    };
  }
  tokenStore.clear();
  tokenStore.markPresence();
  return { kind: 'cookie' };
}
