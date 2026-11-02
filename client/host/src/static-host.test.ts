import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appearanceCache,
  createStaticHost,
  fillCsp,
  originOf,
  placeholderPath,
  plainHost,
  UI_ORIGIN,
  type HostManifest,
} from './static-host';

const MANIFEST: HostManifest = {
  placeholder: '_',
  routes: ['/docs/[collection]', '/docs/[collection]/[...slug]', '/nodes/[id]', '/notes/[id]'],
  noReferrer: ['/client-signin', '/invite'],
};

describe('placeholderPath', () => {
  const map = (path: string) => placeholderPath(path.split('/').filter(Boolean), MANIFEST);

  it('maps a dynamic segment to the placeholder', () => {
    expect(map('/notes/abc123')).toBe('/notes/_');
  });

  it('keeps a page below a dynamic folder', () => {
    expect(map('/nodes/abc/history')).toBe('/nodes/_/history');
  });

  it('maps a catch-all to one placeholder, preferring the longer route', () => {
    expect(map('/docs/handbook/guide/intro')).toBe('/docs/_/_');
  });

  it("maps Next's data files like their page", () => {
    expect(map('/notes/abc.txt')).toBe('/notes/_.txt');
    expect(map('/notes/abc/__next._tree.txt')).toBe('/notes/_/__next._tree.txt');
    expect(map('/nodes/abc/history.txt')).toBe('/nodes/_/history.txt');
  });

  it('maps nothing for a path outside every route', () => {
    expect(map('/tasks/abc')).toBeNull();
    expect(map('/notes')).toBeNull();
  });
});

describe('fillCsp', () => {
  it('names the brain and its websocket twin', () => {
    expect(fillCsp("connect-src 'self' {brain} {brain_ws}\n", 'https://b.example')).toBe(
      "connect-src 'self' https://b.example wss://b.example",
    );
    expect(fillCsp('{brain_ws}', 'http://127.0.0.1:9')).toBe('ws://127.0.0.1:9');
    expect(fillCsp('{brain}', 'https://$&.example')).toBe('https://$&.example');
  });
});

describe('originOf', () => {
  it('gives the origin, and null for no origin at all', () => {
    expect(originOf(`${UI_ORIGIN}/notes/x`)).toBe(UI_ORIGIN);
    expect(originOf('https://b.example:8443/a')).toBe('https://b.example:8443');
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });
});

