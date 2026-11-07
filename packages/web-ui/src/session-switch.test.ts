import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Switching between the logins a device holds. The promises under test:
 *
 *   - nothing is given up before there is something to move to: a login whose
 *     brain refuses it, or does not answer, leaves the one in use untouched;
 *   - on a same-origin box the old login's cookie is dropped BEFORE the new
 *     bearer is traded for one, because the upgrade resolves a cookie first;
 *   - a switch ends in a page load, and a sign-out lands on the next login held
 *     here rather than on the sign-in screen.
 *
 * Modules are re-imported per test: the cookie-upgrade memo, the asset token
 * and the sign-out registry are module state, which is the point.
 */

type Call = { url: string; init: RequestInit | undefined };

let map: Map<string, string>;
let calls: Call[];
let assigned: string[];
let respond: (call: Call) => { ok: boolean; status: number };

function stubWindow(opts: { apiBase?: string; vault?: boolean } = {}) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    location: {
      protocol: 'https:',
      origin: 'https://app.example',
      href: 'https://app.example/',
      assign: (to: string) => void assigned.push(to),
    },
    __MANTLE_ENV__: opts.apiBase ? { apiBase: opts.apiBase } : {},
    ...(opts.vault
      ? { mantleDesktop: { tokenVault: { get: () => 'v', set: () => {}, clear: () => {} } } }
      : {}),
  });
}

async function fresh() {
  vi.resetModules();
  const registry = await import('./session-registry');
  const switcher = await import('./session-switch');
  return { registry, switcher };
}

const paths = () => calls.map((c) => new URL(c.url, 'https://app.example').pathname);
const bearerOf = (c: Call) => new Headers(c.init?.headers).get('Authorization');

beforeEach(() => {
  map = new Map();
  calls = [];
  assigned = [];
  respond = () => ({ ok: true, status: 200 });
  stubWindow();
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return Promise.resolve(respond(call) as Response);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('switchSession · same-origin box', () => {
  it('probes with the new bearer alone, swaps, moves the cookie in order, then loads the app', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    expect(await switcher.switchSession(b.id)).toBe('switched');

    // No whoami first: there is no client login whose cookie a logout would
    // end everywhere (W8).
    expect(paths()).toEqual(['/api/shell', '/api/auth/logout', '/api/auth/sso']);
    expect(bearerOf(calls[0]!)).toBe('Bearer b.sig');
    expect(calls[0]!.init?.credentials).toBe('omit');
    // The cookie drop revokes nothing: it carries no bearer.
    expect(bearerOf(calls[1]!)).toBeNull();
    expect(bearerOf(calls[2]!)).toBe('Bearer b.sig');

    expect(map.get('mantle_token')).toBe('b.sig');
    expect(registry.activeSession()?.id).toBe(b.id);
    expect(registry.listSessions()).toHaveLength(2);
    expect(assigned).toEqual(['/']);
  });

  it('a refused login is marked, and the one in use is left exactly as it was', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'dead.sig' })!;
    const a = registry.signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    respond = () => ({ ok: false, status: 401 });

    expect(await switcher.switchSession(b.id)).toBe('needs-sign-in');

    expect(paths()).toEqual(['/api/shell']);
    expect(map.get('mantle_token')).toBe('a.sig');
    expect(registry.activeSession()?.id).toBe(a.id);
    expect(registry.sessionToken(b.id)).toBeNull();
    expect(registry.listSessions().find((s) => s.id === b.id)?.tokenExpiresAt).toBe(0);
    expect(assigned).toEqual([]);
  });

  it('a brain that does not answer changes nothing at all', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    expect(await switcher.switchSession(b.id)).toBe('unreachable');
    expect(map.get('mantle_token')).toBe('a.sig');
    expect(registry.sessionToken(b.id)).toBe('b.sig');
    expect(assigned).toEqual([]);
  });

  it('a 500 is not a refusal: the login keeps its bearer', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    respond = () => ({ ok: false, status: 500 });

    expect(await switcher.switchSession(b.id)).toBe('unreachable');
    expect(registry.sessionToken(b.id)).toBe('b.sig');
  });

  it("a member login's 403 from /api/shell is a live bearer, not a brain that is down", async () => {
    const { registry, switcher } = await fresh();
    const m = registry.signInSession({ email: 'm@example.com', token: 'm.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    respond = (call) =>
      call.url.endsWith('/api/shell')
        ? ({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ reason: 'member-login' }),
          } as unknown as { ok: boolean; status: number })
        : { ok: true, status: 200 };

    expect(await switcher.switchSession(m.id)).toBe('switched');
    expect(registry.activeSession()?.id).toBe(m.id);
  });

  it('a 403 that names no login role (a proxy, a WAF) changes nothing', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    const a = registry.signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    respond = () =>
      ({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'Forbidden' }),
      }) as unknown as { ok: boolean; status: number };

    expect(await switcher.switchSession(b.id)).toBe('unreachable');
    expect(registry.activeSession()?.id).toBe(a.id);
    expect(registry.sessionToken(b.id)).toBe('b.sig');
    expect(assigned).toEqual([]);
  });

  it("lands where the app's landing says, after the credential has moved", async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    const seen: { to: string; token: string | undefined }[] = [];
    switcher.setSwitchLanding(async (to) => {
      seen.push({ to, token: map.get('mantle_token') });
      return '/home-for-b';
    });

    expect(await switcher.switchSession(b.id)).toBe('switched');
    expect(seen).toEqual([{ to: '/', token: 'b.sig' }]);
    expect(assigned).toEqual(['/home-for-b']);
  });

  it('a landing that throws still lands, on the path asked for', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    const off = switcher.setSwitchLanding(() => Promise.reject(new Error('offline')));

    expect(await switcher.switchSession(b.id)).toBe('switched');
    expect(assigned).toEqual(['/']);
    off();
  });

  it('will not switch to a login held for a different brain', async () => {
    const { registry, switcher } = await fresh();
    const far = registry.signInSession({
      email: 'a@example.com',
      token: 'far.sig',
      origin: 'https://other.example',
    })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    expect(await switcher.switchSession(far.id)).toBe('other-brain');
    expect(calls).toEqual([]);
    expect(switcher.switchableSessions()).toEqual([]);
  });
});

