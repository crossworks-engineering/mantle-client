import { afterEach, describe, expect, it, vi } from 'vitest';
import { deskToWire, type DeskPrefs } from '@/lib/home-desk';
import type { DeskSend } from '@/lib/home-desk-saver';

const fetchDesk = vi.fn();
vi.mock('@mantle/web-ui/api-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mantle/web-ui/api-fetch')>()),
  apiFetch: (...args: unknown[]) => fetchDesk(...args),
}));

const { carriedDesk, carryUp, putDesk, readDesk } = await import('./desk-data');
const { createDeskSaver } = await import('@/lib/home-desk-saver');

const failure = (status: number) => Object.assign(new Error(`status ${status}`), { status });
const state = (version: number) => ({
  homeDesk: { v: 1, items: [], counts: {}, icons: true, clock: 'digital' },
  version,
});

afterEach(() => {
  fetchDesk.mockReset();
});

describe('reading the desk', () => {
  it("reads the login's desk from its own route", async () => {
    fetchDesk.mockResolvedValue(state(3));
    expect(await readDesk()).toEqual({ local: false, state: state(3) });
    expect(fetchDesk).toHaveBeenCalledWith('/api/profile/home-desk');
  });

  it('keeps the desk in this browser on a brain from before the route (404, 405)', async () => {
    for (const status of [404, 405]) {
      fetchDesk.mockRejectedValueOnce(failure(status));
      expect(await readDesk()).toEqual({ local: true });
    }
  });

  it('lets any other failure fail the read (the desk shown stays)', async () => {
    fetchDesk.mockRejectedValueOnce(failure(500));
    await expect(readDesk()).rejects.toThrow('status 500');
    fetchDesk.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(readDesk()).rejects.toThrow('Failed to fetch');
  });
});

describe('the desk this browser kept before desk saving v2', () => {
  const kept: DeskPrefs = {
    v: 1,
    items: [{ id: 'focus', x: 2, y: 1, w: 3, h: 2 }],
    counts: { notes: 3 },
    icons: false,
    clock: 'analog',
  };
  const stored = JSON.stringify(deskToWire(kept));

  it('is carried up into a profile that never had a desk (null, version 0)', () => {
    expect(carriedDesk({ homeDesk: null, version: 0 }, stored)).toEqual(kept);
  });

  it('never over a desk on the profile, nor once one was ever saved', () => {
    expect(carriedDesk(state(0) as never, stored)).toBeNull();
    expect(carriedDesk({ homeDesk: null, version: 2 }, stored)).toBeNull();
  });

  it('only when this browser holds a desk it can read', () => {
    expect(carriedDesk({ homeDesk: null, version: 0 }, null)).toBeNull();
    expect(carriedDesk({ homeDesk: null, version: 0 }, '{"v":2}')).toBeNull();
    expect(carriedDesk({ homeDesk: null, version: 0 }, 'not json')).toBeNull();
  });
});

describe('saving the desk', () => {
  const body = (items = 0) => ({
    homeDesk: {
      v: 1 as const,
      items: Array.from({ length: items }, (_, i) => ({ id: `pin:${i}`, x: 0, y: i, w: 1, h: 1 })),
      counts: {},
      icons: true,
      clock: 'digital' as const,
    },
    version: 4,
    loginId: 'login-1',
  });

  it('sends every save with keepalive, so it outlives the page, and names the login', async () => {
    fetchDesk.mockResolvedValue(state(5));
    expect(await putDesk(body())).toEqual(state(5));
    const [path, init] = fetchDesk.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/profile/home-desk');
    expect(init.method).toBe('PUT');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(body());
  });

  it('a body over the keepalive cap goes without keepalive', async () => {
    fetchDesk.mockRejectedValue(failure(400));
    await expect(putDesk(body(2000))).rejects.toMatchObject({ status: 400 });
    expect((fetchDesk.mock.calls[0]![1] as RequestInit).keepalive).toBe(false);
  });
});

describe('carrying the v0.8.2 desk up', () => {
  const kept: DeskPrefs = { v: 1, items: [], counts: {}, icons: true, clock: 'analog' };
  const carried = (answer: DeskSend) => {
    const forget = vi.fn();
    const saver = createDeskSaver(answer, { onConflict: vi.fn(), onFailed: vi.fn() });
    return { forget, run: () => carryUp(saver, kept, forget) };
  };

  it('forgets this browser copy once the save lands', async () => {
    const { forget, run } = carried(() => Promise.resolve(state(1) as never));
    await run();
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('forgets it too when the brain refuses the desk (400, 413), so it is not sent every visit', async () => {
    for (const status of [400, 413]) {
      const { forget, run } = carried(() => Promise.reject(failure(status)));
      await run();
      expect(forget, String(status)).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps it when the save failed on the way, or the saver stopped', async () => {
    for (const err of [
      failure(503),
      new TypeError('Failed to fetch'),
      failure(401),
      failure(403),
    ]) {
      const { forget, run } = carried(() => Promise.reject(err));
      await run();
      expect(forget, String(err)).not.toHaveBeenCalled();
    }
  });
});
