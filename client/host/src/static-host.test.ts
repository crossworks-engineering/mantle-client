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

  it('never serves a file outside the UI tree', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/notes/..%2F..%2Fsecret.txt']) {
      expect(await (await get(path)).text(), path).not.toBe('outside');
    }
  });
});

describe('appearanceCache', () => {
  it('caches a success for 30 s and a failure for 5 s, keeping the last good value', async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const cached = appearanceCache(
      async () => {
        calls++;
        if (fail) throw new Error('down');
        return { siteName: `v${calls}` };
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
    const cached = appearanceCache(async (url) => ({ from: url }));
    expect(await cached('https://a.example')).toEqual({ from: 'https://a.example/api/appearance' });
    expect(await cached('https://b.example')).toEqual({ from: 'https://b.example/api/appearance' });
  });
});
