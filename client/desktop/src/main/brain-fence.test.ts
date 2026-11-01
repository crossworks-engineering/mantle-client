import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  brainRequestFilter,
  frameNavigationAllowed,
  permissionAllowed,
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
  it('every other permission keeps the answer it had before: granted', () => {
    for (const p of [
      'fullscreen',
      'clipboard-sanitized-write',
      'clipboard-read',
      'fileSystem',
      'geolocation',
      'pointerLock',
      'notifications',
      'display-capture',
    ]) {
      expect(permissionAllowed(p, main, renderer)).toBe(true);
      expect(permissionAllowed(p, { ...main, isMainFrame: false }, renderer)).toBe(true);
    }
  });
});
