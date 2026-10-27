import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A member's tab holds ONE live-update connection (W5c): the rail's
 * subscribers and the member workspace's all share /api/member/realtime.
 */
type StreamOpts = { onActivity?: () => void; onConnect?: () => void };
const opened = vi.hoisted(
  () => [] as { path: string; onMessage: (d: string) => void; opts?: StreamOpts }[],
);
const stopped = vi.hoisted(() => ({ count: 0 }));

vi.mock('@mantle/web-ui/api-fetch', async (orig) => ({
  ...(await orig<typeof import('@mantle/web-ui/api-fetch')>()),
  apiEventStream: (path: string, onMessage: (d: string) => void, opts?: StreamOpts) => {
    opened.push({ path, onMessage, opts });
    return () => {
      stopped.count += 1;
    };
  },
}));

const { subscribeRealtime } = await import('./use-realtime');
const { MEMBER_REALTIME_PATH } = await import('@/lib/realtime-stream');

afterEach(() => {
  vi.useRealTimers();
});

describe('one shared stream per tab', () => {
  it("the rail and the member workspace share the member's one connection", () => {
    vi.useFakeTimers();
    const rail: string[] = [];
    const space: string[] = [];
    // The rail's badge (one type) and the workspace (every type).
    const offRail = subscribeRealtime(MEMBER_REALTIME_PATH, {
      types: ['pending_tool_call'],
      cb: (c) => rail.push(c.id),
    });
    const offSpace = subscribeRealtime(MEMBER_REALTIME_PATH, {
      types: null,
      cb: (c) => space.push(c.id),
    });
    expect(opened.map((o) => o.path)).toEqual([MEMBER_REALTIME_PATH]);

    opened[0]!.onMessage(JSON.stringify({ type: 'page', id: 'p1' }));
    opened[0]!.onMessage(JSON.stringify({ type: 'pending_tool_call', id: 'q1' }));
    expect(rail).toEqual(['q1']);
    expect(space).toEqual(['p1', 'q1']);

    // Closed once, after the last subscriber leaves (and the linger).
    offSpace();
    offRail();
    expect(stopped.count).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(stopped.count).toBe(1);
  });
});

describe('activity and connects reach every subscriber', () => {
  it('the messenger hears keep-alives and reconnects through the shared stream', () => {
    vi.useFakeTimers();
    const path = '/api/messenger/stream';
    let activity = 0;
    let connects = 0;
    const off = subscribeRealtime(path, {
      types: null,
      cb: () => {},
      onActivity: () => (activity += 1),
      onConnect: () => (connects += 1),
    });
    // A subscriber without the hooks is fine too.
    const offPlain = subscribeRealtime(path, { types: null, cb: () => {} });
    const stream = opened.find((o) => o.path === path)!;
    stream.opts?.onConnect?.();
    stream.opts?.onActivity?.();
    stream.opts?.onActivity?.();
    expect(connects).toBe(1);
    expect(activity).toBe(2);
    off();
    offPlain();
    vi.advanceTimersByTime(5_000);
  });
});
