/**
 * The call machine and the session that drives it: a join with the ICE
 * rule, the ring, a leave, the brain ending the call, a dropped room.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MessengerCallJoinResponse } from '@/lib/messenger/dto';
import type { RoomHandlers, RoomPerson, RoomPort } from './room';
import {
  CallSession,
  IDLE,
  RING_MS,
  TOKEN_REFRESH_AHEAD_MS,
  TOKEN_REFRESH_MIN_MS,
  disconnectNotice,
  joinFailureNotice,
  leaveAfterDrop,
  reduce,
  refreshFailureNotice,
  tokenRefreshDelay,
  type CallRing,
  type CallState,
} from './session';

const ring: CallRing = {
  conversationId: 'c1',
  callId: 'call1',
  seq: 7,
  callerName: 'Ann Lee',
  groupTitle: null,
  since: 1000,
};

const join = (ice: MessengerCallJoinResponse['ice'] = null): MessengerCallJoinResponse => ({
  callId: 'call1',
  room: 'msgr-c1',
  url: 'wss://brain.example/livekit',
  token: 'tok1',
  expiresAt: new Date(60 * 60_000).toISOString(),
  ice,
});

const me: RoomPerson = {
  identity: 'login:me',
  loginId: 'me',
  agentId: null,
  me: true,
  speaking: false,
  muted: false,
};

/** A room that records its calls and lets the test fire its events. */
function fakeRoom(opts: { connectFails?: boolean; micFails?: boolean } = {}) {
  const calls: { connect?: unknown[]; mic: boolean[]; disconnects: number } = {
    mic: [],
    disconnects: 0,
  };
  let handlers: RoomHandlers | null = null;
  let people: RoomPerson[] = [me];
  const port: RoomPort = {
    connect: async (url, token, o) => {
      calls.connect = [url, token, o];
      if (opts.connectFails) throw new Error('no route');
    },
    disconnect: async () => {
      calls.disconnects += 1;
    },
    setMicrophoneEnabled: async (on) => {
      calls.mic.push(on);
      if (opts.micFails) throw new Error('NotAllowedError');
    },
    startAudio: async () => {},
    people: () => people,
    on: (h) => {
      handlers = h;
      return () => {
        handlers = null;
      };
    },
  };
  return {
    port,
    calls,
    fire: () => handlers!,
    setPeople: (p: RoomPerson[]) => {
      people = p;
      handlers?.people();
    },
  };
}

function fakeClock(start = 1000) {
  let now = start;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    clock: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ at: now + ms, fn, id });
        return id;
      },
      clearTimeout: (h: unknown) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    advance: (ms: number) => {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    pending: () => timers.length,
  };
}

function session(
  opts: {
    room?: ReturnType<typeof fakeRoom>;
    start?: () => Promise<MessengerCallJoinResponse>;
    openCall?: () => Promise<string | null>;
    token?: () => Promise<MessengerCallJoinResponse>;
    clock?: ReturnType<typeof fakeClock>;
  } = {},
) {
  const room = opts.room ?? fakeRoom();
  const clock = opts.clock ?? fakeClock();
  const api = {
    start: vi.fn(opts.start ?? (async () => join())),
    openCall: vi.fn(opts.openCall ?? (async () => 'call1')),
    token: vi.fn(opts.token ?? (async () => ({ ...join(), token: 'tok2' }))),
    leave: vi.fn(async () => ({})),
    end: vi.fn(async () => ({})),
    removeParticipant: vi.fn(async () => ({})),
  };
  const s = new CallSession({
    api,
    room: async () => room.port,
    device: 'web',
    clock: clock.clock,
  });
  const phases: string[] = [];
  s.subscribe(() => phases.push(s.snapshot().phase));
  return { s, api, room, clock, phases };
}

