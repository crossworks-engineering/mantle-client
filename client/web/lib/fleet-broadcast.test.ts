import { describe, expect, it } from 'vitest';
import {
  boxBroadcastLine,
  broadcastBoxName,
  broadcastIssue,
  broadcastPending,
  broadcastRequest,
  markLine,
  takenCount,
  type FleetBroadcast,
} from './fleet-broadcast';

const b = (marks: FleetBroadcast['marks'], boxIds = ['b1', 'b2']): FleetBroadcast => ({
  id: 'x',
  title: null,
  body: 'Hello',
  madeBy: 'it@example.com',
  madeAt: '2026-11-21T10:00:00.000Z',
  boxIds,
  marks,
});

describe('the broadcast form', () => {
  it('asks for a message, and holds the caps', () => {
    expect(broadcastIssue('', '   ')).toBe('Write the message first.');
    expect(broadcastIssue('', 'x'.repeat(8001))).toMatch(/at most 8000/);
    // The title and a blank line share the box's one chat line.
    expect(broadcastIssue('Tonight', 'x'.repeat(7991))).toBeNull();
    expect(broadcastIssue('Tonight', 'x'.repeat(7992))).toMatch(/With this title.*7991/);
    expect(broadcastIssue('y'.repeat(201), 'x')).toMatch(/title is at most 200/);
    expect(broadcastIssue('', 'Hello')).toBeNull();
  });

  it('sends the title only when one is typed, and the text trimmed', () => {
    expect(broadcastRequest('  ', ' Hi ', ['b1'])).toEqual({ text: 'Hi', boxIds: ['b1'] });
    expect(broadcastRequest(' Tonight ', 'Hi', ['b1', 'b2'])).toEqual({
      title: 'Tonight',
      text: 'Hi',
      boxIds: ['b1', 'b2'],
    });
  });
});

describe('the marks', () => {
  const at = { at: '2026-11-21T10:01:00.000Z', was: 'new' as const };
  it('counts the boxes that took it, and reads again only while a linked box has had no try', () => {
    const linked = [{ id: 'b1' }, { id: 'b2' }];
    expect(takenCount(b({ b1: at }))).toBe(1);
    expect(broadcastPending([b({ b1: at })], linked)).toBe(true);
    expect(broadcastPending([b({ b1: at, b2: { ...at, was: 'already' } })], linked)).toBe(false);
    // A failure waits for the next run; a removed box never answers.
    expect(
      broadcastPending([b({ b1: at, b2: { reason: 'unreachable', tried: 'x' } })], linked),
    ).toBe(false);
    expect(broadcastPending([b({ b1: at })], [{ id: 'b1' }])).toBe(false);
    expect(broadcastPending(undefined, linked)).toBe(false);
  });

  it('says delivered, waiting, or the failure with its reason', () => {
    const one = b({ b1: at, b2: { reason: 'unreachable', tried: '2026-11-21T10:01:00.000Z' } });
    expect(markLine(one, 'b1')).toEqual({ tone: 'ok', text: 'Delivered', reason: null });
    expect(markLine(one, 'b2')).toMatchObject({
      tone: 'bad',
      reason: expect.stringMatching(/HTTPS/),
    });
    expect(markLine(b({}), 'b1')).toMatchObject({ tone: 'wait' });
    const old = b({ b1: { reason: 'bad-call', tried: 'x' } });
    expect(markLine(old, 'b1').reason).toMatch(/release behind/);
  });

  it('a box card shows its word on the newest broadcast it was sent', () => {
    const list = [b({ b1: at }, ['b1']), b({}, ['b1', 'b2'])];
    expect(boxBroadcastLine(list, 'b1')).toEqual({ tone: 'ok', text: 'Last broadcast: Delivered' });
    expect(boxBroadcastLine(list, 'b2')).toMatchObject({ tone: 'wait' });
    expect(boxBroadcastLine(list, 'b3')).toBeNull();
  });

  it('names a box no longer linked', () => {
    expect(
      broadcastBoxName([{ id: 'b1', url: 'https://one.example.com', label: 'One' }], 'b1'),
    ).toBe('One');
    expect(broadcastBoxName([], 'b9')).toBe('A box no longer linked');
  });
});
