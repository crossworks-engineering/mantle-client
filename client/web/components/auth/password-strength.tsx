'use client';

import { Check, Circle } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { passwordChecks, passwordStrength, type PasswordRule } from '@/lib/password-rule';

const BAR_TONE = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

/**
 * Under a new-password field: a strength bar and each part of the brain's
 * rule, ticked as the person types. Point the input at it with
 * `aria-describedby={id}`. Until the rule has loaded it holds the id with a
 * short line, so the input never points at nothing.
 */
export function PasswordStrength({
  id,
  password,
  rule,
}: {
  id: string;
  password: string;
  rule: PasswordRule | null;
}) {
  if (!rule) {
    return (
      <p id={id} className="text-muted-foreground pt-1 text-xs">
        Checking this brain&apos;s password rule.
      </p>
    );
  }
  const checks = passwordChecks(password, rule);
  const strength = passwordStrength(password);
  const filled = password ? strength.score + 1 : 0;
  return (
    <div id={id} className="space-y-1.5 pt-1">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full',
                i < filled ? BAR_TONE[strength.score] : 'bg-muted',
              )}
            />
          ))}
        </div>
        <span className="text-muted-foreground w-16 text-right text-xs" aria-live="polite">
          {password ? strength.label : ''}
        </span>
      </div>
      <ul className="space-y-0.5 text-xs">
        {checks.map((c) => (
          <li
            key={c.id}
            className={cn(
              'flex items-start gap-1.5',
              c.ok ? 'text-success-ink' : 'text-muted-foreground',
            )}
          >
            {c.ok ? (
              <Check className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            )}
            <span>
              {c.label}
              <span className="sr-only">{c.ok ? ': met' : ': not met yet'}</span>
            </span>
          </li>
        ))}
        {rule.commonList ? (
          <li className="text-muted-foreground flex items-start gap-1.5">
            <Circle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>Not a common password (the brain checks this when you save)</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
