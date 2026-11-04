import { originOf, plainHost, UI_ORIGIN } from '@mantle/client-host/static-host';

/**
 * The request headers the shell drops on the way to the configured brain, so
 * the brain sees the same request a native client (the mobile app, curl)
 * sends. Pure, so it can be tested without Electron.
 *
 * - `Origin`: the renderer runs on the shell's own origin
 *   (`http://mantle-ui.localhost`), which the brain does not know.
 *   Without it the brain skips CORS entirely, as it does for every native
 *   client.
 * - `Sec-Fetch-*`: with no usable Origin, the brain's login-CSRF guard
 *   (refuseCrossSiteAuthPost) reads `Sec-Fetch-Site`, and the shell's page
 *   talking to a remote brain is `cross-site`. That refused first-run signup
 *   from the desktop app with a 403. Login was unaffected only because the
 *   split client logs in through the unguarded bearer route.
 *
 * Both are browser claims about a page the shell itself controls, so dropping
 * them gives the brain no less to go on than a native client. A real browser
 * tab cannot do this, so the brain's browser-facing guard is unchanged.
 */
export function stripBrowserOnlyHeaders(
  requestHeaders: Record<string, string>,
): Record<string, string> {
  for (const key of Object.keys(requestHeaders)) {
    const lower = key.toLowerCase();
    if (lower === 'origin' || lower.startsWith('sec-fetch-')) delete requestHeaders[key];
  }
  return requestHeaders;
}

/**
 * The requests the fence applies to: everything under the configured brain's
 * origin, its /api/auth routes included, so a sign-in from the shell reaches
 * the brain as a native client's does (see stripBrowserOnlyHeaders).
 */
export function brainRequestFilter(brainOrigin: string): { urls: string[] } {
  return { urls: [`${brainOrigin}/*`] };
}

/** The frame documents the brain serves into sandboxed iframes: a mini app's
 *  and a Present canvas's (`/api/apps/<id>/frame`, `/api/presents/<id>/frame`). */
const SANDBOX_FRAME_PATH = /^\/api\/(apps|presents)\/[^/]+\/frame$/;

/**
 * Whether a sub-frame may go to `toUrl`. A sandboxed app or canvas frame
 * runs code the owner did not write, and a sandbox keeps the frame's right to
 * navigate ITSELF: it could take its frame to any site, and the request would
 * leave the machine before anything on the page could take the frame down.
 * So a frame that is now such a document may only go to another one on the
 * brain (the parent's own reload, a new ticket); every other sub-frame, and a
 * first load from about:blank, is left alone. Pure, so it is tested without
 * Electron.
 */
export function frameNavigationAllowed(
  fromUrl: string,
  toUrl: string,
  brainOrigin: string,
): boolean {
  let from: URL;
  try {
    from = new URL(fromUrl);
  } catch {
    return true;
  }
  const isSandboxFrame = (u: URL) =>
    u.origin === brainOrigin && SANDBOX_FRAME_PATH.test(u.pathname);
  if (!isSandboxFrame(from)) return true;
  try {
    return isSandboxFrame(new URL(toUrl));
  } catch {
    return false;
  }
}

/**
 * What the app's own page asks for, besides the microphone: copy and paste,
 * fullscreen for a presentation or a canvas, the assistant's location, a
 * notification, Excalidraw's file save, and a mailto: link handed to the
 * system (openExternal, for that scheme only: the page shows chat and page
 * content, and no other link may start a program).
 *
 * Chromium also asks under names the page never calls by. A low-accuracy
 * getCurrentPosition (the assistant's) can come as `geolocation-approximate`.
 * Local Network Access comes as `local-network-access`, `local-network` and
 * `loopback-network`: the page is served on http://mantle-ui.localhost, so
 * Chromium may count it as public, and a brain on a LAN or tailnet address
 * would then need it for every fetch, image, socket and frame. The CSP's
 * connect-src still decides where the page may connect. Left out on
 * purpose: `deprecated-sync-clipboard-read` (execCommand('paste'), which
 * neither the UI nor Excalidraw calls) and every other name.
 */
const UI_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'geolocation',
  'geolocation-approximate',
  'notifications',
  'fileSystem',
  'openExternal',
  'local-network-access',
  'local-network',
  'loopback-network',
]);

/**
 * The answer to a page's permission request or check in a brain window.
 * Only the app's own main frame on the renderer origin (the shell's own
 * `http://mantle-ui.localhost`; the main frame never leaves it) gets
 * anything, and only what it uses (UI_PERMISSIONS). A `media` request (calls
 * P1, plan section 10) is granted for audio only; video is not asked for in
 * P1 and is refused. Any other frame (a sandboxed app or canvas frame, an
 * embed) or origin gets nothing. Before this, every frame got every
 * permission but `media`. Pure, so it is tested without Electron.
 */
export function permissionAllowed(
  permission: string,
  details: {
    requestingUrl?: string;
    isMainFrame?: boolean;
    mediaTypes?: readonly string[];
    externalURL?: string;
  },
  rendererOrigin: string,
): boolean {
  if (details.isMainFrame === false) return false;
  if (originOf(details.requestingUrl ?? '') !== rendererOrigin) return false;
  if (permission === 'openExternal') return /^mailto:/i.test(details.externalURL ?? '');
  if (permission !== 'media') return UI_PERMISSIONS.has(permission);
  const types = details.mediaTypes ?? [];
  return types.length > 0 && types.every((t) => t === 'audio');
}

