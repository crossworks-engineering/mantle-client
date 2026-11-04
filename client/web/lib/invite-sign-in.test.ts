import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing in after an accepted invite (signInAfterInvite). The promises:
 *
 *   - a bearer from /api/auth/token is held as a login of its own
 *     (tokenStore.signIn), and the login that was in use keeps its bearer;
 *   - split with no bearer, nothing in the store changes and the person is
 *     told to sign in at /login;
 *   - same-origin with no bearer, the accept's cookie is the session: the old
 *     bearer goes and the presence flag is set (main's cookie fallback).
 *
 * The real token store and session registry run over a fake localStorage, so
 * "untouched" is checked on the stored keys themselves. Modules are fresh per
 * test: the registry's state lives in them.
 */

type Call = { url: string; init: RequestInit | undefined };

let map: Map<string, string>;
let calls: Call[];
let tokenAnswer: () => Promise<Response>;

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
const refused = () =>
  Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);

beforeEach(() => {
  map = new Map();
  calls = [];
  tokenAnswer = () => ok({ token: 'member.sig' });
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    location: { protocol: 'https:', origin: 'https://app.example', href: 'https://app.example/' },
    __MANTLE_ENV__: {},
  });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return tokenAnswer();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fresh modules, with an admin already signed in on this browser. */
async function withAdminSignedIn() {
  vi.resetModules();
  const registry = await import('@mantle/web-ui/session-registry');
  const { tokenStore } = await import('@mantle/web-ui/token-store');
  const { signInAfterInvite } = await import('./invite-sign-in');
  const admin = registry.signInSession({ email: 'admin@example.com', token: 'admin.sig' })!;
  const spies = {
    signIn: vi.spyOn(tokenStore, 'signIn'),
    set: vi.spyOn(tokenStore, 'set'),
    clear: vi.spyOn(tokenStore, 'clear'),
    markPresence: vi.spyOn(tokenStore, 'markPresence'),
  };
  return { registry, signInAfterInvite, admin, spies };
}

describe('signInAfterInvite · company sign-in required', () => {
  it('a login that must link gets its held ticket, and nothing else changes', async () => {
    const { signInAfterInvite, spies } = await withAdminSignedIn();
    tokenAnswer = () =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({ error: 'Link first.', code: 'sso-link-required', ticket: 'held.t' }),
      } as Response);

    expect(await signInAfterInvite('m@example.com', 'pw-12345678', false)).toEqual({
      kind: 'held',
      ticket: 'held.t',
    });
    // The admin who holds this browser stays: no bearer dropped, no presence set.
    expect(spies.clear).not.toHaveBeenCalled();
    expect(spies.markPresence).not.toHaveBeenCalled();
    expect(spies.signIn).not.toHaveBeenCalled();
  });
});

describe('signInAfterInvite · split', () => {
  it('holds the member bearer as a login of its own; the admin keeps theirs', async () => {
    const { registry, signInAfterInvite, admin, spies } = await withAdminSignedIn();

    expect(await signInAfterInvite('m@example.com', 'pw-12345678', true)).toEqual({
      kind: 'bearer',
    });

    expect(spies.signIn).toHaveBeenCalledWith({ email: 'm@example.com', token: 'member.sig' });
    expect(spies.set).not.toHaveBeenCalled();
    expect(spies.clear).not.toHaveBeenCalled();
    // The exchange: the new credentials, as JSON, no cookie.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/auth\/token$/);
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      email: 'm@example.com',
      password: 'pw-12345678',
    });
    // The admin's row and bearer are exactly as they were; the member is active.
    expect(map.get(registry.sessionTokenKey(admin.id))).toBe('admin.sig');
    expect(registry.sessionToken(admin.id)).toBe('admin.sig');
    expect(registry.activeSession()?.email).toBe('m@example.com');
    expect(map.get('mantle_token')).toBe('member.sig');
    expect(registry.listSessions().map((s) => s.email)).toEqual([
      'admin@example.com',
      'm@example.com',
    ]);
  });

  it('with no bearer: the person is sent to /login, and the store is not touched', async () => {
    const { registry, signInAfterInvite, admin, spies } = await withAdminSignedIn();
    tokenAnswer = refused;
    const before = new Map(map);

    const out = await signInAfterInvite('m@example.com', 'pw-12345678', true);

    expect(out.kind).toBe('sign-in-at-login');
    expect(out.kind === 'sign-in-at-login' && out.message).toContain('m@example.com');
    expect(spies.signIn).not.toHaveBeenCalled();
    expect(spies.set).not.toHaveBeenCalled();
    expect(spies.clear).not.toHaveBeenCalled();
    expect(spies.markPresence).not.toHaveBeenCalled();
    expect(map).toEqual(before);
    expect(registry.activeSession()?.id).toBe(admin.id);
  });

  it('a network failure is the same as no bearer', async () => {
    const { signInAfterInvite, spies } = await withAdminSignedIn();
    tokenAnswer = () => Promise.reject(new TypeError('offline'));

    expect((await signInAfterInvite('m@example.com', 'pw-12345678', true)).kind).toBe(
      'sign-in-at-login',
    );
    expect(spies.signIn).not.toHaveBeenCalled();
    expect(spies.clear).not.toHaveBeenCalled();
  });
});

describe('signInAfterInvite · same-origin', () => {
  it('holds the member bearer too, and clears nothing', async () => {
    const { registry, signInAfterInvite, admin, spies } = await withAdminSignedIn();

    expect(await signInAfterInvite('m@example.com', 'pw-12345678', false)).toEqual({
      kind: 'bearer',
    });

    expect(spies.signIn).toHaveBeenCalledWith({ email: 'm@example.com', token: 'member.sig' });
    expect(spies.clear).not.toHaveBeenCalled();
    expect(registry.sessionToken(admin.id)).toBe('admin.sig');
    expect(registry.activeSession()?.email).toBe('m@example.com');
  });

  it("with no bearer, falls back to the accept's cookie: clear() and markPresence()", async () => {
    const { signInAfterInvite, spies } = await withAdminSignedIn();
    tokenAnswer = refused;

    expect(await signInAfterInvite('m@example.com', 'pw-12345678', false)).toEqual({
      kind: 'cookie',
    });

    expect(spies.signIn).not.toHaveBeenCalled();
    expect(spies.clear).toHaveBeenCalledTimes(1);
    expect(spies.markPresence).toHaveBeenCalledTimes(1);
    // clear() then markPresence(), in that order: presence is what is left.
    expect(spies.clear.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.markPresence.mock.invocationCallOrder[0]!,
    );
    expect(map.has('mantle_token')).toBe(false);
    expect(JSON.parse(map.get('mantle_pref:mantle_authed') ?? '{}').v).toBe('1');
  });

  it('a 200 with no token in it is no bearer', async () => {
    const { signInAfterInvite, spies } = await withAdminSignedIn();
    tokenAnswer = () => ok({});

    expect((await signInAfterInvite('m@example.com', 'pw-12345678', false)).kind).toBe('cookie');
    expect(spies.signIn).not.toHaveBeenCalled();
  });
});
