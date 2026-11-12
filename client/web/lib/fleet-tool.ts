/**
 * The Control Center's admin channel (POST /api/fleet/tool; mantle
 * docs/control-center.md, "The admin channel"): a box's own builtin tool,
 * run as the Control Center within the scope the box's .env grants
 * (MANTLE_CONTROL_CENTER_SCOPE). Fleet users runs on it: `users_list` reads
 * a box's logins and workspaces, `workspace_user_set` puts logins in
 * workspaces or takes them out.
 *
 * The route: `{ boxIds, name, args }` queues one call per box, waits up to
 * 25 s, and answers `{ answers, pending, gone }`. Each answer is handed out
 * once. A call still `pending` is asked for again with `{ callIds }`.
 *
 * Every call ends in one of three outcomes:
 *  - ok: the box ran the tool and answered;
 *  - not run: refused before running, known (scope, tool, size, busy,
 *    replay, refused, error, expired, bad-call, no channel, off, time, sig);
 *  - unknown: sent, but no answer read (pending, a timeout or a network
 *    error, gone, unreachable, a reply this box cannot read, an answer
 *    too large). A write with an unknown outcome may still be made.
 *
 * Pure but for the default `send`, which loads the fetch helper when it runs.
 */
import { FLEET_PATH, reasonText } from './fleet';

export const FLEET_TOOL_PATH = `${FLEET_PATH}/tool`;

/** Every login of a box with its role, sign-in time and workspaces. Args {}. */
export const USERS_LIST_TOOL = 'users_list';
/** Logins into or out of workspaces. Args { changes } (1 to 20). */
export const WORKSPACE_USER_SET_TOOL = 'workspace_user_set';
/** The most changes one workspace_user_set call carries. */
export const MAX_TOOL_CHANGES = 20;
/** The route's own caps. */
export const MAX_TOOL_BOXES = 50;
export const MAX_TOOL_CALL_IDS = 100;
/** A POST is given up after this long: its outcome is then unknown. */
export const TOOL_POST_TIMEOUT_MS = 35_000;
/** Pending calls are asked for again this often, at most this many times. */
export const TOOL_FOLLOW_UP_GAP_MS = 30_000;
export const TOOL_FOLLOW_UPS = 3;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9-]{0,39}$/;

/** One call's answer, as the route gives it (its id is the call's). */
export type ToolAnswer = {
  callId: string;
  boxId: string;
  ok: boolean;
  reason: string | null;
  output: unknown;
  truncated: boolean;
};

export type ToolReply = { answers: ToolAnswer[]; pending: string[]; gone: string[] };

const ids = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
        .map((x) => x.toLowerCase())
        .slice(0, max)
    : [];

/**
 * The route's reply, held to its shape: `{ answers, pending, gone }`. An
 * answer is kept only for a box asked (`boxIds`), and, when `callIds` is
 * given (a follow-up), only for a call made. ok only when `ok === true`
 * and no reason; truncated is its own reason.
 */
export function parseToolReply(
  raw: unknown,
  scope: { boxIds: readonly string[]; callIds?: readonly string[] },
): ToolReply {
  const top = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const boxes = new Set(scope.boxIds.map((b) => b.toLowerCase()));
  const made = scope.callIds ? new Set(scope.callIds.map((c) => c.toLowerCase())) : null;
  const answers: ToolAnswer[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(top.answers) ? top.answers : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !UUID.test(r.id)) continue;
    if (typeof r.boxId !== 'string' || !UUID.test(r.boxId)) continue;
    const callId = r.id.toLowerCase();
    const boxId = r.boxId.toLowerCase();
    if (!boxes.has(boxId) || (made && !made.has(callId)) || seen.has(callId)) continue;
    seen.add(callId);
    const truncated = r.truncated === true;
    const reason =
      typeof r.reason === 'string' && CODE.test(r.reason)
        ? r.reason
        : r.reason === null || r.reason === undefined
          ? null
          : 'error';
    const ok = r.ok === true && reason === null && !truncated;
    answers.push({
      callId,
      boxId,
      ok,
      reason: ok ? null : truncated ? 'truncated' : (reason ?? 'refused'),
      output: ok ? r.output : undefined,
      truncated,
    });
  }
  const keep = (list: string[]) => list.filter((id) => !seen.has(id) && (!made || made.has(id)));
  return {
    answers,
    pending: keep(ids(top.pending, MAX_TOOL_CALL_IDS)),
    gone: keep(ids(top.gone, MAX_TOOL_CALL_IDS)),
  };
}

/** Codes known to mean the box did not run the tool. */
const NOT_RUN = new Set([
  'scope',
  'tool',
  'size',
  'busy',
  'replay',
  'refused',
  'error',
  'expired',
  'bad-call',
  'not-queued',
  'no-channel',
  'off',
  'time',
  'sig',
]);

export type Outcome = 'ok' | 'not-run' | 'unknown';

/** What a box's answer means for a write: made, known not made, or unknown. */
export function outcomeOf(a: { ok: boolean; reason: string | null }): Outcome {
  if (a.ok) return 'ok';
  return NOT_RUN.has(a.reason ?? '') ? 'not-run' : 'unknown';
}

