/** The ICE rule: the brain's override alone, or LiveKit's own list. */
import { describe, expect, it } from 'vitest';
import { connectOptionsFor, rtcConfigFor } from './ice';

const ice = {
  urls: ['turns:calls.example:5349?transport=tcp', 'turn:calls.example:3478?transport=udp'],
  username: 'msgr-abc',
  credential: 'secret',
};

describe('rtcConfigFor', () => {
  it('passes the brain override as the one ICE server, nothing else', () => {
    const cfg = rtcConfigFor(ice);
    expect(cfg).toEqual({
      iceServers: [{ urls: ice.urls, username: 'msgr-abc', credential: 'secret' }],
    });
    // Only iceServers: no transport policy, no bundle policy, no extras.
    expect(Object.keys(cfg!)).toEqual(['iceServers']);
    expect(cfg!.iceServers).toHaveLength(1);
  });
  it('keeps the order the brain gave (TURN/TLS first, then UDP)', () => {
    expect(rtcConfigFor(ice)!.iceServers[0]!.urls).toEqual(ice.urls);
  });
  it('is null when the brain sends no override', () => {
    expect(rtcConfigFor(null)).toBeNull();
    expect(rtcConfigFor(undefined)).toBeNull();
    expect(rtcConfigFor({ ...ice, urls: [] })).toBeNull();
  });
  it('never derives a TURN URL itself', () => {
    const cfg = rtcConfigFor({ urls: ['turn:a:3478'], username: 'u', credential: 'c' });
    expect(cfg!.iceServers[0]!.urls).toEqual(['turn:a:3478']);
  });
});

describe('connectOptionsFor', () => {
  it('is {} without an override, so LiveKit uses its own list', () => {
    expect(connectOptionsFor(null)).toEqual({});
    expect('rtcConfig' in connectOptionsFor(null)).toBe(false);
  });
  it('carries only rtcConfig with an override', () => {
    const o = connectOptionsFor(ice);
    expect(Object.keys(o)).toEqual(['rtcConfig']);
    expect(o.rtcConfig).toEqual(rtcConfigFor(ice));
  });
});
