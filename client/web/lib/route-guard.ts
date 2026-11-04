/**
 * Where a page load must go instead, decided before the first paint.
 *
 * This was the client's Next middleware. The UI is static files now, so
 * /_mantle/boot.js (lib/boot/boot-apply.ts) runs it as a blocking script and
 * replaces the location before the body paints: the same effect as the old
 * server redirect, with no flash of an empty shell.
 *
 * ZERO-SECRET: the client holds no SESSION_SECRET, so it verifies NOTHING —
 * real enforcement is the server origin's 401s on every data fetch. The only
 * job here is UX: a page load without the presence flag (ui-prefs, set at login
 * by the token store, cleared at sign-out/bounce) goes to /login instead of
 * flashing an empty shell that then bounces. The presence flag is spoofable by
 * construction — spoofing it renders a data-free skeleton whose every fetch
 * 401s. Nothing is protected here.
 *
 * No role routing (phase W5c): every login gets the one shell, and what it may
 * manage is the shell's own business (GET /api/shell `areas`).
 */

/** Paths that render without a session: login itself, the runtime env,
 *  `/pair` (the static page a browser lands on when it scans the phone
 *  sign-in QR; it holds no data and never reads the code in the fragment),
 *  `/invite`, where a person redeems an invite, and `/auth/oidc`, where a
 *  company sign-in comes back. Public paths pass before
 *  presence is read, so a signed-in browser is never sent away from them. */
const PUBLIC_PREFIXES: readonly string[] = ['/login', '/env.js', '/pair', '/invite', '/auth/oidc'];

/** Retired pages and where they go now, for everyone and before the presence
 *  gate, to a fresh URL: no `next`, and nothing of the old address carried
 *  over (a clone of `/team/` keeps its trailing slash, and an old link may hold
 *  a team code or a sign-in token).
 *
 *  - `/team`, `/hub`: the team-code portal (member logins Phase 6), the same
 *    as the brain's mountRetiredTeamPages.
 *  - `/client-signin`: the client sign-in page (phase W5c). Its old link held
 *    a token, so not even the query goes along.
 *  - `/review`, `/team-admin`, `/apps/review`: review and Team admin
 *    (phase W5c), home instead.
 *  - `/portal/chat`: a member's chat as the brain's push deep link still
 *    names it; the chat is the assistant now (W7c).
 *  - `/lifelog`, `/memories`, `/todos`: old names, once next.config redirects. */
const RETIRED: ReadonlyArray<readonly [prefix: string, to: string]> = [
  ['/team', '/login'],
  ['/hub', '/login'],
  ['/client-signin', '/login'],
  ['/review', '/'],
  ['/team-admin', '/'],
  ['/apps/review', '/'],
  ['/portal/chat', '/assistant'],
  ['/lifelog', '/journal'],
  ['/memories', '/journal'],
  ['/todos', '/tasks'],
];

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Where a retired path goes now, or null for a live one. In any case: an
 *  old link typed as `/Team` or `/Client-Signin?token=…` goes too. */
export function retiredTarget(pathname: string): string | null {
  const path = pathname.toLowerCase();
  for (const [prefix, to] of RETIRED) if (under(path, prefix)) return to;
  return null;
}

/**
 * The path (with query) a load of `pathname` + `search` must go to instead, or
 * null to stay. `present` is the token store's presence flag.
 */
export function guardRedirect(pathname: string, search: string, present: boolean): string | null {
  const retired = retiredTarget(pathname);
  if (retired) return retired;
  // In any case, as retiredTarget: a signed-out `/INVITE?code=…` stays on the
  // invite and does not carry its code into `next`.
  const path = pathname.toLowerCase();
  if (PUBLIC_PREFIXES.some((p) => under(path, p))) return null;
  if (present) return null;
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}
