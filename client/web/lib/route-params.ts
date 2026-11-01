'use client';

import { usePathname } from 'next/navigation';

export { STATIC_PARAM } from './static-param';

/**
 * Read a dynamic route's params from the URL, not from the exported page.
 * `pattern` is the route as written in app/, without route groups:
 * `/notes/[id]`, `/docs/[collection]/[...slug]`. Segments come back as they
 * stand in the path, still percent-encoded, as Next's own `params` gave them,
 * so a page that decoded its params keeps decoding them once. Missing or
 * non-matching parts come back absent.
 */
export function matchRouteParams(
  pattern: string,
  pathname: string,
): Record<string, string | string[]> {
  const want = pattern.split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  const out: Record<string, string | string[]> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i]!;
    const catchAll = /^\[\.\.\.(\w+)\]$/.exec(part);
    if (catchAll) {
      out[catchAll[1]!] = have.slice(i);
      break;
    }
    const single = /^\[(\w+)\]$/.exec(part);
    if (single) {
      if (have[i] !== undefined) out[single[1]!] = have[i]!;
    } else if (have[i] !== part) {
      return {};
    }
  }
  return out;
}

export function useRouteParams<T extends Record<string, string | string[]>>(pattern: string): T {
  return matchRouteParams(pattern, usePathname() ?? '') as T;
}
