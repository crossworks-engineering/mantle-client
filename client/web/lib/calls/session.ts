/**
 * One login's call, free of React (calls plan page 886126b4 sections 5 and
 * 10): the state machine idle -> ringing -> joining -> live -> ending, and
 * the session that drives it against the brain's routes and a LiveKit room
 * behind a small port (room.ts). The app mounts one session per tab
 * (components/calls/call-store.tsx); the dock, the ring card and the chat
 * header read it through `subscribe`/`snapshot`. Pinned by session.test.ts.
 *
 * A login is in one call at a time across its tabs and devices (the brain
 * swaps the device on a second join), so this holds at most one room. The
 * brain is the truth for who is in a call: this shows the room as LiveKit
 * reports it and leaves by courtesy (POST call/leave); the webhook and the
 * reconciler close what a dropped tab could not.
 */
import type { MessengerCallJoinResponse } from '@/lib/messenger/dto';
import { connectOptionsFor } from './ice';
import type { RoomFactory, RoomPerson, RoomPort } from './room';

export type CallPhase = 'idle' | 'ringing' | 'joining' | 'live' | 'ending';

/** How long an incoming call rings before it stops by itself (plan section 5). */
export const RING_MS = 45_000;
/** A fresh token is fetched this long before the current one runs out. */
export const TOKEN_REFRESH_AHEAD_MS = 5 * 60_000;
/** Never sooner than this after a join (a clock skew guard). */
export const TOKEN_REFRESH_MIN_MS = 30_000;

export type CallRing = {
  conversationId: string;
  callId: string;
  /** The "call started" line's seq: rings once per line. */
  seq: number;
  /** Who started it, as the line names them. */
  callerName: string;
  /** The chat's title, for a group ("Ann in Design"); null for a direct chat. */
  groupTitle: string | null;
  since: number;
};

export type CallState = {
  phase: CallPhase;
  /** The chat whose call this is (while joining, live or ending). */
  conversationId: string | null;
  callId: string | null;
  /** The chat's title, for the dock. */
  title: string;
  ring: CallRing | null;
  /** Everyone in the room, me first. */
  people: RoomPerson[];
  muted: boolean;
  /** The microphone could not be published: in the call, listening only. */
  micBlocked: boolean;
  /** Playback is held by the browser's autoplay rule until a tap. */
  audioBlocked: boolean;
  /** When this tab joined (ms since the epoch), for the duration. */
  liveSince: number | null;
  /** Why the last call ended or did not start; cleared by the next join. */
  notice: string | null;
  /** My rights in this chat's call (a group's admin): end it, remove people. */
  admin: boolean;
};

export const IDLE: CallState = {
  phase: 'idle',
  conversationId: null,
  callId: null,
  title: '',
  ring: null,
  people: [],
  muted: false,
  micBlocked: false,
  audioBlocked: false,
  liveSince: null,
  notice: null,
  admin: false,
};

export type CallAction =
  | { type: 'incoming'; ring: CallRing }
  | { type: 'ring_stop'; reason: 'declined' | 'timeout' | 'ended' | 'answered' }
  | { type: 'join'; conversationId: string; title: string; admin: boolean }
  | { type: 'joined'; callId: string | null; at: number }
  | { type: 'join_failed'; notice: string }
  | { type: 'leave'; notice: string | null }
  | { type: 'left' }
  | { type: 'people'; people: RoomPerson[] }
  | { type: 'muted'; muted: boolean }
  | { type: 'mic_blocked' }
  | { type: 'audio_blocked'; blocked: boolean }
  | { type: 'admin'; admin: boolean }
  | { type: 'clear_notice' };

/**
 * The machine. Every arrow a user or the brain can cause is here; an action
 * that does not fit the phase changes nothing (a late event, a double tap).
 */
