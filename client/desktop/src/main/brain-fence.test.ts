import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BRAIN_PASSTHROUGH,
  brainRequestFilter,
  frameNavigationAllowed,
  httpRouteOf,
  normalizeOrigin,
  oidcArrivalProfile,
  oidcDeepLink,
  oidcStartUrl,
  permissionAllowed,
  savedOriginOk,
  stripBrowserOnlyHeaders,
} from './brain-fence';
import { UI_ORIGIN } from '@mantle/client-host/static-host';

describe('stripBrowserOnlyHeaders', () => {
  it('drops Origin and every Sec-Fetch-* header, whatever the case', () => {
    const out = stripBrowserOnlyHeaders({
      Origin: 'http://127.0.0.1:51234',
      'Sec-Fetch-Site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'SEC-FETCH-USER': '?1',
    });
    expect(out).toEqual({});
  });

  it('keeps everything else, the bearer and the body type included', () => {
    const out = stripBrowserOnlyHeaders({
      Authorization: 'Bearer t',
      'Content-Type': 'application/json',
      'Sec-CH-UA': '"Chromium"',
      'Idempotency-Key': 'k',
    });
    expect(out).toEqual({
      Authorization: 'Bearer t',
      'Content-Type': 'application/json',
      'Sec-CH-UA': '"Chromium"',
      'Idempotency-Key': 'k',
    });
  });
});

/**
 * A sign-in from the shell stands on this fence: the brain's login-CSRF
 * guard (refuseCrossSiteAuthPost) refuses an auth POST whose `Origin` or
 * `Sec-Fetch-Site` says another site, and those are what Chromium puts on
 * the renderer's fetch from the loopback page. Only the fence takes them
 * off. These tests pin each link of that chain, so a later change to the
 * fence cannot quietly cost the desktop its first-run signup.
 */
