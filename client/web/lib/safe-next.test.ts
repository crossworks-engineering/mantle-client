import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps in-app paths, query and hash included', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/tasks')).toBe('/tasks');
    expect(safeNext('/pages/abc?tab=2#top')).toBe('/pages/abc?tab=2#top');
  });

  it('refuses absolute and scheme-relative URLs', () => {
    expect(safeNext('https://evil.example')).toBeUndefined();
    expect(safeNext('http://evil.example/tasks')).toBeUndefined();
    expect(safeNext('//evil.example')).toBeUndefined();
    expect(safeNext('/\\evil.example')).toBeUndefined();
    expect(safeNext('javascript:alert(1)')).toBeUndefined();
  });

  // The bypass the first version shipped with. `new URL()` strips tab, LF and
  // CR from anywhere in its input BEFORE parsing, so each of these reaches the
  // parser as `///evil.example` and resolves to https://evil.example/ — while a
  // "second character is not a slash" test sees a perfectly ordinary path.
  it('refuses a scheme-relative URL smuggled past the first two characters', () => {
    for (const c of ['\n', '\r', '\t']) {
      expect(safeNext(`/${c}//evil.example`)).toBeUndefined();
      expect(safeNext(`/${c}/\\evil.example`)).toBeUndefined();
      expect(safeNext(`/${c}${c}//evil.example`)).toBeUndefined();
    }
    // The same trick spelled with the separator inside the host.
    expect(safeNext('//\nevil.example')).toBeUndefined();
  });

  it('refuses a path that parses back into a scheme-relative one', () => {
    for (const next of ['/.//evil.example', '/x/..//evil.example', '/./\\evil.example']) {
      expect(safeNext(next), next).toBeUndefined();
    }
  });

  it('normalises what it returns, so no control character survives', () => {
    expect(safeNext('/ta\nsks')).toBe('/tasks');
    expect(safeNext('/a/../b')).toBe('/b');
  });

  it('refuses anything that is not a string or not a path', () => {
    expect(safeNext(undefined)).toBeUndefined();
    expect(safeNext(null)).toBeUndefined();
    expect(safeNext('')).toBeUndefined();
    expect(safeNext('tasks')).toBeUndefined();
  });
});
