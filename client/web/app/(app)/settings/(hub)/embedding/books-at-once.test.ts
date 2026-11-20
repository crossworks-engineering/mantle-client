import { describe, expect, it } from 'vitest';
import { parseBooksAtOnce } from './books-at-once';

describe('parseBooksAtOnce', () => {
  it('blank clears to the box value', () => {
    expect(parseBooksAtOnce('')).toBeNull();
    expect(parseBooksAtOnce('   ')).toBeNull();
  });

  it('takes a whole number', () => {
    expect(parseBooksAtOnce('3')).toBe(3);
    expect(parseBooksAtOnce(' 2 ')).toBe(2);
    expect(parseBooksAtOnce('1e3')).toBe(1000);
  });

  it('refuses what is not a whole number, never truncating it', () => {
    expect(parseBooksAtOnce('2.5')).toBeUndefined();
    expect(parseBooksAtOnce('abc')).toBeUndefined();
    expect(parseBooksAtOnce('3x')).toBeUndefined();
  });
});