describe('no client cookie check since W8 (audit B23 is moot)', () => {
  it('the kit asks no whoami and offers no client outcome', async () => {
    const { switcher } = await fresh();
    expect('sameOriginCookieRole' in switcher).toBe(false);
  });

  it('forgetting the login in use drops the cookie, asking nobody first', async () => {
    const { registry, switcher } = await fresh();
    const a = registry.signInSession({ email: 'a@example.com', token: 'a.sig' })!;

    await switcher.forgetSession(a.id);
    expect(paths()).toEqual(['/api/auth/logout']);
    expect(assigned).toEqual(['/login']);
  });
});

describe('switchSession · split client', () => {
  it('touches no cookie: the bearer is the whole credential', async () => {
    stubWindow({ apiBase: 'https://brain.example' });
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    expect(await switcher.switchSession(b.id)).toBe('switched');
    expect(calls.map((c) => c.url)).toEqual(['https://brain.example/api/shell']);
    expect(assigned).toEqual(['/']);
  });
});

describe('leaving a login', () => {
  it('signing out of the one in use lands on the next login held here', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    await switcher.signOutActive();

    expect(registry.listSessions().map((s) => s.email)).toEqual(['b@example.com']);
    expect(registry.activeSession()?.id).toBe(b.id);
    expect(map.get('mantle_token')).toBe('b.sig');
    expect(assigned).toEqual(['/']);
    // a.sig was revoked on its brain; b.sig never was.
    const revoked = calls.filter((c) => c.url.endsWith('/api/auth/mobile-logout')).map(bearerOf);
    expect(revoked).toEqual(['Bearer a.sig']);
  });

  it('with no other login to land on, it goes to the sign-in screen', async () => {
    const { registry, switcher } = await fresh();
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });
    await switcher.signOutActive();
    expect(registry.listSessions()).toEqual([]);
    expect(assigned).toEqual(['/login']);
  });

  it('signing out of a login at rest revokes it on ITS brain and disturbs nothing else', async () => {
    const { registry, switcher } = await fresh();
    const far = registry.signInSession({
      email: 'a@example.com',
      token: 'far.sig',
      origin: 'https://other.example',
    })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    await switcher.signOutSession(far.id);

    expect(calls.map((c) => c.url)).toEqual(['https://other.example/api/auth/mobile-logout']);
    expect(bearerOf(calls[0]!)).toBe('Bearer far.sig');
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(registry.listSessions()).toHaveLength(1);
    expect(map.get('mantle_token')).toBe('a.sig');
    expect(assigned).toEqual([]);
  });

  it('forgetting a login at rest tells no brain anything', async () => {
    const { registry, switcher } = await fresh();
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    registry.signInSession({ email: 'a@example.com', token: 'a.sig' });

    await switcher.forgetSession(b.id);
    expect(calls).toEqual([]);
    expect(registry.listSessions().map((s) => s.email)).toEqual(['a@example.com']);
  });
});

