/**
 * Agent UI phase 3, the window's half: an in-app agent's `ui_*` tool calls
 * reach this window over its turn's stream (a `ui-call` event) and are
 * answered with `POST /api/assistant/turn/:turnId/ui/:callId`. Contract:
 * the shared notes' agent-ui-phase3-contract.md; plan page 596dbe4d.
 *
 *  - A turn names this window (`windowId`, fresh on every page load) only
 *    when the login turned on "Let agents use this window"
 *    (`/api/profile/agent-ui`, off by default).
 *  - The first call in a page's life asks the user (a host prompt). Until
 *    they allow it, every call is answered `needs_consent` at once, so the
 *    agent never waits on a person reading a prompt.
 *  - Each call runs on the agent's hands (lib/agent-ui/hands.ts), with all
 *    their guards, and the requests it sets off carry the call's id
 *    (`x-mantle-agent-call`), so the brain refuses a risky one the user did
 *    not allow.
 */
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { agentHands } from './hands';
import { parseTarget, refuse, type AgentResult, type AgentTarget } from './model';

/** This page load's window id: never stored, so a reload or a duplicated
 *  tab is a new window. */
export const WINDOW_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `w-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

let enabled = false;
let loaded: Promise<boolean> | null = null;

/** The login's setting, read once per page load (and after a change). */
export function loadAgentUiSetting(force = false): Promise<boolean> {
  if (!loaded || force) {
    loaded = apiFetch<{ enabled?: boolean }>('/api/profile/agent-ui').then(
      (r) => (enabled = r.enabled === true),
      () => (enabled = false),
    );
  }
  return loaded;
}

export async function setAgentUiSetting(on: boolean, loginId: string): Promise<boolean> {
  const r = await apiSend<{ enabled?: boolean }>('/api/profile/agent-ui', 'PUT', {
    enabled: on,
    loginId,
  });
  enabled = r.enabled === true;
  loaded = Promise.resolve(enabled);
  return enabled;
}

export function agentUiEnabled(): boolean {
  return enabled;
}

/** A turn body with this window named, when the setting is on. */
export function withWindowId(body: FormData | string, isJson: boolean): FormData | string {
  if (!enabled) return body;
  if (!isJson && body instanceof FormData) {
    body.set('windowId', WINDOW_ID);
    return body;
  }
  try {
    const parsed = JSON.parse(body as string) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, windowId: WINDOW_ID });
  } catch {
    return body;
  }
}

/** A `ui-call` event's data, or null. `expiresAt`: when the brain stops
 *  waiting for the answer (epoch ms; null when the event names none or an
 *  unreadable one). */
export type UiCall = {
  callId: string;
  action: string;
  args: Record<string, unknown>;
  expiresAt?: number | null;
};

export function parseUiCall(data: unknown): UiCall | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.callId !== 'string' || !/^[0-9a-f-]{36}$/i.test(d.callId)) return null;
  if (typeof d.action !== 'string') return null;
  const args = d.args && typeof d.args === 'object' ? (d.args as Record<string, unknown>) : {};
  const at = typeof d.expiresAt === 'string' ? Date.parse(d.expiresAt) : NaN;
  return { callId: d.callId, action: d.action, args, expiresAt: Number.isFinite(at) ? at : null };
}

/** A call past its `expiresAt` is not run: the brain has stopped waiting,
 *  and the agent may already have moved on. */
export function callExpired(call: UiCall, now = Date.now()): boolean {
  return typeof call.expiresAt === 'number' && now >= call.expiresAt;
}

let consent: 'unasked' | 'asking' | 'allowed' | 'refused' = 'unasked';
const handled = new Set<string>();
/** The turns this window sent naming itself: only their calls run here. A
 *  call event names no window, and another tab reading the same turn must
 *  not act on it. */
const ownTurns = new Set<string>();

/** This window sent `turnId` with its window id. */
export function claimTurn(turnId: string): void {
  if (enabled) ownTurns.add(turnId);
}
const turnAgents = new Map<string, string>();
/** Turns the user stopped: their later calls answer `stopped`. */
const stoppedTurns = new Set<string>();
let watching = false;

/**
 * Stop on the bar (or Esc) ends the hands' session. While an agent's turn
 * is running here, that is the user stopping the agent itself: its turn is
 * cancelled, every later call of it answers `stopped`, and the next agent
 * has to ask again before it may use this window.
 */
function watchStop(): void {
  if (watching) return;
  watching = true;
  agentHands().subscribe((s) => {
    if (s.active || turnAgents.size === 0) return;
    for (const turnId of turnAgents.keys()) {
      stoppedTurns.add(turnId);
      void apiFetch(`/api/assistant/turn/${encodeURIComponent(turnId)}/cancel`, {
        method: 'POST',
      }).catch(() => undefined);
    }
    turnAgents.clear();
    consent = 'unasked';
  });
}

/** Run one call from the brain and answer it. Each call id once, whichever
 *  of the page's stream readers hears it first. */
export async function handleUiCall(turnId: string, raw: unknown, agentName: string): Promise<void> {
  const call = parseUiCall(raw);
  if (!call || handled.has(call.callId) || !ownTurns.has(turnId)) return;
  handled.add(call.callId);
  const answer = (result: AgentResult<object>) =>
    apiSend(`/api/assistant/turn/${encodeURIComponent(turnId)}/ui/${call.callId}`, 'POST', {
      windowId: WINDOW_ID,
      result,
    }).catch(() => undefined);

  if (!enabled) return void answer(refuse('no_session'));
  if (stoppedTurns.has(turnId)) return void answer(refuse('stopped'));
  if (callExpired(call)) return void answer(refuse('window_gone'));
  if (consent !== 'allowed') {
    // Answer now; the agent asks again once the user has allowed it.
    void answer(refuse('needs_consent'));
    if (consent === 'unasked') {
      consent = 'asking';
      const ok = await agentHands().askConsent(agentName);
      consent = ok ? 'allowed' : 'refused';
    }
    return;
  }
  watchStop();
  const hands = agentHands();
  turnAgents.set(turnId, agentName);
  if (!hands.get().active) hands.begin(agentName);
  // Checked again as it runs: a call can wait behind the one before it.
  const result = await hands.withCall(
    call.callId,
    () => (callExpired(call) ? Promise.resolve(refuse('window_gone')) : runUiCall(call)),
    { expiresAt: call.expiresAt },
  );
  await answer(result);
}

/** The agent's turn is over: its session ends with it. */
export function endAgentTurn(turnId: string): void {
  ownTurns.delete(turnId);
  // Deleted before the session ends, so its end is not read as Stop.
  if (!turnAgents.delete(turnId)) return;
  if (turnAgents.size === 0) agentHands().end();
}

function target(args: Record<string, unknown>): AgentTarget | null {
  return parseTarget(args.target);
}

/** One call on the hands. `ui_type` adds to what the field holds unless
 *  the agent says `replace: true` (fix round contract, section 4). */
export async function runUiCall(call: UiCall): Promise<AgentResult<object>> {
  const hands = agentHands();
  const a = call.args;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (call.action) {
    case 'screen':
      return hands.screen();
    case 'navigate':
      return hands.go(str(a.path));
    case 'click': {
      const t = target(a);
      return t ? hands.click(t) : refuse('not_found', 'No target.');
    }
    case 'type': {
      const t = target(a);
      return t
        ? hands.type(t, str(a.text), { replace: a.replace === true })
        : refuse('not_found', 'No target.');
    }
    case 'select': {
      const t = target(a);
      return t ? hands.select(t, str(a.option)) : refuse('not_found', 'No target.');
    }
    case 'point': {
      const t = target(a);
      return t ? hands.point(t, str(a.caption)) : refuse('not_found', 'No target.');
    }
    case 'wait':
      return hands.wait(a.target === undefined ? null : target(a), Number(a.ms) || 3000);
    default:
      return refuse('unsupported', `Unknown action "${call.action}".`);
  }
}
