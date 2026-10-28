/**
 * The ICE rule (calls plan page 886126b4 section 20, decision D2 amended):
 * LiveKit advertises its TURN/TLS server to browsers as turns:<domain>:443,
 * a fixed string in the binary, and Caddy holds 443. So the brain hands the
 * client the room's own TURN credential with the ports LiveKit really
 * listens on, and the client connects with THAT list and nothing else: no
 * LiveKit default beside it, no TURN URL derived here. When the brain sends
 * no override (`ice` null: no calls host, or TURN off) the client connects
 * with LiveKit's own list, which is what it does when `rtcConfig` is absent.
 * Pinned by ice.test.ts.
 */
import type { MessengerCallIce } from '@/lib/messenger/dto';

/** The connect options' `rtcConfig`, as a plain object the room port takes. */
export type RtcConfigOverride = { iceServers: RTCIceServer[] };

/** What to pass as `rtcConfig` on connect: the override, or nothing at all. */
export function rtcConfigFor(ice: MessengerCallIce | null | undefined): RtcConfigOverride | null {
  if (!ice || !Array.isArray(ice.urls) || ice.urls.length === 0) return null;
  const urls = ice.urls.filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (urls.length === 0) return null;
  return {
    iceServers: [{ urls, username: ice.username, credential: ice.credential }],
  };
}

/** The connect options object: `{ rtcConfig }` with the override, `{}` without. */
export function connectOptionsFor(ice: MessengerCallIce | null | undefined): {
  rtcConfig?: RtcConfigOverride;
} {
  const rtcConfig = rtcConfigFor(ice);
  return rtcConfig ? { rtcConfig } : {};
}
