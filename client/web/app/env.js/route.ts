/**
 * Runtime client configuration — `<script src="/env.js">` in the root layout
 * head, BLOCKING, so `window.__MANTLE_ENV__` exists before any bundle code
 * runs and before the first paint.
 *
 * In a built UI this is a STATIC file (out/env.js) holding the safe default:
 * an empty apiBase, which means same-origin, and no appearance, which means the
 * fresh-install look. A host serves its OWN /env.js in front of it, per box or
 * per brain window, with the brain's origin and its public appearance
 * (docs/static-ui-host.md). See @mantle/web-ui/runtime-env for the readers.
 *
 * Under `next dev` the route runs per request, so detached dev
 * (scripts/dev-frontend.sh) still points at MANTLE_SERVER_ORIGIN and gets that
 * brain's real appearance, as a host would hand it over.
 */
import type { MantleRuntimeEnv } from '@mantle/web-ui/runtime-env';

export const dynamic = 'force-static';

async function devAppearance(origin: string): Promise<MantleRuntimeEnv['appearance']> {
  if (process.env.NODE_ENV !== 'development' || !origin) return null;
  try {
    const res = await fetch(`${origin}/api/appearance`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as MantleRuntimeEnv['appearance']) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const serverOrigin = (process.env.MANTLE_SERVER_ORIGIN ?? '').trim().replace(/\/+$/, '');
  const env: MantleRuntimeEnv = {
    apiBase: serverOrigin,
    serverOrigin,
    turnStreaming: process.env.MANTLE_TURN_STREAMING ?? '',
    tour: process.env.MANTLE_TOUR ?? '',
    appearance: await devAppearance(serverOrigin),
  };
  return new Response(`window.__MANTLE_ENV__ = ${JSON.stringify(env)};`, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
