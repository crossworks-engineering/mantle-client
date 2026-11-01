import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/**
 * The client middleware (phase W5c): the presence gate, the public pages, and
 * the retired pages. No role routing: the role hint cookies of older builds
 * change nothing.
 */
function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(path, 'http://client.test'));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

const location = (res: Response) => res.headers.get('location');

const SESSIONS: Record<string, Record<string, string>> = {
  'no session': {},
  'a signed-in login': { mantle_authed: '1' },
  'an old member hint': { mantle_authed: '1', mantle_member: '1' },
  'an old client hint': { mantle_authed: '1', mantle_client: '1' },
};

describe('middleware: the presence gate', () => {
  it('lets a signed-in login through to every screen', () => {
    for (const p of ['/', '/pages', '/settings/users', '/apps', '/tasks', '/n/abc', '/models']) {
      expect(location(middleware(request(p, { mantle_authed: '1' }))), p).toBeNull();
    }
  });

  it('bounces a page load with no session to /login, back to where it was', () => {
    const res = middleware(request('/pages?q=x'));
    expect(res.status).toBe(307);
    const to = new URL(location(res)!);
    expect(to.pathname).toBe('/login');
    expect(to.searchParams.get('next')).toBe('/pages?q=x');
  });

  it('a presence cookie of anything but 1 is no session', () => {
    expect(location(middleware(request('/pages', { mantle_authed: '0' })))).toMatch(
      /\/login\?next=/,
    );
  });
});

describe('middleware: public pages', () => {
  it.each(['/login', '/login?add=1', '/env.js', '/pair', '/invite?code=AbCd2345efGH6789'])(
    '%s renders with no session and with one',
    (p) => {
      for (const [who, cookies] of Object.entries(SESSIONS)) {
        expect(location(middleware(request(p, cookies))), who).toBeNull();
      }
    },
  );
});

describe('middleware: no role routing', () => {
  it('an old member or client hint sends nobody anywhere', () => {
    const hints: Record<string, string>[] = [{ mantle_member: '1' }, { mantle_client: '1' }];
    for (const hint of hints) {
      const cookies = { mantle_authed: '1', ...hint };
      for (const p of ['/', '/pages', '/settings/users', '/models', '/n/abc', '/notes/abc']) {
        expect(location(middleware(request(p, cookies))), p).toBeNull();
      }
      // /login is /login for everyone.
      expect(location(middleware(request('/login', hint)))).toBeNull();
    }
  });

  it('flags no path as a member surface', () => {
    const res = middleware(request('/pages', { mantle_authed: '1' }));
    expect(res.headers.get('x-middleware-request-x-mantle-member-surface')).toBeNull();
  });
});

describe('middleware: retired pages', () => {
  // A 307 to a fresh URL, whoever is asking: no `next`, no query (an old
  // link may hold a team code or a sign-in token), no trailing slash.
  const RETIRED: ReadonlyArray<[path: string, to: string]> = [
    ['/team', '/login'],
    ['/team/', '/login'],
    ['/team/forum/abc', '/login'],
    ['/team?code=Xy7kPq2M', '/login'],
    ['/hub', '/login'],
    ['/hub/briefing?code=Xy7kPq2M', '/login'],
    ['/client-signin', '/login'],
    ['/client-signin?token=Xy7kPq2M', '/login'],
    ['/client-signin/', '/login'],
    ['/review', '/'],
    ['/review/abc?x=Xy7kPq2M', '/'],
    ['/team-admin', '/'],
    ['/team-admin?view=shares', '/'],
    ['/apps/review', '/'],
    ['/apps/review/abc', '/'],
    ['/portal/chat', '/assistant'],
    ['/portal/chat?x=Xy7kPq2M', '/assistant'],
  ];

  for (const [who, cookies] of Object.entries(SESSIONS)) {
    for (const [path, to] of RETIRED) {
      it(`sends ${who} on ${path} to ${to}, nothing carried`, () => {
        const res = middleware(request(path, cookies));
        expect(res.status).toBe(307);
        const url = new URL(location(res)!);
        expect(url.pathname).toBe(to);
        expect(url.search).toBe('');
        expect(location(res)).not.toMatch(/Xy7kPq2M|next=/);
      });
    }
  }

  it('leaves a path that only starts with the letters to the gate', () => {
    for (const path of ['/teams', '/hubs', '/hub-app', '/reviews', '/apps/reviewer', '/apps']) {
      expect(location(middleware(request(path, { mantle_authed: '1' }))), path).toBeNull();
      expect(location(middleware(request(path))), path).toMatch(/\/login\?next=/);
    }
  });
});