describe('the fence and a sign-in from the shell', () => {
  const BRAIN = 'https://brain.example';

  /** True when the request still claims a browser page on another site. */
  const brainRefusesAsBrowser = (headers: Record<string, string>) => {
    const has = (name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name);
    return has('origin') || has('sec-fetch-site') || has('sec-fetch-mode') || has('sec-fetch-dest');
  };

  /** Electron's URL filter is a Chrome match pattern; `*` is any run. */
  const matches = (pattern: string, url: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url);

  /** What Chromium sends for the renderer's JSON POST from the loopback UI. */
  const chromiumPost = () => ({
    Origin: 'http://127.0.0.1:51234',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Content-Type': 'application/json',
    Accept: '*/*',
  });

  it('the filter covers the sign-in routes, and nothing off the brain', () => {
    const [pattern] = brainRequestFilter(BRAIN).urls;
    expect(brainRequestFilter(BRAIN).urls).toHaveLength(1);
    for (const path of ['/api/auth/token', '/api/auth/signup']) {
      expect(matches(pattern!, `${BRAIN}${path}`), path).toBe(true);
    }
    expect(matches(pattern!, 'https://brain.example.evil/api/auth/token')).toBe(false);
    expect(matches(pattern!, 'https://other.example/api/auth/token')).toBe(false);
  });

  it('unfenced, the brain refuses the request; fenced, it passes as a native client', () => {
    expect(brainRefusesAsBrowser(chromiumPost())).toBe(true);
    const fenced = stripBrowserOnlyHeaders(chromiumPost());
    expect(brainRefusesAsBrowser(fenced)).toBe(false);
    // And the auth routes' cross-site guard, which reads Sec-Fetch-Site when
    // there is no Origin, finds nothing to refuse; the body stays JSON.
    expect(fenced['Content-Type']).toBe('application/json');
    expect(Object.keys(fenced).map((k) => k.toLowerCase())).not.toContain('sec-fetch-site');
  });

  it('index.ts applies the fence to every brain window, before the window exists', () => {
    const src = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
    expect(src).toContain('const brainUrls = brainRequestFilter(brainOrigin);');
    // ONE onBeforeSendHeaders listener, over the brain only: requests to the
    // shell's own scheme never leave the machine and need no rewrite.
    expect(src.match(/onBeforeSendHeaders\(/g)).toHaveLength(1);
    expect(src).toMatch(
      /ses\.webRequest\.onBeforeSendHeaders\(brainUrls, \(\{ requestHeaders \}, callback\) => \{\s*callback\(\{ requestHeaders: stripBrowserOnlyHeaders\(requestHeaders\) \}\);/,
    );
    // No redirect of /env.js to a data: URL: Chromium refuses it.
    expect(src).not.toContain('redirectURL');
    // openAppWindow fences the window's own partition first, and serves the
    // UI to that same session, both before the window exists.
    const open = src.slice(src.indexOf('async function openAppWindow('));
    expect(open).toContain('const ses = session.fromPartition(partition);');
    const fence = open.indexOf('fenceBrainSession(ses, profile.origin, rendererOrigin);');
    const serve = open.indexOf('serveUi(ses, profile.origin);');
    expect(fence).toBeGreaterThan(-1);
    expect(serve).toBeGreaterThan(-1);
    expect(fence).toBeLessThan(open.indexOf('new BrowserWindow('));
    expect(serve).toBeLessThan(open.indexOf('new BrowserWindow('));
    expect(open.slice(0, open.indexOf('preload:'))).toMatch(/webPreferences: \{\s*partition,/);
  });
});

describe('frameNavigationAllowed', () => {
  const brain = 'https://brain.example';
  const canvas = `${brain}/api/presents/11111111-1111-4111-8111-111111111111/frame?t=x`;
  it('keeps a canvas or app frame on the brain', () => {
    expect(frameNavigationAllowed(canvas, 'https://evil.example/', brain)).toBe(false);
    expect(frameNavigationAllowed(canvas, `${brain}/api/presents`, brain)).toBe(false);
    expect(frameNavigationAllowed(canvas, `${brain}/api/presents/22/frame?t=y`, brain)).toBe(true);
    expect(
      frameNavigationAllowed(`${brain}/api/apps/a1/frame`, 'https://evil.example/', brain),
    ).toBe(false);
    expect(frameNavigationAllowed(canvas, 'not a url', brain)).toBe(false);
  });
  it('leaves every other sub-frame alone', () => {
    expect(frameNavigationAllowed('about:blank', canvas, brain)).toBe(true);
    expect(
      frameNavigationAllowed('https://www.youtube.com/embed/x', 'https://evil.example/', brain),
    ).toBe(true);
    expect(frameNavigationAllowed('', canvas, brain)).toBe(true);
  });
});

describe('permissionAllowed', () => {
  const renderer = 'http://127.0.0.1:51234';
  const main = { requestingUrl: 'http://127.0.0.1:51234/chats/abc', isMainFrame: true };
  it('allows the microphone for the app page on the renderer origin', () => {
    expect(permissionAllowed('media', { ...main, mediaTypes: ['audio'] }, renderer)).toBe(true);
  });
  it("allows it on the shell's own UI origin, and on no other localhost", () => {
    const page = { requestingUrl: `${UI_ORIGIN}/chats/abc`, isMainFrame: true };
    expect(permissionAllowed('media', { ...page, mediaTypes: ['audio'] }, UI_ORIGIN)).toBe(true);
    expect(
      permissionAllowed(
        'media',
        {
          requestingUrl: 'http://other.localhost/chats/abc',
          isMainFrame: true,
          mediaTypes: ['audio'],
        },
        UI_ORIGIN,
      ),
    ).toBe(false);
  });
  it('refuses video, no kind, a sub-frame, another origin and the brain origin', () => {
    expect(permissionAllowed('media', { ...main, mediaTypes: ['audio', 'video'] }, renderer)).toBe(
      false,
    );
    expect(permissionAllowed('media', { ...main, mediaTypes: ['video'] }, renderer)).toBe(false);
    expect(permissionAllowed('media', { ...main, mediaTypes: ['unknown'] }, renderer)).toBe(false);
    expect(permissionAllowed('media', { ...main, mediaTypes: [] }, renderer)).toBe(false);
    expect(permissionAllowed('media', main, renderer)).toBe(false);
    expect(
      permissionAllowed('media', { ...main, isMainFrame: false, mediaTypes: ['audio'] }, renderer),
    ).toBe(false);
    expect(
      permissionAllowed(
        'media',
        { ...main, requestingUrl: 'https://evil.example/', mediaTypes: ['audio'] },
        renderer,
      ),
    ).toBe(false);
    expect(
      permissionAllowed(
        'media',
        { ...main, requestingUrl: 'https://brain.example/chats/abc', mediaTypes: ['audio'] },
        renderer,
      ),
    ).toBe(false);
    expect(permissionAllowed('media', { mediaTypes: ['audio'] }, renderer)).toBe(false);
  });
  it('grants the app page what it uses, and nothing else', () => {
    for (const p of [
      'fullscreen',
      'clipboard-sanitized-write',
      'clipboard-read',
      'fileSystem',
      'geolocation',
      'geolocation-approximate',
      'notifications',
    ]) {
      expect(permissionAllowed(p, main, renderer), p).toBe(true);
    }
    const mail = { ...main, externalURL: 'mailto:a@example.invalid' };
    expect(permissionAllowed('openExternal', mail, renderer)).toBe(true);
    for (const externalURL of ['ms-settings:', 'file:///etc/passwd', 'tel:123', undefined]) {
      expect(
        permissionAllowed('openExternal', { ...main, externalURL }, renderer),
        String(externalURL),
      ).toBe(false);
    }
    for (const p of [
      'pointerLock',
      'display-capture',
      'midiSysex',
      'hid',
      'usb',
      'deprecated-sync-clipboard-read',
      'unknown',
    ]) {
      expect(permissionAllowed(p, main, renderer), p).toBe(false);
    }
  });
  it('grants Local Network Access to the app page only, so it can reach a LAN brain', () => {
    const page = { requestingUrl: `${UI_ORIGIN}/chats/abc`, isMainFrame: true };
    for (const p of ['local-network-access', 'local-network', 'loopback-network']) {
      expect(permissionAllowed(p, page, UI_ORIGIN), p).toBe(true);
      expect(permissionAllowed(p, { ...page, isMainFrame: false }, UI_ORIGIN), p).toBe(false);
      expect(
        permissionAllowed(
          p,
          { ...page, requestingUrl: 'https://192.168.1.20/api/apps/x/frame' },
          UI_ORIGIN,
        ),
        p,
      ).toBe(false);
      expect(
        permissionAllowed(p, { ...page, requestingUrl: 'http://other.localhost/' }, UI_ORIGIN),
        p,
      ).toBe(false);
    }
  });
  it('grants a sub-frame, another origin or no origin nothing at all', () => {
    for (const p of ['fullscreen', 'clipboard-sanitized-write', 'notifications', 'openExternal']) {
      expect(permissionAllowed(p, { ...main, isMainFrame: false }, renderer), p).toBe(false);
      expect(
        permissionAllowed(p, { ...main, requestingUrl: 'https://brain.example/app/x' }, renderer),
        p,
      ).toBe(false);
      expect(permissionAllowed(p, { isMainFrame: true }, renderer), p).toBe(false);
    }
  });
});

describe('httpRouteOf', () => {
  const httpBrain = 'http://127.0.0.1:3000';

  it('answers the UI host from disk, its default port included', () => {
    expect(httpRouteOf(`${UI_ORIGIN}/notes/_`, httpBrain)).toBe('ui');
    expect(httpRouteOf(`${UI_ORIGIN}:80/env.js`, httpBrain)).toBe('ui');
  });

  it("lets the window's own plain-http brain through", () => {
    expect(httpRouteOf(`${httpBrain}/api/shell`, httpBrain)).toBe('brain');
  });

  it('refuses every other http request, look-alikes of the UI host included', () => {
    for (const url of [
      'http://127.0.0.1:11434/api/tags',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'http://127.0.0.1:3001/api/shell',
      'http://mantle-ui.localhost:3000/',
      'http://mantle-ui.localhost./',
      'http://evil.mantle-ui.localhost/',
      'not a url',
    ]) {
      expect(httpRouteOf(url, httpBrain), url).toBe('refuse');
    }
  });

  it('refuses all of it for a brain on https', () => {
    expect(httpRouteOf('http://brain.example/api/shell', 'https://brain.example')).toBe('refuse');
    expect(httpRouteOf(`${UI_ORIGIN}/`, 'https://brain.example')).toBe('ui');
  });
});

describe('BRAIN_PASSTHROUGH', () => {
  it('sends an http brain request with no cookies and follows no redirect', () => {
    expect(BRAIN_PASSTHROUGH).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });
});

describe('normalizeOrigin', () => {
  it('turns what a user types into an origin', () => {
    expect(normalizeOrigin('brain.example/')).toBe('https://brain.example');
    expect(normalizeOrigin(' http://127.0.0.1:3000/x ')).toBe('http://127.0.0.1:3000');
  });

  it('refuses another scheme and a host that is not plain', () => {
    for (const bad of ['ftp://b.example', 'https://*', 'https://*.x.com', 'https://a;b.com', '']) {
      expect(() => normalizeOrigin(bad), bad).toThrow();
    }
  });
});

describe('savedOriginOk', () => {
  it('takes an address exactly as normalizeOrigin saves it', () => {
    expect(savedOriginOk('https://brain.example')).toBe(true);
    expect(savedOriginOk('http://127.0.0.1:3000')).toBe(true);
  });

  it('refuses what an older build or a hand edit could leave', () => {
    for (const bad of [
      'https://*.attacker.example',
      'brain.example',
      'https://brain.example/',
      'HTTPS://BRAIN.EXAMPLE',
      'https://a;b.com',
      undefined,
      42,
    ]) {
      expect(savedOriginOk(bad), String(bad)).toBe(false);
    }
  });
});

describe('oidcDeepLink', () => {
  const iss = encodeURIComponent('https://brain.example');
  it('takes a code, a purpose and the brain, and nothing else', () => {
    expect(
      oidcDeepLink(`mantle://oidc#oidc=code&code=abc_-1&purpose=signin&iss=${iss}&evil=1`),
    ).toEqual({
      iss: 'https://brain.example',
      fragment: `oidc=code&code=abc_-1&purpose=signin&iss=${iss}`,
    });
  });
  it('takes a flow that stopped, with no code riding along', () => {
    expect(oidcDeepLink(`mantle://oidc#oidc=cancelled&code=x&iss=${iss}`)).toEqual({
      iss: 'https://brain.example',
      fragment: `oidc=cancelled&iss=${iss}`,
    });
  });
  it('keeps the brain as an origin: no path or query reaches the page', () => {
    const link = `mantle://oidc#oidc=failed&iss=${encodeURIComponent('https://brain.example/x?y=1')}`;
    expect(oidcDeepLink(link)?.iss).toBe('https://brain.example');
  });
  it('refuses anything that is not the flow s end', () => {
    for (const link of [
      'mantle://n/abc',
      'mantle://oidc',
      'mantle://oidc#oidc=code',
      `mantle://oidc/more#oidc=failed&iss=${iss}`,
      `mantle://oidc?x=1#oidc=failed&iss=${iss}`,
      `mantle://other#oidc=failed&iss=${iss}`,
      `https://oidc#oidc=failed&iss=${iss}`,
      `mantle://oidc#oidc=code&code=abc&purpose=other&iss=${iss}`,
      `mantle://oidc#oidc=code&code=a%20b&purpose=link&iss=${iss}`,
      `mantle://oidc#oidc=code&purpose=link&iss=${iss}`,
      `mantle://oidc#oidc=<b>&iss=${iss}`,
      'mantle://oidc#oidc=failed',
      'mantle://oidc#oidc=failed&iss=javascript:alert(1)',
      'mantle://oidc#oidc=failed&iss=not%20a%20url',
      'not a link',
    ]) {
      expect(oidcDeepLink(link), link).toBeNull();
    }
  });
});

describe('oidcArrivalProfile', () => {
  const profiles = [
    { id: 'a', origin: 'https://a.example' },
    { id: 'b', origin: 'https://b.example' },
  ];
  it('drops a link when no window sent a sign-in out', () => {
    expect(oidcArrivalProfile(new Map(), profiles, 'https://a.example', 10)).toBeNull();
  });
  it('drops a link once the wait is over', () => {
    expect(oidcArrivalProfile(new Map([['a', 10]]), profiles, 'https://a.example', 10)).toBeNull();
  });
  it('a window that waits takes the link that names its brain', () => {
    const armed = new Map([
      ['a', 100],
      ['b', 200],
    ]);
    expect(oidcArrivalProfile(armed, profiles, 'https://a.example', 10)).toBe('a');
  });
  it('a link that names no waiting brain goes to the last that went out', () => {
    const armed = new Map([
      ['a', 100],
      ['b', 200],
    ]);
    expect(oidcArrivalProfile(armed, profiles, 'https://alias.example', 10)).toBe('b');
  });
  it('never wakes a brain that is not waiting, though the link names it', () => {
    expect(oidcArrivalProfile(new Map([['a', 100]]), profiles, 'https://b.example', 10)).toBe('a');
  });
});

describe('oidcStartUrl', () => {
  const brain = 'https://brain.example';
  it('takes this brain s start path', () => {
    const url = `${brain}/api/auth/oidc/start?ticket=abc`;
    expect(oidcStartUrl(url, brain)).toBe(url);
  });
  it('refuses anything else', () => {
    for (const url of [
      'https://evil.example/api/auth/oidc/start',
      `${brain}/api/auth/oidc/callback`,
      `${brain}.evil.example/api/auth/oidc/start`,
      'file:///etc/passwd',
      'mantle://oidc',
      '/api/auth/oidc/start',
      '',
      42,
      null,
      `${brain}/api/auth/oidc/start?x=${'a'.repeat(5000)}`,
    ]) {
      expect(oidcStartUrl(url, brain), String(url)).toBeNull();
    }
  });
});
