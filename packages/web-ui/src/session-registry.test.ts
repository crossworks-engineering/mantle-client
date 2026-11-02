import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeSession,
  dropActiveCredential,
  listSessions,
  recordActiveIdentity,
  removeSession,
  sessionToken,
  sessionTokenKey,
  setSessionToken,
  signInSession,
} from './session-registry';
import { tokenStore } from './token-store';

/**
 * The logins a device holds. Two promises are tested harder than the rest:
 *
 *   - the upgrade signs nobody out: a device that arrives holding the single
 *     `mantle_token` slot (every shipped build, and the e2e suite, which seeds
 *     that key directly) is still signed in afterwards, with the same bearer
 *     under the same name;
 *   - one login's trouble is its own: a refusal, a sign-out or a rotation
 *     touches that session and no other.
 *
 * `environment: 'node'`, so `window` and `document` are stubbed to the narrow
 * shape the modules touch, as token-store.test.ts does.
 */

type Vault = { get: () => string | null; set: (t: string) => void; clear: () => void };

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function fakeVault(initial: string | null = null): Vault & { value: string | null } {
  const v = {
    value: initial,
    get: () => v.value,
    set: (t: string) => {
      v.value = t;
    },
    clear: () => {
      v.value = null;
    },
  };
  return v;
}

function setup(
  opts: {
    storage?: ReturnType<typeof fakeStorage>;
    vault?: Vault;
    origin?: string;
    apiBase?: string;
  } = {},
) {
  const storage = opts.storage ?? fakeStorage();
  const origin = opts.origin ?? 'https://brain.example';
  const cookies: string[] = [];
  vi.stubGlobal('window', {
    localStorage: storage,
    location: { protocol: 'https:', origin, href: `${origin}/` },
    __MANTLE_ENV__: opts.apiBase ? { apiBase: opts.apiBase } : {},
    ...(opts.vault ? { mantleDesktop: { tokenVault: opts.vault } } : {}),
  });
  vi.stubGlobal('document', {
    set cookie(v: string) {
      cookies.push(v);
    },
    get cookie() {
      return cookies.join('; ');
    },
  });
  return { storage, cookies };
}

/** A bearer of the brain's shape: base64url(payload) + '.' + signature. */
function bearer(exp: number, tag = 'a'): string {
  const payload = btoa(JSON.stringify({ exp, tag })).replace(/\+/g, '-').replace(/\//g, '_');
  return `${payload}.signature`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upgrade from the single slot · nobody is signed out', () => {
  it('lists a bearer it finds in mantle_token, and leaves it exactly where it was', () => {
    const token = bearer(2_000_000_000);
    const { storage } = setup({ storage: fakeStorage({ mantle_token: token }) });

    expect(tokenStore.get()).toBe(token);
    expect(storage.map.get('mantle_token')).toBe(token);

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      origin: 'https://brain.example',
      email: '',
      tokenExpiresAt: 2_000_000_000,
    });
    expect(activeSession()?.id).toBe(sessions[0]!.id);
    expect(storage.map.get(sessionTokenKey(sessions[0]!.id))).toBe(token);
  });

  it('does it once: reading again adds nothing', () => {
    setup({ storage: fakeStorage({ mantle_token: bearer(2_000_000_000) }) });
    tokenStore.get();
    tokenStore.get();
    expect(listSessions()).toHaveLength(1);
  });

  it('names the brain by the API origin when the client is served from somewhere else', () => {
    setup({
      storage: fakeStorage({ mantle_token: 'x.y' }),
      origin: 'https://app.example',
      apiBase: 'https://brain.example/',
    });
    expect(listSessions()[0]?.origin).toBe('https://brain.example');
  });

  it('learns the login from /api/shell on the next boot', () => {
    setup({ storage: fakeStorage({ mantle_token: 'x.y' }) });
    recordActiveIdentity({ email: 'owner@example.com', displayName: 'Owner', siteName: 'Brain' });
    expect(activeSession()).toMatchObject({
      email: 'owner@example.com',
      displayName: 'Owner',
      siteName: 'Brain',
    });
  });

  it('leaves a cookie-only login alone: no bearer, no session, nothing written', () => {
    const { storage } = setup();
    expect(tokenStore.get()).toBeNull();
    recordActiveIdentity({ email: 'owner@example.com' });
    expect(listSessions()).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('inside the desktop shell, lists the vault bearer without copying it to localStorage', () => {
    const vault = fakeVault('vaulted.token');
    const { storage } = setup({ vault });

    expect(tokenStore.get()).toBe('vaulted.token');
    const [session] = listSessions();
    expect(session).toBeDefined();
    expect(sessionToken(session!.id)).toBe('vaulted.token');
    expect([...storage.map.values()].some((v) => v.includes('vaulted.token'))).toBe(false);
  });

  it('survives a list it cannot parse: the bearer still signs in and is listed afresh', () => {
    const { storage } = setup({
      storage: fakeStorage({ mantle_token: 'x.y', mantle_sessions: '{not json' }),
    });
    expect(tokenStore.get()).toBe('x.y');
    expect(listSessions()).toHaveLength(1);
    expect(storage.map.get('mantle_token')).toBe('x.y');
  });
});

