/**
 * The second line against an agent changing the login (client lib/agent-ui).
 *
 * While an agent drives the window, its controls that switch, add, forget or
 * sign out a login carry `data-agent-risk`, so the agent cannot press them.
 * But a switch writes this device's login list before it sends a request
 * the request guard could hold, and a sign-out goes on whatever its logout
 * request answered. So the kit asks this guard first, and does nothing
 * while it says the agent is driving. The app registers it; the kit alone
 * never blocks.
 */
let guard: (() => boolean) | null = null;

/** Register (or, with null, drop) the app's "an agent drives now". */
export function setLoginChangeGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

/** True while a login change must not run. */
export function loginChangeBlocked(): boolean {
  try {
    return guard?.() === true;
  } catch {
    return false;
  }
}
