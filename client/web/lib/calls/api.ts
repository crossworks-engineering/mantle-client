/**
 * The calls routes (calls plan page 886126b4 section 9; brain
 * docs/messenger.md "Calls"): all under /api/messenger, beside the chat's
 * own. A call is a LiveKit room named after the conversation; the brain
 * mints every token. The DTOs are the local copy in lib/messenger/dto.ts
 * until the brain release ships them in client-types.
 */
import { apiFetch, apiSend, apiUrl, rewritePath, withAuth } from '@mantle/web-ui/api-fetch';
import type {
  MessengerCallJoinResponse,
  MessengerCallStartRequest,
  MessengerCallsResponse,
  MessengerCapabilities,
} from '@/lib/messenger/dto';

const BASE = '/api/messenger';
const call = (id: string) => `${BASE}/c/${encodeURIComponent(id)}/call`;

export const callsKeys = {
  capabilities: ['messenger', 'capabilities'] as const,
  history: (id: string) => ['messenger', 'calls', id] as const,
};

/** The capabilities answer is cached this long (plan section 9). */
export const CAPABILITIES_FRESH_MS = 60_000;

export const callsApi = {
  /** 404 on a brain before calls: the caller reads that as calls off. */
  capabilities: () => apiFetch<MessengerCapabilities>(`${BASE}/capabilities`),
  /** Start the chat's call, or join the open one: a token either way. */
  start: (id: string, body: MessengerCallStartRequest) =>
    apiSend<MessengerCallJoinResponse>(call(id), 'POST', body),
  /** A fresh hour for the open call (re-checks participation). */
  token: (id: string) => apiSend<MessengerCallJoinResponse>(`${call(id)}/token`, 'POST', {}),
  /** My leave, a courtesy: the brain's webhook and reconciler are the truth. */
  leave: (id: string) => apiSend<unknown>(`${call(id)}/leave`, 'POST', {}),
  /** End the call for everyone (a group's admin; either person of a direct chat). */
  end: (id: string) => apiSend<unknown>(`${call(id)}/end`, 'POST', {}),
  /** Drop a person from the call (a group's admin). */
  removeParticipant: (id: string, loginId: string) =>
    apiSend<unknown>(`${call(id)}/participants/${encodeURIComponent(loginId)}`, 'DELETE'),
  /** The chat's calls, newest first. */
  history: (id: string, q: { before?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.before) params.set('before', q.before);
    if (q.limit) params.set('limit', String(q.limit));
    const qs = params.toString();
    return apiFetch<MessengerCallsResponse>(
      `${BASE}/c/${encodeURIComponent(id)}/calls${qs ? `?${qs}` : ''}`,
    );
  },
};

/**
 * The leave a closing tab can still send (pagehide): a keepalive POST with
 * the same auth as every other call. Best effort; the brain's reconciler
 * closes the stay if this never lands.
 */
export function leaveOnUnload(conversationId: string): void {
  try {
    void fetch(
      apiUrl(rewritePath(`${call(conversationId)}/leave`, 'POST')),
      withAuth({
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ).catch(() => {});
  } catch {
    /* a page on its way out */
  }
}
