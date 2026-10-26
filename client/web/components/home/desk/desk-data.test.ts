import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, onlineManager } from '@tanstack/react-query';

const fetchShell = vi.fn();
vi.mock('@mantle/web-ui/api-fetch', () => ({
  apiFetch: (path: string) => fetchShell(path),
}));

const { readShellNow, shellReadAt, watchShell } = await import('./desk-data');

afterEach(() => {
  fetchShell.mockReset();
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe('reading the shell for the desk', () => {
  it('fails at once offline, never paused until the network is back', async () => {
    onlineManager.setOnline(false);
    fetchShell.mockRejectedValue(new TypeError('Failed to fetch'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(readShellNow(qc)).rejects.toThrow('Failed to fetch');
    expect(fetchShell).toHaveBeenCalledWith('/api/shell');
  });

  it('dates the shell by its last read, not by a write of our own', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    fetchShell.mockResolvedValue({ homeDesk: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    watchShell(qc);
    expect(shellReadAt(qc)).toBe(0); // never read
    await readShellNow(qc);
    expect(shellReadAt(qc)).toBe(1_000_000);
    // A save puts the desk in the shell's copy: the read is as old as it was.
    vi.setSystemTime(2_000_000);
    qc.setQueryData(['shell'], { homeDesk: { v: 1 } });
    expect(qc.getQueryState(['shell'])?.dataUpdatedAt).toBe(2_000_000);
    expect(shellReadAt(qc)).toBe(1_000_000);
    // A read that lands moves it on.
    vi.setSystemTime(3_000_000);
    await readShellNow(qc);
    expect(shellReadAt(qc)).toBe(3_000_000);
  });

  it('takes the cached read as the last one when the watcher starts after it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    fetchShell.mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await readShellNow(qc);
    vi.setSystemTime(6_000_000);
    watchShell(qc);
    qc.setQueryData(['shell'], { homeDesk: null });
    expect(shellReadAt(qc)).toBe(5_000_000);
  });
});