describe('reduce', () => {
  it('walks idle -> joining -> live -> ending -> idle', () => {
    let s: CallState = IDLE;
    s = reduce(s, { type: 'join', conversationId: 'c1', title: 'Ann', admin: false, group: false });
    expect(s.phase).toBe('joining');
    s = reduce(s, { type: 'joined', callId: 'call1', at: 5 });
    expect(s).toMatchObject({ phase: 'live', callId: 'call1', liveSince: 5 });
    s = reduce(s, { type: 'leave', notice: null });
    expect(s.phase).toBe('ending');
    s = reduce(s, { type: 'left' });
    expect(s).toEqual(IDLE);
  });
  it('rings only while idle, and one ring at a time', () => {
    const r = reduce(IDLE, { type: 'incoming', ring });
    expect(r).toMatchObject({ phase: 'ringing', ring });
    expect(reduce(r, { type: 'incoming', ring: { ...ring, conversationId: 'c2' } })).toBe(r);
    const live = reduce(
      reduce(IDLE, { type: 'join', conversationId: 'c1', title: '', admin: false, group: false }),
      { type: 'joined', callId: 'x', at: 1 },
    );
    expect(reduce(live, { type: 'incoming', ring })).toBe(live);
  });
  it('a ring stops to idle; a decline sends nothing (no action for it)', () => {
    const r = reduce(IDLE, { type: 'incoming', ring });
    expect(reduce(r, { type: 'ring_stop', reason: 'declined' })).toEqual(IDLE);
    expect(reduce(r, { type: 'ring_stop', reason: 'timeout' })).toEqual(IDLE);
    expect(reduce(IDLE, { type: 'ring_stop', reason: 'ended' })).toBe(IDLE);
  });
  it('answering a ring joins that chat', () => {
    const r = reduce(IDLE, { type: 'incoming', ring });
    const j = reduce(r, {
      type: 'join',
      conversationId: 'c1',
      title: 'Ann',
      admin: false,
      group: false,
    });
    expect(j).toMatchObject({ phase: 'joining', conversationId: 'c1', ring: null });
  });
  it('a failed join is idle with a notice; a late event changes nothing', () => {
    const j = reduce(IDLE, {
      type: 'join',
      conversationId: 'c1',
      title: '',
      admin: false,
      group: false,
    });
    const f = reduce(j, { type: 'join_failed', notice: 'The call is full.' });
    expect(f).toEqual({ ...IDLE, notice: 'The call is full.' });
    expect(reduce(f, { type: 'joined', callId: 'x', at: 1 })).toBe(f);
    expect(reduce(f, { type: 'left' })).toBe(f);
    expect(reduce(f, { type: 'people', people: [me] })).toBe(f);
  });
  it('cannot join twice', () => {
    const j = reduce(IDLE, {
      type: 'join',
      conversationId: 'c1',
      title: '',
      admin: false,
      group: false,
    });
    expect(
      reduce(j, { type: 'join', conversationId: 'c2', title: '', admin: false, group: false }),
    ).toBe(j);
  });
  it('a blocked microphone means muted, listening only', () => {
    const live = reduce(
      reduce(IDLE, { type: 'join', conversationId: 'c1', title: '', admin: false, group: false }),
      { type: 'joined', callId: 'x', at: 1 },
    );
    expect(reduce(live, { type: 'mic_blocked' })).toMatchObject({ micBlocked: true, muted: true });
  });
  it('a room event after the tab left changes nothing', () => {
    expect(reduce(IDLE, { type: 'mic_blocked' })).toBe(IDLE);
    expect(reduce(IDLE, { type: 'muted', muted: true })).toBe(IDLE);
    expect(reduce(IDLE, { type: 'audio_blocked', blocked: true })).toBe(IDLE);
    expect(reduce(IDLE, { type: 'admin', admin: true })).toBe(IDLE);
  });
});

