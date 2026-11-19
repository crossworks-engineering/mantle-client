/**
 * "Sign out everywhere": end every session a login holds, cookies, asset
 * tokens and bearers alike (the brain bumps the login's session epoch and
 * revokes its bearers). Two routes:
 *
 *  - POST /api/auth/logout `{ everywhere: true }`: the signed-in login, admin
 *    or member, signs ITSELF out everywhere. This browser's session ends too,
 *    so the caller then runs the ordinary sign-out and goes to /login.
 *  - PATCH /api/users/:id `{ signOut: true }`: an admin signs another login
 *    out everywhere (Settings > Users). Admin only.
 *
 * Raw fetch, as the password helpers do (member-password.ts): `apiFetch`
 * reads every 401 as a dead session and bounces the browser, and here the
 * caller decides what a 401 means. Pure outcome mapping, pinned by a test.
 */
import { apiUrl, withAuth } from '@mantle/web-ui/api-fetch';
import { bodyReason, formerClientText } from './login-refusals';

/** What the confirm dialog says before a login signs itself out everywhere. */
export const EVERYWHERE_CONFIRM = 'This signs you out on every device, this one too.';

/** The whole confirm, for the login signing itself out. */
export const EVERYWHERE_CONFIRM_TEXT = `${EVERYWHERE_CONFIRM} Every browser, the phone app and any connected client must sign in again.`;

/** The whole confirm, for an admin signing ANOTHER login out (Settings >
 *  Users). */
export const OTHER_LOGIN_EVERYWHERE_TEXT =
  'Every browser, the phone app and any connected client they use must sign in again. Nothing else about the login changes.';

export type EverywhereOutcome =
  | { kind: 'ok' }
  /** No live session to act with: this browser is signed out already. */
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

export function everywhereOutcome(status: number, body: unknown): EverywhereOutcome {
  const error =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null;
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 401) return { kind: 'signed-out' };
  // A brain from before the route took `signOut` refuses the body as empty.
  if (status === 400 && error === 'Nothing to update.') {
    return { kind: 'error', message: 'This brain cannot do that yet. Update it first.' };
  }
  // A known refusal (a System user's login, by an Admin user outside System).
  const known = status < 500 ? formerClientText(bodyReason(body)) : null;
  if (known) return { kind: 'error', message: known };
  if (error && status < 500) return { kind: 'error', message: error };
  return { kind: 'error', message: 'Could not sign out everywhere. Try again.' };
}

async function send(path: string, method: 'POST' | 'PATCH', body: unknown) {
  try {
    const res = await fetch(
      apiUrl(path),
      withAuth({
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return everywhereOutcome(res.status, await res.json().catch(() => null));
  } catch {
    return { kind: 'error', message: 'Could not reach the brain. Try again.' } as const;
  }
}

/** The signed-in login signs itself out on every device. */
export function signOutEverywhere(): Promise<EverywhereOutcome> {
  return send('/api/auth/logout', 'POST', { everywhere: true });
}

/** An admin signs another login out on every device. */
export function signLoginOutEverywhere(userId: string): Promise<EverywhereOutcome> {
  return send(`/api/users/${encodeURIComponent(userId)}`, 'PATCH', { signOut: true });
}
