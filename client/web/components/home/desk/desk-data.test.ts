import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const fetchDesk = vi.fn();
vi.mock('@mantle/web-ui/api-fetch', () => ({
  apiFetch: (path: string) => fetchDesk(path),
}));

const { deskQueryKey, readDesk } = await import('./desk-data');

const failure = (status: number) => Object.assign(new Error(`status ${status}`), { status });
const state = (version: number) => ({
  homeDesk: { v: 1, items: [], counts: {}, icons: true, clock: 'digital' },
  version,
});

afterEach(() => {
  fetchDesk.mockReset();
});

describe('reading the desk', () => {
  const key = 'mantle_home_desk_v1:b:l';

  it("reads the login's desk from its own route", async () => {
    fetchDesk.mockResolvedValue(state(3));
    expect(await readDesk(new QueryClient(), key)).toEqual({ local: false, state: state(3) });
    expect(fetchDesk).toHaveBeenCalledWith('/api/profile/home-desk');
  });

  it('keeps the desk in this browser on a brain from before the route (404, 405)', async () => {
    for (const status of [404, 405]) {
      fetchDesk.mockRejectedValueOnce(failure(status));
      expect(await readDesk(new QueryClient(), key)).toEqual({ local: true });
    }
  });

  it('lets any other failure fail the read (the desk shown stays)', async () => {
    fetchDesk.mockRejectedValueOnce(failure(500));
    await expect(readDesk(new QueryClient(), key)).rejects.toThrow('status 500');
    fetchDesk.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(readDesk(new QueryClient(), key)).rejects.toThrow('Failed to fetch');
  });

  it('never moves the cache back: a read older than the saved desk keeps the saved one', async () => {
    const qc = new QueryClient();
    qc.setQueryData(deskQueryKey(key), { local: false, state: state(5) });
    fetchDesk.mockResolvedValueOnce(state(4));
    expect(await readDesk(qc, key)).toEqual({ local: false, state: state(5) });
    fetchDesk.mockResolvedValueOnce(state(6));
    expect(await readDesk(qc, key)).toEqual({ local: false, state: state(6) });
  });
});
