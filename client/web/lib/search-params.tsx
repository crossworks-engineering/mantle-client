'use client';

import { Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

/** A query string as the old server pages received `searchParams`: a key seen
 *  once is a string, a key seen more than once is an array. */
export type SearchRecord = Record<string, string | string[] | undefined>;

export function toSearchRecord(params: URLSearchParams): SearchRecord {
  const out: SearchRecord = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

function WithQuery({ render }: { render: (sp: SearchRecord) => ReactNode }) {
  return render(toSearchRecord(useSearchParams()));
}

/**
 * The page's query, read in the browser. The UI is static, so a page can no
 * longer take `searchParams` from a server render; it renders through this
 * instead. The static HTML is the page with an EMPTY query (the Suspense
 * fallback `useSearchParams` requires in a static build), so a public page such
 * as /login paints at once and the real query lands on hydration; afterwards a
 * query change re-renders the page with the new values, as a server render
 * used to.
 */
export function WithSearchParams({ render }: { render: (sp: SearchRecord) => ReactNode }) {
  return (
    <Suspense fallback={render({})}>
      <WithQuery render={render} />
    </Suspense>
  );
}