/** A desktop shell with one keychain slot per login (client/desktop vault.ts). */
function scopedVault() {
  const slots = new Map<string, string>();
  return {
    slots,
    get: () => null,
    set: () => {},
    clear: () => {},
    getFor: (id: string) => slots.get(id) ?? null,
    setFor: (id: string, t: string) => void slots.set(id, t),
    clearFor: (id: string) => void slots.delete(id),
    adopt: () => null,
  };
}

function stubDesktop(vault: ReturnType<typeof scopedVault>) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    // The desktop renders from a loopback UI server; the brain is elsewhere.
    location: {
      protocol: 'http:',
      origin: 'http://127.0.0.1:4173',
      href: 'http://127.0.0.1:4173/',
      assign: (to: string) => void assigned.push(to),
    },
    __MANTLE_ENV__: { apiBase: 'https://brain.example' },
    mantleDesktop: { tokenVault: vault },
  });
}

describe('desktop: admin, then a member login, then back', () => {
  it('nothing of either login is left for the other', async () => {
    const vault = scopedVault();
    stubDesktop(vault);
    vi.resetModules();
    const registry = await import('./session-registry');
    const switcher = await import('./session-switch');
    const assets = await import('./asset-url');
    const api = await import('./api-fetch');
    const { onSignOut } = await import('./session-reset');
    const { tokenStore } = await import('./token-store');

    const admin = registry.signInSession({ email: 'admin@example.com', token: 'admin.sig' })!;
    const member = registry.signInSession({
      email: 'member@example.com',
      token: 'member.sig',
      loginId: 'login-m',
    })!;
    // Bearers live in the keychain slots, never in localStorage.
    expect([...map.keys()].some((k) => k.startsWith('mantle_token'))).toBe(false);
    expect(vault.slots.get(member.id)).toBe('member.sig');
    expect(registry.listSessions().find((s) => s.id === member.id)).toMatchObject({
      loginId: 'login-m',
    });

    // The query cache stands in for every per-login thing on the sign-out
    // registry; the landing for the app's role hints.
    const cacheCleared = vi.fn();
    onSignOut(cacheCleared);
    const landings: (string | null)[] = [];
    switcher.setSwitchLanding(async (to) => {
      landings.push(tokenStore.get());
      return to;
    });
    // A brain before W5c answers /api/shell for a member bearer with its role
    // refusal: the bearer is alive (W8 answers every login 200).
    respond = (call) =>
      bearerOf(call) === 'Bearer member.sig' && call.url.endsWith('/api/shell')
        ? ({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ reason: 'member-login' }),
          } as unknown as { ok: boolean; status: number })
        : { ok: true, status: 200 };

    // Admin in use, as the member is reached: the admin's asset token is out.
    expect(registry.setActiveSession(admin.id)).toBe(true);
    assets.setAssetToken('admin-asset');
    expect(assets.assetUrl('/api/files/f')).toContain('at=admin-asset');

    expect(await switcher.switchSession(member.id)).toBe('switched');
    // No cookie route at all: cross-origin, the bearer is the whole credential,
    // so no logout and no sso.
    expect(paths()).toEqual(['/api/shell']);
    expect(calls[0]!.init?.credentials).toBe('omit');
    // As the member: the member's bearer, no cookie, no admin asset token, the
    // admin's cache dropped, and the landing saw the member's bearer.
    expect(tokenStore.get()).toBe('member.sig');
    const init = api.withAuth();
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer member.sig');
    expect(assets.assetUrl('/api/files/f')).not.toContain('at=');
    expect(cacheCleared).toHaveBeenCalledTimes(1);
    expect(landings).toEqual(['member.sig']);
    // The admin is still held, untouched.
    expect(vault.slots.get(admin.id)).toBe('admin.sig');

    // And back: the member's asset token and cache do not carry over.
    calls.length = 0;
    assets.setAssetToken('member-asset');
    expect(await switcher.switchSession(admin.id)).toBe('switched');
    expect(paths()).toEqual(['/api/shell']);
    expect(tokenStore.get()).toBe('admin.sig');
    expect(new Headers(api.withAuth().headers).get('Authorization')).toBe('Bearer admin.sig');
    expect(assets.assetUrl('/api/files/f')).not.toContain('at=');
    expect(cacheCleared).toHaveBeenCalledTimes(2);
    expect(landings).toEqual(['member.sig', 'admin.sig']);
    expect(vault.slots.get(member.id)).toBe('member.sig');
    expect(assigned).toEqual(['/', '/']);
  });

  it("a held member's Sign out ends it on the brain with its own bearer, then lands on the next login", async () => {
    const vault = scopedVault();
    stubDesktop(vault);
    vi.resetModules();
    const registry = await import('./session-registry');
    const switcher = await import('./session-switch');
    const admin = registry.signInSession({ email: 'admin@example.com', token: 'admin.sig' })!;
    const member = registry.signInSession({
      email: 'member@example.com',
      token: 'member.sig',
    })!;

    await switcher.signOutActive();

    // mobile-logout with the member's bearer ends that bearer on the brain,
    // which is what its Sign out means.
    const revoked = calls.filter((c) => c.url.endsWith('/api/auth/mobile-logout')).map(bearerOf);
    expect(revoked).toEqual(['Bearer member.sig']);
    expect(calls.every((c) => c.init?.credentials !== 'include')).toBe(true);
    expect(registry.listSessions().map((s) => s.id)).toEqual([admin.id]);
    expect(vault.slots.has(member.id)).toBe(false);
    expect(registry.activeSession()?.id).toBe(admin.id);
    expect(assigned).toEqual(['/']);
  });
});

