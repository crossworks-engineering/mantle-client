/**
 * The capture button's tab share (shareHolder). In the nav drawer the click
 * that starts a capture also closes the drawer, which unmounts the button
 * while the browser is still asking for the share. The holder is released
 * then: it stops the share it holds, and a share the browser grants after
 * that is stopped at once, never left recording with no button to end it.
 */
import { describe, expect, it, vi } from 'vitest';
import { shareHolder } from './area-capture';

/** A stand-in share whose tracks record their stop. */
function fakeShare() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, stopped: () => tracks.every((t) => t.stop.mock.calls.length > 0) };
}

describe('shareHolder', () => {
  it('keeps a share granted while the button is there, and stops it when the capture ends', () => {
    const holder = shareHolder();
    const share = fakeShare();
    expect(holder.adopt(share.stream)).toBe(true);
    expect(holder.current).toBe(share.stream);
    expect(share.stopped()).toBe(false);
    holder.stop();
    expect(share.stopped()).toBe(true);
    expect(holder.current).toBeNull();
  });

  it('the button unmounts with a share open (the drawer closed): the share stops', () => {
    const holder = shareHolder();
    const share = fakeShare();
    holder.adopt(share.stream);
    holder.release();
    expect(share.stopped()).toBe(true);
    expect(holder.current).toBeNull();
    expect(holder.live).toBe(false);
  });

  it('a share granted after the button is gone is stopped at once, not kept', () => {
    const holder = shareHolder();
    // The click: the drawer closes (unmount) while the browser asks.
    holder.release();
    const late = fakeShare();
    expect(holder.adopt(late.stream)).toBe(false);
    expect(late.stopped()).toBe(true);
    expect(holder.current).toBeNull();
  });

  it("a remount (React's strict mode) revives it", () => {
    const holder = shareHolder();
    holder.release();
    holder.revive();
    const share = fakeShare();
    expect(holder.adopt(share.stream)).toBe(true);
    expect(share.stopped()).toBe(false);
    expect(holder.live).toBe(true);
  });
});
