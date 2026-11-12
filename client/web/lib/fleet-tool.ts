/**
 * The Control Center's admin channel (CC side: POST /api/fleet/tool): a
 * box's own builtin tool, run as the Control Center within the scope the
 * box's .env grants (MANTLE_CONTROL_CENTER_SCOPE). The CC asks a run at
 * once, waits up to 25 s and answers per box. Fleet users runs on it:
 * `users_list` reads a box's logins and workspaces, `workspace_user_set`
 * puts logins in workspaces or takes them out.
 *
 * The parser is tolerant on purpose: the route's reply may name its rows
 * `boxes` or `results`, and a row's payload `output` or `result`. Pure but
 * for callFleetTool, which loads the fetch helper only when it runs.
 */
import { FLEET_PATH, reasonText } from './fleet';

export const FLEET_TOOL_PATH = `${FLEET_PATH}/tool`;

/** Every login of a box with its role, sign-in time and workspaces. Args {}. */
export const USERS_LIST_TOOL = 'users_list';
/** Logins into or out of workspaces. Args { changes } (1 to 20). */
export const WORKSPACE_USER_SET_TOOL = 'workspace_user_set';
/** The most changes one workspace_user_set call carries. */
export const MAX_TOOL_CHANGES = 20;

/** One box's answer to one tool call. `output`: what the tool gave (ok);
 *  `reason`: a short code when the box did not run it, or the tool failed. */
export type ToolBoxAnswer = {
  boxId: string;
  ok: boolean;
  output: unknown;
  reason: string | null;
};

const CODE = /^[a-z][a-z0-9-]{0,39}$/;

/** The route's reply as one answer per box. Rows it cannot read are left
 *  out; a box asked and left out answers as `missing` (askedFor). */
export function parseToolAnswer(raw: unknown, askedFor: readonly string[] = []): ToolBoxAnswer[] {
  const top = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(top.boxes)
      ? top.boxes
      : Array.isArray(top.results)
        ? top.results
        : [];
  const out: ToolBoxAnswer[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const boxId = typeof r.boxId === 'string' ? r.boxId : typeof r.id === 'string' ? r.id : null;
    if (!boxId) continue;
    const output = 'output' in r ? r.output : 'result' in r ? r.result : undefined;
    const reason =
      typeof r.reason === 'string' && CODE.test(r.reason)
        ? r.reason
        : typeof r.error === 'string' && CODE.test(r.error)
          ? r.error
          : null;
    const ok = typeof r.ok === 'boolean' ? r.ok && reason === null : reason === null;
    out.push({
      boxId,
      ok,
      output: ok ? output : undefined,
      reason: ok ? null : (reason ?? 'error'),
    });
  }
  for (const id of askedFor) {
    if (!out.some((a) => a.boxId === id))
      out.push({ boxId: id, ok: false, output: undefined, reason: 'missing' });
  }
  return out;
}

/** Words for a box's reason on the admin channel. */
export function toolReasonText(code: string | null): string {
  switch (code) {
    case null:
      return 'No answer yet.';
    case 'scope':
      return 'This box has not opened its admin tools to the Control Center (MANTLE_CONTROL_CENTER_SCOPE).';
    case 'unknown-tool':
    case 'tool':
    case 'not-found':
    case 'bad-call':
      return 'This box runs a release before Fleet users.';
    case 'error':
      return 'The box could not run it.';
    case 'no-channel':
      return NO_CHANNEL_TEXT;
    case 'missing':
      return 'The Control Center gave no answer for this box.';
    case 'timeout':
    case 'pending':
      return 'The box did not answer within 25 seconds. Not confirmed: try again.';
    case 'bad-reply':
      return 'The box gave a reply this box cannot read.';
    default:
      return reasonText(code) ?? 'The box could not run it.';
  }
}

/** What the screen says while the route is missing (404 or 405). */
export const NO_CHANNEL_TEXT = 'This Control Center runs a release before the admin channel.';

type Send = (path: string, method: 'POST', body: unknown) => Promise<unknown>;

/** Whether an error is the route answering 404 or 405: no admin channel. */
export function isNoChannel(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 404 || status === 405;
}

/** One tool call on the boxes named: each box's answer, or null when the
 *  Control Center has no admin channel. Other failures throw. `send` is the
 *  fetch helper (apiSend), passed in by tests. */
export async function callFleetTool(
  boxIds: readonly string[],
  name: string,
  args: Record<string, unknown>,
  send?: Send,
): Promise<ToolBoxAnswer[] | null> {
  const post: Send =
    send ??
    (async (path, method, body) => {
      const { apiSend } = await import('@mantle/web-ui/api-fetch');
      return apiSend(path, method, body);
    });
  try {
    const raw = await post(FLEET_TOOL_PATH, 'POST', { boxIds: [...boxIds], name, args });
    return parseToolAnswer(raw, boxIds);
  } catch (err) {
    if (isNoChannel(err)) return null;
    throw err;
  }
}