/** Words for a box's reason on the admin channel. */
export function toolReasonText(code: string | null, tool?: string): string {
  switch (code) {
    case null:
      return 'No answer yet.';
    case 'scope':
      return 'This box has not opened its admin tools to the Control Center (MANTLE_CONTROL_CENTER_SCOPE).';
    case 'tool':
      return `This box does not offer ${tool ?? 'this tool'} to the Control Center yet (a box release, and the admin scope must include it).`;
    case 'bad-call':
      return 'This box runs a release before Fleet users.';
    case 'size':
      return 'The change was too large for one call.';
    case 'busy':
      return 'The box is busy with other calls. Try again in a minute.';
    case 'replay':
      return 'The box refused the call as a repeat. Try again.';
    case 'expired':
      return 'The call was not sent within 2 minutes, so it was dropped.';
    case 'refused':
      return 'The box refused it.';
    case 'error':
      return 'The box could not run it.';
    case 'not-queued':
      return 'The Control Center could not queue the call: each box holds at most 10 calls.';
    case 'truncated':
      return "The box's answer was too large; showing nothing for this box.";
    case 'pending':
      return 'The box did not answer in time.';
    case 'gone':
      return 'The answer was not kept by the Control Center.';
    case 'timeout':
      return 'The Control Center did not answer within 35 seconds.';
    case 'network':
      return 'The Control Center could not be reached.';
    case 'no-channel':
      return NO_CHANNEL_TEXT;
    case 'bad-reply':
      return 'The box gave a reply this box cannot read.';
    default:
      return reasonText(code) ?? 'The box could not run it.';
  }
}

/** What the screen says while the route is missing. */
export const NO_CHANNEL_TEXT = 'This Control Center runs a release before the admin channel.';

/** Whether an error is the plain not-found of a Control Center without the
 *  route (a 404 or 405 whose body is `{ error: 'not found' }` or none). Any
 *  other 4xx is a real answer. */
export function isNoChannel(err: unknown): boolean {
  const e = err as { status?: unknown; body?: unknown } | null;
  if (e?.status !== 404 && e?.status !== 405) return false;
  const body = e.body;
  if (body === undefined || body === null) return true;
  if (typeof body !== 'object') return false;
  const keys = Object.keys(body);
  const error = (body as Record<string, unknown>).error;
  return keys.length === 1 && typeof error === 'string' && /^not found$/i.test(error.trim());
}

/** A POST to the route. `signal` aborts it. */
export type Send = (body: unknown, signal: AbortSignal) => Promise<unknown>;

const defaultSend: Send = async (body, signal) => {
  const { apiFetch } = await import('@mantle/web-ui/api-fetch');
  return apiFetch(FLEET_TOOL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
};

/** One box's outcome of one tool call. */
export type BoxOutcome = {
  boxId: string;
  outcome: Outcome;
  reason: string | null;
  output: unknown;
};

export type ToolRunOptions = {
  send?: Send;
  /** Follow-ups of pending calls (3 for a write, 0 for a read). */
  followUps?: number;
  gapMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** One POST, given up after `timeoutMs`. */
async function post(send: Send, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await send(body, ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** The code of a failed POST: no channel, nothing queued (400), a timeout,
 *  or the network. */
function failCode(err: unknown, ctlAborted: boolean): string {
  if (isNoChannel(err)) return 'no-channel';
  if (ctlAborted || (err as { name?: string } | null)?.name === 'AbortError') return 'timeout';
  if ((err as { status?: unknown } | null)?.status === 400) return 'not-queued';
  return 'network';
}

/**
 * Run `name` on each of `boxIds` and wait for every box's outcome: the
 * first POST, then up to `followUps` asks for the calls still pending,
 * `gapMs` apart. Null when the Control Center has no admin channel.
 */
export async function runFleetTool(
  boxIds: readonly string[],
  name: string,
  args: Record<string, unknown>,
  opts: ToolRunOptions = {},
): Promise<BoxOutcome[] | null> {
  const send = opts.send ?? defaultSend;
  const timeoutMs = opts.timeoutMs ?? TOOL_POST_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const asked = [...new Set(boxIds.map((b) => b.toLowerCase()))];
  const done = new Map<string, BoxOutcome>();
  const answer = (a: ToolAnswer) => {
    if (done.has(a.boxId)) return;
    done.set(a.boxId, {
      boxId: a.boxId,
      outcome: a.ok ? 'ok' : outcomeOf(a),
      reason: a.reason,
      output: a.output,
    });
  };
  const rest = (outcome: Outcome, reason: string) => {
    for (const b of asked) {
      if (!done.has(b)) done.set(b, { boxId: b, outcome, reason, output: undefined });
    }
    return asked.map((b) => done.get(b)!);
  };

  let reply: ToolReply;
  try {
    reply = parseToolReply(await post(send, { boxIds: asked, name, args }, timeoutMs), {
      boxIds: asked,
    });
  } catch (err) {
    const code = failCode(err, false);
    if (code === 'no-channel') return null;
    return rest(code === 'not-queued' ? 'not-run' : 'unknown', code);
  }
  reply.answers.forEach(answer);
  let pending = reply.pending;
  if (reply.gone.length > 0 && pending.length === 0) return rest('unknown', 'gone');
  for (let round = 0; pending.length > 0 && round < (opts.followUps ?? 0); round++) {
    await sleep(opts.gapMs ?? TOOL_FOLLOW_UP_GAP_MS);
    try {
      const next = parseToolReply(await post(send, { callIds: pending }, timeoutMs), {
        boxIds: asked,
        callIds: pending,
      });
      next.answers.forEach(answer);
      pending = next.pending;
    } catch (err) {
      if (isNoChannel(err)) break;
      // A follow-up that fails is asked again next round.
    }
  }
  return rest('unknown', 'pending');
}
