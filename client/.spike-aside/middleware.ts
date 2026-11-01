import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * ZERO-SECRET client middleware. This app holds no SESSION_SECRET, so it can
 * verify NOTHING — real enforcement is the server origin's 401s on every data
 * fetch. The only job here is UX: a page load without the presence cookie
 * (set at login by the token store, cleared at sign-out/bounce) server-
 * redirects to /login instead of flashing an empty shell that then bounces.
 *
 * No role routing (phase W5c): every login gets the one shell, and what it
 * may manage is the shell's own business (GET /api/shell `areas`).
 *
 * The presence cookie is spoofable by construction — spoofing it renders a
 * data-free skeleton whose every fetch 401s. Nothing is protected here.
 */
const PRESENCE_COOKIE = 'mantle_authed';

/** Paths that render without a session: login itself, the runtime env,
 *  `/pair` (the static page a browser lands on when it scans the phone
 *  sign-in QR; it holds no data and never reads the code in the fragment),
 *  and `/invite`, where a person redeems an invite. Public paths pass before
 *  any cookie is read, so a signed-in browser is never sent away from them. */
const PUBLIC_PREFIXES: readonly string[] = ['/login', '/env.js', '/pair', '/invite'];

/** Retired pages and where they go now, for everyone and before the presence
 *  gate, as a 307 to a fresh URL: no `next`, and nothing of the old address
 *  carried over (a clone of `/team/` keeps its trailing slash, and an old
 *  link may hold a team code or a sign-in token).
 *
 *  - `/team`, `/hub`: the team-code portal (member logins Phase 6), the same
 *    as the brain's mountRetiredTeamPages.
 *  - `/client-signin`: the client sign-in page (phase W5c). Its old link held
 *    a token, so not even the query goes along.
 *  - `/review`, `/team-admin`, `/apps/review`: review and Team admin
 *    (phase W5c), home instead.
 *  - `/portal/chat`: a member's chat as the brain's push deep link still
 *    names it; the chat is the assistant now (W7c). */
const RETIRED: ReadonlyArray<readonly [prefix: string, to: string]> = [
  ['/team', '/login'],
  ['/hub', '/login'],
  ['/client-signin', '/login'],
  ['/review', '/'],
  ['/team-admin', '/'],
  ['/apps/review', '/'],
  ['/portal/chat', '/assistant'],
];

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Where a retired path goes now, or null for a live one. */
function retiredTarget(pathname: string): string | null {
  for (const [prefix, to] of RETIRED) if (under(pathname, prefix)) return to;
  return null;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  const retired = retiredTarget(pathname);
  if (retired) return NextResponse.redirect(new URL(retired, req.nextUrl.origin), 307);
  if (PUBLIC_PREFIXES.some((p) => under(pathname, p))) return NextResponse.next();
  if (req.cookies.get(PRESENCE_COOKIE)?.value === '1') return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|ttf|woff2?)).*)',
  ],
};
