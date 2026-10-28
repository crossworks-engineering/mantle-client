/**
 * The request headers the shell drops on the way to the configured brain, so
 * the brain sees the same request a native client (the mobile app, curl)
 * sends. Pure, so it can be tested without Electron.
 *
 * - `Origin`: the renderer runs on a loopback origin the brain does not know.
 *   Without it the brain skips CORS entirely, as it does for every native
 *   client.
 * - `Sec-Fetch-*`: with no usable Origin, the brain's login-CSRF guard
 *   (refuseCrossSiteAuthPost) reads `Sec-Fetch-Site`, and a loopback renderer
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

/**
 * The headers that tell the embedded UI server which brain a window is for.
 * The shell runs one embedded server for every brain, started with the first
 * brain's origin; without these a second brain's window was rendered for the
 * first, CSP included, and could not reach its own brain at all. The key is
 * minted per launch and given to the server process only, so the server can
 * tell the shell's word from any other local caller's. Mirrors
 * client/web/lib/desktop-brain.ts, which this package cannot import.
 */
export const DESKTOP_BRAIN_HEADER = 'X-Jackdaw-Brain';
export const DESKTOP_BRAIN_KEY_HEADER = 'X-Jackdaw-Brain-Key';

export function tagRendererRequest(
  requestHeaders: Record<string, string>,
  brainOrigin: string,
  key: string,
): Record<string, string> {
  // Whatever the page sent under these names goes first, in any case: header
  // names are case-insensitive, so a page's own `x-jackdaw-brain` would
  // otherwise travel beside ours and the server would read whichever won.
  const ours = [DESKTOP_BRAIN_HEADER.toLowerCase(), DESKTOP_BRAIN_KEY_HEADER.toLowerCase()];
  for (const name of Object.keys(requestHeaders)) {
    if (ours.includes(name.toLowerCase())) delete requestHeaders[name];
  }
  requestHeaders[DESKTOP_BRAIN_HEADER] = brainOrigin;
  requestHeaders[DESKTOP_BRAIN_KEY_HEADER] = key;
  return requestHeaders;
}

/**
 * Every request a brain window's session sends that the shell rewrites: the
 * brain's own (made native, see `stripBrowserOnlyHeaders`) and the embedded UI
 * server's (tagged with the brain, see `tagRendererRequest`). One filter for
 * both because a session holds ONE `onBeforeSendHeaders` listener: a second
 * registration replaces the first, it does not add to it.
 */
export function brainWindowRequestFilter(
  brainOrigin: string,
  rendererOrigin: string,
): { urls: string[] } {
  return { urls: [...brainRequestFilter(brainOrigin).urls, `${rendererOrigin}/*`] };
}

/** The request-header rewrite for one URL a brain window's session sends. */
export function rewriteBrainWindowRequest(
  url: string,
  requestHeaders: Record<string, string>,
  origins: { brain: string; renderer: string },
  key: string,
): Record<string, string> {
  if (url.startsWith(`${origins.renderer}/`)) {
    return tagRendererRequest(requestHeaders, origins.brain, key);
  }
  if (url.startsWith(`${origins.brain}/`)) return stripBrowserOnlyHeaders(requestHeaders);
  return requestHeaders;
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
 * The answer to a page's permission request or check in a brain window.
 * Before calls, no handler was set and Electron granted everything, which
 * the app relies on (the clipboard, fullscreen for a presentation, the
 * assistant's location, Excalidraw's file save): every permission but
 * `media` keeps that answer. A `media` request (calls P1, plan section
 * 10) is granted for audio only, from the app's own main frame on the
 * renderer origin (the embedded UI server; the main frame never leaves
 * it). Video is not asked for in P1 and is refused; a sandboxed app or
 * canvas frame (a sub-frame) never gets a device. Pure, so it is tested
 * without Electron.
 */
export function permissionAllowed(
  permission: string,
  details: { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: readonly string[] },
  rendererOrigin: string,
): boolean {
  if (permission !== 'media') return true;
  if (details.isMainFrame === false) return false;
  const types = details.mediaTypes ?? [];
  if (types.length === 0 || types.some((t) => t !== 'audio')) return false;
  let from: URL;
  try {
    from = new URL(details.requestingUrl ?? '');
  } catch {
    return false;
  }
  return from.origin === rendererOrigin;
}
