import { apiUrl, resetCookieUpgrade, withAuth } from './api-fetch';
import { setAssetToken } from './asset-url';
import { loginChangeBlocked } from './login-change-guard';
import { runSignOutResets } from './session-reset';
import { activeLogin, activeSession, forgetSessions } from './session-registry';
import { tokenStore } from './token-store';

export { onSignOut } from './session-reset';

/**
 * Signing out has to forget the session, and "the session" is more than the
 * credential.
 *
 * The credential was always cleared. What was not is everything else this tab
 * accumulated about the person who just left: the TanStack Query cache (their
 * profile, messages, settings), the short-lived asset token, and the memo
 * saying the cookie upgrade had already run. None of that is reachable from a
 * `tokenStore.clear()`.
 *
 * It survives because SIGNING OUT IS A CLIENT NAVIGATION. A 401 bounce is a
 * full page load and takes the whole heap with it, which is why this was never
 * seen there — but `router.push('/login')` keeps the JS context alive, so the
 * next person to sign in on the same tab was first shown the last one's data,
 * painted straight from cache before any request came back.
 *
 * Two ways to forget, and the difference matters:
 *
 *   • Module state this file can reach, reset directly below.
 *   • State owned by React — the query client lives in a provider — which
 *     registers a callback through `onSignOut`. That registry is its own leaf
 *     module (`session-reset.ts`) so the provider does not have to import this
 *     one; see the note there.
 */

/**
 * Sign out across BOTH transports. Same-origin: POST /api/auth/logout clears
 * the session cookie, exactly as before. If a web bearer is held (the split
 * client), also revoke its device row (mobile-logout self-authenticates from
 * the bearer, idempotent) and clear the local store + presence cookie.
 * Callers navigate to /login themselves afterwards.
 *
 * The local clear happens whatever the network did: a sign-out that failed to
 * reach the brain must still leave nothing of this session on the machine.
 *
 * "This session" is the ACTIVE one. Its row leaves the device's list along
 * with its bearer (a refused bearer keeps its row, to sign back in to; a
 * sign-out is the person saying they are done with it). So does any other row
 * holding the same bearer: a copy of this login, not another one. Any other
 * login held on this device is left exactly as it was.
 */
export async function performSignOut(): Promise<void> {
  // An agent driving the window never signs the login out (login-change-guard).
  if (loginChangeBlocked()) return;
  // Everything about WHO is signing out is read before the first await:
  // another tab can switch logins while the revoke is in flight, and the
  // login it switched to is not this sign-out's to forget or to revoke.
  const hadToken = tokenStore.get() !== null;
  const login = activeLogin();
  const revokeInit = withAuth({ method: 'POST' });
  const logoutInit = withAuth({ method: 'POST' });
  // A copy of this login holding a bearer of its own (a rotation) is revoked
  // with that bearer: it is this login's credential too.
  const copyBearers = [
    ...new Set(login?.copies.map((c) => c.token).filter((t): t is string => !!t) ?? []),
  ].filter((t) => t !== login?.token);
  try {
    if (hadToken) {
      await fetch(apiUrl('/api/auth/mobile-logout'), revokeInit);
    }
    for (const token of copyBearers) {
      await fetch(apiUrl('/api/auth/mobile-logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit',
      });
    }
    await fetch(apiUrl('/api/auth/logout'), logoutInit);
  } catch {
    /* network failure — still clear local state so the UI signs out */
  }
  // The row and its copies: those bearers are dead now.
  if (login) forgetSessions([login.id, ...login.copies.map((c) => c.id)]);
  // The credential in use, unless another tab has made a different login
  // active meanwhile: that one is not this sign-out's.
  if (!login || !activeSession()) tokenStore.clear();
  setAssetToken(null);
  resetCookieUpgrade();
  runSignOutResets();
}