export function reduce(s: CallState, a: CallAction): CallState {
  switch (a.type) {
    case 'incoming':
      // One ring at a time, and never while in a call (the badge shows it).
      return s.phase === 'idle' ? { ...s, phase: 'ringing', ring: a.ring, notice: null } : s;
    case 'ring_stop':
      return s.phase === 'ringing' ? { ...s, phase: 'idle', ring: null } : s;
    case 'join':
      if (s.phase !== 'idle' && s.phase !== 'ringing') return s;
      return {
        ...IDLE,
        phase: 'joining',
        conversationId: a.conversationId,
        title: a.title,
        admin: a.admin,
      };
    case 'joined':
      return s.phase === 'joining'
        ? { ...s, phase: 'live', callId: a.callId, liveSince: a.at, notice: null }
        : s;
    case 'join_failed':
      return s.phase === 'joining' ? { ...IDLE, notice: a.notice } : s;
    case 'leave':
      return s.phase === 'joining' || s.phase === 'live'
        ? { ...s, phase: 'ending', notice: a.notice }
        : s;
    case 'left':
      return s.phase === 'ending' ? { ...IDLE, notice: s.notice } : s;
    case 'people':
      return s.phase === 'live' || s.phase === 'joining' ? { ...s, people: a.people } : s;
    case 'muted':
      return { ...s, muted: a.muted };
    case 'mic_blocked':
      return { ...s, micBlocked: true, muted: true };
    case 'audio_blocked':
      return { ...s, audioBlocked: a.blocked };
    case 'admin':
      return { ...s, admin: a.admin };
    case 'clear_notice':
      return s.notice === null ? s : { ...s, notice: null };
  }
}

/** The brain's routes the session needs (lib/calls/api.ts in the app). */
export type CallApi = {
  start: (conversationId: string, device: string) => Promise<MessengerCallJoinResponse>;
  token: (conversationId: string) => Promise<MessengerCallJoinResponse>;
  leave: (conversationId: string) => Promise<unknown>;
  end: (conversationId: string) => Promise<unknown>;
  removeParticipant: (conversationId: string, loginId: string) => Promise<unknown>;
};

export type SessionClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

const realClock: SessionClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The one line a failed join shows, from the brain's status. */
export function joinFailureNotice(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  switch (status) {
    case 404:
      return 'Calls are off on this brain.';
    case 403:
      return 'You are not in this chat any more.';
    case 409:
      return 'The call is full.';
    case 429:
      return 'Too many tries. Wait a minute.';
    case 503:
      return 'The call service is not reachable.';
    default:
      return 'The call could not be started.';
  }
}

/** The words for a room that dropped (the port's reason). */
export function disconnectNotice(reason: string | null): string | null {
  switch (reason) {
    case 'removed':
      return 'You were removed from the call.';
    case 'room_deleted':
      return 'The call ended.';
    case 'duplicate':
      return 'You joined this call from another device.';
    case 'left':
      return null;
    default:
      return 'The call was cut off.';
  }
}

/** When the next token fetch runs, from the brain's expiresAt. */
export function tokenRefreshDelay(expiresAt: string, now: number): number {
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return TOKEN_REFRESH_MIN_MS;
  return Math.max(TOKEN_REFRESH_MIN_MS, at - TOKEN_REFRESH_AHEAD_MS - now);
}

export class CallSession {
  private state: CallState = IDLE;
  private readonly listeners = new Set<() => void>();
  private room: RoomPort | null = null;
  private offRoom: (() => void) | null = null;
  private ringTimer: unknown = null;
  private tokenTimer: unknown = null;
  /** The join in flight, so a leave during it waits for the room. */
  private joining: Promise<void> | null = null;
  private readonly clock: SessionClock;

