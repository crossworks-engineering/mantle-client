import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { challengeFor, newVerifier, sha256 } from './pkce';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('sha256', () => {
  it('matches the FIPS vectors', () => {
    expect(hex(sha256(new TextEncoder().encode('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the platform at every length around a block edge', () => {
    for (const length of [0, 1, 43, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const input = new Uint8Array(length).map((_, i) => (i * 31) & 0xff);
      expect(hex(sha256(input)), String(length)).toBe(
        createHash('sha256').update(input).digest('hex'),
      );
    }
  });
});

describe('the verifier and its challenge', () => {
  it('a verifier is 43 unreserved characters, a new one each time', () => {
    const a = newVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newVerifier()).not.toBe(a);
  });

  it('the RFC 7636 appendix B example', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('gives the same challenge with no WebCrypto digest (the desktop scheme)', async () => {
    const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      expect(await challengeFor(v)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
