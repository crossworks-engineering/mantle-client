'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { runtimeApiBase } from '@mantle/web-ui/runtime-env';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useShellRole } from '@/components/layout/shell-role';
import {
  itemRestore,
  forgetLastOpened,
  lastOpenedKey,
  readLastOpened,
  rememberLastOpened,
  routeBefore,
  shouldRestore,
  type LastOpenedSection,
  type LastOpenedStore,
  type RestoreOutcome,
} from '@/lib/last-opened';

/**
 * The React half of lib/last-opened.ts: who is signed in (from the app
 * shell), recording an item once it has loaded, and the restore on entry to
 * a section's bare index.
 */

/** The signed-in login, as the app shell names it (`admin:<email>`,
 *  `member:<loginId>`, `client:<loginId>`: lib/login-key.ts), or null until
 *  the shell has loaded. */
const LoginContext = createContext<string | null>(null);

export function LastOpenedLoginProvider({
  login,
  children,
}: {
  login: string | null;
  children: ReactNode;
}) {
  return <LoginContext.Provider value={login}>{children}</LoginContext.Provider>;
}

function store(): LastOpenedStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The brain this tab talks to: the API origin, or this page's own. */
function brain(): string {
  return runtimeApiBase() || (typeof window === 'undefined' ? '' : window.location.origin);
}

/** Remember `id` as this section's last item, once it has loaded (null: not
 *  yet, or nothing open). Waits for the shell to name the login. */
export function useRememberLastOpened(section: LastOpenedSection | null, id: string | null): void {
  const login = useContext(LoginContext);
  useEffect(() => {
    if (!section || !id || !login) return;
    rememberLastOpened(store(), lastOpenedKey(brain(), login, section), id);
  }, [section, id, login]);
}

/** How long a restore waits for the shell to name the login before it gives
 *  up and shows the list: a slow shell must not hold the screen. */
const LOGIN_WAIT_MS = 4000;

/**
 * Wraps a section's index. On entry to the bare index, from outside the
 * section, it opens the item this login last had open there (router.replace,
 * so Back still leaves the section), or shows the index as normal when there
 * is none, or when the item is gone (and forgets it).
 */
export function RestoreLastOpened({
  section,
  children,
}: {
  section: LastOpenedSection;
  children: ReactNode;
}) {
  const role = useShellRole();
  const login = useContext(LoginContext);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  // The route before this entry, read at the first render: the shell has not
  // noted this navigation yet, or has (routeBefore answers for both).
  const [from] = useState(() => routeBefore(pathname));
  const bare = pathname === `/${section}` && search === '';
  // Read when the probe answers: a search typed meanwhile wins.
  const bareNow = useRef(bare);
  useEffect(() => {
    bareNow.current = bare;
  }, [bare]);
  // `check`: deciding (only ever on a bare entry). `go`: replacing the URL,
  // the index stays hidden until it changes. `done`: the index as normal.
  const [phase, setPhase] = useState<'check' | 'go' | 'done'>(() =>
    shouldRestore(section, pathname, search, from) ? 'check' : 'done',
  );
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'check' || started.current) return;
    // An unknown role waits (the shell has not answered).
    if (!role) return;
    if (!login) {
      const t = setTimeout(() => setPhase((p) => (p === 'check' ? 'done' : p)), LOGIN_WAIT_MS);
      return () => clearTimeout(t);
    }
    started.current = true;
    const key = lastOpenedKey(brain(), login, section);
    const id = readLastOpened(store(), key);
    if (!id) return setPhase('done');
    const outcome: Promise<RestoreOutcome> = itemRestore(section, id, (p) => apiFetch<unknown>(p));
    void outcome
      .catch((): RestoreOutcome => 'unknown')
      .then((r) => {
        if (!mounted.current) return;
        if (typeof r === 'object' && bareNow.current) {
          setPhase('go');
          router.replace(r.href, { scroll: false });
          return;
        }
        if (r === 'gone') forgetLastOpened(store(), key);
        setPhase('done');
      });
  }, [phase, role, login, section, router]);

  // The restore landed (the URL left the bare index): done. A section whose
  // index and item routes share one layout keeps this mounted, so a later
  // return to the bare index must not find it still waiting to go.
  useEffect(() => {
    if (phase === 'go' && !bare) setPhase('done');
  }, [phase, bare]);

  if (phase === 'done' || !bare) return <>{children}</>;
  // Role not known yet: the shell renders no screen before it answers, so
  // there is nothing to hold back.
  if (phase === 'check' && !role) return <>{children}</>;
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}