describe('CallSession: join', () => {
  it('starts the call, connects with the brain ICE override only, publishes the mic', async () => {
    const ice = { urls: ['turns:h:5349?transport=tcp'], username: 'msgr-c1', credential: 'p' };
    const room = fakeRoom();
    const { s, api, phases } = session({ room, start: async () => join(ice) });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(api.start).toHaveBeenCalledWith('c1', 'web');
    expect(room.calls.connect).toEqual([
      'wss://brain.example/livekit',
      'tok1',
      { rtcConfig: { iceServers: [{ urls: ice.urls, username: 'msgr-c1', credential: 'p' }] } },
    ]);
    expect(room.calls.mic).toEqual([true]);
    expect(phases).toEqual(['joining', 'live', 'live']);
    expect(s.snapshot()).toMatchObject({ phase: 'live', conversationId: 'c1', callId: 'call1' });
    expect(s.snapshot().people).toEqual([me]);
  });
  it('connects with no rtcConfig at all when the brain sends ice null', async () => {
    const room = fakeRoom();
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(room.calls.connect![2]).toEqual({});
  });
  it('a refused start is idle with the brain line', async () => {
    const { s, phases } = session({
      start: async () => {
        throw Object.assign(new Error('full'), { status: 409 });
      },
    });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(phases).toEqual(['joining', 'idle']);
    expect(s.snapshot().notice).toBe('The call is full.');
  });
  it('a failed connect tears the room down and says so', async () => {
    const room = fakeRoom({ connectFails: true });
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(room.calls.disconnects).toBe(1);
    expect(s.snapshot()).toMatchObject({ phase: 'idle', notice: 'The call could not be started.' });
  });
  it('a blocked microphone keeps the call, listening only', async () => {
    const room = fakeRoom({ micFails: true });
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(s.snapshot()).toMatchObject({ phase: 'live', micBlocked: true, muted: true });
  });
  it('a second tap on the same chat does nothing', async () => {
    const { s, api } = session();
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(api.start).toHaveBeenCalledTimes(1);
  });
  it('joining another chat leaves this one first', async () => {
    const room = fakeRoom();
    const { s, api } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await s.startOrJoin('c2', { title: 'Ben', admin: false, group: false });
    expect(api.leave).toHaveBeenCalledWith('c1');
    expect(api.start).toHaveBeenLastCalledWith('c2', 'web');
    expect(s.snapshot()).toMatchObject({ phase: 'live', conversationId: 'c2' });
  });
  it('leaving while the brain is still answering connects nothing', async () => {
    let resolve!: (j: MessengerCallJoinResponse) => void;
    const room = fakeRoom();
    const { s, api } = session({
      room,
      start: () => new Promise<MessengerCallJoinResponse>((r) => (resolve = r)),
    });
    const joining = s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    const leaving = s.leave(null);
    resolve(join());
    await Promise.all([joining, leaving]);
    expect(room.calls.connect).toBeUndefined();
    expect(api.leave).toHaveBeenCalledWith('c1');
    expect(s.snapshot().phase).toBe('idle');
  });
});

