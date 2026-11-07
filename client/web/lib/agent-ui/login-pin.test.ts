import { describe, expect, it } from 'vitest';
import { isLoginStorageKey, loginChangedFrom } from './login-pin';

describe('the login pin', () => {
  it('a pin changed only when the login now is another one', () => {
    expect(loginChangedFrom('login:a', 'login:a')).toBe(false);
    expect(loginChangedFrom('login:a', 'login:b')).toBe(true);
    expect(loginChangedFrom('login:a', null)).toBe(true);
    expect(loginChangedFrom(null, 'login:a')).toBe(true);
    expect(loginChangedFrom(undefined, 'login:b')).toBe(false);
  });

  it('the storage keys of a login change', () => {
    for (const k of [
      null,
      'mantle_token',
      'mantle_token:s1',
      'mantle_active_session',
      'mantle_sessions',
    ])
      expect(isLoginStorageKey(k)).toBe(true);
    expect(isLoginStorageKey('mantle_ui_prefs')).toBe(false);
  });
});
