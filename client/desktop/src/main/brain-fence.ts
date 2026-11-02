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
 */
const UI_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'geolocation',
  'notifications',
  'fileSystem',
  'openExternal',
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
