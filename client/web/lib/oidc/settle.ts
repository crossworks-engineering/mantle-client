import { apiUrl, resetCookieUpgrade, upgradeOwnerCookie } from '@mantle/web-ui/api-fetch';
import { SIGN_IN_TIMEOUT_MS, settleWithin } from '@/lib/sign-in-error';

/**
 * After a bearer is held, on a same-origin box: the browser-native loaders
 * (`<img>`, `<iframe>`, download anchors) can only send a cookie, so the bearer
 * is traded for one before the first screen.
 *
 * The upgrade resolves a cookie BEFORE a bearer, so a cookie left by another
 * login (a sign-out that never reached the brain) would be renewed instead of
 * replaced, and assets would load as that person. It goes first, unless it is
 * this very login's (a signup's). Sent without the bearer: this revokes
 * nothing.
 *
 * Every step here is best effort with the bearer already held, and each has
 * the same 20 s limit as the sign-in itself: a hang must not keep the screen
 * busy.
 */
export async function settleSessionCookie(opts: { keepCookie: boolean }): Promise<void> {
  if (!opts.keepCookie) {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
    }).catch(() => undefined);
  }
  // Whatever an earlier visit to this tab memoised is about someone else's
  // session; this one has not been upgraded yet.
  resetCookieUpgrade();
  await settleWithin(upgradeOwnerCookie(), SIGN_IN_TIMEOUT_MS, undefined);
}
