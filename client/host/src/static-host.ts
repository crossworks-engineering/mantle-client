import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

/**
 * THE host of the static owner UI (docs/static-ui-host.md), shared by both
 * places that serve it:
 *
 *  - the desktop shell, one per brain window's session, on its own
 *    `http://mantle-ui.localhost` (client/desktop/src/main/index.ts, serveUi);
 *  - the box, as the client image's whole server (serve.ts).
 *
 * It does what a server used to do for the UI:
 *
 *  - serve the static export, with a dynamic route's one placeholder page
 *    (`_`) for every value, keeping the real path in the address bar;
 *  - answer `/env.js` with the brain: its origin and its public appearance,
 *    which the UI's boot script paints before the first frame;
 *  - send the CSP for that brain (the build's csp.txt) and Referrer-Policy on
 *    the link-code pages (the build's routes.json).
 *
 * Plain fetch types and node:fs, no Electron, no framework: tested under node,
 * bundled into the desktop main process and into the box's server.mjs.
 */

/** The desktop shell's own host for the UI: serveUi intercepts http for it.
 *  A real http origin, not a custom scheme, which Chromium gives no cookies. */
export const UI_HOST = 'mantle-ui.localhost';
export const UI_ORIGIN = `http://${UI_HOST}`;

/** The origin of a URL, or null when it does not parse or has none. */
export function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Whether a parsed URL names a plain host: letters, digits, dots and dashes,
 * or a bracketed IPv6 address. The URL parser lets `*`, `;` and `,` through
 * in a hostname, and a brain origin goes into the CSP as written, so
 * `https://*` would open connect-src to every https host.
 */
export function plainHost(url: URL): boolean {
  return /^[a-z0-9.-]+$/.test(url.hostname) || /^\[[0-9a-f:.]+\]$/.test(url.hostname);
}

/** On every answer: a file is only ever the type the host names. */
const NOSNIFF = { 'x-content-type-options': 'nosniff' };

export type HostManifest = {
  /** The value each dynamic segment was exported under. */
  placeholder: string;
  /** `/notes/[id]`, `/docs/[collection]/[...slug]`, … */
  routes: string[];
  /** Path prefixes served with Referrer-Policy: no-referrer. */
  noReferrer: string[];
};

