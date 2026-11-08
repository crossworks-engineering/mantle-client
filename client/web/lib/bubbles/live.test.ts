import { describe, expect, it } from 'vitest';
import { LIVE_HOLD_MS, LIVE_TAIL_MAX, liveHeld, liveTail, liveTurnOf } from './live';

describe('liveTurnOf', () => {
  it('is null with no assistant line', () => {
    expect(liveTurnOf([])).toBeNull();
    expect(liveTurnOf([{ id: 'u-1', role: 'user', text: 'hi' }])).toBeNull();
  });

  it('takes the newest assistant line, with its turn and step', () => {
    const live = liveTurnOf([
      { id: 'a-0', role: 'assistant', text: 'old' },
      { id: 'u-1', role: 'user', text: 'list the features' },
      {
        id: 'a-1',
        role: 'assistant',
        text: 'I created',
        pending: true,
        turnId: 'turn-me.1',
        step: '  Reading the release notes ',
      },
    ]);
    expect(live).toEqual({
      id: 'a-1',
      turnId: 'turn-me.1',
      step: 'Reading the release notes',
      text: 'I created',
      pending: true,
      error: false,
    });
  });

  it('reads a line from before the turn id came as no turn and no step', () => {
    const live = liveTurnOf([{ id: 'a-1', role: 'assistant', text: '', pending: true, step: ' ' }]);
    expect(live?.turnId).toBeNull();
    expect(live?.step).toBeNull();
  });
});

describe('liveTail', () => {
  it('shows short text in full, with its marks gone', () => {
    expect(liveTail('# Done\n\nI **made** the [list](/n/x).\n- one\n- two')).toBe(
      'Done I made the list. one two',
    );
  });

  it('drops a fence, closed or still open', () => {
    expect(liveTail('Before ```js\nconst a = 1;\n``` after')).toBe('Before after');
    expect(liveTail('Before\n```js\nconst a = 1;')).toBe('Before');
  });

  it('keeps the end of long text, cut at a word', () => {
    const out = liveTail(`${'start word '.repeat(50)}the newest words`);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('the newest words')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(LIVE_TAIL_MAX + 1);
    expect(out.slice(1).startsWith(' ')).toBe(false);
  });
});

describe('liveHeld', () => {
  const base = {
    shownAtEnd: true,
    closed: false,
    failed: false,
    keysAtStart: ['agent:1'],
    keysNow: ['agent:1'],
    endedAt: 1000,
    now: 2000,
  };

  it('holds until the reply card comes', () => {
    expect(liveHeld(base)).toBe(true);
    expect(liveHeld({ ...base, keysNow: ['agent:1', 'agent:2'] })).toBe(false);
  });

  it('holds no longer than the hold', () => {
    expect(liveHeld({ ...base, now: 1000 + LIVE_HOLD_MS })).toBe(false);
  });

  it('does not come back when it was not on screen, or was closed', () => {
    expect(liveHeld({ ...base, shownAtEnd: false })).toBe(false);
    expect(liveHeld({ ...base, closed: true })).toBe(false);
  });

  it('keeps a failed turn until it is closed', () => {
    expect(liveHeld({ ...base, failed: true, now: 1000 + LIVE_HOLD_MS * 10 })).toBe(true);
    expect(liveHeld({ ...base, failed: true, closed: true })).toBe(false);
  });

  it('is not ended by a card that went', () => {
    expect(liveHeld({ ...base, keysNow: [] })).toBe(true);
  });
});