describe('CallSession: in the call', () => {
  it('follows the room: people, speaking, mute', async () => {
    const room = fakeRoom();
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    const ann: RoomPerson = {
      ...me,
      identity: 'login:ann',
      loginId: 'ann',
      me: false,
      speaking: true,
    };
    room.setPeople([me, ann]);
    expect(s.snapshot().people).toEqual([me, ann]);
    await s.setMuted(true);
    expect(room.calls.mic).toEqual([true, false]);
    expect(s.snapshot().muted).toBe(true);
  });
  it('refreshes the token before it runs out, and leaves when the brain refuses', async () => {
    const clock = fakeClock(0);
    const room = fakeRoom();
    let refuse = false;
    const { s, api } = session({
      room,
      clock,
      token: async () => {
        if (refuse) throw Object.assign(new Error('gone'), { status: 403 });
        return { ...join(), token: 'tok2', expiresAt: new Date(2 * 60 * 60_000).toISOString() };
      },
    });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(clock.pending()).toBe(1);
    clock.advance(60 * 60_000 - TOKEN_REFRESH_AHEAD_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(api.token).toHaveBeenCalledWith('c1');
    expect(s.snapshot().phase).toBe('live');
    refuse = true;
    clock.advance(60 * 60_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.snapshot()).toMatchObject({
      phase: 'idle',
      notice: 'You are not in this chat any more.',
    });
    // Refused: the brain already knows, no leave is sent for it.
    expect(api.leave).not.toHaveBeenCalled();
  });
  it('leave: disconnects, tells the brain, idle', async () => {
    const room = fakeRoom();
    const { s, api, phases } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await s.leave(null);
    expect(room.calls.disconnects).toBe(1);
    expect(api.leave).toHaveBeenCalledWith('c1');
    expect(phases.slice(-2)).toEqual(['ending', 'idle']);
    expect(s.snapshot()).toEqual(IDLE);
  });
  it('end: the brain ends it for everyone, then this tab leaves without a second leave', async () => {
    const room = fakeRoom();
    const { s, api } = session({ room });
    await s.startOrJoin('c1', { title: 'Group', admin: true, group: true });
    await s.end();
    expect(api.end).toHaveBeenCalledWith('c1');
    expect(api.leave).not.toHaveBeenCalled();
    expect(s.snapshot().phase).toBe('idle');
  });
  it('a refused end keeps the call and throws to the caller', async () => {
    const { s, api } = session();
    api.end.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
    await s.startOrJoin('c1', { title: 'Group', admin: false, group: true });
    await expect(s.end()).rejects.toThrow('no');
    expect(s.snapshot().phase).toBe('live');
  });
  it('an end line while joining, before the call id is known, is ignored', async () => {
    let resolve!: (j: MessengerCallJoinResponse) => void;
    const { s } = session({
      start: () => new Promise<MessengerCallJoinResponse>((r) => (resolve = r)),
    });
    const joining = s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await new Promise((r) => setTimeout(r, 0));
    s.remoteEnded('c1', 'older-call');
    expect(s.snapshot().phase).toBe('joining');
    resolve(join());
    await joining;
    expect(s.snapshot().phase).toBe('live');
  });
  it('removeParticipant goes to the brain for this chat', async () => {
    const { s, api } = session();
    await s.startOrJoin('c1', { title: 'Group', admin: true, group: true });
    await s.removeParticipant('ben');
    expect(api.removeParticipant).toHaveBeenCalledWith('c1', 'ben');
  });
  it('the brain ending the call (call_ended line) closes this tab without a leave', async () => {
    const room = fakeRoom();
    const { s, api } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    s.remoteEnded('c1', 'call1');
    await new Promise((r) => setTimeout(r, 0));
    expect(room.calls.disconnects).toBe(1);
    expect(api.leave).not.toHaveBeenCalled();
    expect(s.snapshot()).toMatchObject({ phase: 'idle', notice: 'The call ended.' });
  });
  it('an end line of another call or chat is ignored', async () => {
    const { s } = session();
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    s.remoteEnded('c2', 'callX');
    s.remoteEnded('c1', 'older-call');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.snapshot().phase).toBe('live');
  });
  it('a room cut by the network leaves, and tells the brain', async () => {
    const room = fakeRoom();
    const { s, api } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    room.fire().disconnected('other');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.leave).toHaveBeenCalledWith('c1');
    expect(s.snapshot()).toMatchObject({ phase: 'idle', notice: 'The call was cut off.' });
  });
  it('a removal, a swap to another device or a closed room sends no leave', async () => {
    // The brain did those itself; a leave from here would close the stay
    // the other device just opened.
    for (const reason of ['removed', 'duplicate', 'room_deleted'] as const) {
      const room = fakeRoom();
      const { s, api } = session({ room });
      await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
      room.fire().disconnected(reason);
      await new Promise((r) => setTimeout(r, 0));
      expect(api.leave).not.toHaveBeenCalled();
      expect(s.snapshot().phase).toBe('idle');
      expect(s.snapshot().notice).toBe(disconnectNotice(reason));
    }
  });
  it('a failed connect after the brain opened my stay closes it', async () => {
    const room = fakeRoom({ connectFails: true });
    const { s, api } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(api.leave).toHaveBeenCalledWith('c1');
    expect(s.snapshot().phase).toBe('idle');
  });
  it('a refused start owes no leave', async () => {
    const { s, api } = session({
      start: async () => {
        throw Object.assign(new Error('full'), { status: 409 });
      },
    });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    expect(api.leave).not.toHaveBeenCalled();
  });
  it('a leave during a slow connect disconnects the room at once', async () => {
    let settle!: () => void;
    const room = fakeRoom();
    room.port.connect = () =>
      new Promise<void>((_, reject) => {
        settle = () => reject(new Error('cancelled'));
      });
    const { s, api } = session({ room });
    const joining = s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.snapshot().phase).toBe('joining');
    const leaving = s.leave(null);
    await new Promise((r) => setTimeout(r, 0));
    // The room was torn down before the connect settled.
    expect(room.calls.disconnects).toBe(1);
    settle();
    await Promise.all([joining, leaving]);
    expect(api.leave).toHaveBeenCalledTimes(1);
    expect(s.snapshot().phase).toBe('idle');
  });
  it('two taps queued behind one leave start one call, not two', async () => {
    const { s, api } = session();
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await Promise.all([
      s.startOrJoin('c2', { title: 'Ben', admin: false, group: false }),
      s.startOrJoin('c3', { title: 'Cy', admin: false, group: false }),
    ]);
    // One of the two taps won; the other started nothing.
    const started = (api.start.mock.calls as unknown[][]).map((c) => c[0]);
    expect(started).toHaveLength(2);
    expect(started[0]).toBe('c1');
    expect(s.snapshot()).toMatchObject({ phase: 'live', conversationId: started[1] });
    // And the one call was left once, not twice.
    expect(api.leave).toHaveBeenCalledTimes(1);
  });
  it('a late microphone answer after a leave changes nothing', async () => {
    let fail!: () => void;
    const room = fakeRoom();
    room.port.setMicrophoneEnabled = () =>
      new Promise<void>((_, reject) => {
        fail = () => reject(new Error('NotAllowedError'));
      });
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await s.leave(null);
    fail();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.snapshot()).toEqual(IDLE);
  });
  it('unloadNow drops the room and sends the leave the caller can still send', async () => {
    const room = fakeRoom();
    const { s } = session({ room });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    const sent: string[] = [];
    s.unloadNow((c) => sent.push(c));
    expect(sent).toEqual(['c1']);
    expect(room.calls.disconnects).toBe(1);
    expect(s.snapshot().phase).toBe('idle');
  });
});

