import { describe, expect, it } from 'vitest';
import { callExpired, parseUiCall, withWindowId, WINDOW_ID } from './turn-calls';

describe('parseUiCall', () => {
  it('reads a ui-call event', () => {
    expect(
      parseUiCall({
        callId: '0a0a0a0a-0a0a-40a0-80a0-000000000001',
        action: 'click',
        args: { target: { role: 'button', name: 'Add' } },
      }),
    ).toEqual({
      callId: '0a0a0a0a-0a0a-40a0-80a0-000000000001',
      action: 'click',
      args: { target: { role: 'button', name: 'Add' } },
      expiresAt: null,
    });
  });

  it('reads expiresAt, and a call past it has expired', () => {
    const call = parseUiCall({
      callId: '0a0a0a0a-0a0a-40a0-80a0-000000000001',
      action: 'screen',
      expiresAt: '2026-11-07T10:00:00.000Z',
    })!;
    expect(call.expiresAt).toBe(Date.parse('2026-11-07T10:00:00.000Z'));
    expect(callExpired(call, Date.parse('2026-11-07T09:59:59.000Z'))).toBe(false);
    expect(callExpired(call, Date.parse('2026-11-07T10:00:00.000Z'))).toBe(true);
    // None, or one that does not read: never expires here (the brain still
    // times it out).
    const bare = parseUiCall({ callId: call.callId, action: 'screen', expiresAt: 'soon' })!;
    expect(bare.expiresAt).toBeNull();
    expect(callExpired(bare)).toBe(false);
  });

  it('refuses a call with no id, a bad id or no action', () => {
    expect(parseUiCall(null)).toBeNull();
    expect(parseUiCall({ action: 'screen' })).toBeNull();
    expect(parseUiCall({ callId: '../x', action: 'screen' })).toBeNull();
    expect(parseUiCall({ callId: '0a0a0a0a-0a0a-40a0-80a0-000000000001' })).toBeNull();
  });
});

describe('withWindowId', () => {
  it('names no window while the login has not turned agents on', () => {
    const body = JSON.stringify({ text: 'hi' });
    expect(withWindowId(body, true)).toBe(body);
  });

  it('has a fresh id for this page load, fit for the brain', () => {
    expect(WINDOW_ID).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
