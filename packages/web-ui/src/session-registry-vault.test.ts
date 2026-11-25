import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeSession,
  canHoldSeveralLogins,
  listSessions,
  removeSession,
  sessionToken,
  setActiveSession,
  setSessionToken,
  signInSession,
} from './session-registry';
import { tokenStore } from './token-store';

/**
 * The registry inside a desktop shell whose vault keeps one bearer PER LOGIN.
 * What differs from the browser, and is pinned here:
 *
 *   - no bearer is ever written to localStorage, not per login and not as a
 *     mirror: the vault answers for whichever login is active;
 *   - the first run after the shell update adopts the one-slot bearer into the
 *     login it belongs to, whether or not that login was already listed, and
 *     the person stays signed in throughout;
 *   - a brain window can now hold, and switch between, several logins.
 *
 * The fake mirrors the real shell's contract (client/tauri/src/vault.rs):
 * `adopt` moves the one slot to a login that has none and returns the bearer.
 */

function fakeScopedVault(legacy: string | null = null) {
  const slots = new Map<string, string>();
  const v = {
    slots,
    legacy,
    get: () => v.legacy,
    set: (t: string) => {
      v.legacy = t;
    },
    clear: () => {
      v.legacy = null;
    },
    getFor: (id: string) => slots.get(id) ?? null,
    setFor: (id: string, t: string) => void slots.set(id, t),
    clearFor: (id: string) => void slots.delete(id),
    adopt: (id: string) => {
      if (slots.has(id)) return slots.get(id)!;
      if (v.legacy === null) return null;
      slots.set(id, v.legacy);
      v.legacy = null;
      return slots.get(id)!;
    },
  };
  return v;
}

function setup(vault: ReturnType<typeof fakeScopedVault>, seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    location: {
      protocol: 'http:',
      origin: 'http://127.0.0.1:4173',
      href: 'http://127.0.0.1:4173/',
    },
    __MANTLE_ENV__: { apiBase: 'https://brain.example' },
    mantleDesktop: { tokenVault: vault },
  });
  vi.stubGlobal('document', { cookie: '' });
  return map;
}

const holdsABearer = (map: Map<string, string>) =>
  [...map.entries()].some(([k, v]) => k.startsWith('mantle_token') || v.includes('.sig'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the first run after the shell update', () => {
  it('a bearer in the one slot, nothing listed: it is listed, adopted, and still signs in', () => {
    const vault = fakeScopedVault('legacy.sig');
    const map = setup(vault);

    expect(tokenStore.get()).toBe('legacy.sig');

    const [session] = listSessions();
    expect(session).toMatchObject({ origin: 'https://brain.example', email: '' });
    expect(vault.slots.get(session!.id)).toBe('legacy.sig');
    expect(vault.legacy).toBeNull();
    expect(holdsABearer(map)).toBe(false);
    // And again, from the login's own slot now.
    expect(tokenStore.get()).toBe('legacy.sig');
    expect(listSessions()).toHaveLength(1);
  });

  it('a login already listed by the one-slot build adopts the bearer under ITS id', () => {
    // The state phase 0 leaves behind inside an older shell: a row and an
    // active id in localStorage, the bearer in the one slot.
    const vault = fakeScopedVault('legacy.sig');
    setup(vault, {
      mantle_sessions: JSON.stringify([
        {
          id: 'held-1',
          origin: 'https://brain.example',
          email: 'owner@example.com',
          addedAt: 1,
          lastUsedAt: 1,
        },
      ]),
      mantle_active_session: 'held-1',
    });

    expect(tokenStore.get()).toBe('legacy.sig');
    expect(vault.slots.get('held-1')).toBe('legacy.sig');
    expect(vault.legacy).toBeNull();
    expect(listSessions()).toHaveLength(1);
    expect(activeSession()?.email).toBe('owner@example.com');
  });

  it('a plaintext bearer from before there was any vault still ends up in the keychain', () => {
    const vault = fakeScopedVault();
    const map = setup(vault, { mantle_token: 'ancient.sig' });

    expect(tokenStore.get()).toBe('ancient.sig');
    expect(holdsABearer(map)).toBe(false);
    expect([...vault.slots.values()]).toEqual(['ancient.sig']);
  });

  it('a shell with slots but no adopt is handled by copy, then emptying the one slot', () => {
    const vault = fakeScopedVault('legacy.sig');
    // @ts-expect-error a shell that predates `adopt`
    delete vault.adopt;
    setup(vault);

    expect(tokenStore.get()).toBe('legacy.sig');
    expect([...vault.slots.values()]).toEqual(['legacy.sig']);
    expect(vault.legacy).toBeNull();
  });
});

describe('several logins in one brain window', () => {
  it('can hold them, each in its own slot, with nothing in localStorage', () => {
    const vault = fakeScopedVault();
    const map = setup(vault);
    expect(canHoldSeveralLogins()).toBe(true);

    const a = signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    const b = signInSession({ email: 'b@example.com', token: 'b.sig' })!;

    expect(listSessions()).toHaveLength(2);
    expect(vault.slots.get(a.id)).toBe('a.sig');
    expect(vault.slots.get(b.id)).toBe('b.sig');
    expect(tokenStore.get()).toBe('b.sig');
    expect(holdsABearer(map)).toBe(false);
  });

  it('switching makes the vault answer for the other login: no mirror to update', () => {
    const vault = fakeScopedVault();
    const map = setup(vault);
    const a = signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    signInSession({ email: 'b@example.com', token: 'b.sig' });

    expect(setActiveSession(a.id)).toBe(true);
    expect(tokenStore.get()).toBe('a.sig');
    expect(holdsABearer(map)).toBe(false);
  });

  it('rotates an idle login in place, which the one-slot shell never could', () => {
    const vault = fakeScopedVault();
    setup(vault);
    const idle = signInSession({ email: 'idle@example.com', token: 'idle.sig' })!;
    signInSession({ email: 'active@example.com', token: 'active.sig' });

    setSessionToken(idle.id, 'idle-rotated.sig');
    expect(sessionToken(idle.id)).toBe('idle-rotated.sig');
    expect(tokenStore.get()).toBe('active.sig');
  });

  it('a refused bearer and a removed login each empty their own slot only', () => {
    const vault = fakeScopedVault();
    setup(vault);
    const a = signInSession({ email: 'a@example.com', token: 'a.sig' })!;
    const b = signInSession({ email: 'b@example.com', token: 'b.sig' })!;
    const c = signInSession({ email: 'c@example.com', token: 'c.sig' })!;

    tokenStore.clear(); // c, the active one, was refused
    expect(vault.slots.has(c.id)).toBe(false);
    removeSession(a.id);
    expect(vault.slots.has(a.id)).toBe(false);
    expect(vault.slots.get(b.id)).toBe('b.sig');
    expect(
      listSessions()
        .map((s) => s.email)
        .sort(),
    ).toEqual(['b@example.com', 'c@example.com']);
  });
});