describe('CallSession: the ring', () => {
  it('rings, then stops by itself after RING_MS', () => {
    const clock = fakeClock();
    const { s } = session({ clock });
    s.incoming(ring);
    expect(s.snapshot()).toMatchObject({ phase: 'ringing', ring });
    clock.advance(RING_MS - 1);
    expect(s.snapshot().phase).toBe('ringing');
    clock.advance(1);
    expect(s.snapshot()).toEqual(IDLE);
  });
  it('decline stops the ring and sends nothing', () => {
    const { s, api } = session();
    s.incoming(ring);
    s.decline();
    expect(s.snapshot()).toEqual(IDLE);
    expect(api.leave).not.toHaveBeenCalled();
    expect(api.end).not.toHaveBeenCalled();
  });
  it('the call ending stops the ring', () => {
    const { s } = session();
    s.incoming(ring);
    s.remoteEnded('c1', 'call1');
    expect(s.snapshot().phase).toBe('idle');
        // A later call of the same chat rings again (call1 is remembered as ended).
    s.incoming({ ...ring, callId: 'call2' });
    s.remoteEnded('c1', 'another');
    expect(s.snapshot().phase).toBe('ringing');
    s.remoteEnded('c1', null);
    expect(s.snapshot().phase).toBe('idle');
  });
  it('answer joins the ringing chat and cancels the timer', async () => {
    const clock = fakeClock();
    const { s, api } = session({ clock });
    s.incoming(ring);
    await s.answer('Ann Lee', { admin: false, group: false });
    expect(api.openCall).toHaveBeenCalledWith('c1');
    expect(api.start).toHaveBeenCalledWith('c1', 'web');
    expect(s.snapshot()).toMatchObject({ phase: 'live', conversationId: 'c1', title: 'Ann Lee' });
    clock.advance(RING_MS);
    expect(s.snapshot().phase).toBe('live');
  });
  it('answer on a call that ended meanwhile starts nothing', async () => {
    const { s, api } = session({ openCall: async () => null });
    s.incoming(ring);
    await s.answer('Ann Lee', { admin: false, group: false });
    expect(api.start).not.toHaveBeenCalled();
    expect(s.snapshot()).toMatchObject({ phase: 'idle', notice: 'The call ended.' });
    // And the same call never rings again here.
    s.incoming(ring);
    expect(s.snapshot().phase).toBe('idle');
  });
  it('joinOpen joins only an open call', async () => {
    const { s, api } = session({ openCall: async () => null });
    expect(await s.joinOpen('c1', { title: 'Ann', admin: false, group: false })).toBe(false);
    expect(api.start).not.toHaveBeenCalled();
    expect(s.snapshot().notice).toBe('The call ended.');
    api.openCall.mockResolvedValueOnce('call1');
    expect(await s.joinOpen('c1', { title: 'Ann', admin: false, group: false })).toBe(true);
    expect(s.snapshot().phase).toBe('live');
  });
  it('a start line of a call the brain already ended never rings', () => {
    const { s } = session();
    s.remoteEnded('c1', 'call1');
    s.incoming(ring);
    expect(s.snapshot().phase).toBe('idle');
  });
  it('my own call never rings my other tabs: started here, or started in a peer tab', async () => {
    const clock = fakeClock();
    const { s } = session({ clock });
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    await s.leave(null);
    expect(s.startedRecently('c1')).toBe(true);
    s.incoming(ring);
    expect(s.snapshot().phase).toBe('idle');
    clock.advance(RING_MS);
    expect(s.startedRecently('c1')).toBe(false);
    s.fromPeer({ kind: 'started', conversationId: 'c2', at: clock.clock.now() });
    s.incoming({ ...ring, conversationId: 'c2', callId: 'call2' });
    expect(s.snapshot().phase).toBe('idle');
  });
  it('answered or declined in another tab stops the ring here, and tells the others', () => {
    const { s } = session();
    const heard: unknown[] = [];
    s.onPeer((e) => heard.push(e));
    s.incoming(ring);
    s.fromPeer({ kind: 'ring_stop', callId: 'other' });
    expect(s.snapshot().phase).toBe('ringing');
    s.fromPeer({ kind: 'ring_stop', callId: 'call1' });
    expect(s.snapshot().phase).toBe('idle');
    s.incoming({ ...ring, callId: 'call9' });
    s.decline();
    expect(heard).toContainEqual({ kind: 'ring_stop', callId: 'call9' });
  });
  it('does not ring while in a call', async () => {
    const { s } = session();
    await s.startOrJoin('c1', { title: 'Ann', admin: false, group: false });
    s.incoming({ ...ring, conversationId: 'c2' });
    expect(s.snapshot().phase).toBe('live');
  });
});

