import { describe, expect, it } from 'vitest';
import { guardRedirect } from './route-guard';

/**
 * The page-load guard (was the client middleware, phase W5c): the presence
 * gate, the public pages, and the retired pages. No role routing: the role
 * hint cookies of older builds change nothing.
 */
function guard(path: string, cookies: Record<string, string> = {}): string | null {
  const url = new URL(path, 'http://client.test');
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return guardRedirect(url.pathname, url.search, header);
}

const SESSIONS: Record<string, Record<string, string>> = {
  'no session': {},
  'a signed-in login': { mantle_authed: '1' },
  'an old member hint': { mantle_authed: '1', mantle_member: '1' },
  'an old client hint': { mantle_authed: '1', mantle_client: '1' },
};

describe('guard: the presence gate', () => {
  it('lets a signed-in login through to every screen', () => {
    for (const p of ['/', '/pages', '/settings/users', '/apps', '/tasks', '/n/abc', '/models']) {
      expect(guard(p, { mantle_authed: '1' }), p).toBeNull();
    }
  });

  it('sends a page load with no session to /login, back to where it was', () => {
    const to = new URL(guard('/pages?q=x')!, 'http://client.test');
    expect(to.pathname).toBe('/login');
    expect(to.searchParams.get('next')).toBe('/pages?q=x');
  });

  it('a presence cookie of anything but 1 is no session', () => {
    expect(guard('/pages', { mantle_authed: '0' })).toMatch(/^\/login\?next=/);
  });

  it('reads the presence cookie among others, with spaces', () => {
    expect(guardRedirect('/pages', '', 'a=b;  mantle_authed=1 ; c=d')).toBeNull();
    expect(guardRedirect('/pages', '', 'not_mantle_authed=1')).toMatch(/^\/login\?next=/);
  });
});

describe('guard: public pages', () => {
  it.each(['/login', '/login?add=1', '/env.js', '/pair', '/invite?code=AbCd2345efGH6789'])(
    '%s renders with no session and with one',
    (p) => {
      for (const [who, cookies] of Object.entries(SESSIONS)) {
        expect(guard(p, cookies), who).toBeNull();
      }
    },
  );
});

describe('guard: no role routing', () => {
  it('an old member or client hint sends nobody anywhere', () => {
    const hints: Record<string, string>[] = [{ mantle_member: '1' }, { mantle_client: '1' }];
    for (const hint of hints) {
      const cookies = { mantle_authed: '1', ...hint };
      for (const p of ['/', '/pages', '/settings/users', '/models', '/n/abc', '/notes/abc']) {
        expect(guard(p, cookies), p).toBeNull();
      }
      // /login is /login for everyone.
      expect(guard('/login', hint)).toBeNull();
    }
  });
});

describe('guard: retired pages', () => {
  // A fresh URL, whoever is asking: no `next`, no query (an old link may hold
  // a team code or a sign-in token), no trailing slash.
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
    ['/lifelog', '/journal'],
    ['/memories', '/journal'],
    ['/todos', '/tasks'],
  ];

  for (const [who, cookies] of Object.entries(SESSIONS)) {
    for (const [path, to] of RETIRED) {
      it(`sends ${who} on ${path} to ${to}, nothing carried`, () => {
        expect(guard(path, cookies)).toBe(to);
      });
    }
  }

  it('leaves a path that only starts with the letters to the gate', () => {
    for (const path of ['/teams', '/hubs', '/hub-app', '/reviews', '/apps/reviewer', '/apps']) {
      expect(guard(path, { mantle_authed: '1' }), path).toBeNull();
      expect(guard(path), path).toMatch(/^\/login\?next=/);
    }
  });
});
