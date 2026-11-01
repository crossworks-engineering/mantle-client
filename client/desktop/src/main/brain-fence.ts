import { originOf } from '@mantle/client-host/static-host';

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
 * The answer to a page's permission request or check in a brain window.
 * Before calls, no handler was set and Electron granted everything, which
 * the app relies on (the clipboard, fullscreen for a presentation, the
 * assistant's location, Excalidraw's file save): every permission but
 * `media` keeps that answer. A `media` request (calls P1, plan section
 * 10) is granted for audio only, from the app's own main frame on the
 * renderer origin (the shell's own `http://mantle-ui.localhost`; the main
 * frame never leaves it). Video is not asked for in P1 and is refused; a sandboxed app or
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
  return originOf(details.requestingUrl ?? '') === rendererOrigin;
}
