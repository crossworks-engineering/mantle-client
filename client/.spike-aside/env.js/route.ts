/**
 * Runtime client configuration — `<script src="/env.js">` in the root layout
 * head, BLOCKING, so `window.__MANTLE_ENV__` exists before any bundle code
 * runs. Reads process.env per request (force-dynamic, no-store): ONE prebuilt
 * client image serves any server origin; per-box config is compose env only.
 *
 * Empty apiBase ⇒ same-origin (the monolith / single-host deployment).
 * See @mantle/web-ui/runtime-env for the reader + fallback chain.
 *
 * Config ONLY — the brain's appearance is NOT delivered here: the root layout
 * renders it into the <html> tag server-side (lib/appearance.ts), so the
 * document is already correct before any script runs.
 */
import { brainOrigin } from '@/lib/brain-origin';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The request's brain: the deployment's, or in the desktop shell the
  // window's own (lib/brain-origin.ts), the same value its preload injects.
  const serverOrigin = await brainOrigin();
  const env = {
    apiBase: serverOrigin,
    serverOrigin,
    turnStreaming: process.env.MANTLE_TURN_STREAMING ?? '',
    tour: process.env.MANTLE_TOUR ?? '',
  };
  return new Response(`window.__MANTLE_ENV__ = ${JSON.stringify(env)};`, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
