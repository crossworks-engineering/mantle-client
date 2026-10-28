/** What travels between a login's tabs. */
import { describe, expect, it } from 'vitest';
import { parsePeerEvent } from './tabs';

describe('parsePeerEvent', () => {
  it('reads the two events and nothing else', () => {
    expect(parsePeerEvent({ kind: 'ring_stop', callId: 'c' })).toEqual({
      kind: 'ring_stop',
      callId: 'c',
    });
    expect(parsePeerEvent({ kind: 'mine', callId: 'x' })).toEqual({ kind: 'mine', callId: 'x' });
    expect(parsePeerEvent({ kind: 'ring_stop' })).toBeNull();
    expect(parsePeerEvent({ kind: 'mine', callId: 7 })).toBeNull();
    expect(parsePeerEvent({ kind: 'other' })).toBeNull();
    expect(parsePeerEvent('ring_stop')).toBeNull();
    expect(parsePeerEvent(null)).toBeNull();
  });
});
