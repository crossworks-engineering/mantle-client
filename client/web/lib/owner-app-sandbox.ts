import { apiUrl, withAuth } from '@mantle/web-ui/api-fetch';

/**
 * The `apiBase` + `fetcher` an AppSandbox needs to reach its brain, for EVERY
 * login (workspaces W7e: the runner, POST /api/apps/:id/frame-ticket,
 * db-broker and tool-broker and GET /api/apps/:id/frame, answers each login
 * in its own scope; a member's own route under /api/member/apps is no longer
 * called).
 *
 * AppSandbox defaults to a page-relative `/api/apps/<id>` and a plain fetch.
 * That only works when the UI and the brain share an origin (the path-routed
 * one-domain box). A detached client (`pnpm dev:fe`, the desktop app) serves
 * the UI from its own origin, so the relative frame-ticket POST hit the UI's
 * server and 404'd, the preview said "This app isn't available right now",
 * and even a correct URL would have gone without the bearer.
 *
 * `apiUrl` resolves against the brain's origin (relative again when there is
 * none), and `withAuth` attaches the owner credential the right way for either
 * shape: cookies same-origin, bearer cross-origin. The frame document itself
 * authenticates by its short-lived ticket, so framing it cross-origin is fine.
 * Same pattern the team hub uses for its `/s/<token>` brokers.
 */
export function ownerAppSandboxProps(appId: string): {
  apiBase: string;
  fetcher: (input: string, init?: RequestInit) => Promise<Response>;
} {
  return {
    apiBase: apiUrl(`/api/apps/${appId}`),
    fetcher: (input, init) => fetch(input, withAuth(init)),
  };
}
