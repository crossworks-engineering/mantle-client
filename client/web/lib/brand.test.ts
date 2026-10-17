import { describe, expect, it } from 'vitest';

import {
  brandTitle,
  FALLBACK_NAME,
  readBrandFields,
  resolveLoginBrand,
  SITE_NAME_MAX,
  type BrandFields,
} from './brand';

/**
 * The login screen's branding ladder.
 *
 * This is the half of dev task `db6b72e9` that can be proven WITHOUT the mantle
 * change: the public `/api/appearance` payload does not carry `siteName`,
 * `peerName` or a logo flag yet, so every rung above the fallback is
 * unreachable through a real brain today. The resolver is pure, so it is
 * testable now — and when the endpoint grows the fields, these are the cases
 * that say what the screen will do.
 */

const NONE: BrandFields = {
  siteName: null,
  peerName: null,
  logoVersion: null,
  logoDarkVersion: null,
};

describe('readBrandFields', () => {
  it('reads the fields the pinned type does not declare yet', () => {
    // The forward-compatible read: this is exactly the payload shape mantle
    // will send, arriving through a type that knows nothing about it.
    const payload = {
      colorTheme: 'slate',
      siteName: 'Northwind',
      peerName: 'westmill',
      logoVersion: 'a1b2c3d4',
      logoDarkVersion: 'e5f6a7b8',
    } as never;
    expect(readBrandFields(payload)).toEqual({
      siteName: 'Northwind',
      peerName: 'westmill',
      logoVersion: 'a1b2c3d4',
      logoDarkVersion: 'e5f6a7b8',
    });
  });

  it('reads nothing from the payload the endpoint sends TODAY', () => {
    // The whole point of shipping this before mantle: today's payload yields a
    // clean "no branding", not a crash and not a half-state.
    const today = { colorTheme: 'slate', fontLogo: 'playfair', avatarStyle: 'bauhaus' } as never;
    expect(readBrandFields(today)).toEqual(NONE);
  });

  it('treats null, undefined and an empty payload as no branding', () => {
    expect(readBrandFields(null)).toEqual(NONE);
    expect(readBrandFields(undefined)).toEqual(NONE);
    expect(readBrandFields({} as never)).toEqual(NONE);
  });

  it('ignores a value that is not a string rather than coercing it', () => {
    // A half-typed or hand-edited payload must never put `[object Object]` or
    // `42` on the login screen.
    const junk = { siteName: 42, peerName: { name: 'x' }, logoVersion: true } as never;
    expect(readBrandFields(junk)).toEqual(NONE);
  });

  it('trims, and treats whitespace-only as absent', () => {
    const padded = { siteName: '  Northwind  ', peerName: '   ' } as never;
    const got = readBrandFields(padded);
    expect(got.siteName).toBe('Northwind');
    expect(got.peerName).toBeNull();
  });

  it('clamps a site name to the length the settings screen allows', () => {
    const long = { siteName: 'x'.repeat(SITE_NAME_MAX + 20) } as never;
    expect(readBrandFields(long).siteName).toHaveLength(SITE_NAME_MAX);
  });
});

describe('resolveLoginBrand', () => {
  it('shows an uploaded logo when there is one', () => {
    const brand = resolveLoginBrand({ ...NONE, siteName: 'Northwind', logoVersion: 'a1b2c3d4' });
    expect(brand.kind).toBe('logo');
    // The name still travels — it is the logo's alt text.
    expect(brand.name).toBe('Northwind');
  });

  it('shows the logo when only the DARK variant was uploaded', () => {
    // A dark-only upload is a supported state, not an error: the route 404s on
    // the missing variant on purpose and the client owns the fallback.
    expect(resolveLoginBrand({ ...NONE, logoDarkVersion: 'e5f6a7b8' }).kind).toBe('logo');
  });

  it('falls back to the site name when there is no logo', () => {
    const brand = resolveLoginBrand({ ...NONE, siteName: 'Northwind' });
    expect(brand.kind).toBe('name');
    expect(brand.name).toBe('Northwind');
  });

  it('falls back to the MantleOS wordmark when the brain has said nothing', () => {
    const brand = resolveLoginBrand(NONE);
    expect(brand.kind).toBe('product');
    expect(brand.name).toBe(FALLBACK_NAME);
  });

  it('carries the peer name on every rung', () => {
    // It is a second line under the mark, not an alternative to it.
    for (const fields of [
      { ...NONE, peerName: 'westmill', logoVersion: 'a1b2c3d4' },
      { ...NONE, peerName: 'westmill', siteName: 'Northwind' },
      { ...NONE, peerName: 'westmill' },
    ]) {
      expect(resolveLoginBrand(fields).peerName).toBe('westmill');
    }
  });
});

describe('brandTitle', () => {
  it('names the brain when it has a name', () => {
    expect(brandTitle({ ...NONE, siteName: 'Northwind' })).toBe('Northwind');
  });

  it('falls back to the PEER name — the whole point of the complaint', () => {
    // Naming the box is part of standing it up; a site name is branding someone
    // chooses to set. Without this rung a fleet of unbranded boxes stays a row
    // of identical "Jackdaw" tabs, which is exactly what was being reported.
    expect(brandTitle({ ...NONE, peerName: 'westmill' })).toBe('westmill');
  });

  it('prefers the site name over the peer name when both are set', () => {
    expect(brandTitle({ ...NONE, siteName: 'Northwind', peerName: 'westmill' })).toBe('Northwind');
  });

  it('never yields a blank tab', () => {
    expect(brandTitle(NONE)).toBe(FALLBACK_NAME);
  });

  it('does NOT follow the logo — a tab shows a name, not a picture', () => {
    // A branded brain with no name of any kind still has nothing to WRITE in a
    // tab, so the product name stands in rather than the logo's alt text.
    expect(brandTitle({ ...NONE, logoVersion: 'a1b2c3d4' })).toBe(FALLBACK_NAME);
  });
});

describe('the mark and the tab disagree on purpose', () => {
  it('a peer-named brain shows its peer in the TAB and the product mark on the SCREEN', () => {
    // `brandTitle` takes the peer name; `resolveLoginBrand` does not. A peer
    // name identifies a box — it is not a thing to set in a display face where
    // a logo would go, and the login screen already shows it on its own line
    // under the mark.
    const fields = { ...NONE, peerName: 'westmill' };
    expect(brandTitle(fields)).toBe('westmill');
    const brand = resolveLoginBrand(fields);
    expect(brand.kind).toBe('product');
    expect(brand.name).toBe(FALLBACK_NAME);
    expect(brand.peerName).toBe('westmill');
  });
});