describe('the browser', () => {
  it('can hold several logins', async () => {
    const { registry } = await fresh();
    expect(registry.canHoldSeveralLogins()).toBe(true);
  });
});

describe('the desktop shell', () => {
  it('cannot hold several logins yet, and says so', async () => {
    stubWindow({ vault: true });
    const { registry } = await fresh();
    expect(registry.canHoldSeveralLogins()).toBe(false);
    expect(registry.setActiveSession('anything')).toBe(false);
  });
});

/**
 * Sign-out with copy rows left by the burst (session-registry-burst.test.ts):
 * nameless rows holding the very bearer being signed out. Each copy used to
 * count as "the next login held here", so a sign-out probed the bearer it had
 * just revoked once per copy before it reached the sign-in screen, and left
 * every copy listed as signed out. The brain here revokes on mobile-logout
 * and answers /api/shell as a real one does: 401 for a revoked bearer, the
 * role refusal for a live member bearer (as a brain before W5c did).
 */
describe('signing out with copies of the login still listed', () => {
  const roles: Record<string, 'admin' | 'member'> = {};
  let revoked: Set<string>;

  function brain() {
    revoked = new Set();
    respond = (call) => {
      const auth = bearerOf(call)?.replace(/^Bearer /, '') ?? null;
      const path = new URL(call.url, 'https://app.example').pathname;
      if (path === '/api/auth/mobile-logout' && auth) revoked.add(auth);
      if (path !== '/api/shell' || !auth) return { ok: true, status: 200 };
      if (revoked.has(auth)) return { ok: false, status: 401 };
      const role = roles[auth] ?? 'admin';
      if (role === 'admin') return { ok: true, status: 200 };
      return {
        ok: false,
        status: 403,
        json: () => Promise.resolve({ reason: `${role}-login` }),
      } as unknown as { ok: boolean; status: number };
    };
  }

  /** Copy rows of the active login, added after the page's load-time repair. */
  function addCopies(
    registry: typeof import('./session-registry'),
    token: string,
    n: number,
    vault?: ReturnType<typeof scopedVault>,
  ) {
    registry.listSessions(); // the load-time repair has run
    const list = JSON.parse(map.get('mantle_sessions')!) as unknown[];
    for (let i = 0; i < n; i++) {
      const id = `copy${i}`;
      list.push({
        id,
        origin: registry.currentBrainOrigin(),
        email: '',
        addedAt: 1,
        lastUsedAt: 2e12,
      });
      if (vault) vault.slots.set(id, token);
      else map.set(`mantle_token:${id}`, token);
    }
    map.set('mantle_sessions', JSON.stringify(list));
  }

  const probedWith = (token: string) =>
    calls.filter((c) => c.url.endsWith('/api/shell') && bearerOf(c) === `Bearer ${token}`);

  for (const role of ['admin', 'member'] as const) {
    it(`${role}: with no other login, goes straight to the sign-in screen and lists nothing`, async () => {
      brain();
      roles['me.sig'] = role;
      const { registry, switcher } = await fresh();
      registry.signInSession({ email: 'me@example.com', token: 'me.sig' });
      addCopies(registry, 'me.sig', 3);

      await switcher.signOutActive();

      expect(probedWith('me.sig')).toEqual([]);
      expect(registry.listSessions()).toEqual([]);
      expect([...map.keys()].filter((k) => k.startsWith('mantle_token'))).toEqual([]);
      expect(assigned).toEqual(['/login']);
    });

    it(`${role}: with another login held, lands on it with a page load`, async () => {
      brain();
      roles['me.sig'] = role;
      roles['other.sig'] = 'member';
      const { registry, switcher } = await fresh();
      const other = registry.signInSession({ email: 'other@example.com', token: 'other.sig' })!;
      registry.signInSession({ email: 'me@example.com', token: 'me.sig' });
      addCopies(registry, 'me.sig', 3);

      await switcher.signOutActive();

      expect(probedWith('me.sig')).toEqual([]);
      expect(registry.listSessions().map((s) => s.id)).toEqual([other.id]);
      expect(registry.activeSession()?.id).toBe(other.id);
      expect(map.get('mantle_token')).toBe('other.sig');
      expect(assigned).toEqual(['/']);
    });
  }

  it('member in the desktop shell: copies in the keychain go too, and it lands on the sign-in screen', async () => {
    brain();
    roles['member.sig'] = 'member';
    const vault = scopedVault();
    stubDesktop(vault);
    const { registry, switcher } = await fresh();
    registry.signInSession({ email: 'm@example.com', token: 'member.sig' });
    addCopies(registry, 'member.sig', 3, vault);

    await switcher.signOutActive();

    expect(probedWith('member.sig')).toEqual([]);
    expect(registry.listSessions()).toEqual([]);
    expect(vault.slots.size).toBe(0);
    expect(assigned).toEqual(['/login']);
  });

  it('member in the desktop shell, an admin held too: lands on the admin', async () => {
    brain();
    roles['member.sig'] = 'member';
    const vault = scopedVault();
    stubDesktop(vault);
    const { registry, switcher } = await fresh();
    const admin = registry.signInSession({ email: 'admin@example.com', token: 'admin.sig' })!;
    registry.signInSession({ email: 'm@example.com', token: 'member.sig' });
    addCopies(registry, 'member.sig', 3, vault);

    await switcher.signOutActive();

    expect(probedWith('member.sig')).toEqual([]);
    expect(registry.listSessions().map((s) => s.id)).toEqual([admin.id]);
    expect(assigned).toEqual(['/']);
  });

  /** Run `onChange` on this tab's SESSIONS_CHANGED_EVENT, as a screen would. */
  function listen(onChange: () => void) {
    const w = window as unknown as Record<string, unknown>;
    w.dispatchEvent = (e: Event) => {
      if (e.type === 'mantle:sessions') onChange();
      return true;
    };
  }

  /** Another tab lists a row the moment this tab has forgotten the login. */
  function relistAfterForget(
    registry: typeof import('./session-registry'),
    late: object,
    token: string,
  ) {
    let done = false;
    listen(() => {
      const list = JSON.parse(map.get('mantle_sessions') ?? '[]') as { email: string }[];
      if (done || list.some((s) => s.email === 'me@example.com')) return;
      done = true;
      map.set('mantle_sessions', JSON.stringify([...list, late]));
      map.set('mantle_token:late', token);
    });
    return () => done;
  }

  it('a row holding the revoked bearer, listed again mid-sign-out, is never landed on', async () => {
    brain();
    const { registry, switcher } = await fresh();
    registry.signInSession({ email: 'me@example.com', token: 'me.sig' });
    registry.listSessions();
    const origin = registry.currentBrainOrigin();
    const relisted = relistAfterForget(
      registry,
      { id: 'late', origin, email: 'named@example.com', addedAt: 1, lastUsedAt: 3e12 },
      'me.sig',
    );

    await switcher.signOutActive();

    expect(relisted()).toBe(true);
    expect(registry.listSessions().map((s) => s.id)).toContain('late');
    expect(probedWith('me.sig')).toEqual([]);
    expect(assigned).toEqual(['/login']);
  });

  it('a nameless row with a rotated bearer, listed again mid-sign-out, is never landed on', async () => {
    brain();
    const { registry, switcher } = await fresh();
    registry.signInSession({ email: 'me@example.com', token: tok('u1', 'live') });
    registry.listSessions();
    const origin = registry.currentBrainOrigin();
    const relisted = relistAfterForget(
      registry,
      { id: 'late', origin, email: '', addedAt: 1, lastUsedAt: 3e12 },
      tok('u1', 'rotated'),
    );

    await switcher.signOutActive();

    expect(relisted()).toBe(true);
    expect(probedWith(tok('u1', 'rotated'))).toEqual([]);
    expect(assigned).toEqual(['/login']);
  });

  it('member with rotated copies: every copy bearer is revoked too, and it lands on the other login', async () => {
    brain();
    roles[tok('u1', 'live')] = 'member';
    roles['other.sig'] = 'member';
    const { registry, switcher } = await fresh();
    const other = registry.signInSession({ email: 'other@example.com', token: 'other.sig' })!;
    registry.signInSession({ email: 'me@example.com', token: tok('u1', 'live') });
    registry.listSessions(); // the load-time repair has run
    const list = JSON.parse(map.get('mantle_sessions')!) as unknown[];
    for (const jti of ['old1', 'old2']) {
      list.push({
        id: jti,
        origin: registry.currentBrainOrigin(),
        email: '',
        addedAt: 1,
        lastUsedAt: 3e12,
      });
      map.set(`mantle_token:${jti}`, tok('u1', jti));
    }
    map.set('mantle_sessions', JSON.stringify(list));

    await switcher.signOutActive();

    const revokedWith = calls
      .filter((c) => c.url.endsWith('/api/auth/mobile-logout'))
      .map(bearerOf);
    expect(revokedWith).toEqual([
      `Bearer ${tok('u1', 'live')}`,
      `Bearer ${tok('u1', 'old1')}`,
      `Bearer ${tok('u1', 'old2')}`,
    ]);
    for (const jti of ['live', 'old1', 'old2']) expect(probedWith(tok('u1', jti))).toEqual([]);
    expect(registry.listSessions().map((s) => s.id)).toEqual([other.id]);
    expect(assigned).toEqual(['/']);
  });

  it('signing out of the admin neither revokes nor forgets a member that shares its anchor id', async () => {
    brain();
    const admin = tok('anchor', 'a1');
    const member = tok('anchor', 'm1', 'member-login');
    roles[member] = 'member';
    const { registry, switcher } = await fresh();
    registry.signInSession({ email: 'a@example.com', token: admin });
    registry.listSessions(); // the load-time repair has run
    const list = JSON.parse(map.get('mantle_sessions')!) as unknown[];
    list.push({
      id: 'member',
      origin: registry.currentBrainOrigin(),
      email: '',
      addedAt: 1,
      lastUsedAt: 1,
    });
    map.set('mantle_sessions', JSON.stringify(list));
    map.set('mantle_token:member', member);

    await switcher.signOutActive();

    const revokedWith = calls
      .filter((c) => c.url.endsWith('/api/auth/mobile-logout'))
      .map(bearerOf);
    expect(revokedWith).toEqual([`Bearer ${admin}`]);
    expect(registry.listSessions().map((s) => s.id)).toEqual(['member']);
    expect(registry.sessionToken('member')).toBe(member);
    // Nameless, so not landed on automatically: the sign-in screen.
    expect(assigned).toEqual(['/login']);
  });

  it('another tab switching logins while the revoke is in flight keeps that login, unrevoked', async () => {
    brain();
    const { registry } = await fresh();
    const { performSignOut } = await import('./sign-out');
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    const me = registry.signInSession({ email: 'me@example.com', token: 'me.sig' })!;
    const inner = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        // The other tab's switch lands in shared storage mid-sign-out.
        if (String(url).endsWith('/api/auth/mobile-logout')) registry.setActiveSession(b.id);
        return inner(url, init);
      }),
    );

    await performSignOut();

    expect(registry.listSessions().map((s) => s.id)).toEqual([b.id]);
    expect(registry.activeSession()?.id).toBe(b.id);
    expect(registry.sessionToken(b.id)).toBe('b.sig');
    expect(map.get('mantle_token')).toBe('b.sig');
    expect(map.has(`mantle_token:${me.id}`)).toBe(false);
    const revokedWith = calls
      .filter((c) => c.url.endsWith('/api/auth/mobile-logout'))
      .map(bearerOf);
    expect(revokedWith).toEqual(['Bearer me.sig']);
  });
});

