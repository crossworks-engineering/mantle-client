import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventStreamCore } from './api-fetch';

/**
 * The SSE reader tells a consumer that watches for silence (the messenger)
 * about every frame, keep-alive comments included, and about every connect,
 * reconnects included.
 */

function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eventStreamCore activity and connects', () => {
  it('a comment-only keep-alive counts as activity; data still reaches onMessage', async () => {
    const messages: string[] = [];
    let activity = 0;
    let connects = 0;
    let calls = 0;
    const stop = eventStreamCore(
      () => {
        calls += 1;
        // The first connect speaks; the reconnect hangs until stopped.
        return calls === 1
          ? Promise.resolve(sseResponse([': connected\n\n', ': ping\n\n', 'data: {"a":1}\n\n']))
          : new Promise<Response>(() => {});
      },
      () => {},
      (d) => messages.push(d),
      { onActivity: () => (activity += 1), onConnect: () => (connects += 1) },
    );
    await vi.waitFor(() => expect(messages).toEqual(['{"a":1}']));
    expect(activity).toBe(3);
    expect(connects).toBe(1);
    stop();
  });

  it('every reconnect is a connect', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let connects = 0;
    let calls = 0;
    const stop = eventStreamCore(
      () => {
        calls += 1;
        return calls <= 2
          ? Promise.resolve(sseResponse([': connected\n\n']))
          : new Promise<Response>(() => {});
      },
      () => {},
      () => {},
      { onConnect: () => (connects += 1) },
    );
    // The stream ends after its first frame; the reader backs off (1 s with
    // no jitter) and connects again.
    await vi.waitFor(() => expect(connects).toBe(2), { timeout: 4_000 });
    stop();
  });
});