describe('an older build open in another tab', () => {
  it('adopts a bearer that tab rotated into mantle_token', () => {
    const { storage } = setup();
    const s = signInSession({ email: 'owner@example.com', token: 'first.sig' })!;
    storage.map.set('mantle_token', 'rotated.sig');

    expect(tokenStore.get()).toBe('rotated.sig');
    expect(sessionToken(s.id)).toBe('rotated.sig');
    expect(listSessions()).toHaveLength(1);
  });

  it('honours that tab signing out: the per-session copy does not outlive it', () => {
    const { storage } = setup();
    const s = signInSession({ email: 'owner@example.com', token: 'first.sig' })!;
    storage.map.delete('mantle_token');

    expect(tokenStore.get()).toBeNull();
    expect(storage.map.has(sessionTokenKey(s.id))).toBe(false);
    expect(activeSession()).toBeNull();
  });
});

describe('a role stored by an older build (phase W5c)', () => {
  it('is ignored: the login is listed and signed in as before, and nothing names a role', () => {
    const token = bearer(2_000_000_000);
    const row = {
      id: 'old',
      origin: 'https://brain.example',
      email: 'c@example.com',
      role: 'client',
      addedAt: 1000,
      lastUsedAt: 1000,
    };
    setup({
      storage: fakeStorage({
        mantle_sessions: JSON.stringify([row]),
        mantle_active_session: 'old',
        mantle_token: token,
        [sessionTokenKey('old')]: token,
      }),
    });
    expect(listSessions().map((s) => s.id)).toEqual(['old']);
    expect(activeSession()?.email).toBe('c@example.com');
    expect(tokenStore.get()).toBe(token);
    // The type has no role: a caller cannot branch on it (typecheck).
    const s = activeSession()!;
    // @ts-expect-error Session has no role since phase W5c.
    void s.role;
  });
});

describe('signing in', () => {
  it('holds the login as the active session and mirrors its bearer into mantle_token', () => {
    const { storage, cookies } = setup();
    tokenStore.signIn({ email: 'owner@example.com', token: bearer(2_000_000_000) });

    const s = activeSession();
    expect(s).toMatchObject({ email: 'owner@example.com', origin: 'https://brain.example' });
    expect(storage.map.get('mantle_token')).toBe(bearer(2_000_000_000));
    expect(JSON.parse(storage.map.get('mantle_pref:mantle_authed') ?? '{}').v).toBe('1');
    expect(cookies).toEqual([]);
  });

  it('signing in again as the same login refreshes its row instead of adding one', () => {
    setup();
    const a = signInSession({ email: 'Owner@Example.com', token: 'one.sig' })!;
    const b = signInSession({ email: 'owner@example.com', token: 'two.sig' })!;
    expect(b.id).toBe(a.id);
    expect(listSessions()).toHaveLength(1);
    expect(sessionToken(a.id)).toBe('two.sig');
  });

  it('keeps two logins on one brain, and the same email on two brains, apart', () => {
    setup();
    signInSession({ email: 'a@example.com', token: 'a.sig' });
    signInSession({ email: 'b@example.com', token: 'b.sig' });
    signInSession({ email: 'a@example.com', token: 'c.sig', origin: 'https://other.example' });
    expect(listSessions()).toHaveLength(3);
    expect(activeSession()).toMatchObject({ origin: 'https://other.example' });
    expect(tokenStore.get()).toBe('c.sig');
  });

  it('inside the desktop shell, holds only the login its one vault slot can back', () => {
    const vault = fakeVault();
    setup({ vault });
    signInSession({ email: 'a@example.com', token: 'a.sig' });
    signInSession({ email: 'b@example.com', token: 'b.sig' });
    expect(listSessions().map((s) => s.email)).toEqual(['b@example.com']);
    expect(vault.value).toBe('b.sig');
  });
});

