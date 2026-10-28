/**
 * The other tabs of this login, same origin (a BroadcastChannel): answered
 * or declined in one tab stops the ring in the rest, and a call started in
 * one tab is mine in the rest, so none of them rings for it. Best effort:
 * a browser without the channel has every tab ring on its own, as before.
 * The desktop's windows of one brain share the channel (one partition).
 */
import type { CallPeerEvent, CallSession } from './session';

export const CALLS_CHANNEL = 'mantle-calls';

/** What travels: the event, as sent. Anything else on the channel is noise. */
export function parsePeerEvent(data: unknown): CallPeerEvent | null {
  if (!data || typeof data !== 'object') return null;
  const e = data as Record<string, unknown>;
  if (e.kind === 'ring_stop' && typeof e.callId === 'string' && e.callId) {
    return { kind: 'ring_stop', callId: e.callId };
  }
  if (e.kind === 'mine' && typeof e.callId === 'string' && e.callId) {
    return { kind: 'mine', callId: e.callId };
  }
  if (
    e.kind === 'pending' &&
    typeof e.conversationId === 'string' &&
    e.conversationId &&
    typeof e.on === 'boolean'
  ) {
    return { kind: 'pending', conversationId: e.conversationId, on: e.on };
  }
  return null;
}

/** Wire the session to the channel; returns the unsubscribe. */
export function connectTabs(session: CallSession): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CALLS_CHANNEL);
  } catch {
    return () => {};
  }
  const onMessage = (ev: MessageEvent) => {
    const e = parsePeerEvent(ev.data);
    if (e) session.fromPeer(e);
  };
  channel.addEventListener('message', onMessage);
  const off = session.onPeer((e) => {
    try {
      channel.postMessage(e);
    } catch {
      /* a closed channel */
    }
  });
  return () => {
    off();
    channel.removeEventListener('message', onMessage);
    channel.close();
  };
}