/** A bearer of the brain's shape, naming its login (`uid`) and its own id. */
function tok(uid: string, jti: string, act?: string): string {
  const payload = btoa(JSON.stringify({ uid, jti, exp: 2_000_000_000, ...(act ? { act } : {}) }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${payload}.sig`;
}

describe('the login-change guard (an agent drives the window)', () => {
  it('a switch, a sign-out and a forget do nothing at all while it says so', async () => {
    const { registry, switcher } = await fresh();
    const guard = await import('./login-change-guard');
    const signOut = await import('./sign-out');
    const b = registry.signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    const a = registry.signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    guard.setLoginChangeGuard(() => true);

    expect(await switcher.switchSession(b.id)).toBe('unavailable');
    await switcher.signOutActive();
    await switcher.signOutSession(b.id);
    await switcher.forgetSession(b.id);
    await signOut.performSignOut();

    expect(calls).toEqual([]);
    expect(assigned).toEqual([]);
    expect(map.get('mantle_token')).toBe('a.sig');
    expect(registry.activeSession()?.id).toBe(a.id);
    expect(registry.listSessions()).toHaveLength(2);

    // Once the agent stops (or the user takes over), it runs as ever.
    guard.setLoginChangeGuard(() => false);
    expect(await switcher.switchSession(b.id)).toBe('switched');
    guard.setLoginChangeGuard(null);
  });

  it('a guard that throws does not block', async () => {
    await fresh();
    const guard = await import('./login-change-guard');
    guard.setLoginChangeGuard(() => {
      throw new Error('x');
    });
    expect(guard.loginChangeBlocked()).toBe(false);
    guard.setLoginChangeGuard(null);
  });
});
