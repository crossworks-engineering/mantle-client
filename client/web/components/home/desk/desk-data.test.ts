import { afterEach, describe, expect, it, vi } from 'vitest';
import { deskToWire, type DeskPrefs } from '@/lib/home-desk';

const fetchDesk = vi.fn();
vi.mock('@mantle/web-ui/api-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mantle/web-ui/api-fetch')>()),
  apiFetch: (path: string) => fetchDesk(path),
}));

const { carriedDesk, putDesk, readDesk } = await import('./desk-data');

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
  const sent = vi.fn();
  const answer = (status: number, json: unknown) =>
    sent.mockResolvedValueOnce(
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  afterEach(() => {
    sent.mockReset();
    vi.unstubAllGlobals();
  });

  it('sends every save with keepalive, so it outlives the page, and names the login', async () => {
    vi.stubGlobal('fetch', sent);
    answer(200, { homeDesk: body().homeDesk, version: 5 });
    expect(await putDesk(body())).toEqual({ homeDesk: body().homeDesk, version: 5 });
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/profile\/home-desk$/);
    expect(init.method).toBe('PUT');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(body());
  });

  it('a body over the keepalive cap goes without keepalive', async () => {
    vi.stubGlobal('fetch', sent);
    answer(400, { error: 'too big' });
    await expect(putDesk(body(2000))).rejects.toMatchObject({ status: 400 });
    expect((sent.mock.calls[0]![1] as RequestInit).keepalive).toBe(false);
  });

  it('a 409 rejects with the stored desk; a desk named for another login is a quiet 401', async () => {
    vi.stubGlobal('fetch', sent);
    answer(409, { homeDesk: null, version: 9 });
    await expect(putDesk(body())).rejects.toMatchObject({
      status: 409,
      body: { homeDesk: null, version: 9 },
    });
    answer(401, { error: 'loginId is not the login of this session', code: 'login-mismatch' });
    await expect(putDesk(body())).rejects.toMatchObject({
      status: 401,
      body: { code: 'login-mismatch' },
    });
  });
});