describe('one login at a time', () => {
  it('a rotation lands on the active session and its mirror, nowhere else', () => {
    const { storage } = setup();
    const idle = signInSession({ email: 'idle@example.com', token: 'idle.sig' })!;
    const active = signInSession({ email: 'active@example.com', token: 'old.sig' })!;

    tokenStore.set('new.sig');
    expect(sessionToken(active.id)).toBe('new.sig');
    expect(storage.map.get('mantle_token')).toBe('new.sig');
    expect(sessionToken(idle.id)).toBe('idle.sig');
  });

  it('rotating an idle session never touches the active bearer', () => {
    const { storage } = setup();
    const idle = signInSession({ email: 'idle@example.com', token: 'idle.sig' })!;
    signInSession({ email: 'active@example.com', token: 'active.sig' });

    setSessionToken(idle.id, bearer(2_000_000_000));
    expect(storage.map.get('mantle_token')).toBe('active.sig');
    expect(listSessions().find((s) => s.id === idle.id)?.tokenExpiresAt).toBe(2_000_000_000);
  });

  it('a refused bearer keeps its row, marked as needing a sign-in, and spares the others', () => {
    const { storage, cookies } = setup();
    const idle = signInSession({ email: 'idle@example.com', token: 'idle.sig' })!;
    const active = signInSession({ email: 'active@example.com', token: 'dead.sig' })!;

    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
    expect(storage.map.has(sessionTokenKey(active.id))).toBe(false);
    expect(cookies.at(-1)).toContain('Max-Age=0');
    expect(listSessions().find((s) => s.id === active.id)?.tokenExpiresAt).toBe(0);
    expect(sessionToken(idle.id)).toBe('idle.sig');
    // Nothing is switched to behind the person's back.
    expect(activeSession()).toBeNull();
  });

  it('a refused bearer that never learned its login leaves no nameless row behind', () => {
    setup({ storage: fakeStorage({ mantle_token: 'x.y' }) });
    dropActiveCredential();
    expect(listSessions()).toEqual([]);
  });

  it('signing back in to a refused login revives its row', () => {
    setup();
    const s = signInSession({ email: 'owner@example.com', token: 'dead.sig' })!;
    tokenStore.clear();
    const again = signInSession({ email: 'owner@example.com', token: bearer(2_000_000_000) })!;
    expect(again.id).toBe(s.id);
    expect(again.tokenExpiresAt).toBe(2_000_000_000);
    expect(listSessions()).toHaveLength(1);
  });

  it('a migrated bearer that turns out to be an already-listed login folds into one row', () => {
    const { storage } = setup();
    signInSession({ email: 'owner@example.com', token: 'dead.sig' });
    tokenStore.clear();
    // an older build signs the same person back in: only the mirror is written
    storage.map.set('mantle_token', 'fresh.sig');
    tokenStore.get();
    recordActiveIdentity({ email: 'owner@example.com' });

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessionToken(sessions[0]!.id)).toBe('fresh.sig');
  });

  it('removing a session forgets its row and bearer; removing the active one clears the mirror', () => {
    const { storage } = setup();
    const idle = signInSession({ email: 'idle@example.com', token: 'idle.sig' })!;
    const active = signInSession({ email: 'active@example.com', token: 'active.sig' })!;

    removeSession(idle.id);
    expect(storage.map.get('mantle_token')).toBe('active.sig');
    removeSession(active.id);
    expect(storage.map.has('mantle_token')).toBe(false);
    expect(listSessions()).toEqual([]);
  });
});

describe('hostile environments', () => {
  it('is inert on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(listSessions()).toEqual([]);
    expect(activeSession()).toBeNull();
    expect(signInSession({ email: 'a@example.com', token: 't' })).toBeNull();
    expect(() => dropActiveCredential()).not.toThrow();
  });

  it('never throws on a storage that throws on access', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('window', {
      localStorage: { getItem: boom, setItem: boom, removeItem: boom },
      location: {
        protocol: 'https:',
        origin: 'https://brain.example',
        href: 'https://brain.example/',
      },
    });
    expect(() => signInSession({ email: 'a@example.com', token: 't' })).not.toThrow();
    expect(() => recordActiveIdentity({ email: 'a@example.com' })).not.toThrow();
    expect(() => removeSession('x')).not.toThrow();
    expect(listSessions()).toEqual([]);
  });
});
