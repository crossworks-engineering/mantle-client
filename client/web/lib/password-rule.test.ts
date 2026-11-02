import { describe, expect, it } from 'vitest';
import {
  OLD_RULE,
  passwordChecks,
  passwordKinds,
  passwordRuleError,
  passwordStrength,
  type PasswordRule,
} from './password-rule';

/** The brain's rule from 2026-11 (password-rule.ts in mantle). */
const RULE: PasswordRule = { min: 12, maxBytes: 72, kinds: 3, passphrase: 20, commonList: true };

describe('the password rule, as a form shows it', () => {
  it('counts the kinds as the brain does', () => {
    expect(passwordKinds('abc')).toBe(1);
    expect(passwordKinds('aB3 ')).toBe(4);
    expect(passwordKinds('Привет7')).toBe(3);
    expect(passwordKinds('日本語のパス7!')).toBe(3);
    // Invisible characters are no symbol, as on the brain.
    expect(passwordKinds('kettleunder7\u0000')).toBe(2);
    expect(passwordKinds('kettleunder7\u200b')).toBe(2);
    expect(passwordKinds('kettleunder7\u0301')).toBe(2);
    expect(passwordRuleError('kettleunder7\u200b', RULE)).toMatch(/3 of small letters/);
  });

  it('ticks each part as it is met', () => {
    const ids = (pw: string) =>
      passwordChecks(pw, RULE)
        .filter((c) => c.ok)
        .map((c) => c.id);
    expect(ids('')).toEqual(['max']);
    expect(ids('kettleunder7')).toEqual(['length', 'max']);
    expect(ids('Kettle-under-7')).toEqual(['length', 'max', 'kinds']);
    expect(ids('kettle under the stairs')).toEqual(['length', 'max', 'kinds']);
    expect(ids(`Aa1!${'é'.repeat(35)}`)).toEqual(['length', 'kinds']);
  });

  it('says the first unmet part, or nothing', () => {
    expect(passwordRuleError('Kettle-un7!', RULE)).toMatch(/at least 12/);
    expect(passwordRuleError('kettleunder7', RULE)).toMatch(/3 of small letters/);
    expect(passwordRuleError(`Aa1!${'x'.repeat(69)}`, RULE)).toMatch(/at most 72 bytes/);
    expect(passwordRuleError('Kettle-under-7', RULE)).toBeNull();
  });

  it('holds a brain from before the rule to its 8 characters, and no more', () => {
    expect(passwordChecks('abcdefgh', OLD_RULE).map((c) => c.id)).toEqual(['length']);
    expect(passwordRuleError('abcdefgh', OLD_RULE)).toBeNull();
    expect(passwordRuleError('abcdefg', OLD_RULE)).toMatch(/at least 8/);
  });

  it('a strength that grows with length and kinds, and not with repeats', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('aaaaaaaaaaaaaaaa').score).toBe(0);
    expect(passwordStrength('kettle').score).toBeLessThan(passwordStrength('Kettle-under-7').score);
    expect(passwordStrength('blue kettle under the stairs 7').score).toBe(4);
  });
});
