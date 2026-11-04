/**
 * Reading a signed token's own expiry, and deciding when to go back for a new
 * one.
 *
 * A leaf module: it imports nothing, so anything can ask without dragging a
 * transport in behind it.
 *
 * Every credential the brain mints goes through one `signClaims` — a base64url
 * payload carrying `exp`, then a dot, then the signature. NOTHING here verifies
 * anything: the server does that, and a client that trusted this would be
 * trusting a string it was handed. It only decides when to ask for a fresh one.
 */

/**
 * The `exp` claim (epoch SECONDS) from a signed token, or null if it cannot be
 * read — an unexpected shape, a truncated value, a format that changed.
 *
 * Callers must treat null as "I do not know", never as "it is fine".
 */
export function tokenExpEpoch(token: string): number | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  try {
    const payload = token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(payload)) as { exp?: number };
    return typeof data.exp === 'number' ? data.exp : null;
  } catch {
    return null;
  }
}

/**
 * Whether company sign-in made this token (its `so` claim). Not verified, like
 * everything here: it decides only what a screen offers, and the brain judges
 * the credential on every request.
 */
export function tokenFromCompanySignIn(token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  try {
    const payload = token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { so?: unknown }).so === 1;
  } catch {
    return false;
  }
}

/**
 * Which login a signed token was minted for: its `act` claim when it has one,
 * else its `uid`. A token minted for a login that is not the brain's anchor
 * can carry the anchor as `uid` and the login as `act`, so `uid` alone does
 * not tell two logins apart. Null when the token names neither.
 *
 * Not a secret and not verified: the registry uses it only to see that two
 * bearers it holds, at the same brain, belong to the same login (a rotation
 * gives a login a new bearer, so the bearers themselves stop matching).
 */
export function tokenLogin(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  try {
    const payload = token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(payload)) as { uid?: unknown; act?: unknown };
    if (typeof data.act === 'string' && data.act !== '') return data.act;
    return typeof data.uid === 'string' && data.uid !== '' ? data.uid : null;
  } catch {
    return null;
  }
}

/** Never poll faster than this, however close expiry is. */
const MIN_REFRESH_MS = 30_000;

/** Used when the token is there but its expiry cannot be read. Short enough to
 *  stay inside any plausible TTL, since the real one is unknown: the shortest
 *  the brain mints is a member's ten minutes (workspaces W7e), so under half
 *  of that. */
const UNKNOWN_EXPIRY_REFRESH_MS = 4 * 60_000;

/** Refresh once this much of the token's life has passed. Half, so a refresh
 *  that fails — offline for a moment, a 500 — has a whole second half to be
 *  retried in before anything starts failing. */
const REFRESH_AT_FRACTION = 0.5;

/**
 * How long until the asset token should be fetched again, or `false` for
 * "never" — the value TanStack Query's `refetchInterval` wants.
 *
 * The asset token is delivered IN THE URL (`?at=`), so the brain keeps its TTL
 * deliberately short: two hours for an Admin user, commented there as "one
 * working session", and ten minutes for any other login (workspaces W7e).
 * Nothing refreshed it: `/api/shell` ran once per mount, so a tab left open
 * past lunch got a 401 on every image, iframe and download until someone
 * reloaded. Rather than copy that two hours into this repo and let the two
 * drift apart, this reads the expiry the token itself carries, so a change to
 * the brain's TTL needs no change here.
 *
 * `false` when there is no token at all, which is the ordinary same-origin
 * deployment: the session cookie authenticates those assets and there is
 * nothing to keep fresh, so it must not poll.
 *
 * ⚠ An interval is only half of it. TanStack pauses `refetchInterval` while the
 * tab is in the background, which is EXACTLY the case this bug is about — so
 * the caller must also refetch on focus. Neither alone is enough: focus misses
 * the tab left open and staring at you for hours, the interval misses the tab
 * you came back to after lunch.
 */
export function assetTokenRefreshDelayMs(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): number | false {
  if (!token) return false;
  const exp = tokenExpEpoch(token);
  if (exp === null) return UNKNOWN_EXPIRY_REFRESH_MS;
  const remainingMs = exp * 1000 - nowMs;
  // Already expired, or as good as: ask now, at the floor.
  if (remainingMs <= 0) return MIN_REFRESH_MS;
  return Math.max(MIN_REFRESH_MS, Math.round(remainingMs * REFRESH_AT_FRACTION));
}
