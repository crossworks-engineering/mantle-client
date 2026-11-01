'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * False in the static build and during hydration, true from the first client
 * render after it. For values only the host knows (window.__MANTLE_ENV__: the
 * brain's origin, its branding): reading them before this is true would make
 * the client's first render differ from the static HTML, which React refuses,
 * and would show the build's default where the brain's own value belongs.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