describe('the words', () => {
  it('joinFailureNotice maps the brain status', () => {
    expect(joinFailureNotice({ status: 404 })).toBe('Calls are off on this brain.');
    expect(joinFailureNotice({ status: 409 })).toBe('The call is full.');
    expect(joinFailureNotice({ status: 503 })).toBe('The call service is not reachable.');
    expect(joinFailureNotice(new Error('x'))).toBe('The call could not be started.');
  });
  it('disconnectNotice', () => {
    expect(disconnectNotice('left')).toBeNull();
    expect(disconnectNotice('room_deleted')).toBe('The call ended.');
    expect(disconnectNotice('other')).toBe('The call was cut off.');
  });
  it("leaveAfterDrop: only a drop that was nobody's act", () => {
    expect(leaveAfterDrop('other')).toBe(true);
    expect(leaveAfterDrop(null)).toBe(true);
    expect(leaveAfterDrop('removed')).toBe(false);
    expect(leaveAfterDrop('duplicate')).toBe(false);
    expect(leaveAfterDrop('room_deleted')).toBe(false);
    expect(leaveAfterDrop('left')).toBe(false);
  });
  it('refreshFailureNotice: a 404 on refresh is the call ending', () => {
    expect(refreshFailureNotice({ status: 404 })).toBe('The call ended.');
    expect(refreshFailureNotice({ status: 403 })).toBe('You are not in this chat any more.');
  });
  it('tokenRefreshDelay is ahead of expiry, never under the floor', () => {
    expect(tokenRefreshDelay(new Date(60 * 60_000).toISOString(), 0)).toBe(55 * 60_000);
    expect(tokenRefreshDelay(new Date(1000).toISOString(), 0)).toBe(TOKEN_REFRESH_MIN_MS);
    expect(tokenRefreshDelay('garbage', 0)).toBe(TOKEN_REFRESH_MIN_MS);
  });
});
