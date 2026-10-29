/** Which sound each app event makes (lib/sounds/events.ts). */
import { describe, expect, it } from 'vitest';
import {
  activityChanges,
  agentLineSounds,
  callTroubleSound,
  chatLineSound,
  commitFailedSound,
  freshKeys,
  goneIds,
  runEndSound,
  uploadBatchSound,
} from './events';

describe('chatLineSound', () => {
  it('is a mention when the line names my login', () => {
    const message = { mentions: [{ kind: 'login' as const, id: 'me' }] };
    expect(chatLineSound(message, 'me')).toBe('mention');
  });

  it('is a plain message when it names someone else, or an agent with my id', () => {
    expect(chatLineSound({ mentions: [{ kind: 'login', id: 'ann' }] }, 'me')).toBe('message');
    expect(chatLineSound({ mentions: [{ kind: 'agent', id: 'me' }] }, 'me')).toBe('message');
  });

  it('is a plain message with no mentions or no known login', () => {
    expect(chatLineSound({ mentions: [] }, 'me')).toBe('message');
    expect(chatLineSound({}, 'me')).toBe('message');
    expect(chatLineSound({ mentions: [{ kind: 'login', id: 'me' }] }, null)).toBe('message');
  });
});

describe('freshKeys', () => {
  it('seeds on the first look: what was there makes no sound', () => {
    const { seen, fresh } = freshKeys(null, ['a', 'b']);
    expect(fresh).toEqual([]);
    expect([...seen]).toEqual(['a', 'b']);
  });

  it('reports only the new keys, once', () => {
    const seen = new Set(['a']);
    expect(freshKeys(seen, ['a', 'b']).fresh).toEqual(['b']);
    expect(freshKeys(seen, ['a', 'b']).fresh).toEqual([]);
  });

  it('keeps a key that went away, so its return is not new', () => {
    const seen = new Set(['a']);
    freshKeys(seen, []);
    expect(freshKeys(seen, ['a']).fresh).toEqual([]);
  });

  it('seeds an empty first look, then everything after is new', () => {
    const { seen } = freshKeys(null, []);
    expect(freshKeys(seen, ['x']).fresh).toEqual(['x']);
  });
});

describe('runEndSound', () => {
  it('chimes complete for a done run, danger for a failed one', () => {
    expect(runEndSound('done')).toBe('complete');
    expect(runEndSound('completed')).toBe('complete');
    expect(runEndSound('failed')).toBe('danger');
  });

  it('stays quiet for a run someone stopped, or an unknown state', () => {
    expect(runEndSound('cancelled')).toBeNull();
    expect(runEndSound('superseded')).toBeNull();
    expect(runEndSound('running')).toBeNull();
    expect(runEndSound(undefined)).toBeNull();
  });
});

describe('goneIds', () => {
  it('lists the ids that left', () => {
    expect(goneIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(goneIds([], ['a'])).toEqual([]);
  });
});

describe('callTroubleSound', () => {
  const calm = { phase: 'live', micBlocked: false, audioBlocked: false };

  it('warns when the mic or the speaker becomes blocked', () => {
    expect(callTroubleSound(calm, { ...calm, micBlocked: true })).toBe('warning');
    expect(callTroubleSound(calm, { ...calm, audioBlocked: true })).toBe('warning');
  });

  it('says nothing while it stays blocked, or when it clears', () => {
    const blocked = { ...calm, micBlocked: true };
    expect(callTroubleSound(blocked, blocked)).toBeNull();
    expect(callTroubleSound(blocked, calm)).toBeNull();
  });

  it('is danger when a join fails, not when a call ends', () => {
    const joining = { ...calm, phase: 'joining' };
    expect(callTroubleSound(joining, { ...calm, phase: 'idle' })).toBe('danger');
    expect(callTroubleSound(calm, { ...calm, phase: 'ending' })).toBeNull();
    expect(callTroubleSound({ ...calm, phase: 'ending' }, { ...calm, phase: 'idle' })).toBeNull();
  });
});

describe('uploadBatchSound', () => {
  it('is success when every file went through or was already there', () => {
    expect(uploadBatchSound(['done', 'exists'])).toBe('success');
  });

  it('warns when any file was refused or failed', () => {
    expect(uploadBatchSound(['done', 'error'])).toBe('warning');
    expect(uploadBatchSound(['conflict'])).toBe('warning');
  });

  it('stays quiet for a batch that was all cancelled, or empty', () => {
    expect(uploadBatchSound(['cancelled'])).toBeNull();
    expect(uploadBatchSound([])).toBeNull();
  });
});

describe('commitFailedSound', () => {
  it('warns on a changed-elsewhere 409, danger otherwise', () => {
    expect(commitFailedSound(409)).toBe('warning');
    expect(commitFailedSound(500)).toBe('danger');
    expect(commitFailedSound(null)).toBe('danger');
  });
});

describe('activityChanges', () => {
  const item = (traceId: string, kind = 'extractor_run') => ({ traceId, kind });
  const snap = (active: string[], recent: string[] = [], failures: string[] = []) => ({
    active: active.map((id) => item(id)),
    recent: recent.map((id) => item(id)),
    failures: failures.map((id) => item(id)),
  });

  it('seeds on the first look: items already running are quiet', () => {
    const first = activityChanges(null, snap(['a', 'b']));
    expect(first.starts).toEqual([]);
    expect(first.ends).toEqual([]);
    expect([...first.known.keys()]).toEqual(['a', 'b']);
  });

  it('starts only the new ones, once', () => {
    const { known } = activityChanges(null, snap(['a']));
    const next = activityChanges(known, snap(['a', 'b']));
    expect(next.starts).toEqual(['b']);
    expect(activityChanges(next.known, snap(['a', 'b'])).starts).toEqual([]);
  });

  it('ends a finished item as complete and a failed one as danger', () => {
    const { known } = activityChanges(null, snap(['a', 'b', 'c']));
    const next = activityChanges(known, snap([], ['a'], ['b']));
    expect(next.ends).toEqual([
      { id: 'a', sound: 'complete' },
      { id: 'b', sound: 'danger' },
    ]);
  });

  it("leaves a conversation turn's end to the reply sound", () => {
    const known = new Map([['t', 'responder_turn']]);
    expect(activityChanges(known, snap([], ['t'])).ends).toEqual([]);
  });

  it('starts every new item, conversation turns included', () => {
    const next = activityChanges(new Map(), {
      active: [item('t', 'responder_turn')],
      recent: [],
      failures: [],
    });
    expect(next.starts).toEqual(['t']);
  });
});

describe('agentLineSounds', () => {
  it('stays quiet on the assistant screen, where the reply sounds', () => {
    expect(agentLineSounds('/assistant')).toBe(false);
    expect(agentLineSounds('/assistant/abc')).toBe(false);
  });

  it('sounds anywhere else', () => {
    expect(agentLineSounds('/chats')).toBe(true);
    expect(agentLineSounds('/assistant-settings')).toBe(true);
    expect(agentLineSounds(null)).toBe(true);
  });
});
