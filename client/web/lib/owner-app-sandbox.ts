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
    fetcher: async (input, init) => readableToolRefusal(input, await fetch(input, withAuth(init))),
  };
}

/** The relay's reasons it already words itself (share-ui AppSandbox). */
const RELAY_WORDED = new Set(['review-test-read-only', 'team-rules']);

/**
 * A tool call the brain refuses with its own plain reason (a draft
 * preview's build, which an agent edited, may not run the app's tools):
 * the relay (share-ui AppSandbox) shows a bare 403 as "this app tried to
 * use a tool it hasn't declared", which would send the builder the wrong
 * way. So the answer is handed on in the shape the relay shows in the
 * brain's own words (reason `team-rules`, `error`), with the brain's reason
 * kept as `refused`. Nothing is retried: the relay and this fetcher send a
 * tool call once.
 */
export async function readableToolRefusal(input: string, res: Response): Promise<Response> {
  if (res.status !== 403 || !/\/tool-broker(\?|$)/.test(input)) return res;
  let body: Record<string, unknown>;
  try {
    body = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    return res;
  }
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const words = typeof body.error === 'string' ? body.error.trim() : '';
  // An undeclared tool (no reason) keeps the relay's own words, and so do
  // the reasons it knows.
  // The brain's refusal of an agent's write is the hands' (lib/agent-ui).
  if (!reason || !words || RELAY_WORDED.has(reason) || words === 'agent_refused') return res;
  return new Response(
    JSON.stringify({ ...body, ok: false, reason: 'team-rules', refused: reason, error: words }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}
