import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appearanceCache, createStaticHost } from './static-host';

/**
 * The box's host of the static owner UI: the client image's whole server.
 *
 * It replaced `next start`. It is the same host the desktop shell uses
 * (static-host.ts), behind a plain node:http server (Bun runs node:http too), and keeps the contract
 * the box already relies on: port 3000, `/env.js` answering 200 (the compose
 * healthcheck fetches it), and the same environment:
 *
 *   MANTLE_SERVER_ORIGIN   the brain's public origin ('' = same-origin)
 *   MANTLE_TURN_STREAMING  passed through to env.js
 *   MANTLE_TOUR            passed through to env.js
 *   PORT, HOST             3000 and 0.0.0.0 by default
 *   UI_DIR                 the static export, by default ./out beside this file
 *
 * scripts/build.mjs bundles it into one dependency-free dist/server.mjs, so
 * the image needs the export and this file and nothing else. The image runs
 * it on Bun (`bun server.mjs`); plain node runs it the same way, which is
 * how the tests and a local check start it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const brainOrigin = (process.env.MANTLE_SERVER_ORIGIN ?? '').trim().replace(/\/+$/, '');

const appearanceOf = appearanceCache(async (url, signal) => {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

const host = createStaticHost({
  uiDir: process.env.UI_DIR || join(here, 'out'),
  brainOrigin,
  // Same-origin with no origin set: no absolute URL to fetch the appearance
  // from, so the page wears the fresh-install look and corrects after mount.
  appearance: () => (brainOrigin ? appearanceOf(brainOrigin) : Promise.resolve(null)),
  turnStreaming: process.env.MANTLE_TURN_STREAMING ?? '',
  tour: process.env.MANTLE_TOUR ?? '',
});

/** Node's request to a fetch Request. The host only reads the URL. */
function toRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', 'http://client.internal');
  return new Request(url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET' });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const answer = await host(toRequest(req));
  const headers: Record<string, string> = {};
  answer.headers.forEach((value, key) => (headers[key] = value));
  const body = Buffer.from(await answer.arrayBuffer());
  headers['content-length'] = String(body.length);
  res.writeHead(answer.status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error('[client-host]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || '0.0.0.0';
server.listen(port, hostname, () => {
  console.log(
    `[client-host] serving the static UI on ${hostname}:${port} for ${brainOrigin || 'same-origin'}`,
  );
});

// The container's stop: finish what is in flight, then go.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