describe('createStaticHost', () => {
  let dir: string;
  const put = (rel: string, body: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const host = (appearance: unknown = { siteName: 'Acme' }) =>
    createStaticHost({
      uiDir: dir,
      brainOrigin: 'https://b.example',
      appearance: async () => appearance,
    });
  const get = (path: string, h = host()) => h(new Request(`${UI_ORIGIN}${path}`));

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'static-host-'));
    put('_mantle/routes.json', JSON.stringify(MANIFEST));
    put('_mantle/csp.txt', "default-src 'self'; connect-src 'self' {brain} {brain_ws}\n");
    put('index.html', 'home');
    put('login.html', 'login');
    put('invite.html', 'invite');
    put('Shout.HTML', 'shout');
    put('notes/_.html', 'note page');
    put('notes/_.txt', 'note data');
    put('404.html', 'not here');
    put('_next/static/chunks/a.js', 'js');
    writeFileSync(join(dirname(dir), 'secret.txt'), 'outside');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dirname(dir), 'secret.txt'), { force: true });
  });

  it('serves a page, its .html, and the index', async () => {
    expect(await (await get('/login')).text()).toBe('login');
    expect(await (await get('/')).text()).toBe('home');
  });

  it('serves the placeholder page for any id, with a 200', async () => {
    const res = await get('/notes/abc123?x=1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('note page');
    expect(await (await get('/notes/abc123.txt')).text()).toBe('note data');
  });

  it('sends the CSP for this brain on HTML, and no-referrer on link-code pages', async () => {
    const page = await get('/login');
    expect(page.headers.get('content-security-policy')).toBe(
      "default-src 'self'; connect-src 'self' https://b.example wss://b.example",
    );
    expect(page.headers.get('referrer-policy')).toBeNull();
    expect((await get('/invite')).headers.get('referrer-policy')).toBe('no-referrer');
    for (const path of ['/%69nvite?code=1', '//invite?code=1', '/invite.html?code=1']) {
      expect((await get(path)).headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it('sends nosniff on every answer, env.js and a miss included', async () => {
    for (const path of ['/login', '/_next/static/chunks/a.js', '/env.js', '/no/such/page']) {
      expect((await get(path)).headers.get('x-content-type-options'), path).toBe('nosniff');
    }
  });

  it('caches hashed assets for good, and HTML not at all', async () => {
    expect((await get('/_next/static/chunks/a.js')).headers.get('cache-control')).toMatch(
      /immutable/,
    );
    expect((await get('/login')).headers.get('cache-control')).toBe('no-cache');
  });

  it('answers env.js with this brain and its appearance, never cached', async () => {
    const res = await get('/env.js');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    const env = JSON.parse(body.replace(/^window\.__MANTLE_ENV__ = /, '').replace(/;$/, ''));
    expect(env).toMatchObject({
      apiBase: 'https://b.example',
      serverOrigin: 'https://b.example',
      appearance: { siteName: 'Acme' },
    });
  });

  it('still answers env.js when the appearance fails, with none', async () => {
    const failing = createStaticHost({
      uiDir: dir,
      brainOrigin: 'https://b.example',
      appearance: () => Promise.reject(new Error('down')),
    });
    expect(await (await get('/env.js', failing)).text()).toContain('"appearance":null');
  });

  it('gives a missing page the 404 page, and a missing asset a bare 404', async () => {
    const page = await get('/no-such-page');
    expect(page.status).toBe(404);
    expect(await page.text()).toBe('not here');
    const asset = await get('/_next/static/chunks/missing.js');
    expect(asset.status).toBe(404);
    expect(await asset.text()).toBe('Not found');
  });

  it('types a file by its extension in any case: an upper-case .HTML is HTML, with its CSP', async () => {
    const res = await get('/Shout.HTML');
    expect(await res.text()).toBe('shout');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toContain('https://b.example');
  });

  it('finds no file by a name Windows reads as another one', async () => {
    for (const path of ['/invite.html.', '/invite.html%20', '/invite.html::$DATA', '/invite.']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toBe('invite');
    }
  });

  it('still maps a route value holding a colon or a trailing dot to its page', async () => {
    expect(await (await get('/notes/turn:abc')).text()).toBe('note page');
    expect(await (await get('/notes/v1.')).text()).toBe('note page');
  });

  it('never serves a file outside the UI tree', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/notes/..%2F..%2Fsecret.txt']) {
      expect(await (await get(path)).text(), path).not.toBe('outside');
    }
  });
});

describe('appearanceCache', () => {
  const json = (value: unknown) => new Response(JSON.stringify(value));

  it('caches a success for 30 s and a failure for 5 s, keeping the last good value', async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const cached = appearanceCache(
      async () => {
        calls++;
        if (fail) throw new Error('down');
        return json({ siteName: `v${calls}` });
      },
      () => t,
    );
    expect(await cached('https://b.example')).toEqual({ siteName: 'v1' });
    t = 29_000;
    expect(await cached('https://b.example')).toEqual({ siteName: 'v1' });
    expect(calls).toBe(1);
    t = 31_000;
    fail = true;
    expect(await cached('https://b.example')).toEqual({ siteName: 'v1' });
    t = 34_000;
    await cached('https://b.example');
    expect(calls).toBe(2);
    t = 37_000;
    fail = false;
    expect(await cached('https://b.example')).toEqual({ siteName: 'v3' });
  });

  it('keeps each brain apart', async () => {
    const cached = appearanceCache(async (url) => json({ from: url }));
    expect(await cached('https://a.example')).toEqual({ from: 'https://a.example/api/appearance' });
    expect(await cached('https://b.example')).toEqual({ from: 'https://b.example/api/appearance' });
  });

  it('asks for no redirect and no cookie', async () => {
    let seen: RequestInit | undefined;
    const cached = appearanceCache(async (_url, init) => {
      seen = init;
      return json({});
    });
    await cached('https://b.example');
    expect(seen).toMatchObject({ redirect: 'error', credentials: 'omit' });
  });

  it('refuses an array, a non-object, a huge body and an error status', async () => {
    for (const res of [
      json([1, 2]),
      json('text'),
      json(null),
      new Response('x'.repeat(70 * 1024)),
      new Response('{}', { status: 500 }),
    ]) {
      expect(await appearanceCache(async () => res)('https://b.example')).toBeNull();
    }
  });

  it('shares one fetch between callers that miss the cache together', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cached = appearanceCache(async () => {
      calls++;
      await gate;
      return json({ siteName: 'once' });
    });
    const all = Promise.all([1, 2, 3].map(() => cached('https://b.example')));
    const other = cached('https://a.example');
    release();
    expect(await all).toEqual([{ siteName: 'once' }, { siteName: 'once' }, { siteName: 'once' }]);
    await other;
    expect(calls).toBe(2);
  });

  it('starts a new fetch once the shared one has failed', async () => {
    let t = 0;
    let calls = 0;
    const cached = appearanceCache(
      async () => {
        calls++;
        throw new Error('down');
      },
      () => t,
    );
    expect(await Promise.all([cached('https://b.example'), cached('https://b.example')])).toEqual([
      null,
      null,
    ]);
    expect(calls).toBe(1);
    t = 6_000;
    await cached('https://b.example');
    expect(calls).toBe(2);
  });

  it('stops reading a body at 64 KB, without waiting for its end', async () => {
    let sent = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(
      await appearanceCache(async () => new Response(endless))('https://b.example'),
    ).toBeNull();
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(128 * 1024);
  });

  it('refuses a body whose length is over 64 KB before reading it', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const res = new Response(body, { headers: { 'content-length': String(65 * 1024) } });
    expect(await appearanceCache(async () => res)('https://b.example')).toBeNull();
    expect(pulled).toBe(false);
  });

  it('takes a body of exactly 64 KB', async () => {
    const body = `{"pad":"${'x'.repeat(64 * 1024 - 10)}"}`;
    expect(body.length).toBe(64 * 1024);
    expect(await appearanceCache(async () => new Response(body))('https://b.example')).toEqual({
      pad: 'x'.repeat(64 * 1024 - 10),
    });
  });

  it('never follows a redirect off the brain, with the real fetch', async () => {
    const { createServer } = await import('node:http');
    let reached = false;
    const target = createServer((_req, res) => {
      reached = true;
      res.end('{"siteName":"lan"}');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    const targetPort = (target.address() as { port: number }).port;
    const brain = createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/x.json` }).end();
    });
    await new Promise<void>((r) => brain.listen(0, '127.0.0.1', r));
    const brainPort = (brain.address() as { port: number }).port;
    try {
      expect(await appearanceCache(fetch)(`http://127.0.0.1:${brainPort}`)).toBeNull();
      expect(reached).toBe(false);
    } finally {
      brain.close();
      target.close();
    }
  });
});

describe('plainHost', () => {
  it('takes names, IPv4 and bracketed IPv6', () => {
    for (const u of ['https://b.example', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(plainHost(new URL(u)), u).toBe(true);
    }
  });

  it('refuses a wildcard, a semicolon or a comma in the host', () => {
    for (const u of ['https://*', 'https://*.x.com', 'https://a;b.com', 'https://a,b.com']) {
      expect(plainHost(new URL(u)), u).toBe(false);
    }
  });
});