/** What env.js hands the page (packages/web-ui runtime-env.ts). */
export type HostEnv = {
  apiBase: string;
  serverOrigin: string;
  turnStreaming: string;
  tour: string;
  appearance: unknown;
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/x-component; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The URL path's segments, or null when a segment could step out of the UI
 * tree (`..`, an encoded slash or backslash, a NUL). Decoded: the export's
 * files are named by the decoded path.
 */
function safeSegments(pathname: string): string[] | null {
  const out: string[] = [];
  for (const raw of pathname.split('/')) {
    if (!raw) continue;
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (seg === '.' || seg === '..' || /[/\\\0]/.test(seg)) return null;
    out.push(seg);
  }
  return out;
}

/**
 * The path, relative to the UI tree, that a request for `pathname` maps to
 * through the placeholder fallback, or null when no route matches. Next's data
 * files ride along: `/notes/x.txt` and `/notes/x/__next.….txt` map like
 * `/notes/x`. The longest matching route wins.
 */
export function placeholderPath(segments: string[], manifest: HostManifest): string | null {
  let segs = segments;
  let suffix = '';
  const last = segs.at(-1) ?? '';
  if (last.startsWith('__next.')) {
    suffix = `/${last}`;
    segs = segs.slice(0, -1);
  } else if (last.endsWith('.txt')) {
    suffix = '.txt';
    segs = [...segs.slice(0, -1), last.slice(0, -4)];
  }
  let best: { len: number; path: string } | null = null;
  for (const route of manifest.routes) {
    // A route names a dynamic FOLDER; its pages may sit below it
    // (`/nodes/[id]/history`), so the rest of the path rides along. A
    // catch-all takes the rest as its one placeholder.
    const pat = route.split('/').filter(Boolean);
    if (segs.length < pat.length) continue;
    const catchAll = pat.at(-1)?.startsWith('[...') ?? false;
    const mapped: string[] = [];
    let ok = true;
    for (let i = 0; i < pat.length && ok; i++) {
      const part = pat[i]!;
      if (part.startsWith('[')) mapped.push(manifest.placeholder);
      else if (part === segs[i]) mapped.push(part);
      else ok = false;
    }
    if (!catchAll) mapped.push(...segs.slice(pat.length));
    if (ok && (!best || pat.length > best.len)) {
      best = { len: pat.length, path: `/${mapped.join('/')}${suffix}` };
    }
  }
  return best?.path ?? null;
}

export function envScript(env: HostEnv): string {
  return `window.__MANTLE_ENV__ = ${JSON.stringify(env)};`;
}

/** `{brain}` / `{brain_ws}` in the build's CSP template, for this brain. */
export function fillCsp(template: string, brainOrigin: string): string {
  const ws = brainOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  // Replacer functions: a `$` in the value is never read as a pattern.
  return template
    .trim()
    .replaceAll('{brain_ws}', () => ws)
    .replaceAll('{brain}', () => brainOrigin);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export type StaticHostOptions = {
  /** The staged static export (client/desktop/ui). */
  uiDir: string;
  /** This window's brain. */
  brainOrigin: string;
  /** The brain's public appearance, or null (cached by the caller). */
  appearance: () => Promise<unknown>;
  turnStreaming?: string;
  tour?: string;
};

/** A request handler for one brain window's session (`protocol.handle`). */
export function createStaticHost(opts: StaticHostOptions): (request: Request) => Promise<Response> {
  let manifest: Promise<{ routes: HostManifest; csp: string }> | null = null;
  const load = () =>
    (manifest ??= (async () => ({
      routes: JSON.parse(
        await readFile(join(opts.uiDir, '_mantle/routes.json'), 'utf8'),
      ) as HostManifest,
      csp: fillCsp(await readFile(join(opts.uiDir, '_mantle/csp.txt'), 'utf8'), opts.brainOrigin),
    }))());
  const root = normalize(opts.uiDir + sep);

  async function find(segments: string[], routes: HostManifest) {
    const tryPath = async (rel: string) => {
      // A name Windows reads as another file (`invite.html.`, `invite.html `,
      // `invite.html::$DATA`, `/ınvıte`, which NTFS folds to INVITE) would be
      // served with the wrong type, or past the no-referrer match. The
      // export's names are plain ASCII with none of these: such a name finds
      // nothing.
      if (rel.split('/').some((seg) => /[^\x20-\x7e]|:|[. ]$/.test(seg))) return null;
      for (const candidate of [rel, `${rel}.html`, join(rel, 'index.html')]) {
        const full = normalize(join(opts.uiDir, candidate));
        if (full.startsWith(root) && (await isFile(full))) return full;
      }
      return null;
    };
    const direct = await tryPath(segments.join('/'));
    if (direct) return { file: direct, status: 200 };
    const mapped = placeholderPath(segments, routes);
    const viaPlaceholder = mapped ? await tryPath(mapped) : null;
    if (viaPlaceholder) return { file: viaPlaceholder, status: 200 };
    // A page that does not exist gets the 404 page; a missing asset, nothing.
    if (!extname(segments.at(-1) ?? '')) {
      const notFound = await tryPath('404');
      if (notFound) return { file: notFound, status: 404 };
    }
    return null;
  }

  return async (request) => {
    const url = new URL(request.url);
    const { routes, csp } = await load();

    if (url.pathname === '/env.js') {
      const env: HostEnv = {
        apiBase: opts.brainOrigin,
        serverOrigin: opts.brainOrigin,
        turnStreaming: opts.turnStreaming ?? '',
        tour: opts.tour ?? '',
        appearance: await opts.appearance().catch(() => null),
      };
      return new Response(envScript(env), {
        headers: { 'content-type': TYPES['.js']!, 'cache-control': 'no-store', ...NOSNIFF },
      });
    }

    const segments = safeSegments(url.pathname);
    const hit = segments ? await find(segments, routes) : null;
    if (!hit) return new Response('Not found', { status: 404, headers: NOSNIFF });

    // Lower-cased: on a case-insensitive disk (an unpacked Mac or Windows
    // build) `/Invite.HTML` finds invite.html, and must still be HTML with
    // its CSP, not a download.
    const type = TYPES[extname(hit.file).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'content-type': type, ...NOSNIFF };
    if (type.startsWith('text/html')) {
      headers['content-security-policy'] = csp;
      headers['cache-control'] = 'no-cache';
      // Matched on the path the file was found by (decoded, any case, with
      // or without .html), so `/%69nvite` or `/INVITE` is no way around it.
      const asked = `/${(segments ?? []).join('/')}`.toLowerCase().replace(/\.html$/, '');
      if (routes.noReferrer.some((p) => under(asked, p))) {
        headers['referrer-policy'] = 'no-referrer';
      }
    } else if (url.pathname.startsWith('/_next/static/')) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['cache-control'] = 'no-cache';
    }
    return new Response(await readFile(hit.file), { status: hit.status, headers });
  };
}

/**
 * The brain's public appearance for env.js, cached per brain the way the old
 * server cached it: 30 s after a success, 5 s after a failure (keeping the
 * last good value), a 2 s timeout. A page must never wait long on branding,
 * and never fail over it. Callers that miss the cache together share one
 * fetch, so a burst of windows or visitors costs the brain one read.
 *
 * The timeout is the host's own, not only the fetch's: a fetch that ignores
 * its signal, or a body that stalls under the cap, still ends for every
 * caller at the deadline, so a shared read can never hang env.js for good.
 */
export function appearanceCache(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  now: () => number = Date.now,
  timeoutMs = 2_000,
): (brainOrigin: string) => Promise<unknown> {
  const cache = new Map<string, { at: number; ok: boolean; value: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();
  return async (brainOrigin) => {
    const hit = cache.get(brainOrigin);
    if (hit && now() - hit.at < (hit.ok ? 30_000 : 5_000)) return hit.value;
    const running = inFlight.get(brainOrigin);
    if (running) return running;
    // Started a turn later, so the entry is in the map before the read can
    // end, even by a throw before its first await.
    const read: Promise<unknown> = Promise.resolve().then(async () => {
      const deadline = AbortSignal.timeout(timeoutMs);
      try {
        const value = await Promise.race([
          fetchAppearance(fetchImpl, brainOrigin, deadline),
          whenAborted(deadline),
        ]);
        cache.set(brainOrigin, { at: now(), ok: true, value });
        return value;
      } catch {
        const value = cache.get(brainOrigin)?.value ?? null;
        cache.set(brainOrigin, { at: now(), ok: false, value });
        return value;
      } finally {
        if (inFlight.get(brainOrigin) === read) inFlight.delete(brainOrigin);
      }
    });
    inFlight.set(brainOrigin, read);
    return read;
  };
}

/** Rejects once `signal` aborts. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** Bigger than any real appearance (a few hundred bytes), small enough that a
 *  brain cannot swell every page's env.js. */
const APPEARANCE_MAX_BYTES = 64 * 1024;

/**
 * One read of `${brainOrigin}/api/appearance`, the one place both hosts fetch
 * it. The host, not the page, sends it (no CORS) and hands the body to every
 * visitor in env.js, so it reads only the configured origin: no redirect is
 * followed, no cookie is sent, and only a JSON object of modest size passes.
 * Anything else throws, and the caller keeps its last good value or null.
 */
async function fetchAppearance(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  brainOrigin: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetchImpl(`${brainOrigin}/api/appearance`, {
    signal,
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && originOf(res.url) !== brainOrigin) throw new Error('off-origin answer');
  const value: unknown = JSON.parse(await readCapped(res, APPEARANCE_MAX_BYTES, signal));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('appearance is not an object');
  }
  return value;
}

/** The body as text, read no further than `max` bytes: a bigger body throws
 *  as soon as it passes the cap (or at once, when its length says so), and
 *  the rest is never read. On `signal`'s abort the read stops too, so a body
 *  that stalls is let go. */
async function readCapped(res: Response, max: number, signal: AbortSignal): Promise<string> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error('appearance too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const stop = () => void reader.cancel().catch(() => {});
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('appearance read timed out');
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new Error('appearance too large');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