  constructor(
    private readonly deps: {
      api: CallApi;
      room: RoomFactory;
      /** "web" or "desktop": the brain records it on the stay. */
      device: string;
      clock?: SessionClock;
    },
  ) {
    this.clock = deps.clock ?? realClock;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  snapshot = (): CallState => this.state;

  private dispatch(a: CallAction): void {
    const next = reduce(this.state, a);
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  // ── Incoming ────────────────────────────────────────────────────────────

  /** A "call started" line that should ring (lib/calls/ring.ts decided). */
  incoming(ring: CallRing): void {
    const before = this.state.phase;
    this.dispatch({ type: 'incoming', ring });
    if (before === 'idle' && this.state.phase === 'ringing') {
      this.clearRingTimer();
      this.ringTimer = this.clock.setTimeout(
        () => this.dispatch({ type: 'ring_stop', reason: 'timeout' }),
        RING_MS,
      );
    }
  }

  decline(): void {
    // Nothing is sent: a decline is not a fact other people need (plan
    // section 5). The ring just stops.
    this.clearRingTimer();
    this.dispatch({ type: 'ring_stop', reason: 'declined' });
  }

  /** The brain says the call ended (a call_ended or call_cap line). */
  remoteEnded(conversationId: string, callId: string | null): void {
    const s = this.state;
    if (s.phase === 'ringing' && s.ring?.conversationId === conversationId) {
      if (callId === null || s.ring.callId === callId) {
        this.clearRingTimer();
        this.dispatch({ type: 'ring_stop', reason: 'ended' });
      }
      return;
    }
    if ((s.phase === 'live' || s.phase === 'joining') && s.conversationId === conversationId) {
      if (callId !== null && s.callId !== null && s.callId !== callId) return;
      void this.leave('The call ended.', { tellBrain: false });
    }
  }

  // ── Joining ─────────────────────────────────────────────────────────────

  /** Answer the ring: join that chat's call. */
  answer(title: string, admin: boolean): Promise<void> {
    const ring = this.state.ring;
    if (this.state.phase !== 'ringing' || !ring) return Promise.resolve();
    this.clearRingTimer();
    return this.startOrJoin(ring.conversationId, { title, admin });
  }

  /**
   * Start the chat's call, or join the open one (the brain tells them
   * apart). In another chat's call already: that one is left first.
   */
  async startOrJoin(
    conversationId: string,
    opts: { title: string; admin: boolean },
  ): Promise<void> {
    const s = this.state;
    if ((s.phase === 'live' || s.phase === 'joining') && s.conversationId === conversationId) {
      return;
    }
    if (s.phase === 'live' || s.phase === 'joining' || s.phase === 'ending') {
      await this.leave(null);
    }
    this.clearRingTimer();
    this.dispatch({ type: 'join', conversationId, title: opts.title, admin: opts.admin });
    if (this.state.phase !== 'joining') return;
    const run = this.connect(conversationId);
    this.joining = run;
    try {
      await run;
    } finally {
      if (this.joining === run) this.joining = null;
    }
  }

  private async connect(conversationId: string): Promise<void> {
    let room: RoomPort | null = null;
    try {
      const join = await this.deps.api.start(conversationId, this.deps.device);
      if (this.state.phase !== 'joining' || this.state.conversationId !== conversationId) {
        // Left while the brain was answering: nothing to connect.
        return;
      }
      room = await this.deps.room();
      if (this.state.phase !== 'joining') {
        await room.disconnect().catch(() => {});
        return;
      }
      this.room = room;
      this.offRoom = room.on({
        people: () => this.dispatch({ type: 'people', people: room!.people() }),
        disconnected: (reason) => this.onRoomDropped(room!, reason),
        audioBlocked: (blocked) => this.dispatch({ type: 'audio_blocked', blocked }),
      });
      // THE ICE RULE: the brain's override as rtcConfig.iceServers and
      // nothing else; LiveKit's own list when it sent none (lib/calls/ice.ts).
      await room.connect(join.url, join.token, connectOptionsFor(join.ice));
      if (this.state.phase !== 'joining') {
        await this.teardownRoom(room);
        return;
      }
      this.dispatch({ type: 'joined', callId: join.callId, at: this.clock.now() });
      this.dispatch({ type: 'people', people: room.people() });
      this.scheduleTokenRefresh(conversationId, join.expiresAt);
      try {
        await room.setMicrophoneEnabled(true);
      } catch {
        // No microphone, or no permission: in the call, listening only.
        this.dispatch({ type: 'mic_blocked' });
      }
    } catch (err) {
      if (room) await this.teardownRoom(room);
      if (this.state.phase === 'joining') {
        this.dispatch({ type: 'join_failed', notice: joinFailureNotice(err) });
      }
    }
  }

  private scheduleTokenRefresh(conversationId: string, expiresAt: string): void {
    this.clearTokenTimer();
    this.tokenTimer = this.clock.setTimeout(
      () => {
        this.tokenTimer = null;
        if (this.state.phase !== 'live' || this.state.conversationId !== conversationId) return;
        this.deps.api
          .token(conversationId)
          .then((fresh) => {
            if (this.state.phase !== 'live' || this.state.conversationId !== conversationId) return;
            // LiveKit keeps a live connection on its own refreshed token; the
            // brain's fresh one re-checks my participation and feeds a
            // reconnect from scratch.
            this.room?.updateToken?.(fresh.token);
            this.scheduleTokenRefresh(conversationId, fresh.expiresAt);
          })
          .catch((err: unknown) => {
            const status = (err as { status?: unknown } | null)?.status;
            // Dropped from the chat, or the call closed: leave. Anything else
            // (a blip) tries again later.
            if (status === 403 || status === 404) {
              void this.leave(joinFailureNotice(err), { tellBrain: false });
            } else {
              this.scheduleTokenRefresh(
                conversationId,
                new Date(
                  this.clock.now() + TOKEN_REFRESH_AHEAD_MS + TOKEN_REFRESH_MIN_MS,
                ).toISOString(),
              );
            }
          });
      },
      tokenRefreshDelay(expiresAt, this.clock.now()),
    );
  }

  // ── Leaving ─────────────────────────────────────────────────────────────

  /** Leave the call (Leave in the dock, the call ending, this tab going). */
  async leave(notice: string | null, opts: { tellBrain?: boolean } = {}): Promise<void> {
    const s = this.state;
    if (s.phase !== 'live' && s.phase !== 'joining' && s.phase !== 'ending') return;
    const conversationId = s.conversationId;
    this.dispatch({ type: 'leave', notice });
    this.clearTokenTimer();
    if (this.joining) await this.joining.catch(() => {});
    const room = this.room;
    if (room) await this.teardownRoom(room);
    if (opts.tellBrain !== false && conversationId) {
      await this.deps.api.leave(conversationId).catch(() => {
        /* a courtesy: the brain's reconciler is the truth */
      });
    }
    this.dispatch({ type: 'left' });
  }

  /** End the call for everyone (a group's admin; either person of a direct chat). */
  async end(): Promise<void> {
    const s = this.state;
    if (s.phase !== 'live' || !s.conversationId) return;
    try {
      await this.deps.api.end(s.conversationId);
    } catch {
      return;
    }
    await this.leave(null, { tellBrain: false });
  }

  /** Drop a person from the call (a group's admin). */
  removeParticipant(loginId: string): Promise<unknown> {
    const s = this.state;
    if (s.phase !== 'live' || !s.conversationId) return Promise.resolve();
    return this.deps.api.removeParticipant(s.conversationId, loginId);
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.state.phase !== 'live' || !this.room || this.state.micBlocked) return;
    this.dispatch({ type: 'muted', muted });
    try {
      await this.room.setMicrophoneEnabled(!muted);
    } catch {
      this.dispatch({ type: 'mic_blocked' });
    }
  }

  /** The tap that lets held-back audio play. */
  async resumeAudio(): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.startAudio();
      this.dispatch({ type: 'audio_blocked', blocked: false });
    } catch {
      /* still held: the port reports it */
    }
  }

  /** My rights changed (the chat says I am an admin, or not). */
  setAdmin(admin: boolean): void {
    this.dispatch({ type: 'admin', admin });
  }

  clearNotice(): void {
    this.dispatch({ type: 'clear_notice' });
  }

  /**
   * The tab is going (pagehide): drop the room now and tell the brain with
   * what a leaving page may still send. Best effort; the reconciler closes
   * the stay if this never lands.
   */
  unloadNow(send: (conversationId: string) => void): void {
    const s = this.state;
    if (s.phase !== 'live' && s.phase !== 'joining') return;
    this.clearTokenTimer();
    const room = this.room;
    this.room = null;
    this.offRoom?.();
    this.offRoom = null;
    void room?.disconnect().catch(() => {});
    if (s.conversationId) send(s.conversationId);
    this.dispatch({ type: 'leave', notice: null });
    this.dispatch({ type: 'left' });
  }

  // ── The room ────────────────────────────────────────────────────────────

  private onRoomDropped(room: RoomPort, reason: string | null): void {
    if (this.room !== room) return;
    // LiveKit tried its own reconnects before this: the call is over for
    // this tab. The brain's leave is still sent, so the stay closes fast.
    void this.leave(disconnectNotice(reason));
  }

  private async teardownRoom(room: RoomPort): Promise<void> {
    if (this.room === room) {
      this.room = null;
      this.offRoom?.();
      this.offRoom = null;
    }
    await room.disconnect().catch(() => {});
  }

  private clearRingTimer(): void {
    if (this.ringTimer !== null) {
      this.clock.clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }

  private clearTokenTimer(): void {
    if (this.tokenTimer !== null) {
      this.clock.clearTimeout(this.tokenTimer);
      this.tokenTimer = null;
    }
  }
}
