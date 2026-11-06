import { describe, expect, it } from 'vitest';
import { parseUiCall, withWindowId, WINDOW_ID } from './turn-calls';

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
    });
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