/**
 * What the shell does with an http request from a brain window's session,
 * where it intercepts http to serve the UI (index.ts, serveUi). The UI's own
 * host is answered from disk; the window's own brain, when it runs on plain
 * http, goes out as before. Anything else is refused: a request re-issued
 * from the main process carries no Origin and gets no CORS check, so passing
 * it through would let a page read any http service on the LAN or loopback
 * that a browser keeps from it. Pure, so it is tested without Electron.
 */
export function httpRouteOf(url: string, brainOrigin: string): 'ui' | 'brain' | 'refuse' {
  const origin = originOf(url);
  if (origin === null) return 'refuse';
  if (origin === UI_ORIGIN) return 'ui';
  return origin === brainOrigin ? 'brain' : 'refuse';
}

/**
 * How the shell sends a request on to the window's own brain on plain http
 * (httpRouteOf 'brain'). The main process sends it, so none of the page's own
 * checks apply; it goes out as a native client's request does (the fence
 * already drops Origin): no cookies, since the shell signs in with a bearer
 * and a cookie in the jar would reach the brain's sandboxed app and canvas
 * frames too, and no redirects, since no CORS check would see where one
 * lands. A 3xx then fails, and the page gets a 502.
 */
export const BRAIN_PASSTHROUGH = {
  bypassCustomProtocolHandlers: true,
  redirect: 'manual',
  credentials: 'omit',
} as const;

/** URL → origin. Unlike the mobile app, a bare host gets https:// prefixed.
 *  The origin goes into the window's CSP as written (static-host.ts), so its
 *  host must be plain (no `*`, `;` or `,`). */
export function normalizeOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('empty URL');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported protocol ${url.protocol}`);
  }
  if (!plainHost(url)) throw new Error(`unsupported host ${url.hostname}`);
  return url.origin;
}

/** Whether an address read back from profiles.json is exactly one
 *  normalizeOrigin would save today. */
export function savedOriginOk(origin: unknown): boolean {
  if (typeof origin !== 'string') return false;
  try {
    return normalizeOrigin(origin) === origin;
  } catch {
    return false;
  }
}

/** A company sign-in's way back to the shell, parsed (brain docs/oidc-sign-in.md). */
export type OidcDeepLink = { iss: string; fragment: string };

const OIDC_RESULT = /^[a-z-]{1,32}$/;
const OIDC_CODE = /^[A-Za-z0-9_-]{1,128}$/;
const OIDC_PURPOSE = new Set(['signin', 'link', 'fresh']);

/**
 * `mantle://oidc#oidc=...&iss=...`, or null for anything else. Any app can open
 * a `mantle://` link, so only what the flow's end can hold is taken, rebuilt
 * from its parts: what reaches the page is exactly these fields. The page then
 * refuses a code it is not waiting for, and a code is worth nothing without its
 * verifier.
 */
export function oidcDeepLink(link: string): OidcDeepLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'mantle:' || url.host !== 'oidc') return null;
  if ((url.pathname !== '' && url.pathname !== '/') || url.search) return null;
  const q = new URLSearchParams(url.hash.replace(/^#/, ''));
  const result = q.get('oidc');
  const issRaw = q.get('iss');
  if (!result || !issRaw || !OIDC_RESULT.test(result)) return null;
  let iss: string;
  try {
    const parsed = new URL(issRaw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    iss = parsed.origin;
  } catch {
    return null;
  }
  const out = new URLSearchParams({ oidc: result });
  if (result === 'code') {
    const code = q.get('code');
    const purpose = q.get('purpose');
    if (!code || !OIDC_CODE.test(code) || !purpose || !OIDC_PURPOSE.has(purpose)) return null;
    out.set('code', code);
    out.set('purpose', purpose);
  }
  out.set('iss', iss);
  return { iss, fragment: out.toString() };
}

/** How long a brain window waits for a company sign-in it sent out. */
export const OIDC_ARMED_MS = 15 * 60_000;

/**
 * The window a `mantle://oidc` link goes to, or null to drop it with no window
 * moved. Any app can open such a link, so only a window that sent a sign-in out
 * to the browser takes one:
 *  - the one for the brain the link names (`named`): that was its way back, and
 *    its wait is over;
 *  - a link naming a brain this shell does not hold goes to the last that went
 *    out, whose page sees that the brain differs (a brain reached by an alias)
 *    and spends nothing. Its wait goes on: the real way back may still come.
 * A link naming another listed brain that is not waiting moves nothing.
 * `armed`: profile id to when its wait ends.
 */
export function oidcArrival(
  armed: ReadonlyMap<string, number>,
  profiles: readonly { id: string; origin: string }[],
  iss: string,
  now: number,
): { id: string; named: boolean } | null {
  const live = profiles.filter((p) => (armed.get(p.id) ?? 0) > now);
  const named = live.find((p) => p.origin === iss);
  if (named) return { id: named.id, named: true };
  if (profiles.some((p) => p.origin === iss)) return null;
  let latest: string | null = null;
  for (const p of live) {
    if (latest === null || armed.get(p.id)! > armed.get(latest)!) latest = p.id;
  }
  return latest === null ? null : { id: latest, named: false };
}

/** Whether a link is addressed to company sign-in at all: such a link never
 *  takes the path of an in-app deep link, whatever its fragment holds. */
export function isOidcLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'mantle:' && url.host === 'oidc';
  } catch {
    return false;
  }
}

/**
 * `raw` when it starts a company sign-in on this window's brain, the only URL
 * the page may ask the shell to open this way. Exactly the brain's origin and
 * the start path: a page cannot use it to open anything else on the machine.
 */
export function oidcStartUrl(raw: unknown, brainOrigin: string): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    return url.origin === brainOrigin && url.pathname === '/api/auth/oidc/start' ? url.href : null;
  } catch {
    return null;
  }
}
