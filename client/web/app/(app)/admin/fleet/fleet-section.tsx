import { ApiError } from '@mantle/web-ui/api-fetch';
import type { ReactNode } from 'react';

/** One section of the Fleet screen: a title, an optional action, a body. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The brain's own words for a refusal. */
export function refusalText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const message = err.body?.message;
  return typeof message === 'string' && message ? message : err.message || fallback;
}
