'use client';

import { LinkForm } from './link-form';

/**
 * The one "Link your company sign-in" step of required mode (corporate plan
 * section 17.1): no reset, no admin call. The person's password was enough to
 * get here, and one click at the provider finishes it.
 */
export function LinkStep({
  label,
  held,
  next,
  add,
  onEnded,
}: {
  label: string;
  held?: { ticket: string };
  next?: string;
  add?: boolean;
  onEnded?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-base font-medium">Link your company sign-in</h1>
        <p className="text-sm text-muted-foreground">
          This site uses {label} to sign in. Link it once, and sign in with it from now on.
        </p>
      </div>
      <LinkForm
        label={label}
        action={`Link with ${label}`}
        {...(held ? { held } : {})}
        {...(next ? { next } : {})}
        {...(add ? { add } : {})}
        {...(onEnded ? { onEnded } : {})}
      />
    </div>
  );
}
