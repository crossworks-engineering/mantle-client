/**
 * The rule a new password must meet, as the brain says it (GET
 * /api/auth/bootstrap-state `passwordRule`, brains from 2026-11), and what a
 * form shows as the person types. The brain stays the judge: a form only says
 * early what the brain would refuse, and the common-password list is the
 * brain's alone. A brain from before the field sends no rule; its rule was
 * 8 characters, so that is what a form holds then.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';

export type PasswordRule = {
  min: number;
  commonList: boolean;
  /** Most UTF-8 bytes. Absent from a brain before 2026-11. */
  maxBytes?: number;
  /** Kinds of character needed below `passphrase` characters. */
  kinds?: number;
  passphrase?: number;
};

/** A brain from before the rule field: 8 characters, no list. */
export const OLD_RULE: PasswordRule = { min: 8, commonList: false };

/** Which of the four kinds `password` uses: small letters (and letters of a
 *  script with no capitals), capitals, digits, and anything else. The
 *  brain's own count (password-rule.ts passwordKinds). */
export function passwordKinds(password: string): number {
  const kinds = [/[\p{Ll}\p{Lo}\p{Lm}]/u, /[\p{Lu}\p{Lt}]/u, /\p{N}/u, /[^\p{L}\p{N}]/u];
  return kinds.filter((k) => k.test(password)).length;
}

export type PasswordCheck = { id: 'length' | 'max' | 'kinds'; ok: boolean; label: string };

/** Each part of the rule, met or not, in the order the brain checks them. */
export function passwordChecks(password: string, rule: PasswordRule): PasswordCheck[] {
  const chars = [...password].length;
  const checks: PasswordCheck[] = [
    { id: 'length', ok: chars >= rule.min, label: `At least ${rule.min} characters` },
  ];
  if (rule.maxBytes) {
    checks.push({
      id: 'max',
      ok: new TextEncoder().encode(password).length <= rule.maxBytes,
      label: `At most ${rule.maxBytes} bytes (an accented letter or emoji takes more than one)`,
    });
  }
  if (rule.kinds && rule.passphrase) {
    checks.push({
      id: 'kinds',
      ok: chars >= rule.passphrase || passwordKinds(password) >= rule.kinds,
      label: `${rule.kinds} of: small letters, capitals, digits, symbols. Or ${rule.passphrase}+ characters`,
    });
  }
  return checks;
}

/** What a form says about `password` before it sends it, or null. */
export function passwordRuleError(password: string, rule: PasswordRule): string | null {
  const failed = passwordChecks(password, rule).find((c) => !c.ok);
  if (!failed) return null;
  if (failed.id === 'length') return `Use at least ${rule.min} characters.`;
  if (failed.id === 'max') return `Use at most ${rule.maxBytes} bytes.`;
  return `Use ${rule.kinds} of small letters, capitals, digits and symbols, or ${rule.passphrase} characters or more.`;
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** A rough strength for the bar, from length, kinds and repeats. It is a
 *  guide only: the rule decides, and a common password can look strong here. */
export function passwordStrength(password: string): PasswordStrength {
  const chars = [...password];
  if (chars.length === 0) return { score: 0, label: LABELS[0] };
  let pool = 0;
  if (/[\p{Ll}]/u.test(password)) pool += 26;
  if (/[\p{Lu}]/u.test(password)) pool += 26;
  if (/\p{N}/u.test(password)) pool += 10;
  if (/[^\p{L}\p{N}]/u.test(password)) pool += 33;
  if (/[\p{Lo}\p{Lm}]/u.test(password)) pool += 100;
  // Each character past the first of a run of one character adds little.
  const distinct = new Set(chars.map((c) => c.toLowerCase())).size;
  const effective = Math.min(chars.length, distinct * 2);
  const bits = effective * Math.log2(Math.max(pool, 2));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: LABELS[score] };
}

/** The rule in force on this brain, or null while it loads. */
export function usePasswordRule(): PasswordRule | null {
  const q = useQuery({
    queryKey: ['auth-bootstrap-state'],
    queryFn: () =>
      apiFetch<{ firstRun: boolean; setupCodeRequired?: boolean; passwordRule?: PasswordRule }>(
        '/api/auth/bootstrap-state',
      ),
    staleTime: 5 * 60_000,
  });
  if (q.isPending) return null;
  return q.data?.passwordRule ?? OLD_RULE;
}
